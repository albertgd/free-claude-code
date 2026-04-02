import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
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
  console.log(`${C.dim}Type /help for commands, @ to pick files, exit to quit${C.reset}\n`);
}

function printHelp(): void {
  console.log(`
${C.bold}Commands:${C.reset}
  /help                  Show this help
  /clear                 Clear conversation history
  /compact               Keep only the last 2 turns (saves context)
  /history               Show conversation history summary
  /status                Show current provider and model
  /provider              Show current provider
  /provider <name>       Switch provider (groq, openai, gemini)
  /model                 Show current model
  /model <name>          Switch model for this session
  /cwd                   Show current working directory
  /cd <path>             Change working directory
  /ls [path]             List files in a directory
  /tokens                Show token usage for this session
  /copy                  Copy last assistant response to clipboard
  /retry                 Resend the last message
  /save [filename]       Save conversation to a markdown file
  exit, quit             Exit fcc

${C.bold}File context (@):${C.reset}
  @                      Open interactive file/folder picker
  @path/to/file          Include a file's contents in your message (inline)
  Tab after @            Auto-complete file paths

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

// ─── History file helpers ─────────────────────────────────────────────────────

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

function appendHistory(historyFile: string, line: string): void {
  try {
    fs.appendFileSync(historyFile, line + '\n');
  } catch {
    // ignore
  }
}

// ─── Tab completer ────────────────────────────────────────────────────────────

const SLASH_COMMANDS = [
  '/help', '/clear', '/compact', '/history', '/status',
  '/provider ', '/model ', '/cwd', '/cd ', '/ls', '/ls ',
  '/tokens', '/copy', '/retry', '/save', '/save ',
  '/exit',
];

function completer(line: string): [string[], string] {
  // Slash command completion
  if (line.startsWith('/')) {
    const hits = SLASH_COMMANDS.filter(c => c.trimEnd().startsWith(line));
    return [hits.length ? hits : SLASH_COMMANDS, line];
  }

  // @ path completion — complete the segment after the last @
  const atIdx = line.lastIndexOf('@');
  if (atIdx !== -1) {
    const afterAt = line.slice(atIdx + 1);
    const prefix = line.slice(0, atIdx + 1);
    const lastSlash = afterAt.lastIndexOf('/');
    const dirPart = lastSlash === -1 ? '.' : afterAt.slice(0, lastSlash) || '.';
    const namePart = lastSlash === -1 ? afterAt : afterAt.slice(lastSlash + 1);

    try {
      const entries = fs.readdirSync(dirPart);
      const hits = entries
        .filter(e => e.startsWith(namePart))
        .map(e => {
          const full = dirPart === '.' ? e : `${dirPart}/${e}`;
          let isDir = false;
          try { isDir = fs.statSync(full).isDirectory(); } catch { /* ignore */ }
          const pathPart = lastSlash === -1 ? e : `${afterAt.slice(0, lastSlash + 1)}${e}`;
          return prefix + pathPart + (isDir ? '/' : '');
        });
      return [hits, line];
    } catch {
      return [[], line];
    }
  }

  return [[], line];
}

// ─── @ file picker ────────────────────────────────────────────────────────────

interface PickerEntry {
  name: string;
  fullPath: string;
  isDir: boolean;
}

interface PickerState {
  currentDir: string;
  resolve: (selected: string | null) => void;
}

function getPickerEntries(dir: string): PickerEntry[] {
  try {
    return fs
      .readdirSync(dir)
      .map(name => {
        const fullPath = path.join(dir, name);
        let isDir = false;
        try { isDir = fs.statSync(fullPath).isDirectory(); } catch { /* ignore */ }
        return { name, fullPath, isDir };
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}

function showPickerMenu(state: PickerState, rl: readline.Interface): void {
  const entries = getPickerEntries(state.currentDir);
  const relDir = path.relative(process.cwd(), state.currentDir) || '.';

  console.log(`\n${C.bold}${C.cyan}@ ${relDir}${C.reset}`);

  const isRoot = state.currentDir === path.parse(state.currentDir).root;
  if (!isRoot) {
    console.log(`  ${C.dim}0${C.reset}  ${C.dim}../${C.reset}`);
  }

  if (entries.length === 0) {
    console.log(`  ${C.dim}(empty directory)${C.reset}`);
  } else {
    entries.forEach((entry, i) => {
      if (entry.isDir) {
        console.log(`  ${C.dim}${i + 1}${C.reset}  ${C.cyan}${entry.name}/${C.reset}`);
      } else {
        console.log(`  ${C.dim}${i + 1}${C.reset}  ${entry.name}`);
      }
    });
  }

  console.log(`\n${C.dim}  number/name to select · 0 or .. to go up · q to cancel${C.reset}`);
  rl.setPrompt(`${C.green}@${C.reset} `);
  rl.prompt();
}

function handlePickerInput(
  choice: string,
  state: PickerState,
  rl: readline.Interface,
): void {
  if (!choice || choice.toLowerCase() === 'q') {
    rl.setPrompt(`${C.green}>${C.reset} `);
    console.log(`${C.dim}Cancelled.${C.reset}`);
    state.resolve(null);
    return;
  }

  if (choice === '..' || choice === '0') {
    const parent = path.dirname(state.currentDir);
    if (parent !== state.currentDir) state.currentDir = parent;
    showPickerMenu(state, rl);
    return;
  }

  const entries = getPickerEntries(state.currentDir);
  const num = parseInt(choice, 10);
  const selected =
    !isNaN(num) && num >= 1 && num <= entries.length
      ? entries[num - 1]
      : entries.find(e => e.name === choice || e.name === choice + '/');

  if (!selected) {
    console.log(`${C.red}  Not found: ${choice}${C.reset}`);
    showPickerMenu(state, rl);
    return;
  }

  if (selected.isDir) {
    state.currentDir = selected.fullPath;
    showPickerMenu(state, rl);
    return;
  }

  // File selected — resolve and restore prompt
  rl.setPrompt(`${C.green}>${C.reset} `);
  state.resolve(selected.fullPath);
}

// ─── Inline @path expansion ───────────────────────────────────────────────────

function expandAtReferences(message: string): string {
  const atPattern = /@([^\s@]+)/g;
  let match;
  const files: Array<{ relPath: string; content: string }> = [];

  while ((match = atPattern.exec(message)) !== null) {
    const ref = match[1];
    const candidates = [path.resolve(ref), path.resolve(process.cwd(), ref)];
    for (const candidate of candidates) {
      try {
        if (fs.statSync(candidate).isFile()) {
          files.push({
            relPath: path.relative(process.cwd(), candidate),
            content: fs.readFileSync(candidate, 'utf-8'),
          });
          break;
        }
      } catch { /* skip */ }
    }
  }

  if (files.length === 0) return message;
  const blocks = files.map(f => `<file path="${f.relPath}">\n${f.content}\n</file>`).join('\n\n');
  return blocks + '\n\n' + message;
}

// ─── Clipboard helper ─────────────────────────────────────────────────────────

function copyToClipboard(text: string): void {
  const platform = process.platform;
  if (platform === 'darwin') {
    execSync('pbcopy', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
  } else if (platform === 'linux') {
    try {
      execSync('xclip -selection clipboard', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      execSync('xsel --clipboard --input', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    }
  } else if (platform === 'win32') {
    execSync('clip', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
  } else {
    throw new Error(`Clipboard not supported on platform: ${platform}`);
  }
}

// ─── REPL ─────────────────────────────────────────────────────────────────────

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
    completer,
  });

  let current = resolved;

  // File picker state — set while picker is active
  let activePicker: PickerState | null = null;

  // Files staged via @ picker, injected into the next chat message
  let pendingFiles: Array<{ relPath: string; content: string }> = [];

  rl.prompt();

  rl.on('line', async (input: string) => {
    // ── File picker mode ──────────────────────────────────────────────────────
    if (activePicker) {
      handlePickerInput(input.trim(), activePicker, rl);
      return;
    }

    const line = input.trim();
    if (!line) {
      rl.prompt();
      return;
    }

    // ── Built-in commands ─────────────────────────────────────────────────────

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
      pendingFiles = [];
      console.log(`${C.dim}Conversation cleared.${C.reset}`);
      rl.prompt();
      return;
    }

    if (line === '/compact') {
      const count = agent.getMessageCount();
      if (count === 0) {
        console.log(`${C.dim}Nothing to compact.${C.reset}`);
      } else {
        const dropped = agent.compact(2);
        if (dropped === 0) {
          console.log(`${C.dim}Already compact (≤2 turns). Use /clear to reset entirely.${C.reset}`);
        } else {
          console.log(
            `${C.dim}Compacted: removed ${dropped} old message(s), kept last 2 turns.${C.reset}`,
          );
        }
      }
      rl.prompt();
      return;
    }

    if (line === '/history') {
      const msgs = agent.getHistory();
      if (msgs.length === 0) {
        console.log(`${C.dim}No conversation history.${C.reset}`);
      } else {
        console.log(`\n${C.bold}History (${msgs.length} messages):${C.reset}`);
        for (const msg of msgs) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            const label =
              msg.role === 'user'
                ? `${C.green}User${C.reset}`
                : `${C.cyan}Assistant${C.reset}`;
            const content =
              typeof msg.content === 'string'
                ? msg.content.slice(0, 120) + (msg.content.length > 120 ? '…' : '')
                : '[non-text]';
            console.log(`${label}  ${C.dim}${content}${C.reset}`);
          }
        }
      }
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

    if (line === '/cwd') {
      console.log(`${C.dim}${process.cwd()}${C.reset}`);
      rl.prompt();
      return;
    }

    if (line.startsWith('/cd ')) {
      const target = line.slice('/cd '.length).trim();
      try {
        const resolved = path.resolve(target);
        process.chdir(resolved);
        console.log(`${C.dim}${process.cwd()}${C.reset}`);
      } catch (err: any) {
        console.error(`${C.red}${err.message}${C.reset}`);
      }
      rl.prompt();
      return;
    }

    if (line === '/ls' || line.startsWith('/ls ')) {
      const target = line.startsWith('/ls ') ? line.slice('/ls '.length).trim() : '.';
      try {
        const dir = path.resolve(target);
        const entries = getPickerEntries(dir);
        const relDir = path.relative(process.cwd(), dir) || '.';
        console.log(`\n${C.dim}${relDir}${C.reset}`);
        for (const entry of entries) {
          if (entry.isDir) {
            console.log(`  ${C.cyan}${entry.name}/${C.reset}`);
          } else {
            let size = '';
            try {
              const bytes = fs.statSync(entry.fullPath).size;
              size = bytes < 1024 ? `${bytes}B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)}K` : `${(bytes / 1024 / 1024).toFixed(1)}M`;
            } catch { /* ignore */ }
            console.log(`  ${entry.name}${C.dim}${size ? '  ' + size : ''}${C.reset}`);
          }
        }
      } catch (err: any) {
        console.error(`${C.red}${err.message}${C.reset}`);
      }
      rl.prompt();
      return;
    }

    if (line === '/tokens') {
      const count = agent.getMessageCount();
      console.log(`${C.dim}Conversation: ${count} message(s) in context${C.reset}`);
      if (pendingFiles.length > 0) {
        console.log(`${C.dim}Staged files: ${pendingFiles.map(f => f.relPath).join(', ')}${C.reset}`);
      }
      rl.prompt();
      return;
    }

    if (line === '/copy') {
      const last = agent.getLastAssistantMessage();
      if (!last) {
        console.log(`${C.dim}No response to copy.${C.reset}`);
      } else {
        try {
          copyToClipboard(last);
          console.log(`${C.dim}Copied to clipboard.${C.reset}`);
        } catch (err: any) {
          console.error(`${C.red}${err.message}${C.reset}`);
        }
      }
      rl.prompt();
      return;
    }

    if (line === '/retry') {
      const lastMsg = agent.retryLast();
      if (!lastMsg) {
        console.log(`${C.dim}No previous message to retry.${C.reset}`);
        rl.prompt();
        return;
      }
      console.log(`${C.dim}Retrying: ${lastMsg.slice(0, 80)}${lastMsg.length > 80 ? '…' : ''}${C.reset}`);
      appendHistory(historyFile, lastMsg);
      rl.pause();
      console.log();
      try {
        await agent.chat(lastMsg);
      } catch (err: any) {
        console.error(`\n${C.red}Error: ${err.message}${C.reset}`);
      }
      console.log();
      rl.resume();
      rl.prompt();
      return;
    }

    if (line === '/save' || line.startsWith('/save ')) {
      const filename = line.startsWith('/save ')
        ? line.slice('/save '.length).trim()
        : `fcc-conversation-${Date.now()}.md`;
      const msgs = agent.getHistory();
      if (msgs.length === 0) {
        console.log(`${C.dim}No conversation to save.${C.reset}`);
        rl.prompt();
        return;
      }
      const md = msgs
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
          const role = m.role === 'user' ? '**User**' : '**Assistant**';
          const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          return `## ${role}\n\n${text}`;
        })
        .join('\n\n---\n\n');
      try {
        fs.writeFileSync(filename, md, 'utf-8');
        console.log(`${C.dim}Saved to ${filename}${C.reset}`);
      } catch (err: any) {
        console.error(`${C.red}${err.message}${C.reset}`);
      }
      rl.prompt();
      return;
    }

    // ── @ file picker ─────────────────────────────────────────────────────────
    if (line === '@') {
      const selectedPath = await new Promise<string | null>(resolve => {
        activePicker = { currentDir: process.cwd(), resolve };
        showPickerMenu(activePicker, rl);
      });

      if (selectedPath) {
        const relPath = path.relative(process.cwd(), selectedPath);
        try {
          const content = fs.readFileSync(selectedPath, 'utf-8');
          pendingFiles.push({ relPath, content });
          console.log(`${C.dim}Added @${relPath} to context. Type your message now.${C.reset}`);
        } catch (err: any) {
          console.error(`${C.red}Could not read file: ${err.message}${C.reset}`);
        }
      }

      rl.prompt();
      return;
    }

    // ── Regular chat message ──────────────────────────────────────────────────

    // Inject pending files from picker
    let finalMessage = line;
    if (pendingFiles.length > 0) {
      const blocks = pendingFiles
        .map(f => `<file path="${f.relPath}">\n${f.content}\n</file>`)
        .join('\n\n');
      finalMessage = blocks + '\n\n' + line;
      pendingFiles = [];
    }

    // Expand inline @path references
    finalMessage = expandAtReferences(finalMessage);

    appendHistory(historyFile, line);
    rl.pause();
    console.log();

    try {
      await agent.chat(finalMessage);
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
