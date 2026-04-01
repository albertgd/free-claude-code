import fs from 'fs';
import path from 'path';

interface WriteFileArgs {
  path: string;
  content: string;
}

export const writeFileTool = {
  type: 'function' as const,
  function: {
    name: 'write_file',
    description:
      "Write content to a file, creating it (and any missing parent directories) if needed, or overwriting it. Use edit_file for targeted changes to existing files.",
    parameters: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to write',
        },
        content: {
          type: 'string',
          description: 'Full content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
    parse: JSON.parse as (input: string) => WriteFileArgs,
    function: async (args: WriteFileArgs): Promise<string> => {
      try {
        const filePath = path.isAbsolute(args.path)
          ? args.path
          : path.join(process.cwd(), args.path);

        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, args.content, 'utf-8');

        const lines = args.content.split('\n').length;
        return `Wrote ${lines} line${lines === 1 ? '' : 's'} to ${args.path}`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
  },
};
