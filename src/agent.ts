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

/**
 * Drop the oldest complete turn (user message + everything up to the next
 * user message) to reduce context size. Always keeps the system message and
 * the most recent user message. Returns null if there's nothing left to trim.
 */
function trimOldestTurn(
  conversation: ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] | null {
  // conversation[0] is the system message
  const history = conversation.slice(1);

  // Find indices of user messages in history
  const userIdxs = history.reduce<number[]>((acc, m, i) => {
    if (m.role === 'user') acc.push(i);
    return acc;
  }, []);

  // Need at least 2 user messages to drop the oldest turn
  if (userIdxs.length < 2) return null;

  // Drop everything from the first user message up to (not including) the second
  const trimmed = history.slice(userIdxs[1]);
  return [conversation[0], ...trimmed];
}

/**
 * Sleep for ms milliseconds, printing a countdown to stderr.
 */
async function sleepWithCountdown(ms: number): Promise<void> {
  const secs = Math.ceil(ms / 1000);
  for (let i = secs; i > 0; i--) {
    process.stderr.write(`\r${C.dim}Retrying in ${i}s…${C.reset}  `);
    await new Promise(r => setTimeout(r, 1000));
  }
  process.stderr.write(`\r${C.dim}Retrying now…${C.reset}      \n`);
}

export class Agent {
  private client: OpenAI;
  private messages: ChatCompletionMessageParam[] = [];
  private tools: ReturnType<typeof getTools>;
  private toolDefs: ChatCompletionTool[];
  private toolsDisabled = false; // set when model reports no tool support

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
    this.toolsDisabled = false; // reset when switching models
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

  /**
   * Make one streaming API call, handling 413 (context too large) and
   * 429 (rate limited) with automatic retry/trim before giving up.
   */
  private async callWithRetry(
    conversation: ChatCompletionMessageParam[],
  ): Promise<{ stream: AsyncIterable<any>; conversation: ChatCompletionMessageParam[] }> {
    const MAX_TRIM_ATTEMPTS = 5;
    const MAX_RATE_RETRIES = 3;

    let current = conversation;
    let trimAttempts = 0;
    let rateRetries = 0;

    while (true) {
      try {
        const streamParams: any = {
          model: this.cfg.model,
          messages: current,
          tools: this.toolsDisabled ? undefined : this.toolDefs,
          stream: true,
          stream_options: { include_usage: true },
        };
        const stream = (await this.client.chat.completions.create(
          streamParams,
        )) as unknown as AsyncIterable<any>;
        return { stream, conversation: current };
      } catch (err: any) {
        const status: number = err.status ?? err.statusCode ?? 0;
        const msg: string = err.message ?? String(err);

        // ── 413 Context too large ──────────────────────────────────────────
        if (status === 413 || msg.includes('Request too large')) {
          if (trimAttempts >= MAX_TRIM_ATTEMPTS) {
            throw new Error(
              `Context is too large even after trimming. Use /clear to start a fresh conversation.`,
            );
          }

          const trimmed = trimOldestTurn(current);
          if (!trimmed) {
            throw new Error(
              `Your message is too large for the free tier (Groq limit: ~12k tokens/min).\n` +
              `Try breaking it into smaller requests, or upgrade at https://console.groq.com/settings/billing`,
            );
          }

          const dropped = current.length - trimmed.length;
          process.stderr.write(
            `\n${C.yellow}⚠  Context too large for ${this.cfg.provider} free tier — ` +
            `trimming ${dropped} old message(s) and retrying…${C.reset}\n` +
            `${C.dim}   (Use /clear to start fresh if this keeps happening)${C.reset}\n`,
          );

          current = trimmed;
          trimAttempts++;
          continue;
        }

        // ── Model doesn't support tool calling ────────────────────────────
        if (
          !this.toolsDisabled &&
          (msg.includes('tool calling') || msg.includes('tool_use') || msg.includes('tools')) &&
          (status === 400 || msg.toLowerCase().includes('not supported'))
        ) {
          this.toolsDisabled = true;
          process.stderr.write(
            `\n${C.yellow}⚠  ${this.cfg.model} doesn't support tool calling — running in chat-only mode.${C.reset}\n` +
            `${C.dim}   File tools (read, write, bash…) won't be available for this model.${C.reset}\n`,
          );
          continue; // retry without tools
        }

        // ── 429 Rate limited ───────────────────────────────────────────────
        if (status === 429 || msg.includes('rate limit') || msg.includes('Rate limit')) {
          if (rateRetries >= MAX_RATE_RETRIES) {
            throw new Error(
              `Still rate limited after waiting. Try again in a moment, or upgrade at https://console.groq.com/settings/billing`,
            );
          }

          // Use retry-after header if provided, otherwise wait 60s (Groq TPM resets per minute)
          const retryAfter =
            err.headers?.['retry-after'] ??
            msg.match(/try again in ([0-9.]+)s/i)?.[1] ??
            null;
          const waitMs = retryAfter ? Math.ceil(parseFloat(retryAfter) * 1000) : 60_000;

          process.stderr.write(
            `\n${C.yellow}⚠  Rate limited by ${this.cfg.provider} — waiting ${Math.ceil(waitMs / 1000)}s for the token bucket to reset…${C.reset}\n`,
          );
          await sleepWithCountdown(waitMs);
          rateRetries++;
          continue;
        }

        // ── Any other error ────────────────────────────────────────────────
        throw err;
      }
    }
  }

