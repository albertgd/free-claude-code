import { execSync } from 'child_process';
import path from 'path';

interface GrepArgs {
  pattern: string;
  path?: string;
  glob?: string;
  case_insensitive?: boolean;
}

export const grepTool = {
  type: 'function' as const,
  function: {
    name: 'grep',
    description:
      'Search file contents for a regex pattern. Returns matching lines with file paths and line numbers. Skips node_modules and .git.',
    parameters: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression to search for',
        },
        path: {
          type: 'string',
          description: 'File or directory to search in (default: current directory)',
        },
        glob: {
          type: 'string',
          description: 'Filter files by name pattern (e.g. "*.ts", "*.go")',
        },
        case_insensitive: {
          type: 'boolean',
          description: 'Case-insensitive search',
        },
      },
      required: ['pattern'],
    },
    parse: JSON.parse as (input: string) => GrepArgs,
    function: async (args: GrepArgs): Promise<string> => {
      try {
        const searchPath = args.path
          ? path.isAbsolute(args.path)
            ? args.path
            : path.join(process.cwd(), args.path)
          : process.cwd();

        const flags: string[] = ['-rn', '--color=never'];
        if (args.case_insensitive) flags.push('-i');
        if (args.glob) flags.push(`--include=${args.glob}`);
        flags.push('--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist');

        const escapedPattern = args.pattern.replace(/'/g, `'\\''`);
        const cmd = `grep ${flags.join(' ')} -E '${escapedPattern}' ${JSON.stringify(searchPath)} 2>/dev/null | head -50`;

        const result = execSync(cmd, {
          encoding: 'utf-8',
          shell: '/bin/bash',
        }).trim();

        if (!result) return 'No matches found';

        const lines = result.split('\n');
        const suffix = lines.length >= 50 ? '\n(showing first 50 matches)' : '';

        // Make paths relative for readability
        const formatted = lines.map(line => {
          const colonIdx = line.indexOf(':');
          if (colonIdx === -1) return line;
          const filePart = line.slice(0, colonIdx);
          const rest = line.slice(colonIdx);
          const rel = path.relative(process.cwd(), filePart);
          return (rel.startsWith('..') ? filePart : rel) + rest;
        });

        return formatted.join('\n') + suffix;
      } catch (err: any) {
        if ((err as any).status === 1) return 'No matches found';
        return `Error: ${err.message}`;
      }
    },
  },
};
