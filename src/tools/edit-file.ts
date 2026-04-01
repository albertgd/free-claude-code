import fs from 'fs';
import path from 'path';
import { confirmIfOutside } from '../confirm';

interface EditFileArgs {
  path: string;
  old_string: string;
  new_string: string;
}

export const editFileTool = {
  type: 'function' as const,
  function: {
    name: 'edit_file',
    description:
      'Edit a file by replacing an exact string with a new string. old_string must match exactly (including whitespace and indentation). Fails if old_string appears more than once — add more surrounding context to make it unique.',
    parameters: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to edit',
        },
        old_string: {
          type: 'string',
          description: 'The exact string to replace (must be unique in the file)',
        },
        new_string: {
          type: 'string',
          description: 'The replacement string',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    parse: JSON.parse as (input: string) => EditFileArgs,
    function: async (args: EditFileArgs): Promise<string> => {
      try {
        const filePath = path.isAbsolute(args.path)
          ? args.path
          : path.join(process.cwd(), args.path);

        const allowed = await confirmIfOutside(filePath, `Edit ${args.path}`);
        if (!allowed) return `Cancelled: user did not confirm edit to ${args.path}`;

        const content = fs.readFileSync(filePath, 'utf-8');

        const count = content.split(args.old_string).length - 1;
        if (count === 0) {
          return `Error: old_string not found in ${args.path}. Check for exact whitespace/indentation match.`;
        }
        if (count > 1) {
          return `Error: old_string found ${count} times in ${args.path}. Add more surrounding context to make it unique.`;
        }

        const newContent = content.replace(args.old_string, args.new_string);
        fs.writeFileSync(filePath, newContent, 'utf-8');
        return `Edited ${args.path}`;
      } catch (err: any) {
        return `Error: ${err.message}`;
      }
    },
  },
};
