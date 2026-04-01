import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { isOutsideCwd, promptConfirm } from '../confirm';

const execAsync = promisify(exec);

interface BashArgs {
  command: string;
  timeout?: number;
}

// Patterns that destructively modify the filesystem
const DESTRUCTIVE_RE = /\b(rm|rmdir|mv|shred|unlink)\b/;

/**
 * Extract absolute paths from a shell command that look like they could be
 * targets of a destructive operation. Very conservative — only matches
 * obvious /absolute/paths that are not the cwd.
 */
function extractOutsidePaths(command: string): string[] {
  const cwd = process.cwd();
  const outside: string[] = [];

  // Match tokens that look like absolute paths
  const tokens = command.match(/\/[^\s'"`;|&<>()$\\]+/g) ?? [];
  for (const tok of tokens) {
    const resolved = path.resolve(tok);
    const rel = path.relative(cwd, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      outside.push(resolved);
    }
  }
  return [...new Set(outside)];
}

export const bashTool = {
  type: 'function' as const,
  function: {
    name: 'bash',
    description:
      'Execute a shell command and return stdout + stderr. Use for running tests, git commands, installing packages, building, etc.',
    parameters: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default: 30, max: 120)',
        },
      },
      required: ['command'],
    },
    parse: JSON.parse as (input: string) => BashArgs,
    function: async (args: BashArgs): Promise<string> => {
      // Guard: destructive commands targeting paths outside cwd require confirmation
      if (DESTRUCTIVE_RE.test(args.command)) {
        const outsidePaths = extractOutsidePaths(args.command);
        if (outsidePaths.length > 0) {
          const pathList = outsidePaths.map(p => `  • ${p}`).join('\n');
          const ok = await promptConfirm(
            `Command targets paths outside the working directory:\n${pathList}\n   Command: ${args.command}`,
          );
          if (!ok) return `Cancelled: user did not confirm destructive command outside working directory.`;
        }
      }

      const timeoutMs = Math.min((args.timeout ?? 30) * 1000, 120_000);
      try {
        const { stdout, stderr } = await execAsync(args.command, {
          timeout: timeoutMs,
          cwd: process.cwd(),
          maxBuffer: 10 * 1024 * 1024,
          shell: '/bin/bash',
        });
        let output = stdout;
        if (stderr) output += (output ? '\n' : '') + stderr;
        return output.trimEnd() || '(no output)';
      } catch (err: any) {
        const out = [err.stdout, err.stderr].filter(Boolean).join('\n').trimEnd();
        return out || `Error: ${err.message}`;
      }
    },
  },
};
