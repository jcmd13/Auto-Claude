import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import path from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { AutoBuildSourceUpdateProgress, CodexAuthResult, CodexExecpolicyInstallResult, CodexExecpolicyStatusResult, SourceEnvConfig, SourceEnvCheckResult, CodexApprovalPolicy, CodexSandboxMode } from '../../shared/types';
import { checkForUpdates as checkSourceUpdates, downloadAndApplyUpdate, getEffectiveVersion, getEffectiveSourcePath } from '../auto-claude-updater';
import { debugLog } from '../../shared/utils/debug-logger';
import { checkCodexLoginStatus } from '../codex-auth';
import { spawn } from 'child_process';
import { findPythonCommand, parsePythonCommand } from '../python-detector';
import { PythonEnvManager } from '../python-env-manager';
import os from 'os';


/**
 * Register all autobuild-source-related IPC handlers
 */
export function registerAutobuildSourceHandlers(
  pythonEnvManager: PythonEnvManager,
  getMainWindow: () => BrowserWindow | null
): void {
  // ============================================
  // Auto Claude Source Update Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.AUTOBUILD_SOURCE_CHECK,
    async (): Promise<IPCResult<{ updateAvailable: boolean; currentVersion: string; latestVersion?: string; releaseNotes?: string; releaseUrl?: string; error?: string }>> => {
      debugLog('[IPC] AUTOBUILD_SOURCE_CHECK called');
      try {
        const result = await checkSourceUpdates();
        debugLog('[IPC] AUTOBUILD_SOURCE_CHECK result:', result);
        return { success: true, data: result };
      } catch (error) {
        console.error('[autobuild-source] Check error:', error);
        debugLog('[IPC] AUTOBUILD_SOURCE_CHECK error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check for updates'
        };
      }
    }
  );

  ipcMain.on(
    IPC_CHANNELS.AUTOBUILD_SOURCE_DOWNLOAD,
    () => {
      debugLog('[IPC] Autobuild source download requested');
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('[IPC] No main window available, aborting update');
        return;
      }

      // Start download in background
      downloadAndApplyUpdate((progress) => {
        debugLog('[IPC] Update progress:', progress.stage, progress.message);
        mainWindow.webContents.send(
          IPC_CHANNELS.AUTOBUILD_SOURCE_PROGRESS,
          progress
        );
      }).then((result) => {
        if (result.success) {
          debugLog('[IPC] Update completed successfully, version:', result.version);
          mainWindow.webContents.send(
            IPC_CHANNELS.AUTOBUILD_SOURCE_PROGRESS,
            {
              stage: 'complete',
              message: `Updated to version ${result.version}`,
              newVersion: result.version // Include new version for UI refresh
            } as AutoBuildSourceUpdateProgress
          );
        } else {
          debugLog('[IPC] Update failed:', result.error);
          mainWindow.webContents.send(
            IPC_CHANNELS.AUTOBUILD_SOURCE_PROGRESS,
            {
              stage: 'error',
              message: result.error || 'Update failed'
            } as AutoBuildSourceUpdateProgress
          );
        }
      }).catch((error) => {
        debugLog('[IPC] Update error:', error instanceof Error ? error.message : error);
        mainWindow.webContents.send(
          IPC_CHANNELS.AUTOBUILD_SOURCE_PROGRESS,
          {
            stage: 'error',
            message: error instanceof Error ? error.message : 'Update failed'
          } as AutoBuildSourceUpdateProgress
        );
      });

      // Send initial progress
      mainWindow.webContents.send(
        IPC_CHANNELS.AUTOBUILD_SOURCE_PROGRESS,
        {
          stage: 'checking',
          message: 'Starting update...'
        } as AutoBuildSourceUpdateProgress
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AUTOBUILD_SOURCE_VERSION,
    async (): Promise<IPCResult<string>> => {
      try {
        // Use effective version which accounts for source updates
        const version = getEffectiveVersion();
        debugLog('[IPC] Returning effective version:', version);
        return { success: true, data: version };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get version'
        };
      }
    }
  );

  // ============================================
  // Auto Claude Source Environment Operations
  // ============================================

  /**
   * Parse an .env file content into a key-value object
   */
  const parseSourceEnvFile = (content: string): Record<string, string> => {
    const vars: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        vars[key] = value;
      }
    }
    return vars;
  };

  ipcMain.handle(
    IPC_CHANNELS.AUTOBUILD_SOURCE_ENV_GET,
    async (): Promise<IPCResult<SourceEnvConfig>> => {
      try {
        const sourcePath = getEffectiveSourcePath();
        if (!sourcePath) {
          return {
            success: true,
            data: {
              hasClaudeToken: false,
              autoClaudeEngine: undefined,
              envExists: false,
              sourcePath: undefined
            }
          };
        }

        const envPath = path.join(sourcePath, '.env');
        const envExists = existsSync(envPath);

        if (!envExists) {
          return {
            success: true,
            data: {
              hasClaudeToken: false,
              autoClaudeEngine: 'claude',
              envExists: false,
              sourcePath
            }
          };
        }

        const content = readFileSync(envPath, 'utf-8');
        const vars = parseSourceEnvFile(content);
        const hasToken = !!vars['CLAUDE_CODE_OAUTH_TOKEN'];
        const autoBuildModel = (vars['AUTO_BUILD_MODEL'] || '').trim();
        const rawEngine = (vars['AUTO_CLAUDE_ENGINE'] || '').trim().toLowerCase();
        const autoClaudeEngine = rawEngine === 'codex' || rawEngine === 'codex_cli' ? 'codex' : 'claude';
        const codexApprovalPolicy = (vars['AUTO_CLAUDE_CODEX_APPROVAL_POLICY'] || '').trim() as CodexApprovalPolicy | '';
        const codexSandboxMode = (vars['AUTO_CLAUDE_CODEX_SANDBOX_MODE'] || '').trim() as CodexSandboxMode | '';

        return {
          success: true,
          data: {
            hasClaudeToken: hasToken,
            claudeOAuthToken: hasToken ? vars['CLAUDE_CODE_OAUTH_TOKEN'] : undefined,
            autoBuildModel: autoBuildModel || undefined,
            autoClaudeEngine,
            codexApprovalPolicy: codexApprovalPolicy || undefined,
            codexSandboxMode: codexSandboxMode || undefined,
            envExists: true,
            sourcePath
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get source env'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AUTOBUILD_SOURCE_ENV_UPDATE,
    async (
      _,
      config: {
        claudeOAuthToken?: string;
        autoBuildModel?: string;
        autoClaudeEngine?: string;
        codexApprovalPolicy?: string;
        codexSandboxMode?: string;
      }
    ): Promise<IPCResult> => {
      try {
        const sourcePath = getEffectiveSourcePath();
        if (!sourcePath) {
          return {
            success: false,
            error: 'Auto-Claude source path not found. Please configure it in App Settings.'
          };
        }

        const envPath = path.join(sourcePath, '.env');

        // Read existing content or start fresh
        let existingContent = '';
        const existingVars: Record<string, string> = {};

        if (existsSync(envPath)) {
          existingContent = readFileSync(envPath, 'utf-8');
          Object.assign(existingVars, parseSourceEnvFile(existingContent));
        }

        // Update the token
        if (config.claudeOAuthToken !== undefined) {
          existingVars['CLAUDE_CODE_OAUTH_TOKEN'] = config.claudeOAuthToken;
        }

        // Update model override (empty string unsets)
        if (config.autoBuildModel !== undefined) {
          const raw = config.autoBuildModel.trim();
          if (!raw) {
            delete existingVars['AUTO_BUILD_MODEL'];
          } else {
            existingVars['AUTO_BUILD_MODEL'] = raw;
          }
        }

        // Update the engine selection
        if (config.autoClaudeEngine !== undefined) {
          existingVars['AUTO_CLAUDE_ENGINE'] = config.autoClaudeEngine;
        }

        // Update Codex settings (empty string unsets)
        if (config.codexApprovalPolicy !== undefined) {
          const raw = config.codexApprovalPolicy.trim();
          if (!raw) {
            delete existingVars['AUTO_CLAUDE_CODEX_APPROVAL_POLICY'];
          } else {
            existingVars['AUTO_CLAUDE_CODEX_APPROVAL_POLICY'] = raw;
          }
        }
        if (config.codexSandboxMode !== undefined) {
          const raw = config.codexSandboxMode.trim();
          if (!raw) {
            delete existingVars['AUTO_CLAUDE_CODEX_SANDBOX_MODE'];
          } else {
            existingVars['AUTO_CLAUDE_CODEX_SANDBOX_MODE'] = raw;
          }
        }

        // Rebuild the .env file preserving comments and structure
        const lines = existingContent.split('\n');
        const processedKeys = new Set<string>();
        const outputLines: string[] = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) {
            outputLines.push(line);
            continue;
          }

          const eqIndex = trimmed.indexOf('=');
          if (eqIndex > 0) {
            const key = trimmed.substring(0, eqIndex).trim();
            if (key in existingVars) {
              outputLines.push(`${key}=${existingVars[key]}`);
              processedKeys.add(key);
            } else {
              outputLines.push(line);
            }
          } else {
            outputLines.push(line);
          }
        }

        // Add any new keys that weren't in the original file
        for (const [key, value] of Object.entries(existingVars)) {
          if (!processedKeys.has(key)) {
            outputLines.push(`${key}=${value}`);
          }
        }

        writeFileSync(envPath, outputLines.join('\n'));

        const mainWindow = getMainWindow();
        if (mainWindow) {
          const hasToken = !!existingVars['CLAUDE_CODE_OAUTH_TOKEN'];
          const autoBuildModel = (existingVars['AUTO_BUILD_MODEL'] || '').trim();
          const rawEngine = (existingVars['AUTO_CLAUDE_ENGINE'] || '').trim().toLowerCase();
          const autoClaudeEngine = rawEngine === 'codex' || rawEngine === 'codex_cli' ? 'codex' : 'claude';
          const codexApprovalPolicy = (existingVars['AUTO_CLAUDE_CODEX_APPROVAL_POLICY'] || '').trim() as CodexApprovalPolicy | '';
          const codexSandboxMode = (existingVars['AUTO_CLAUDE_CODEX_SANDBOX_MODE'] || '').trim() as CodexSandboxMode | '';

          mainWindow.webContents.send(IPC_CHANNELS.AUTOBUILD_SOURCE_ENV_UPDATED, {
            hasClaudeToken: hasToken,
            claudeOAuthToken: hasToken ? existingVars['CLAUDE_CODE_OAUTH_TOKEN'] : undefined,
            autoBuildModel: autoBuildModel || undefined,
            autoClaudeEngine,
            codexApprovalPolicy: codexApprovalPolicy || undefined,
            codexSandboxMode: codexSandboxMode || undefined,
            envExists: true,
            sourcePath
          } satisfies SourceEnvConfig);
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update source env'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.AUTOBUILD_SOURCE_ENV_CHECK_TOKEN,
    async (): Promise<IPCResult<SourceEnvCheckResult>> => {
      try {
        const sourcePath = getEffectiveSourcePath();
        if (!sourcePath) {
          return {
            success: true,
            data: {
              hasToken: false,
              sourcePath: undefined,
              error: 'Auto-Claude source path not found'
            }
          };
        }

        const envPath = path.join(sourcePath, '.env');
        if (!existsSync(envPath)) {
          return {
            success: true,
            data: {
              hasToken: false,
              sourcePath,
              error: '.env file does not exist'
            }
          };
        }

        const content = readFileSync(envPath, 'utf-8');
        const vars = parseSourceEnvFile(content);
        const hasToken = !!vars['CLAUDE_CODE_OAUTH_TOKEN'] && vars['CLAUDE_CODE_OAUTH_TOKEN'].length > 0;

        return {
          success: true,
          data: {
            hasToken,
            sourcePath
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check source token'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CODEX_LOGIN_STATUS,
    async (): Promise<IPCResult<CodexAuthResult>> => {
      try {
        const result = await checkCodexLoginStatus();

        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check Codex login status'
        };
      }
    }
  );

  const expandHome = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    if (trimmed === '~') return os.homedir();
    if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2));
    return trimmed;
  };

  const getCodexHomeDir = (): string => {
    const raw = (process.env.CODEX_HOME || '').trim();
    return expandHome(raw) || path.join(os.homedir(), '.codex');
  };

  const getCodexRulesPath = (): string => path.join(getCodexHomeDir(), 'rules', 'auto-claude.rules');

  const validateCodexExecpolicyRulesText = (
    content: string
  ): { valid: boolean; ruleCount: number; error?: string } => {
    let ruleCount = 0;
    const normalized = content.replace(/^\uFEFF/, '');
    const lines = normalized.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i]?.trim() ?? '';
      if (!trimmed || trimmed.startsWith('#')) continue;

      ruleCount += 1;

      const match = trimmed.match(
        /^prefix_rule\(\s*pattern=\[(.*)\]\s*,\s*decision=("allow"|"prompt")\s*\)\s*$/
      );

      if (!match) {
        return {
          valid: false,
          ruleCount,
          error: `Invalid execpolicy rule syntax on line ${i + 1}`
        };
      }

      const patternInner = match[1]?.trim() ?? '';
      try {
        const tokens = JSON.parse(`[${patternInner}]`) as unknown;
        if (!Array.isArray(tokens) || tokens.length === 0) {
          return {
            valid: false,
            ruleCount,
            error: `Invalid execpolicy pattern on line ${i + 1}`
          };
        }

        for (const token of tokens) {
          if (typeof token !== 'string' || !token || /\s/.test(token)) {
            return {
              valid: false,
              ruleCount,
              error: `Invalid execpolicy pattern token on line ${i + 1}`
            };
          }
        }
      } catch {
        return {
          valid: false,
          ruleCount,
          error: `Invalid execpolicy pattern JSON on line ${i + 1}`
        };
      }
    }

    if (ruleCount === 0) {
      return { valid: false, ruleCount: 0, error: 'No execpolicy prefix_rule entries found' };
    }

    return { valid: true, ruleCount };
  };

  ipcMain.handle(
    IPC_CHANNELS.CODEX_EXECPOLICY_STATUS,
    async (): Promise<IPCResult<CodexExecpolicyStatusResult>> => {
      try {
        const rulesPath = getCodexRulesPath();
        const installed = existsSync(rulesPath);
        if (!installed) {
          return { success: true, data: { rulesPath, installed: false } };
        }

        let generatedAt: string | undefined;
        let projectPath: string | undefined;
        let valid: boolean | undefined;
        let validationError: string | undefined;
        let ruleCount: number | undefined;
        try {
          const content = readFileSync(rulesPath, 'utf-8');
          const validation = validateCodexExecpolicyRulesText(content);
          valid = validation.valid;
          validationError = validation.error;
          ruleCount = validation.ruleCount;

          for (const line of content.split(/\r?\n/).slice(0, 30)) {
            if (line.startsWith('# Generated:')) {
              generatedAt = line.replace('# Generated:', '').trim() || generatedAt;
            } else if (line.startsWith('# Project:')) {
              projectPath = line.replace('# Project:', '').trim() || projectPath;
            }
          }
        } catch (error) {
          valid = false;
          validationError = error instanceof Error ? error.message : 'Failed to read execpolicy rules file';
        }

        return {
          success: true,
          data: {
            rulesPath,
            installed: true,
            generatedAt,
            projectPath,
            valid,
            ruleCount,
            validationError,
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check Codex execpolicy status'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CODEX_INSTALL_EXECPOLICY,
    async (_, projectPath: string): Promise<IPCResult<CodexExecpolicyInstallResult>> => {
      try {
        if (!projectPath || typeof projectPath !== 'string') {
          return { success: false, error: 'Project path is required' };
        }

        const sourcePath = getEffectiveSourcePath();
        if (!sourcePath) {
          return {
            success: false,
            error: 'Auto-Claude source path not found. Please configure it in App Settings.'
          };
        }

        if (!existsSync(projectPath)) {
          return { success: false, error: `Project path does not exist: ${projectPath}` };
        }

        const runScript = path.join(sourcePath, 'run.py');
        if (!existsSync(runScript)) {
          return { success: false, error: `run.py not found at: ${runScript}` };
        }

        // Ensure Python environment is ready (required for imports like python-dotenv)
        if (!pythonEnvManager.isEnvReady()) {
          const status = await pythonEnvManager.initialize(sourcePath);
          if (!status.ready) {
            return { success: false, error: status.error || 'Python environment is not ready' };
          }
        }

        const pythonPath = pythonEnvManager.getPythonPath() || findPythonCommand() || 'python';
        const [pythonCommand, pythonBaseArgs] = parsePythonCommand(pythonPath);
        const args = [
          runScript,
          '--install-codex-execpolicy',
          '--project-dir', projectPath
        ];

        return await new Promise((resolve) => {
          const proc = spawn(pythonCommand, [...pythonBaseArgs, ...args], {
            cwd: sourcePath,
            env: {
              ...process.env,
              PYTHONUNBUFFERED: '1',
              PYTHONIOENCODING: 'utf-8',
              PYTHONUTF8: '1'
            },
            stdio: ['ignore', 'pipe', 'pipe']
          });

          let stdout = '';
          let stderr = '';

          proc.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
          });

          proc.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
          });

          proc.on('error', (error) => {
            resolve({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to run execpolicy install'
            });
          });

          proc.on('close', (code) => {
            if (code !== 0) {
              resolve({
                success: false,
                error: stderr || stdout || `Execpolicy install failed with exit code ${code}`
              });
              return;
            }

            const marker = 'Wrote Codex execpolicy rules:';
            const line = stdout.split('\n').find((l) => l.includes(marker));
            const rulesPath = line ? line.split(marker)[1]?.trim() : undefined;

            resolve({
              success: true,
              data: {
                rulesPath,
                stdout: stdout.trim() || undefined,
                stderr: stderr.trim() || undefined
              }
            });
          });
        });
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to install Codex execpolicy'
        };
      }
    }
  );

}
