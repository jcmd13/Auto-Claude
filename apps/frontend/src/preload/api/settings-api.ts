import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  AppSettings,
  IPCResult,
  CodexAuthResult,
  CodexExecpolicyInstallResult,
  CodexExecpolicyStatusResult,
  SourceEnvConfig,
  SourceEnvCheckResult,
  ToolDetectionResult
} from '../../shared/types';
import { createIpcListener, type IpcListenerCleanup } from './modules/ipc-utils';

export interface SettingsAPI {
  // App Settings
  getSettings: () => Promise<IPCResult<AppSettings>>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<IPCResult>;

  // CLI Tools Detection
  getCliToolsInfo: () => Promise<IPCResult<{
    python: ToolDetectionResult;
    git: ToolDetectionResult;
    gh: ToolDetectionResult;
    claude: ToolDetectionResult;
  }>>;

  // App Info
  getAppVersion: () => Promise<string>;

  // Auto-Build Source Environment
  getSourceEnv: () => Promise<IPCResult<SourceEnvConfig>>;
  updateSourceEnv: (config: { claudeOAuthToken?: string; autoBuildModel?: string; autoClaudeEngine?: string; codexApprovalPolicy?: string; codexSandboxMode?: string }) => Promise<IPCResult>;
  onSourceEnvUpdated: (callback: (config: SourceEnvConfig) => void) => IpcListenerCleanup;
  checkSourceToken: () => Promise<IPCResult<SourceEnvCheckResult>>;

  // Codex
  checkCodexLoginStatus: () => Promise<IPCResult<CodexAuthResult>>;
  installCodexExecpolicy: (projectPath: string) => Promise<IPCResult<CodexExecpolicyInstallResult>>;
  checkCodexExecpolicyStatus: () => Promise<IPCResult<CodexExecpolicyStatusResult>>;
}

export const createSettingsAPI = (): SettingsAPI => ({
  // App Settings
  getSettings: (): Promise<IPCResult<AppSettings>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),

  saveSettings: (settings: Partial<AppSettings>): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, settings),

  // CLI Tools Detection
  getCliToolsInfo: (): Promise<IPCResult<{
    python: ToolDetectionResult;
    git: ToolDetectionResult;
    gh: ToolDetectionResult;
    claude: ToolDetectionResult;
  }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_CLI_TOOLS_INFO),

  // App Info
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_VERSION),

  // Auto-Build Source Environment
  getSourceEnv: (): Promise<IPCResult<SourceEnvConfig>> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTOBUILD_SOURCE_ENV_GET),

  updateSourceEnv: (config: { claudeOAuthToken?: string; autoBuildModel?: string; autoClaudeEngine?: string; codexApprovalPolicy?: string; codexSandboxMode?: string }): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTOBUILD_SOURCE_ENV_UPDATE, config),

  onSourceEnvUpdated: (
    callback: (config: SourceEnvConfig) => void
  ): IpcListenerCleanup =>
    createIpcListener<[SourceEnvConfig]>(IPC_CHANNELS.AUTOBUILD_SOURCE_ENV_UPDATED, callback),

  checkSourceToken: (): Promise<IPCResult<SourceEnvCheckResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTOBUILD_SOURCE_ENV_CHECK_TOKEN),

  // Codex
  checkCodexLoginStatus: (): Promise<IPCResult<CodexAuthResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CODEX_LOGIN_STATUS),

  installCodexExecpolicy: (projectPath: string): Promise<IPCResult<CodexExecpolicyInstallResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CODEX_INSTALL_EXECPOLICY, projectPath),

  checkCodexExecpolicyStatus: (): Promise<IPCResult<CodexExecpolicyStatusResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CODEX_EXECPOLICY_STATUS)
});
