import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat';
import { getTools } from './tools/index';
import { getSystemPrompt } from './system-prompt';
import type { ResolvedConfig } from './config';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
};

function truncate(str: string, n: number): string {
  if (str.length <= n) return str;
  return str.slice(0, n) + '…';
}

function formatToolArgs(argsStr: string): string {
  try {
    const args = JSON.parse(argsStr) as Record<string, unknown>;
    if (typeof args.command === 'string') return truncate(args.command, 70);
    if (typeof args.path === 'string') return args.path;
    if (typeof args.pattern === 'string') return args.pattern;
    return truncate(JSON.stringify(args), 70);
  } catch {
    return truncate(argsStr, 70);
  }
}

function buildToolDefs(tools: ReturnType<typeof getTools>): ChatCompletionTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.function.name,
      description: t.function.description ?? '',
      parameters: t.function.parameters as Record<string, unknown>,
    },
  }));
}

export class Agent {
  private client: OpenAI;
  private messages: ChatCompletionMessageParam[] = [];
  private tools: ReturnType<typeof getTools>;
  private toolDefs: ChatCompletionTool[];

  constructor(private cfg: ResolvedConfig) {
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
    this.tools = getTools();
    this.toolDefs = buildToolDefs(this.tools);
  }

  clearHistory(): void {
    this.messages = [];
  }

  switchProvider(cfg: ResolvedConfig): void {
    this.cfg = cfg;
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
  }

  private async executeTool(name: string, argsStr: string): Promise<string> {
    const tool = this.tools.find(t => t.function.name === name);
    if (!tool) return `Error: unknown tool "${name}"`;

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argsStr);
    } catch {
      return `Error: could not parse tool arguments: ${argsStr}`;
    }

    try {
      const result = await (tool.function as any).function(args);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  }

  async chat(userMessage: string): Promise<void> {
    this.messages.push({ role: 'user', content: userMessage });

    // Build the full message list (system prompt + history) fresh each turn.
    // We manage this array directly so we have complete control over what
    // gets sent — no extra fields (like 'parsed') that non-OpenAI providers reject.
    const conversation: ChatCompletionMessageParam[] = [
      { role: 'system', content: getSystemPrompt(process.cwd()) },
      ...this.messages,
    ];

    const MAX_ROUNDS = 15;

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        // Stream the next completion
        const stream = await this.client.chat.completions.create({
          model: this.cfg.model,
          messages: conversation,
          tools: this.toolDefs,
          stream: true,
        });

        let content = '';
        const toolCallMap: Record<
          number,
          { id: string; name: string; args: string }
        > = {};
        let finishReason = '';

        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;

          // Stream text tokens directly to stdout
          if (delta.content) {
            content += delta.content;
            process.stdout.write(`${C.cyan}${delta.content}${C.reset}`);
          }

          // Accumulate tool-call deltas (they arrive in fragments)
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallMap[idx]) {
                toolCallMap[idx] = { id: '', name: '', args: '' };
              }
              if (tc.id) toolCallMap[idx].id = tc.id;
              if (tc.function?.name) toolCallMap[idx].name = tc.function.name;
              if (tc.function?.arguments)
                toolCallMap[idx].args += tc.function.arguments;
            }
          }

          if (choice.finish_reason) finishReason = choice.finish_reason;
        }

        const toolCalls = Object.values(toolCallMap).filter(tc => tc.name);

        // No tool calls → final text response, done
        if (toolCalls.length === 0 || finishReason === 'stop') {
          if (content) process.stdout.write('\n');
          conversation.push({ role: 'assistant', content });
          break;
        }

        // Has tool calls — finish any streamed text first
        if (content) process.stdout.write('\n');

        // Append the assistant message (only standard fields, no 'parsed')
        conversation.push({
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.args },
          })),
        });

        // Execute each tool and feed results back
        for (const tc of toolCalls) {
          process.stdout.write(
            `\n${C.dim}⚙  ${C.yellow}${tc.name}${C.reset}${C.dim}(${formatToolArgs(tc.args)})${C.reset}\n`,
          );

          const result = await this.executeTool(tc.name, tc.args);

          // Show a short preview of the result
          const lines = result.split('\n');
          for (const line of lines.slice(0, 8)) {
            process.stdout.write(`${C.dim}   ${line}${C.reset}\n`);
          }
          if (lines.length > 8) {
            process.stdout.write(
              `${C.dim}   … (${lines.length - 8} more lines)${C.reset}\n`,
            );
          }

          conversation.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          });
        }
        // Loop back → model sees tool results and continues
      }

      // Persist history (strip system prompt)
      this.messages = conversation.slice(1);
    } catch (err: any) {
      this.messages.pop(); // roll back the user message on failure
      throw new Error(err.message ?? String(err));
    }
  }
}
