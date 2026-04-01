import fs from 'fs';
import path from 'path';

interface ListDirArgs {
  path?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const listDirTool = {
  type: 'function' as const,
  function: {
    name: 'list_dir',
    description: 'List the contents of a directory. Directories are shown with a trailing /.',
    parameters: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list (default: current directory)',
        },
      },
    },
    parse: JSON.parse as (input: string) => ListDirArgs,
    function: async (args: ListDirArgs): Promise<string> => {
      try {
        const dirPath = args.path
          ? path.isAbsolute(args.path)
            ? args.path
            : path.join(process.cwd(), args.path)
          : process.cwd();

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        const lines = entries.map(e => {
          if (e.isDirectory()) return `${e.name}/`;
          try {
            const stat = fs.statSync(path.join(dirPath, e.name));
            return `${e.name} (${formatBytes(stat.size)})`;
          } catch {
            return e.name;
          }
        });

        if (lines.length === 0) return '(empty directory)';
        return lines.join('\n');
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
  },
};
