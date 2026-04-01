import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat';
import { getTools } from './tools/index';
import { getSystemPrompt } from './system-prompt';
import type { ResolvedConfig } from './config';

// ANSI color helpers
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function truncate(str: string, n: number): string {
  if (str.length <= n) return str;
  return str.slice(0, n) + '…';
}

function formatToolArgs(argsStr: string): string {
  try {
    const args = JSON.parse(argsStr) as Record<string, unknown>;
    // Show the most meaningful argument concisely
    if (typeof args.command === 'string') return truncate(args.command, 70);
    if (typeof args.path === 'string') return args.path;
    if (typeof args.pattern === 'string') return args.pattern;
    // Fallback: compact JSON
    return truncate(JSON.stringify(args), 70);
  } catch {
    return truncate(argsStr, 70);
  }
}

export class Agent {
  private client: OpenAI;
  private messages: ChatCompletionMessageParam[] = [];
  private tools: ReturnType<typeof getTools>;

  constructor(private cfg: ResolvedConfig) {
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
    });
    this.tools = getTools();
  }

  clearHistory(): void {
    this.messages = [];
  }

  switchProvider(cfg: ResolvedConfig): void {
    this.cfg = cfg;
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
    });
  }

  async chat(userMessage: string): Promise<void> {
    this.messages.push({ role: 'user', content: userMessage });

    const systemMessage: ChatCompletionMessageParam = {
      role: 'system',
      content: getSystemPrompt(process.cwd()),
    };

    try {
      // runTools handles the full agentic loop: stream → detect tool calls →
      // execute functions → feed results back → stream again → until stop
      const runner = this.client.beta.chat.completions.runTools(
        {
          model: this.cfg.model,
          messages: [systemMessage, ...this.messages],
          tools: this.tools as Parameters<
            typeof this.client.beta.chat.completions.runTools
          >[0]['tools'],
          stream: true,
        },
        { maxChatCompletions: 15 },
      );

      let hasContent = false;
      let toolCallsPending = false;

      // Stream text tokens to stdout as they arrive
      runner.on('content', (delta: string) => {
        if (!hasContent) {
          hasContent = true;
        }
        process.stdout.write(`${C.cyan}${delta}${C.reset}`);
      });

      // Show tool calls and results via the message event
      runner.on('message', (msg: ChatCompletionMessageParam) => {
        if (
          msg.role === 'assistant' &&
          'tool_calls' in msg &&
          Array.isArray(msg.tool_calls) &&
          msg.tool_calls.length > 0
        ) {
          if (hasContent) {
            process.stdout.write('\n');
            hasContent = false;
          }
          for (const tc of msg.tool_calls) {
            if (tc.type === 'function') {
              const preview = formatToolArgs(tc.function.arguments);
              process.stdout.write(
                `\n${C.dim}⚙  ${C.yellow}${tc.function.name}${C.reset}${C.dim}(${preview})${C.reset}\n`,
              );
            }
          }
          toolCallsPending = true;
        } else if (msg.role === 'tool') {
          const content =
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content);
          const lines = content.split('\n');
          const preview = lines.slice(0, 8);
          for (const line of preview) {
            process.stdout.write(`${C.dim}   ${line}${C.reset}\n`);
          }
          if (lines.length > 8) {
            process.stdout.write(
              `${C.dim}   … (${lines.length - 8} more lines)${C.reset}\n`,
            );
          }
          toolCallsPending = false;
        }
      });

      await runner.finalMessage();
      process.stdout.write('\n');

      // Update conversation history, stripping the system message
      const allMessages = runner.messages as ChatCompletionMessageParam[];
      this.messages = allMessages.filter(m => m.role !== 'system');
    } catch (err: any) {
      // Roll back the user message if the request failed before any response
      this.messages.pop();
      throw new Error(
        err.message ?? String(err),
      );
    }
  }
}
