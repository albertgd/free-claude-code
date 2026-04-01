import readline from 'readline';
import path from 'path';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  yellow: '\x1b[33m',
};

/**
 * Returns true if the given resolved path is OUTSIDE the current working directory.
 */
export function isOutsideCwd(resolvedPath: string): boolean {
  const cwd = process.cwd();
  const relative = path.relative(cwd, resolvedPath);
  // Starts with '..' or is an absolute path not under cwd
  return relative.startsWith('..') || path.isAbsolute(relative);
}

/**
 * Prompts the user for y/N confirmation in the terminal.
 * Returns true if the user confirmed.
 */
export async function promptConfirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  return new Promise(resolve => {
    rl.question(
      `\n${C.bold}${C.yellow}⚠  ${message}${C.reset}\n   Proceed? [y/N] `,
      answer => {
        rl.close();
        const yes = answer.trim().toLowerCase();
        resolve(yes === 'y' || yes === 'yes');
      },
    );
  });
}

/**
 * If the path is outside cwd, asks for confirmation.
 * Returns true if the operation should proceed.
 */
export async function confirmIfOutside(
  resolvedPath: string,
  action: string,
): Promise<boolean> {
  if (!isOutsideCwd(resolvedPath)) return true;

  const display = path.relative(process.env.HOME ?? '/', resolvedPath);
  return promptConfirm(`${action} ~/${display} (outside working directory)`);
}
