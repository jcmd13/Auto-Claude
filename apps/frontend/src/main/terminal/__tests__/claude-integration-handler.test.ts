import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IPC_CHANNELS } from '../../../shared/constants';
import { invokeClaude, resumeClaude } from '../claude-integration-handler';
import type { TerminalProcess } from '../types';

const mockProfileManager = {
  getProfile: vi.fn(),
  getActiveProfile: vi.fn(),
  getProfileToken: vi.fn(),
  markProfileUsed: vi.fn(),
  setActiveProfile: vi.fn()
};

vi.mock('../../claude-profile-manager', () => ({
  getClaudeProfileManager: () => mockProfileManager
}));

describe('ClaudeIntegration (Windows parity)', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.clearAllMocks();
  });

  it('invokes Claude with a Windows-scoped token override (no bash/clear, no token in command)', () => {
    const write = vi.fn();
    const webContentsSend = vi.fn();

    const terminal = {
      id: 'terminal-1',
      pty: { write } as unknown as TerminalProcess['pty'],
      isClaudeMode: false,
      isCodexMode: false,
      cwd: 'C:\\project',
      outputBuffer: '',
      title: 'Terminal 1'
    } satisfies TerminalProcess;

    mockProfileManager.getProfile.mockReturnValue({
      id: 'profile-1',
      name: 'Work',
      isDefault: false,
      oauthToken: 'encrypted-token',
      configDir: 'C:\\claude-config'
    });
    mockProfileManager.getActiveProfile.mockReturnValue({
      id: 'default',
      name: 'Default',
      isDefault: true
    });
    mockProfileManager.getProfileToken.mockReturnValue('token-should-not-appear');

    invokeClaude(
      terminal,
      'C:\\project',
      'profile-1',
      () => ({ webContents: { send: webContentsSend } }) as never,
      vi.fn()
    );

    expect(write).toHaveBeenCalledTimes(1);

    const command = String(write.mock.calls[0]?.[0] ?? '');
    expect(command).toContain('cls');
    expect(command).toContain('cd /d');
    expect(command).toContain('setlocal');
    expect(command).toContain('set /p CLAUDE_CODE_OAUTH_TOKEN=<');
    expect(command).toContain('del /f /q');
    expect(command).toContain('claude');

    expect(command).not.toContain('bash -c');
    expect(command).not.toContain('clear &&');
    expect(command).not.toContain('token-should-not-appear');

    expect(webContentsSend).toHaveBeenCalledWith(
      IPC_CHANNELS.TERMINAL_TITLE_CHANGE,
      'terminal-1',
      'Claude (Work)'
    );
  });

  it('resumes Claude with cmd-safe quoting on Windows', () => {
    const write = vi.fn();

    const terminal = {
      id: 'terminal-2',
      pty: { write } as unknown as TerminalProcess['pty'],
      isClaudeMode: false,
      isCodexMode: false,
      cwd: 'C:\\project',
      outputBuffer: '',
      title: 'Terminal 2'
    } satisfies TerminalProcess;

    resumeClaude(terminal, 'session-123', () => null);

    expect(write).toHaveBeenCalledWith('claude --resume "session-123"\r');
  });
});

