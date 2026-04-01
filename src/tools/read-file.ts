import fs from 'fs';
import path from 'path';

interface ReadFileArgs {
  path: string;
  start_line?: number;
  end_line?: number;
}

function resolvePath(filePath: string): string {
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
}

export const readFileTool = {
  type: 'function' as const,
  function: {
    name: 'read_file',
    description:
      'Read the contents of a file, returned with line numbers. Optionally specify a line range with start_line and end_line.',
    parameters: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read',
        },
        start_line: {
          type: 'number',
          description: 'First line to read, 1-based (optional)',
        },
        end_line: {
          type: 'number',
          description: 'Last line to read, 1-based (optional)',
        },
      },
      required: ['path'],
    },
    parse: JSON.parse as (input: string) => ReadFileArgs,
    function: async (args: ReadFileArgs): Promise<string> => {
      try {
        const filePath = resolvePath(args.path);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        const start = args.start_line ? Math.max(1, args.start_line) - 1 : 0;
        const end = args.end_line
          ? Math.min(args.end_line, lines.length)
          : lines.length;

        return lines
          .slice(start, end)
          .map((line, i) => `${String(start + i + 1).padStart(4)} | ${line}`)
          .join('\n');
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
  },
};
