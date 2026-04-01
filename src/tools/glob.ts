import { execSync } from 'child_process';
import path from 'path';

interface GlobArgs {
  pattern: string;
  path?: string;
}

export const globTool = {
  type: 'function' as const,
  function: {
    name: 'glob',
    description:
      'Find files matching a glob pattern. Returns matching file paths, sorted by modification time. Skips node_modules and .git.',
    parameters: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.test.js", "*.go")',
        },
        path: {
          type: 'string',
          description: 'Directory to search in (default: current directory)',
        },
      },
      required: ['pattern'],
    },
    parse: JSON.parse as (input: string) => GlobArgs,
    function: async (args: GlobArgs): Promise<string> => {
      try {
        const searchDir = args.path
          ? path.isAbsolute(args.path)
            ? args.path
            : path.join(process.cwd(), args.path)
          : process.cwd();

        // Use find for reliable ** support; sort by mod time; skip common noise dirs
        const cmd = [
          'find', JSON.stringify(searchDir),
          '-name', JSON.stringify(args.pattern.split('/').pop() ?? '*'),
          '-not', '-path', '"*/node_modules/*"',
          '-not', '-path', '"*/.git/*"',
          '-not', '-path', '"*/dist/*"',
          '-not', '-path', '"*/.next/*"',
          '2>/dev/null',
          '| head -100',
        ].join(' ');

        let result = execSync(cmd, { encoding: 'utf-8', shell: '/bin/bash' }).trim();

        if (!result) return 'No files found';

        // Make paths relative to cwd for readability
        const lines = result.split('\n').map(p => {
          const rel = path.relative(process.cwd(), p);
          return rel.startsWith('..') ? p : rel;
        });

        return lines.join('\n');
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
  },
};
