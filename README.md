# fcc — Free Claude Code

An AI coding assistant for the terminal. Works exactly like Claude Code but connects to **Groq** (free), **OpenAI**, or **Google Gemini** instead of Anthropic's API.

## Install

```bash
brew tap albertgd/tap
brew install fcc
```

## Quick start

```bash
fcc --setup   # configure your API key
fcc           # start an interactive session
```

**Groq is the default provider and has a free tier** — get a key at [console.groq.com](https://console.groq.com) in under a minute.

---

## Providers

| Provider | Default model | Cost | Get a key |
|----------|---------------|------|-----------|
| **Groq** (default) | `llama-3.3-70b-versatile` | Free tier | [console.groq.com](https://console.groq.com) |
| OpenAI | `gpt-4o` | Paid | [platform.openai.com](https://platform.openai.com) |
| Gemini | `gemini-2.0-flash` | Free tier | [aistudio.google.com](https://aistudio.google.com) |

All three use the same OpenAI-compatible API protocol, so switching between them is seamless.

### Groq free-tier models

Use `/model <id>` to switch. Your choice is saved and restored on the next launch.

| Model ID | RPM | RPD | TPM | TPD | Notes |
|----------|-----|-----|-----|-----|-------|
| `llama-3.3-70b-versatile` ★ | 30 | 1K | 12K | 100K | default |
| `llama-3.1-8b-instant` | 30 | 14.4K | 6K | 500K | |
| `meta-llama/llama-4-scout-17b-16e-instruct` | 30 | 1K | 30K | 500K | |
| `moonshotai/kimi-k2-instruct` | 60 | 1K | 10K | 300K | |
| `moonshotai/kimi-k2-instruct-0905` | 60 | 1K | 10K | 300K | |
| `qwen/qwen3-32b` | 60 | 1K | 6K | 500K | |
| `openai/gpt-oss-120b` | 30 | 1K | 8K | 200K | |
| `openai/gpt-oss-20b` | 30 | 1K | 8K | 200K | |
| `openai/gpt-oss-safeguard-20b` | 30 | 1K | 8K | 200K | |
| `allam-2-7b` | 30 | 7K | 6K | 500K | |
| `meta-llama/llama-prompt-guard-2-22m` | 30 | 14.4K | 15K | 500K | |
| `meta-llama/llama-prompt-guard-2-86m` | 30 | 14.4K | 15K | 500K | |
| `compound-beta` | 30 | 250 | 70K | — | no tool calls |
| `compound-beta-mini` | 30 | 250 | 70K | — | no tool calls |

RPM = requests/min · RPD = requests/day · TPM = tokens/min · TPD = tokens/day

---

## Configuration

### Interactive setup

```bash
fcc --setup
```

Prompts for your API keys and saves them to `~/.fcc/config.json` (mode 600).

### Environment variables

You can skip the setup wizard entirely by setting env vars:

```bash
export GROQ_API_KEY=gsk_...
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=AIza...
export FCC_PROVIDER=groq   # optional: set default provider
```

### Config file

`~/.fcc/config.json`:
```json
{
  "provider": "groq",
  "providers": {
    "groq":   { "apiKey": "gsk_...", "model": "llama-3.3-70b-versatile" },
    "openai": { "apiKey": "sk-...",  "model": "gpt-4o" },
    "gemini": { "apiKey": "AIza...", "model": "gemini-2.0-flash" }
  }
}
```

---

## Usage

### Interactive REPL

```bash
fcc
fcc --provider openai
fcc --provider gemini --model gemini-2.0-flash
```

### One-shot (non-interactive)

```bash
fcc "explain what this repo does"
fcc --print "write a Dockerfile for a Node.js app"
cat error.log | fcc "what's wrong here?"
```

### CLI flags

| Flag | Short | Description |
|------|-------|-------------|
| `--setup` | `-s` | Run the API key setup wizard |
| `--provider <name>` | `-P` | Use a specific provider (`groq`, `openai`, `gemini`) |
| `--model <name>` | `-m` | Override the model for this session |
| `--print` | `-p` | Non-interactive: print response and exit |
| `--version` | `-v` | Show version |

---

## REPL commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands and Groq model list |
| `/clear` | Clear conversation history |
| `/status` | Show current provider and model |
| `/provider` | Show current provider |
| `/provider <name>` | Switch provider mid-session (saved to config) |
| `/model` | Show current model |
| `/model <name>` | Switch model mid-session (saved to config) |
| `exit` / `quit` | Exit fcc |

---

## Tools

fcc can use these tools to help with your tasks:

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands (git, npm, tests, etc.) |
| `read_file` | Read file contents with line numbers |
| `write_file` | Create or overwrite files |
| `edit_file` | Make precise string replacements in existing files |
| `glob` | Find files by glob pattern (`**/*.ts`, `src/**/*.go`) |
| `grep` | Search file contents with regex |
| `list_dir` | List directory contents |

---

## Examples

```
> explain this codebase
> why are my tests failing? run them and check the output
> refactor the auth module to use async/await
> add error handling to all API routes
> create a GitHub Actions workflow for CI
> what does the foo function in utils.ts do?
```

---

## Building from source

Requirements: Node.js 22+

```bash
git clone https://github.com/albertgd/free-claude-code
cd free-claude-code
npm install
npm run build
node dist/index.js
```

### Building macOS binaries

```bash
npm run package
# outputs: binaries/fcc-macos-arm64  (Apple Silicon)
#          binaries/fcc-macos-x64    (Intel)
```

### Releasing a new version

Tag a version and push — GitHub Actions handles the rest:

```bash
git tag v1.2.0 && git push origin v1.2.0
```

The workflow:
1. Compiles TypeScript
2. Builds arm64 + x64 binaries with `@yao-pkg/pkg`
3. Creates a GitHub release with the binaries
4. Updates the Homebrew formula in `albertgd/homebrew-tap` automatically

---

## License

MIT
