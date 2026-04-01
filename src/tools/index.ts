import { bashTool } from './bash';
import { readFileTool } from './read-file';
import { writeFileTool } from './write-file';
import { editFileTool } from './edit-file';
import { globTool } from './glob';
import { grepTool } from './grep';
import { listDirTool } from './list-dir';

export function getTools() {
  return [
    bashTool,
    readFileTool,
    writeFileTool,
    editFileTool,
    globTool,
    grepTool,
    listDirTool,
  ];
}
