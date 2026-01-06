/**
 * PATH helpers for subprocesses launched from the Electron app.
 *
 * Packaged GUI apps often have an incomplete PATH (especially on macOS when
 * launched from Finder). Centralize conservative PATH augmentation here.
 */

import * as os from 'os';
import * as path from 'path';

export const expandHome = (value: string): string => {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
};

export const getPathAdditions = (): string[] => {
  const homeDir = os.homedir();

  return process.platform === 'win32'
    ? [
        // User-level global npm installs
        path.join(homeDir, 'AppData', 'Roaming', 'npm'),
        path.join(homeDir, '.local', 'bin'),
        // Common Node.js install path (npm-installed CLIs need node.exe)
        'C:\\Program Files\\nodejs',
        'C:\\Program Files (x86)\\nodejs',
        // Common Git for Windows paths (agents and Codex often need git)
        'C:\\Program Files\\Git\\cmd',
        'C:\\Program Files\\Git\\bin',
        'C:\\Program Files\\Git\\usr\\bin',
        'C:\\Program Files (x86)\\Git\\cmd',
        'C:\\Program Files (x86)\\Git\\bin',
        'C:\\Program Files (x86)\\Git\\usr\\bin',
        'C:\\Program Files\\Claude',
        'C:\\Program Files (x86)\\Claude',
        'C:\\Program Files\\Codex',
        'C:\\Program Files (x86)\\Codex'
      ]
    : [
        '/usr/local/bin',
        '/opt/homebrew/bin',
        path.join(homeDir, '.local', 'bin'),
        path.join(homeDir, 'bin')
      ];
};

export const buildMergedPath = (
  basePath: string | undefined,
  options: {
    includeCodexOverrideDir?: boolean;
    extraDirs?: string[];
  } = {}
): string => {
  const merged: string[] = [];

  if (basePath) {
    merged.push(basePath);
  }

  if (options.includeCodexOverrideDir !== false) {
    const codexOverride = (process.env.AUTO_CLAUDE_CODEX_PATH || '').trim();
    if (codexOverride) {
      merged.push(path.dirname(expandHome(codexOverride)));
    }
  }

  if (options.extraDirs?.length) {
    merged.push(...options.extraDirs);
  }

  merged.push(...getPathAdditions());

  return merged.filter(Boolean).join(path.delimiter);
};
