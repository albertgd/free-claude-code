import readline from 'readline';
import fs from 'fs';
import { Agent } from './agent';
import type { Config, ResolvedConfig } from './config';
import { resolveConfig, saveConfig, getHistoryFile } from './config';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function printBanner(resolved: ResolvedConfig, version: string): void {
  console.log(`\n${C.bold}${C.cyan}fcc${C.reset} — Free Claude Code v${version}`);
  console.log(
    `${C.dim}Provider: ${resolved.provider} | Model: ${resolved.model}${C.reset}`,
  );
  console.log(`${C.dim}Type /help for commands, exit to quit${C.reset}\n`);
}

function printHelp(): void {
  console.log(`
${C.bold}Commands:${C.reset}
  /help                  Show this help
  /clear                 Clear conversation history
  /status                Show current provider and model
  /provider              Show current provider
  /provider <name>       Switch provider (groq, openai, gemini)
  /model                 Show current model
  /model <name>          Switch model for this session
  exit, quit             Exit fcc

${C.bold}Providers:${C.reset}
  groq     Free — Llama 3.3 70B via console.groq.com
  openai   Paid — GPT-4o via platform.openai.com
  gemini   Free tier — Gemini 2.0 Flash via aistudio.google.com

${C.bold}Groq free-tier models:${C.reset}  (use /model <id> to switch)
${C.dim}
  Model ID                                      RPM   RPD     TPM    TPD
  ─────────────────────────────────────────────────────────────────────────
  llama-3.3-70b-versatile  ◄ default            30    1K      12K    100K
  llama-3.1-8b-instant                          30    14.4K    6K    500K
  meta-llama/llama-4-scout-17b-16e-instruct     30    1K      30K    500K
  moonshotai/kimi-k2-instruct                   60    1K      10K    300K
  moonshotai/kimi-k2-instruct-0905              60    1K      10K    300K
  qwen/qwen3-32b                                60    1K       6K    500K
  openai/gpt-oss-120b                           30    1K       8K    200K
  openai/gpt-oss-20b                            30    1K       8K    200K
  openai/gpt-oss-safeguard-20b                  30    1K       8K    200K
  allam-2-7b                                    30    7K       6K    500K
  meta-llama/llama-prompt-guard-2-22m           30    14.4K   15K    500K
  meta-llama/llama-prompt-guard-2-86m           30    14.4K   15K    500K
  compound-beta            (no tool calls)       30    250     70K    —
  compound-beta-mini       (no tool calls)       30    250     70K    —
  canopylabs/orpheus-arabic-saudi  (audio TTS)  10    100      1.2K   3.6K
  canopylabs/orpheus-v1-english    (audio TTS)  10    100      1.2K   3.6K
  ─────────────────────────────────────────────────────────────────────────
  RPM=requests/min  RPD=requests/day  TPM=tokens/min  TPD=tokens/day${C.reset}

${C.bold}Tips:${C.reset}
  Set GROQ_API_KEY env var to skip setup
  Use fcc --setup to reconfigure API keys`);
}

// Load readline history from file
function loadHistory(historyFile: string): string[] {
  try {
    return fs
      .readFileSync(historyFile, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .reverse()
      .slice(0, 500);
  } catch {
    return [];
  }
}

// Append a line to the history file
function appendHistory(historyFile: string, line: string): void {
  try {
    fs.appendFileSync(historyFile, line + '\n');
  } catch {
    // ignore
  }
}

export async function runREPL(
  agent: Agent,
  config: Config,
  resolved: ResolvedConfig,
  version: string,
): Promise<void> {
  printBanner(resolved, version);

  const historyFile = getHistoryFile();
  const history = loadHistory(historyFile);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.green}>${C.reset} `,
    history,
    historySize: 500,
    terminal: true,
  });

  let current = resolved;

  rl.prompt();

  rl.on('line', async (input: string) => {
    const line = input.trim();

    if (!line) {
      rl.prompt();
      return;
    }

    // Built-in commands
    if (line === 'exit' || line === 'quit' || line === '/exit') {
      console.log(`${C.dim}Goodbye!${C.reset}`);
      rl.close();
      process.exit(0);
    }

    if (line === '/help') {
      printHelp();
      rl.prompt();
      return;
    }

    if (line === '/clear') {
      agent.clearHistory();
      console.log(`${C.dim}Conversation cleared.${C.reset}`);
      rl.prompt();
      return;
    }

    if (line === '/status') {
      console.log(
        `${C.dim}Provider: ${current.provider} | Model: ${current.model}${C.reset}`,
      );
      rl.prompt();
      return;
    }

    if (line === '/provider') {
      console.log(`${C.dim}Current provider: ${current.provider}${C.reset}`);
      console.log(`${C.dim}Available: groq, openai, gemini${C.reset}`);
      rl.prompt();
      return;
    }

    if (line.startsWith('/provider ')) {
      const providerName = line.slice('/provider '.length).trim();
      try {
        const newResolved = resolveConfig(config, providerName);
        agent.switchProvider(newResolved);
        current = newResolved;
        config.provider = providerName;
        saveConfig(config);
        console.log(
          `${C.dim}Switched to ${providerName} (${newResolved.model})${C.reset}`,
        );
      } catch (err: any) {
        console.error(`${C.red}${err.message}${C.reset}`);
      }
      rl.prompt();
      return;
    }

    if (line === '/model') {
      console.log(`${C.dim}Current model: ${current.model}${C.reset}`);
      rl.prompt();
      return;
    }

    if (line.startsWith('/model ')) {
      const modelName = line.slice('/model '.length).trim();
      current = { ...current, model: modelName };
      agent.switchProvider(current);
      if (config.providers[current.provider]) {
        config.providers[current.provider]!.model = modelName;
        saveConfig(config);
      }
      console.log(`${C.dim}Model set to ${modelName}${C.reset}`);
      rl.prompt();
      return;
    }

    // Regular chat message — pause readline while the agent responds
    appendHistory(historyFile, line);
    rl.pause();
    console.log();

    try {
      await agent.chat(line);
    } catch (err: any) {
      console.error(`\n${C.red}Error: ${err.message}${C.reset}`);
    }

    console.log();
    rl.resume();
    rl.prompt();
  });

  rl.on('close', () => {
    console.log(`\n${C.dim}Goodbye!${C.reset}`);
    process.exit(0);
  });

  // Keep the process alive until readline closes
  return new Promise(() => {});
}
