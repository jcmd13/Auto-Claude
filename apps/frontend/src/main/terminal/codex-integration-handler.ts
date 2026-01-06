/**
 * Codex Integration Handler
 * Manages Codex-specific operations for Agent Terminals
 */

import { IPC_CHANNELS } from '../../shared/constants';
import { buildCdCommand } from '../../shared/utils/shell-escape';
import type { TerminalProcess, WindowGetter } from './types';

/**
 * Invoke Codex in a terminal
 */
export function invokeCodex(
  terminal: TerminalProcess,
  cwd: string | undefined,
  getWindow: WindowGetter,
): void {
  terminal.isCodexMode = true;
  terminal.isClaudeMode = false;
  terminal.claudeSessionId = undefined;
  terminal.claudeProfileId = undefined;

  const cwdCommand = buildCdCommand(cwd);
  terminal.pty.write(`${cwdCommand}codex\r`);

  const win = getWindow();
  if (win) {
    win.webContents.send(IPC_CHANNELS.TERMINAL_TITLE_CHANGE, terminal.id, 'Codex');
  }
}

/**
 * Resume the most recent Codex session (MVP)
 */
export function resumeCodex(
  terminal: TerminalProcess,
  getWindow: WindowGetter,
): void {
  terminal.isCodexMode = true;
  terminal.isClaudeMode = false;
  terminal.claudeSessionId = undefined;
  terminal.claudeProfileId = undefined;

  terminal.pty.write('codex resume --last\r');

  const win = getWindow();
  if (win) {
    win.webContents.send(IPC_CHANNELS.TERMINAL_TITLE_CHANGE, terminal.id, 'Codex');
  }
}