  async chat(userMessage: string): Promise<void> {
    this.messages.push({ role: 'user', content: userMessage });

    let conversation: ChatCompletionMessageParam[] = [
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

        // callWithRetry handles 413/429 transparently
        const { stream, conversation: trimmedConversation } =
          await this.callWithRetry(conversation);
        conversation = trimmedConversation;

        let content = '';
        const toolCallMap: Record<number, ToolCallAccum> = {};
        let finishReason = '';
        let roundPromptTokens = 0;
        let roundCompletionTokens = 0;

        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];

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
              const idx = tc.index ?? 0;
              if (!toolCallMap[idx]) {
                toolCallMap[idx] = { id: '', name: '', args: '' };
              }
              if (tc.id) toolCallMap[idx].id = tc.id;
              if (tc.function?.name) toolCallMap[idx].name += tc.function.name;
              if (tc.function?.arguments) toolCallMap[idx].args += tc.function.arguments;
            }
          }

          if (choice.finish_reason) finishReason = choice.finish_reason;
        }

        const roundMs = Date.now() - roundStart;
        const toolCalls = Object.values(toolCallMap).filter(tc => tc.name && tc.args);

        for (let i = 0; i < toolCalls.length; i++) {
          if (!toolCalls[i].id) toolCalls[i].id = `call_${Date.now()}_${i}`;
        }

        if (roundPromptTokens > 0 || roundCompletionTokens > 0) {
          const tokStr =
            roundPromptTokens > 0
              ? `↑${formatTokens(roundPromptTokens)} ↓${formatTokens(roundCompletionTokens)}`
              : `↓${formatTokens(roundCompletionTokens)}`;
          process.stdout.write(
            `\n${C.dim}[${this.cfg.provider} · ${this.cfg.model} · ${tokStr} tokens · ${roundMs}ms]${C.reset}`,
          );
        }

        if (toolCalls.length === 0 || finishReason === 'stop') {
          process.stdout.write('\n');
          conversation.push({ role: 'assistant', content });
          break;
        }

        if (content) process.stdout.write('\n');

        conversation.push({
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.args },
          })),
        });

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

      const msg: string = err.message ?? String(err);
      if (msg.includes('failed_generation') || msg.includes('Failed to call a function')) {
        throw new Error(
          `The model failed to generate a valid tool call.\n` +
          `  Reason: ${msg}\n` +
          `  Try rephrasing your request, or switch models: /model deepseek-r1-distill-llama-70b`,
        );
      }
      throw new Error(msg);
    }
  }
}
