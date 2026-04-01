import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface BashArgs {
  command: string;
  timeout?: number;
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
      const timeoutMs = Math.min((args.timeout ?? 30) * 1000, 120_000);
      try {
        const { stdout, stderr } = await execAsync(args.command, {
          timeout: timeoutMs,
          cwd: process.cwd(),
          maxBuffer: 10 * 1024 * 1024, // 10 MB
          shell: '/bin/bash',
        });
        let output = stdout;
        if (stderr) output += (output ? '\n' : '') + stderr;
        return output.trimEnd() || '(no output)';
      } catch (err: any) {
        // Return captured output even on non-zero exit
        const out = [err.stdout, err.stderr].filter(Boolean).join('\n').trimEnd();
        return out || `Error: ${err.message}`;
      }
    },
  },
};
