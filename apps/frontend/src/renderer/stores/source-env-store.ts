import { create } from 'zustand';
import type { SourceEnvConfig } from '../../shared/types';

interface SourceEnvState {
  sourceEnv: SourceEnvConfig | null;
  isLoading: boolean;
  error: string | null;

  setSourceEnv: (sourceEnv: SourceEnvConfig | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useSourceEnvStore = create<SourceEnvState>((set) => ({
  sourceEnv: null,
  isLoading: false,
  error: null,

  setSourceEnv: (sourceEnv) => set({ sourceEnv }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error })
}));

export async function loadSourceEnv(): Promise<void> {
  const store = useSourceEnvStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.getSourceEnv();
    if (result.success && result.data) {
      store.setSourceEnv(result.data);
      return;
    }

    store.setSourceEnv(null);
    store.setError(result.error || 'Failed to load Auto-Claude source environment');
  } catch (error) {
    store.setSourceEnv(null);
    store.setError(
      error instanceof Error ? error.message : 'Failed to load Auto-Claude source environment'
    );
  } finally {
    store.setLoading(false);
  }
}

