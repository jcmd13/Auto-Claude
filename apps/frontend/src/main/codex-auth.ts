/**
 * Codex authentication helpers (main process)
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CodexAuthResult } from '../shared/types';
import { buildMergedPath, expandHome } from './path-env';

const resolveCodexCommand = (): string => {
  const override = (process.env.AUTO_CLAUDE_CODEX_PATH || '').trim();
  if (override) {
    return expandHome(override);
  }

  const homeDir = os.homedir();
  const candidates = process.platform === 'win32'
    ? [
        path.join(homeDir, 'AppData', 'Roaming', 'npm', 'codex.cmd'),
        path.join(homeDir, 'AppData', 'Roaming', 'npm', 'codex.exe'),
        path.join(homeDir, 'AppData', 'Local', 'Programs', 'codex', 'codex.exe')
      ]
    : [
        '/usr/local/bin/codex',
        '/opt/homebrew/bin/codex',
        path.join(homeDir, '.local', 'bin', 'codex'),
        path.join(homeDir, 'bin', 'codex')
      ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore and fall through
    }
  }

  return 'codex';
};

const buildSpawnEnv = (): Record<string, string> => {
  return {
    ...process.env,
    PATH: buildMergedPath(process.env.PATH)
  } as Record<string, string>;
};

const parseCodexLoginStatus = (
  output: string
): { authenticated: boolean; loginMethod: CodexAuthResult['loginMethod'] } => {
  const normalized = output.toLowerCase();

  const isLoggedIn = normalized.includes('logged in');
  const isChatGpt = normalized.includes('chatgpt');
  const isApiKey = normalized.includes('api key') || normalized.includes('api-key') || normalized.includes('api_key');

  if (isLoggedIn && isChatGpt) {
    return { authenticated: true, loginMethod: 'chatgpt' };
  }
  if (isLoggedIn && isApiKey) {
    return { authenticated: false, loginMethod: 'api_key' };
  }
  if (isLoggedIn) {
    return { authenticated: false, loginMethod: 'unknown' };
  }

  return { authenticated: false, loginMethod: 'unknown' };
};

export async function checkCodexLoginStatus(): Promise<CodexAuthResult> {
  return await new Promise<CodexAuthResult>((resolve) => {
    const codexCommand = resolveCodexCommand();
    const proc = spawn(codexCommand, ['login', 'status'], {
      cwd: process.cwd(),
      env: buildSpawnEnv(),
      shell: process.platform === 'win32'
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code: number | null) => {
      const output = `${stdout}\n${stderr}`.trim();
      const normalized = output.toLowerCase();

      if (code === 0) {
        const parsed = parseCodexLoginStatus(output);
        resolve({
          success: true,
          authenticated: parsed.authenticated,
          loginMethod: parsed.loginMethod,
          error: parsed.loginMethod === 'api_key'
            ? 'Codex is logged in via API key mode. This app expects "Sign in with ChatGPT".'
            : undefined
        });
        return;
      }

      // Treat "not logged in" as a valid (non-error) status
      if (normalized.includes('not logged in') || normalized.includes('logged out')) {
        resolve({
          success: true,
          authenticated: false,
          loginMethod: 'unknown'
        });
        return;
      }

      resolve({
        success: false,
        authenticated: false,
        error: output || 'Failed to check Codex login status'
      });
    });

    proc.on('error', (err: Error & { code?: string }) => {
      const isNotFound = err.code === 'ENOENT';
      resolve({
        success: false,
        authenticated: false,
        error: isNotFound
          ? 'Codex CLI not found. Please install it first (or set AUTO_CLAUDE_CODEX_PATH to the full codex binary path).'
          : err.message
      });
    });
  });
}
