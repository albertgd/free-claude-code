#!/usr/bin/env -S node --no-deprecation

import { loadConfig, resolveConfig, runSetup } from './config';
import { Agent } from './agent';
import { runREPL } from './repl';

const VERSION = '1.0.8';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse flags
  let providerFlag: string | undefined;
  let modelFlag: string | undefined;
  let setupFlag = false;
  let versionFlag = false;
  let printFlag = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--setup' || arg === '-s') {
      setupFlag = true;
    } else if (arg === '--version' || arg === '-v') {
      versionFlag = true;
    } else if (arg === '--print' || arg === '-p') {
      printFlag = true;
    } else if ((arg === '--provider' || arg === '-P') && args[i + 1]) {
      providerFlag = args[++i];
    } else if ((arg === '--model' || arg === '-m') && args[i + 1]) {
      modelFlag = args[++i];
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (versionFlag) {
    console.log(`fcc version ${VERSION}`);
    return;
  }

  // Run interactive setup wizard
  if (setupFlag) {
    await runSetup();
    return;
  }

  // Load stored/env config
  let config = loadConfig();
  if (!config) {
    console.log('No API key found. Starting setup...\n');
    config = await runSetup();
  }

  // Resolve to active provider settings
  let resolved;
  try {
    resolved = resolveConfig(config, providerFlag, modelFlag);
  } catch (err: any) {
    console.error(`\x1b[31m${err.message}\x1b[0m`);
    process.exit(1);
  }

  const agent = new Agent(resolved);

  // Non-interactive mode: prompt from args or stdin pipe
  if (printFlag || positional.length > 0 || !process.stdin.isTTY) {
    let prompt = positional.join(' ');

    if (!prompt) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
      prompt = Buffer.concat(chunks).toString('utf-8').trim();
    }

    if (!prompt) {
      console.error('No input provided');
      process.exit(1);
    }

    await agent.chat(prompt);
    return;
  }

  // Interactive REPL
  await runREPL(agent, config, resolved, VERSION);
}

main().catch(err => {
  console.error(`\x1b[31mFatal: ${(err as Error).message}\x1b[0m`);
  process.exit(1);
});
