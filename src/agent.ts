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
  green: '\x1b[32m',
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

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
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

interface ToolCallAccum {
  id: string;
  name: string;
  args: string;
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

    const conversation: ChatCompletionMessageParam[] = [
      { role: 'system', content: getSystemPrompt(process.cwd()) },
      ...this.messages,
    ];

    const MAX_ROUNDS = 15;
    const startTime = Date.now();
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const roundStart = Date.now();

        const streamParams: any = {
          model: this.cfg.model,
          messages: conversation,
          tools: this.toolDefs,
          stream: true,
          // Request usage stats in the final chunk (supported by Groq & OpenAI)
          stream_options: { include_usage: true },
        };
        const stream = (await this.client.chat.completions.create(streamParams)) as unknown as AsyncIterable<any>;

        let content = '';
        const toolCallMap: Record<number, ToolCallAccum> = {};
        let finishReason = '';
        let roundPromptTokens = 0;
        let roundCompletionTokens = 0;

        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];

          // Final usage chunk (no choices)
          if (chunk.usage) {
            roundPromptTokens = chunk.usage.prompt_tokens ?? 0;
            roundCompletionTokens = chunk.usage.completion_tokens ?? 0;
            totalPromptTokens += roundPromptTokens;
            totalCompletionTokens += roundCompletionTokens;
          }

          if (!choice) continue;

          const delta = choice.delta;

          if (delta?.content) {
            content += delta.content;
            process.stdout.write(`${C.cyan}${delta.content}${C.reset}`);
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              // index can be 0 which is falsy — use ?? not ||
              const idx = tc.index ?? 0;
              if (!toolCallMap[idx]) {
                toolCallMap[idx] = { id: '', name: '', args: '' };
              }
              // IDs and names only arrive in the first delta for that index
              if (tc.id) toolCallMap[idx].id = tc.id;
              if (tc.function?.name) toolCallMap[idx].name += tc.function.name;
              if (tc.function?.arguments) toolCallMap[idx].args += tc.function.arguments;
            }
          }

          if (choice.finish_reason) finishReason = choice.finish_reason;
        }

        const roundMs = Date.now() - roundStart;

        // Filter to valid, complete tool calls
        const toolCalls = Object.values(toolCallMap).filter(
          tc => tc.name && tc.args,
        );

        // Ensure every tool call has a non-empty ID (some providers omit it)
        for (let i = 0; i < toolCalls.length; i++) {
          if (!toolCalls[i].id) {
            toolCalls[i].id = `call_${Date.now()}_${i}`;
          }
        }

        // Print token stats for this round
        if (roundPromptTokens > 0 || roundCompletionTokens > 0) {
          const tokStr =
            roundPromptTokens > 0
              ? `↑${formatTokens(roundPromptTokens)} ↓${formatTokens(roundCompletionTokens)}`
              : `↓${formatTokens(roundCompletionTokens)}`;
          process.stdout.write(
            `\n${C.dim}[${this.cfg.provider} · ${this.cfg.model} · ${tokStr} tokens · ${roundMs}ms]${C.reset}`,
          );
        }

        // No tool calls → final text response
        if (toolCalls.length === 0 || finishReason === 'stop') {
          process.stdout.write('\n');
          conversation.push({ role: 'assistant', content });
          break;
        }

        if (content) process.stdout.write('\n');

        // Add assistant message with tool calls (only standard fields)
        conversation.push({
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.args },
          })),
        });

        // Execute tools and add results
        for (const tc of toolCalls) {
          process.stdout.write(
            `\n${C.dim}⚙  ${C.yellow}${tc.name}${C.reset}${C.dim}(${formatToolArgs(tc.args)})${C.reset}\n`,
          );

          const result = await this.executeTool(tc.name, tc.args);

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
      }

      // Show total if more than one round (i.e. tool calls happened)
      const totalMs = Date.now() - startTime;
      const totalTokens = totalPromptTokens + totalCompletionTokens;
      if (totalTokens > 0) {
        process.stdout.write(
          `${C.dim}[total: ${formatTokens(totalPromptTokens + totalCompletionTokens)} tokens · ${totalMs}ms]${C.reset}\n`,
        );
      }

      this.messages = conversation.slice(1);
    } catch (err: any) {
      this.messages.pop();

      // Groq returns a specific error when tool generation fails
      const msg: string = err.message ?? String(err);
      if (msg.includes('failed_generation') || msg.includes('Failed to call a function')) {
        throw new Error(
          `The model had trouble with tool calling on this request. Try rephrasing, or switch to a different model with /model deepseek-r1-distill-llama-70b`,
        );
      }
      throw new Error(msg);
    }
  }
}
