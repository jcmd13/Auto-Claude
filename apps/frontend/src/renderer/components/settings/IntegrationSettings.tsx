import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Key,
  Eye,
  EyeOff,
  Info,
  Users,
  Bot,
  Plus,
  Trash2,
  Star,
  Check,
  Pencil,
  X,
  Loader2,
  LogIn,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Activity,
  AlertCircle,
  Copy,
  FolderOpen,
  Shield
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { cn } from '../../lib/utils';
import { SettingsSection } from './SettingsSection';
import { loadClaudeProfiles as loadGlobalClaudeProfiles } from '../../stores/claude-profile-store';
import { useTerminalStore } from '../../stores/terminal-store';
import { useProjectStore } from '../../stores/project-store';
import { toast } from '../../hooks/use-toast';
import type { AppSettings, ClaudeProfile, ClaudeAutoSwitchSettings, AutoClaudeEngineName, CodexAuthResult, SourceEnvConfig, CodexApprovalPolicy, CodexSandboxMode, CodexExecpolicyStatusResult } from '../../../shared/types';

interface IntegrationSettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  isOpen: boolean;
}

/**
 * Integration settings for Claude accounts and API keys
 */
export function IntegrationSettings({ settings, onSettingsChange, isOpen }: IntegrationSettingsProps) {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  // Password visibility toggle for global API keys
  const [showGlobalOpenAIKey, setShowGlobalOpenAIKey] = useState(false);

  const selectedProjectPath = useProjectStore((state) => {
    const project = state.projects.find((p) => p.id === state.selectedProjectId);
    return project?.path;
  });

  const addTerminal = useTerminalStore((state) => state.addTerminal);
  const updateTerminal = useTerminalStore((state) => state.updateTerminal);

  // Auto-Claude source environment state
  const [sourceEnv, setSourceEnv] = useState<SourceEnvConfig | null>(null);
  const [isLoadingSourceEnv, setIsLoadingSourceEnv] = useState(false);
  const [isUpdatingSourceEnv, setIsUpdatingSourceEnv] = useState(false);
  const [sourceEnvError, setSourceEnvError] = useState<string | null>(null);
  const [codexApprovalPolicy, setCodexApprovalPolicy] = useState<string>('');
  const [codexSandboxMode, setCodexSandboxMode] = useState<string>('');
  const [autoBuildModel, setAutoBuildModel] = useState<string>('');

  // Codex login status (ChatGPT auth)
  const [codexStatus, setCodexStatus] = useState<CodexAuthResult | null>(null);
  const [isCheckingCodexStatus, setIsCheckingCodexStatus] = useState(false);
  const [isStartingCodexLogin, setIsStartingCodexLogin] = useState(false);
  const [isPollingCodexStatus, setIsPollingCodexStatus] = useState(false);
  const codexPollAttemptsRef = useRef(0);
  const [isInstallingCodexExecpolicy, setIsInstallingCodexExecpolicy] = useState(false);
  const [codexExecpolicyError, setCodexExecpolicyError] = useState<string | null>(null);
  const [codexExecpolicyStatus, setCodexExecpolicyStatus] = useState<CodexExecpolicyStatusResult | null>(null);
  const [isCheckingCodexExecpolicy, setIsCheckingCodexExecpolicy] = useState(false);

  // Claude Accounts state
  const [claudeProfiles, setClaudeProfiles] = useState<ClaudeProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingProfileName, setEditingProfileName] = useState('');
  const [authenticatingProfileId, setAuthenticatingProfileId] = useState<string | null>(null);
  const [expandedTokenProfileId, setExpandedTokenProfileId] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [manualTokenEmail, setManualTokenEmail] = useState('');
  const [showManualToken, setShowManualToken] = useState(false);
  const [savingTokenProfileId, setSavingTokenProfileId] = useState<string | null>(null);

  // Auto-swap settings state
  const [autoSwitchSettings, setAutoSwitchSettings] = useState<ClaudeAutoSwitchSettings | null>(null);
  const [isLoadingAutoSwitch, setIsLoadingAutoSwitch] = useState(false);

  // Load Claude profiles and auto-swap settings when section is shown
  useEffect(() => {
    if (isOpen) {
      loadClaudeProfiles();
      loadAutoSwitchSettings();
      loadSourceEnv();
      loadCodexLoginStatus();
      loadCodexExecpolicyStatus();
    }
  }, [isOpen]);

  // Listen for OAuth authentication completion
  useEffect(() => {
    const unsubscribe = window.electronAPI.onTerminalOAuthToken(async (info) => {
      if (info.success && info.profileId) {
        // Reload profiles to show updated state
        await loadClaudeProfiles();
        toast({
          variant: 'success',
          title: 'Profile authenticated',
          description: info.email
            ? `Account: ${info.email}\n\nYou can now use this profile.`
            : 'Authentication complete.\n\nYou can now use this profile.',
          duration: 8000,
        });
      }
    });

    return unsubscribe;
  }, []);

  const loadClaudeProfiles = async () => {
    setIsLoadingProfiles(true);
    try {
      const result = await window.electronAPI.getClaudeProfiles();
      if (result.success && result.data) {
        setClaudeProfiles(result.data.profiles);
        setActiveProfileId(result.data.activeProfileId);
        // Also update the global store
        await loadGlobalClaudeProfiles();
      }
    } catch (err) {
      console.error('Failed to load Claude profiles:', err);
    } finally {
      setIsLoadingProfiles(false);
    }
  };

  const loadSourceEnv = async () => {
    setIsLoadingSourceEnv(true);
    setSourceEnvError(null);
    try {
      const result = await window.electronAPI.getSourceEnv();
      if (result.success && result.data) {
        setSourceEnv(result.data);
        setCodexApprovalPolicy(result.data.codexApprovalPolicy || '');
        setCodexSandboxMode(result.data.codexSandboxMode || '');
        setAutoBuildModel(result.data.autoBuildModel || '');
      } else {
        setSourceEnv(null);
        setSourceEnvError(result.error || 'Failed to load Auto-Claude source environment');
      }
    } catch (err) {
      setSourceEnv(null);
      setSourceEnvError(err instanceof Error ? err.message : 'Failed to load Auto-Claude source environment');
    } finally {
      setIsLoadingSourceEnv(false);
    }
  };

  const handleAutoClaudeEngineChange = async (engine: AutoClaudeEngineName) => {
    setIsUpdatingSourceEnv(true);
    setSourceEnvError(null);
    try {
      const result = await window.electronAPI.updateSourceEnv({ autoClaudeEngine: engine });
      if (result.success) {
        await loadSourceEnv();
      } else {
        setSourceEnvError(result.error || 'Failed to update engine selection');
      }
    } catch (err) {
      setSourceEnvError(err instanceof Error ? err.message : 'Failed to update engine selection');
    } finally {
      setIsUpdatingSourceEnv(false);
    }
  };

  const handleAutoBuildModelSave = async () => {
    setIsUpdatingSourceEnv(true);
    setSourceEnvError(null);
    try {
      const result = await window.electronAPI.updateSourceEnv({ autoBuildModel });
      if (result.success) {
        toast({
          variant: 'success',
          title: 'Model saved',
          description: autoBuildModel ? `AUTO_BUILD_MODEL=${autoBuildModel}` : 'AUTO_BUILD_MODEL cleared',
        });
        await loadSourceEnv();
      } else {
        setSourceEnvError(result.error || 'Failed to update AUTO_BUILD_MODEL');
      }
    } catch (err) {
      setSourceEnvError(err instanceof Error ? err.message : 'Failed to update AUTO_BUILD_MODEL');
    } finally {
      setIsUpdatingSourceEnv(false);
    }
  };

  const handleCodexApprovalPolicyChange = async (value: string) => {
    setCodexApprovalPolicy(value);
    setIsUpdatingSourceEnv(true);
    setSourceEnvError(null);
    try {
      const result = await window.electronAPI.updateSourceEnv({ codexApprovalPolicy: value });
      if (!result.success) {
        setSourceEnvError(result.error || 'Failed to update Codex approval policy');
      }
      await loadSourceEnv();
    } catch (err) {
      setSourceEnvError(err instanceof Error ? err.message : 'Failed to update Codex approval policy');
    } finally {
      setIsUpdatingSourceEnv(false);
    }
  };

  const handleCodexSandboxModeChange = async (value: string) => {
    setCodexSandboxMode(value);
    setIsUpdatingSourceEnv(true);
    setSourceEnvError(null);
    try {
      const result = await window.electronAPI.updateSourceEnv({ codexSandboxMode: value });
      if (!result.success) {
        setSourceEnvError(result.error || 'Failed to update Codex sandbox mode');
      }
      await loadSourceEnv();
    } catch (err) {
      setSourceEnvError(err instanceof Error ? err.message : 'Failed to update Codex sandbox mode');
    } finally {
      setIsUpdatingSourceEnv(false);
    }
  };

  const loadCodexLoginStatus = async () => {
    setIsCheckingCodexStatus(true);
    try {
      const result = await window.electronAPI.checkCodexLoginStatus();
      if (result.success && result.data) {
        setCodexStatus(result.data);
        if (result.data.authenticated) {
          setIsPollingCodexStatus(false);
        }
      } else {
        setCodexStatus({
          success: false,
          authenticated: false,
          error: result.error || 'Failed to check Codex login status'
        });
      }
    } catch (err) {
      setCodexStatus({
        success: false,
        authenticated: false,
        error: err instanceof Error ? err.message : 'Failed to check Codex login status'
      });
    } finally {
      setIsCheckingCodexStatus(false);
    }
  };

  const loadCodexExecpolicyStatus = async () => {
    setIsCheckingCodexExecpolicy(true);
    try {
      const result = await window.electronAPI.checkCodexExecpolicyStatus();
      if (result.success && result.data) {
        setCodexExecpolicyStatus(result.data);
      } else {
        setCodexExecpolicyStatus(null);
      }
    } finally {
      setIsCheckingCodexExecpolicy(false);
    }
  };

  const waitForTerminalRunning = async (terminalId: string, timeoutMs = 8000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const terminal = useTerminalStore.getState().terminals.find((t) => t.id === terminalId);
      if (terminal && (terminal.status === 'running' || terminal.status === 'claude-active')) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  };

  const handleCodexLogin = async () => {
    setIsStartingCodexLogin(true);
    try {
      const terminal = addTerminal(selectedProjectPath);
      if (!terminal) {
        toast({
          variant: 'warning',
          title: 'Maximum terminals reached',
          description: 'Close a terminal and try again.',
        });
        return;
      }

      updateTerminal(terminal.id, { title: 'Codex Login' });

      const ready = await waitForTerminalRunning(terminal.id);
      if (!ready) {
        toast({
          variant: 'destructive',
          title: 'Terminal failed to start',
          description: 'Try again.',
        });
        return;
      }

      window.electronAPI.sendTerminalInput(terminal.id, 'codex login\r');

      codexPollAttemptsRef.current = 0;
      setIsPollingCodexStatus(true);

      toast({
        title: 'Codex login started',
        description:
          'Started Codex login in a new Agent Terminal.\n\n' +
          'Complete the "Sign in with ChatGPT" flow in your browser, then return here — the status will update automatically.',
        duration: 12000,
      });
    } finally {
      setIsStartingCodexLogin(false);
    }
  };

  const handleInstallCodexExecpolicy = async () => {
    if (!selectedProjectPath) {
      toast({
        variant: 'warning',
        title: 'Select a project first',
        description: 'Use the top-left project picker to install Codex execpolicy rules.',
      });
      return;
    }

    setIsInstallingCodexExecpolicy(true);
    setCodexExecpolicyError(null);

    try {
      const result = await window.electronAPI.installCodexExecpolicy(selectedProjectPath);
      if (result.success && result.data) {
        const rulesPath = result.data.rulesPath;
        toast({
          variant: 'success',
          title: 'Codex execpolicy installed',
          description: rulesPath
            ? `Rules file:\n${rulesPath}`
            : 'Rules file path was not detected; see logs for details.',
          duration: 8000,
        });
        await loadCodexExecpolicyStatus();
      } else {
        setCodexExecpolicyError(result.error || 'Failed to install Codex execpolicy rules');
      }
    } catch (err) {
      setCodexExecpolicyError(err instanceof Error ? err.message : 'Failed to install Codex execpolicy rules');
    } finally {
      setIsInstallingCodexExecpolicy(false);
    }
  };

  const handleCopyCodexExecpolicyPath = async () => {
    const rulesPath = codexExecpolicyStatus?.rulesPath;
    if (!rulesPath) return;

    try {
      await navigator.clipboard.writeText(rulesPath);
      toast({
        variant: 'success',
        title: 'Copied rules path',
        description: rulesPath,
        duration: 4000,
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to copy',
        description: err instanceof Error ? err.message : 'Could not copy rules path to clipboard.',
      });
    }
  };

  const handleRevealCodexExecpolicyRules = async () => {
    const rulesPath = codexExecpolicyStatus?.rulesPath;
    if (!rulesPath || !codexExecpolicyStatus?.installed) return;

    try {
      const opened = await window.electronAPI.showItemInFolder(rulesPath);
      if (!opened) {
        toast({
          variant: 'warning',
          title: 'Could not reveal rules file',
          description: rulesPath,
        });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not reveal rules file',
        description: err instanceof Error ? err.message : 'Failed to open your file browser.',
      });
    }
  };

  // Poll Codex auth while login is in progress
  useEffect(() => {
    if (!isPollingCodexStatus || !isOpen) return;

    const interval = setInterval(async () => {
      codexPollAttemptsRef.current += 1;

      // Stop polling after ~2 minutes
      if (codexPollAttemptsRef.current > 60) {
        setIsPollingCodexStatus(false);
        return;
      }

      await loadCodexLoginStatus();
    }, 2000);

    return () => clearInterval(interval);
  }, [isPollingCodexStatus, isOpen]);

  const handleAddProfile = async () => {
    if (!newProfileName.trim()) return;

    setIsAddingProfile(true);
    try {
      const profileName = newProfileName.trim();
      const profileSlug = profileName.toLowerCase().replace(/\s+/g, '-');

      const result = await window.electronAPI.saveClaudeProfile({
        id: `profile-${Date.now()}`,
        name: profileName,
        configDir: `~/.claude-profiles/${profileSlug}`,
        isDefault: false,
        createdAt: new Date()
      });

      if (result.success && result.data) {
        // Initialize the profile
        const initResult = await window.electronAPI.initializeClaudeProfile(result.data.id);

        if (initResult.success) {
          await loadClaudeProfiles();
          setNewProfileName('');

          toast({
            title: `Authenticating "${profileName}"...`,
            description:
              'A browser window will open for you to log in with your Claude account.\n\n' +
              'The authentication will be saved automatically once complete.',
            duration: 12000,
          });
        } else {
          await loadClaudeProfiles();
          toast({
            variant: 'destructive',
            title: 'Failed to start authentication',
            description: initResult.error || 'Please try again.',
          });
        }
      }
    } catch (err) {
      console.error('Failed to add profile:', err);
      toast({
        variant: 'destructive',
        title: 'Failed to add profile',
        description: 'Please try again.',
      });
    } finally {
      setIsAddingProfile(false);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    setDeletingProfileId(profileId);
    try {
      const result = await window.electronAPI.deleteClaudeProfile(profileId);
      if (result.success) {
        await loadClaudeProfiles();
      }
    } catch (err) {
      console.error('Failed to delete profile:', err);
    } finally {
      setDeletingProfileId(null);
    }
  };

  const startEditingProfile = (profile: ClaudeProfile) => {
    setEditingProfileId(profile.id);
    setEditingProfileName(profile.name);
  };

  const cancelEditingProfile = () => {
    setEditingProfileId(null);
    setEditingProfileName('');
  };

  const handleRenameProfile = async () => {
    if (!editingProfileId || !editingProfileName.trim()) return;

    try {
      const result = await window.electronAPI.renameClaudeProfile(editingProfileId, editingProfileName.trim());
      if (result.success) {
        await loadClaudeProfiles();
      }
    } catch (err) {
      console.error('Failed to rename profile:', err);
    } finally {
      setEditingProfileId(null);
      setEditingProfileName('');
    }
  };

  const handleSetActiveProfile = async (profileId: string) => {
    try {
      const result = await window.electronAPI.setActiveClaudeProfile(profileId);
      if (result.success) {
        setActiveProfileId(profileId);
        await loadGlobalClaudeProfiles();
      }
    } catch (err) {
      console.error('Failed to set active profile:', err);
    }
  };

  const handleAuthenticateProfile = async (profileId: string) => {
    setAuthenticatingProfileId(profileId);
    try {
      const initResult = await window.electronAPI.initializeClaudeProfile(profileId);
      if (initResult.success) {
        toast({
          title: 'Authenticating profile...',
          description:
            'A browser window will open for you to log in with your Claude account.\n\n' +
            'The authentication will be saved automatically once complete.',
          duration: 12000,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Failed to start authentication',
          description: initResult.error || 'Please try again.',
        });
      }
    } catch (err) {
      console.error('Failed to authenticate profile:', err);
      toast({
        variant: 'destructive',
        title: 'Failed to start authentication',
        description: 'Please try again.',
      });
    } finally {
      setAuthenticatingProfileId(null);
    }
  };

  const toggleTokenEntry = (profileId: string) => {
    if (expandedTokenProfileId === profileId) {
      setExpandedTokenProfileId(null);
      setManualToken('');
      setManualTokenEmail('');
      setShowManualToken(false);
    } else {
      setExpandedTokenProfileId(profileId);
      setManualToken('');
      setManualTokenEmail('');
      setShowManualToken(false);
    }
  };

  const handleSaveManualToken = async (profileId: string) => {
    if (!manualToken.trim()) return;

    setSavingTokenProfileId(profileId);
    try {
      const result = await window.electronAPI.setClaudeProfileToken(
        profileId,
        manualToken.trim(),
        manualTokenEmail.trim() || undefined
      );
      if (result.success) {
        await loadClaudeProfiles();
        setExpandedTokenProfileId(null);
        setManualToken('');
        setManualTokenEmail('');
        setShowManualToken(false);
      } else {
        toast({
          variant: 'destructive',
          title: 'Failed to save token',
          description: result.error || 'Please try again.',
        });
      }
    } catch (err) {
      console.error('Failed to save token:', err);
      toast({
        variant: 'destructive',
        title: 'Failed to save token',
        description: 'Please try again.',
      });
    } finally {
      setSavingTokenProfileId(null);
    }
  };

  // Load auto-swap settings
  const loadAutoSwitchSettings = async () => {
    setIsLoadingAutoSwitch(true);
    try {
      const result = await window.electronAPI.getAutoSwitchSettings();
      if (result.success && result.data) {
        setAutoSwitchSettings(result.data);
      }
    } catch (err) {
      console.error('Failed to load auto-switch settings:', err);
    } finally {
      setIsLoadingAutoSwitch(false);
    }
  };

  // Update auto-swap settings
  const handleUpdateAutoSwitch = async (updates: Partial<ClaudeAutoSwitchSettings>) => {
    setIsLoadingAutoSwitch(true);
    try {
      const result = await window.electronAPI.updateAutoSwitchSettings(updates);
      if (result.success) {
        await loadAutoSwitchSettings();
      } else {
        toast({
          variant: 'destructive',
          title: 'Failed to update settings',
          description: result.error || 'Please try again.',
        });
      }
    } catch (err) {
      console.error('Failed to update auto-switch settings:', err);
      toast({
        variant: 'destructive',
        title: 'Failed to update settings',
        description: 'Please try again.',
      });
    } finally {
      setIsLoadingAutoSwitch(false);
    }
  };

  return (
    <SettingsSection
      title={t('integrations.title')}
      description={t('integrations.description')}
    >
      <div className="space-y-6">
        {/* Claude Accounts Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold text-foreground">{t('integrations.claudeAccounts')}</h4>
          </div>

          <div className="rounded-lg bg-muted/30 border border-border p-4">
            <p className="text-sm text-muted-foreground mb-4">
              {t('integrations.claudeAccountsDescription')}
            </p>

            {/* Accounts list */}
            {isLoadingProfiles ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : claudeProfiles.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center mb-4">
                <p className="text-sm text-muted-foreground">{t('integrations.noAccountsYet')}</p>
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                {claudeProfiles.map((profile) => (
                  <div
                    key={profile.id}
                    className={cn(
                      "rounded-lg border transition-colors",
                      profile.id === activeProfileId
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background"
                    )}
                  >
                    <div className={cn(
                      "flex items-center justify-between p-3",
                      expandedTokenProfileId !== profile.id && "hover:bg-muted/50"
                    )}>
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0",
                          profile.id === activeProfileId
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        )}>
                          {(editingProfileId === profile.id ? editingProfileName : profile.name).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          {editingProfileId === profile.id ? (
                            <div className="flex items-center gap-2">
                              <Input
                                value={editingProfileName}
                                onChange={(e) => setEditingProfileName(e.target.value)}
                                className="h-7 text-sm w-40"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleRenameProfile();
                                  if (e.key === 'Escape') cancelEditingProfile();
                                }}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleRenameProfile}
                                className="h-7 w-7 text-success hover:text-success hover:bg-success/10"
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={cancelEditingProfile}
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-foreground">{profile.name}</span>
                                {profile.isDefault && (
                                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{t('integrations.default')}</span>
                                )}
                                {profile.id === activeProfileId && (
                                  <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded flex items-center gap-1">
                                    <Star className="h-3 w-3" />
                                    {t('integrations.active')}
                                  </span>
                                )}
                                {(profile.oauthToken || (profile.isDefault && profile.configDir)) ? (
                                  <span className="text-xs bg-success/20 text-success px-1.5 py-0.5 rounded flex items-center gap-1">
                                    <Check className="h-3 w-3" />
                                    {t('integrations.authenticated')}
                                  </span>
                                ) : (
                                  <span className="text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded">
                                    {t('integrations.needsAuth')}
                                  </span>
                                )}
                              </div>
                              {profile.email && (
                                <span className="text-xs text-muted-foreground">{profile.email}</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      {editingProfileId !== profile.id && (
                        <div className="flex items-center gap-1">
                          {/* Authenticate button - show only if NOT authenticated */}
                          {/* A profile is authenticated if: has OAuth token OR (is default AND has configDir) */}
                          {!(profile.oauthToken || (profile.isDefault && profile.configDir)) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleAuthenticateProfile(profile.id)}
                              disabled={authenticatingProfileId === profile.id}
                              className="gap-1 h-7 text-xs"
                            >
                              {authenticatingProfileId === profile.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <LogIn className="h-3 w-3" />
                              )}
                              {t('integrations.authenticate')}
                            </Button>
                          ) : (
                            /* Re-authenticate button for already authenticated profiles */
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleAuthenticateProfile(profile.id)}
                              disabled={authenticatingProfileId === profile.id}
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title="Re-authenticate profile"
                            >
                              {authenticatingProfileId === profile.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                          {profile.id !== activeProfileId && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSetActiveProfile(profile.id)}
                              className="gap-1 h-7 text-xs"
                            >
                              <Check className="h-3 w-3" />
                              {t('integrations.setActive')}
                            </Button>
                          )}
                          {/* Toggle token entry button */}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleTokenEntry(profile.id)}
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title={expandedTokenProfileId === profile.id ? "Hide token entry" : "Enter token manually"}
                          >
                            {expandedTokenProfileId === profile.id ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => startEditingProfile(profile)}
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Rename profile"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          {!profile.isDefault && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteProfile(profile.id)}
                              disabled={deletingProfileId === profile.id}
                              className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                              title="Delete profile"
                            >
                              {deletingProfileId === profile.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Expanded token entry section */}
                    {expandedTokenProfileId === profile.id && (
                      <div className="px-3 pb-3 pt-0 border-t border-border/50 mt-0">
                        <div className="bg-muted/30 rounded-lg p-3 mt-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-medium text-muted-foreground">
                              {t('integrations.manualTokenEntry')}
                            </Label>
                            <span className="text-xs text-muted-foreground">
                              {t('integrations.runSetupToken')}
                            </span>
                          </div>

                          <div className="space-y-2">
                            <div className="relative">
                              <Input
                                type={showManualToken ? 'text' : 'password'}
                                placeholder={t('integrations.tokenPlaceholder')}
                                value={manualToken}
                                onChange={(e) => setManualToken(e.target.value)}
                                className="pr-10 font-mono text-xs h-8"
                              />
                              <button
                                type="button"
                                onClick={() => setShowManualToken(!showManualToken)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                {showManualToken ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                              </button>
                            </div>

                            <Input
                              type="email"
                              placeholder={t('integrations.emailPlaceholder')}
                              value={manualTokenEmail}
                              onChange={(e) => setManualTokenEmail(e.target.value)}
                              className="text-xs h-8"
                            />
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleTokenEntry(profile.id)}
                              className="h-7 text-xs"
                            >
                              {tCommon('buttons.cancel')}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleSaveManualToken(profile.id)}
                              disabled={!manualToken.trim() || savingTokenProfileId === profile.id}
                              className="h-7 text-xs gap-1"
                            >
                              {savingTokenProfileId === profile.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                              {t('integrations.saveToken')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add new account */}
            <div className="flex items-center gap-2">
              <Input
                placeholder={t('integrations.accountNamePlaceholder')}
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                className="flex-1 h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newProfileName.trim()) {
                    handleAddProfile();
                  }
                }}
              />
              <Button
                onClick={handleAddProfile}
                disabled={!newProfileName.trim() || isAddingProfile}
                size="sm"
                className="gap-1 shrink-0"
              >
                {isAddingProfile ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                {tCommon('buttons.add')}
              </Button>
            </div>
          </div>
        </div>

        {/* Auto-Switch Settings Section */}
        {claudeProfiles.length > 1 && (
          <div className="space-y-4 pt-6 border-t border-border">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold text-foreground">{t('integrations.autoSwitching')}</h4>
            </div>

            <div className="rounded-lg bg-muted/30 border border-border p-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('integrations.autoSwitchingDescription')}
              </p>

              {/* Master toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">{t('integrations.enableAutoSwitching')}</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('integrations.masterSwitch')}
                  </p>
                </div>
                <Switch
                  checked={autoSwitchSettings?.enabled ?? false}
                  onCheckedChange={(enabled) => handleUpdateAutoSwitch({ enabled })}
                  disabled={isLoadingAutoSwitch}
                />
              </div>

              {autoSwitchSettings?.enabled && (
                <>
                  {/* Proactive Monitoring Section */}
                  <div className="pl-6 space-y-4 pt-2 border-l-2 border-primary/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium flex items-center gap-2">
                          <Activity className="h-3.5 w-3.5" />
                          {t('integrations.proactiveMonitoring')}
                        </Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t('integrations.proactiveDescription')}
                        </p>
                      </div>
                      <Switch
                        checked={autoSwitchSettings?.proactiveSwapEnabled ?? true}
                        onCheckedChange={(value) => handleUpdateAutoSwitch({ proactiveSwapEnabled: value })}
                        disabled={isLoadingAutoSwitch}
                      />
                    </div>

                    {autoSwitchSettings?.proactiveSwapEnabled && (
                      <>
                        {/* Check interval */}
                        <div className="space-y-2">
                          <Label className="text-sm">{t('integrations.checkUsageEvery')}</Label>
                          <select
                            className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
                            value={autoSwitchSettings?.usageCheckInterval ?? 30000}
                            onChange={(e) => handleUpdateAutoSwitch({ usageCheckInterval: parseInt(e.target.value) })}
                            disabled={isLoadingAutoSwitch}
                          >
                            <option value={15000}>{t('integrations.seconds15')}</option>
                            <option value={30000}>{t('integrations.seconds30')}</option>
                            <option value={60000}>{t('integrations.minute1')}</option>
                            <option value={0}>{t('integrations.disabled')}</option>
                          </select>
                        </div>

                        {/* Session threshold */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm">{t('integrations.sessionThreshold')}</Label>
                            <span className="text-sm font-mono">{autoSwitchSettings?.sessionThreshold ?? 95}%</span>
                          </div>
                          <input
                            type="range"
                            min="70"
                            max="99"
                            step="1"
                            value={autoSwitchSettings?.sessionThreshold ?? 95}
                            onChange={(e) => handleUpdateAutoSwitch({ sessionThreshold: parseInt(e.target.value) })}
                            disabled={isLoadingAutoSwitch}
                            className="w-full"
                          />
                          <p className="text-xs text-muted-foreground">
                            {t('integrations.sessionThresholdDescription')}
                          </p>
                        </div>

                        {/* Weekly threshold */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm">{t('integrations.weeklyThreshold')}</Label>
                            <span className="text-sm font-mono">{autoSwitchSettings?.weeklyThreshold ?? 99}%</span>
                          </div>
                          <input
                            type="range"
                            min="70"
                            max="99"
                            step="1"
                            value={autoSwitchSettings?.weeklyThreshold ?? 99}
                            onChange={(e) => handleUpdateAutoSwitch({ weeklyThreshold: parseInt(e.target.value) })}
                            disabled={isLoadingAutoSwitch}
                            className="w-full"
                          />
                          <p className="text-xs text-muted-foreground">
                            {t('integrations.weeklyThresholdDescription')}
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Reactive Recovery Section */}
                  <div className="pl-6 space-y-4 pt-2 border-l-2 border-orange-500/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium flex items-center gap-2">
                          <AlertCircle className="h-3.5 w-3.5" />
                          {t('integrations.reactiveRecovery')}
                        </Label>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t('integrations.reactiveDescription')}
                        </p>
                      </div>
                      <Switch
                        checked={autoSwitchSettings?.autoSwitchOnRateLimit ?? false}
                        onCheckedChange={(value) => handleUpdateAutoSwitch({ autoSwitchOnRateLimit: value })}
                        disabled={isLoadingAutoSwitch}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* API Keys Section */}
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold text-foreground">{t('integrations.apiKeys')}</h4>
          </div>

          <div className="rounded-lg bg-info/10 border border-info/30 p-3">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                {t('integrations.apiKeysInfo')}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="globalOpenAIKey" className="text-sm font-medium text-foreground">
                {t('integrations.openaiKey')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t('integrations.openaiKeyDescription')}
              </p>
              <div className="relative max-w-lg">
                <Input
                  id="globalOpenAIKey"
                  type={showGlobalOpenAIKey ? 'text' : 'password'}
                  placeholder="sk-..."
                  value={settings.globalOpenAIApiKey || ''}
                  onChange={(e) =>
                    onSettingsChange({ ...settings, globalOpenAIApiKey: e.target.value || undefined })
                  }
                  className="pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowGlobalOpenAIKey(!showGlobalOpenAIKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showGlobalOpenAIKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Auto-Claude Engine Section */}
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold text-foreground">Auto-Claude Engine</h4>
          </div>

          <div className="rounded-lg bg-muted/30 border border-border p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Select which engine runs build tasks (spec → plan → implement → QA).
            </p>

            {isLoadingSourceEnv ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading engine settings…
              </div>
            ) : (
              <>
                {!sourceEnv?.sourcePath ? (
                  <div className="rounded-lg bg-warning/10 border border-warning/30 p-3 text-sm text-muted-foreground">
                    Auto-Claude source path not found. Configure it in Settings → Paths.
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <Label className="text-sm font-medium">Build engine</Label>
                        <p className="text-xs text-muted-foreground">
                          Stored in <code className="px-1 py-0.5 bg-muted rounded font-mono text-xs">auto-claude/.env</code>
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          value={sourceEnv?.autoClaudeEngine || 'claude'}
                          onChange={(e) => handleAutoClaudeEngineChange(e.target.value as AutoClaudeEngineName)}
                          disabled={!sourceEnv?.sourcePath || isUpdatingSourceEnv}
                          className={cn(
                            'h-9 rounded-md border border-border bg-background px-3 text-sm',
                            isUpdatingSourceEnv && 'opacity-60 cursor-not-allowed'
                          )}
                        >
                          <option value="claude">Claude (default)</option>
                          <option value="codex">Codex (ChatGPT)</option>
                        </select>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={loadSourceEnv}
                          disabled={isLoadingSourceEnv || isUpdatingSourceEnv}
                          className="gap-1"
                        >
                          <RefreshCw className={cn('h-3.5 w-3.5', (isLoadingSourceEnv || isUpdatingSourceEnv) && 'animate-spin')} />
                          Refresh
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <Label className="text-sm font-medium">Default model</Label>
                        <p className="text-xs text-muted-foreground">
                          Sets <code className="px-1 py-0.5 bg-muted rounded font-mono text-xs">AUTO_BUILD_MODEL</code> (engine-specific).
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Input
                          value={autoBuildModel}
                          onChange={(e) => setAutoBuildModel(e.target.value)}
                          placeholder={(sourceEnv?.autoClaudeEngine || 'claude') === 'codex' ? 'o3' : 'claude-opus-4-5-20251101'}
                          disabled={!sourceEnv?.sourcePath || isUpdatingSourceEnv}
                          className="h-9 w-64 font-mono text-xs"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleAutoBuildModelSave}
                          disabled={!sourceEnv?.sourcePath || isUpdatingSourceEnv}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                {sourceEnvError && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-muted-foreground">
                    {sourceEnvError}
                  </div>
                )}

                <div className="pt-3 border-t border-border/50 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">Codex login</Label>
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        {isCheckingCodexStatus ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Checking…
                          </>
                        ) : codexStatus?.authenticated ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-success" />
                            Logged in using ChatGPT
                          </>
                        ) : codexStatus?.loginMethod === 'api_key' ? (
                          <>
                            <AlertCircle className="h-3.5 w-3.5 text-warning" />
                            Logged in via API key mode (unsupported)
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-3.5 w-3.5 text-warning" />
                            Not logged in
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={loadCodexLoginStatus}
                        disabled={isCheckingCodexStatus}
                        className="gap-1"
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5', isCheckingCodexStatus && 'animate-spin')} />
                        Check
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleCodexLogin}
                        disabled={isStartingCodexLogin}
                        className="gap-1"
                      >
                        {isStartingCodexLogin ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <LogIn className="h-3.5 w-3.5" />
                        )}
                        Login
                      </Button>
                    </div>
                  </div>

                  {codexStatus?.error && !codexStatus.authenticated && (
                    <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-muted-foreground">
                      {codexStatus.error}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">Codex execpolicy</Label>
                      <p className="text-xs text-muted-foreground">
                        Generate <code className="px-1 py-0.5 bg-muted rounded font-mono text-xs">~/.codex/rules/auto-claude.rules</code> from this project&apos;s security profile.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {isCheckingCodexExecpolicy ? (
                          <span className="inline-flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Checking status…
                          </span>
                        ) : (
                          <>
                            {codexExecpolicyStatus?.installed ? (
                              <>
                                Status: <span className="text-success">installed</span>
                                {codexExecpolicyStatus.valid === true ? (
                                  <> · <span className="text-success">valid</span></>
                                ) : codexExecpolicyStatus.valid === false ? (
                                  <> · <span className="text-warning">invalid</span></>
                                ) : null}
                                {typeof codexExecpolicyStatus.ruleCount === 'number' ? ` · ${codexExecpolicyStatus.ruleCount} rules` : ''}
                                {codexExecpolicyStatus.generatedAt ? ` · ${codexExecpolicyStatus.generatedAt}` : ''}
                                {codexExecpolicyStatus.projectPath ? (
                                  <>
                                    <br />
                                    Last generated for: <code className="px-1 py-0.5 bg-muted rounded font-mono text-xs">{codexExecpolicyStatus.projectPath}</code>
                                  </>
                                ) : null}
                              </>
                            ) : codexExecpolicyStatus ? (
                              <>Status: <span className="text-warning">not installed</span></>
                            ) : (
                              <>Status: <span className="text-warning">unknown</span></>
                            )}
                            {codexExecpolicyStatus?.rulesPath ? (
                              <>
                                <br />
                                Rules file: <code className="px-1 py-0.5 bg-muted rounded font-mono text-xs">{codexExecpolicyStatus.rulesPath}</code>
                              </>
                            ) : null}
                            {codexExecpolicyStatus?.installed && codexExecpolicyStatus.valid === false && codexExecpolicyStatus.validationError ? (
                              <>
                                <br />
                                <span className="text-warning">Validation:</span> {codexExecpolicyStatus.validationError}
                              </>
                            ) : null}
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={loadCodexExecpolicyStatus}
                        disabled={isCheckingCodexExecpolicy}
                        className="gap-1"
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5', isCheckingCodexExecpolicy && 'animate-spin')} />
                        Check
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyCodexExecpolicyPath}
                        disabled={!codexExecpolicyStatus?.rulesPath}
                        className="gap-1"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRevealCodexExecpolicyRules}
                        disabled={!codexExecpolicyStatus?.installed || !codexExecpolicyStatus?.rulesPath}
                        className="gap-1"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        Reveal
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleInstallCodexExecpolicy}
                        disabled={isInstallingCodexExecpolicy || !selectedProjectPath}
                        className="gap-1"
                        title={!selectedProjectPath ? 'Select a project to enable this action' : undefined}
                      >
                        {isInstallingCodexExecpolicy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Shield className="h-3.5 w-3.5" />
                        )}
                        Install
                      </Button>
                    </div>
                  </div>

                  {codexExecpolicyError && (
                    <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-muted-foreground">
                      {codexExecpolicyError}
                    </div>
                  )}

                  {((sourceEnv?.autoClaudeEngine || 'claude') === 'codex') && codexExecpolicyStatus && !codexExecpolicyStatus.installed && (
                    <div className="rounded-lg bg-warning/10 border border-warning/30 p-3 text-sm text-muted-foreground">
                      Codex engine is selected, but execpolicy rules are not installed. Install them to reduce friction when running common commands.
                    </div>
                  )}

                  <div className="rounded-lg bg-muted/20 border border-border/50 p-3 space-y-3">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">Codex execution</Label>
                      <p className="text-xs text-muted-foreground">
                        Stored in <code className="px-1 py-0.5 bg-muted rounded font-mono text-xs">auto-claude/.env</code> and used for non-interactive <code className="px-1 py-0.5 bg-muted rounded font-mono text-xs">codex exec</code> runs.
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <Label className="text-sm font-medium">Approvals</Label>
                        <p className="text-xs text-muted-foreground">Auto is TTY-aware (UI tasks are non-interactive → <code className="px-1 py-0.5 bg-muted rounded font-mono text-xs">never</code>).</p>
                      </div>
                      <select
                        value={codexApprovalPolicy}
                        onChange={(e) => handleCodexApprovalPolicyChange(e.target.value)}
                        disabled={!sourceEnv?.sourcePath || isUpdatingSourceEnv}
                        className={cn(
                          'h-9 rounded-md border border-border bg-background px-3 text-sm',
                          isUpdatingSourceEnv && 'opacity-60 cursor-not-allowed'
                        )}
                      >
                        <option value="">Auto (default)</option>
                        {(['untrusted', 'on-failure', 'on-request', 'never'] as CodexApprovalPolicy[]).map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <Label className="text-sm font-medium">Sandbox</Label>
                        <p className="text-xs text-muted-foreground">Workspace-write is the default.</p>
                      </div>
                      <select
                        value={codexSandboxMode}
                        onChange={(e) => handleCodexSandboxModeChange(e.target.value)}
                        disabled={!sourceEnv?.sourcePath || isUpdatingSourceEnv}
                        className={cn(
                          'h-9 rounded-md border border-border bg-background px-3 text-sm',
                          isUpdatingSourceEnv && 'opacity-60 cursor-not-allowed'
                        )}
                      >
                        <option value="">workspace-write (default)</option>
                        {(['read-only', 'workspace-write', 'danger-full-access'] as CodexSandboxMode[]).map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {((sourceEnv?.autoClaudeEngine || 'claude') === 'codex') && autoBuildModel.toLowerCase().startsWith('claude') && (
                    <div className="rounded-lg bg-warning/10 border border-warning/30 p-3 text-sm text-muted-foreground">
                      <code className="px-1 py-0.5 bg-muted rounded font-mono text-xs">AUTO_BUILD_MODEL</code> is set to a Claude model ID. Codex ignores Claude model IDs — set an OpenAI model ID (e.g. <code className="px-1 py-0.5 bg-muted rounded font-mono text-xs">o3</code>) or clear it.
                    </div>
                  )}

                  {((sourceEnv?.autoClaudeEngine || 'claude') === 'codex') && codexStatus && !codexStatus.authenticated && (
                    <div className="rounded-lg bg-warning/10 border border-warning/30 p-3 text-sm text-muted-foreground">
                      Codex engine is selected, but you are not logged in using ChatGPT. Click “Login” and complete the browser flow.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
