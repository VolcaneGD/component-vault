import { create } from 'zustand';
import {
  defaultAppSettings,
  type AppSettings,
  type LibraryRecord,
  type ViewMode,
} from '../../../shared/contracts';

interface AppStore {
  settings: AppSettings;
  libraries: LibraryRecord[];
  selectedLibraryId: string | null;
  selectedComponentId: string | null;
  isHydrated: boolean;
  mutationVersion: number;
  hydrate: () => Promise<void>;
  setViewMode: (viewMode: ViewMode) => void;
  setSelectedLibraryId: (libraryId: string | null) => void;
  setSelectedComponentId: (componentId: string | null) => void;
  updateLayout: (patch: Partial<AppSettings>) => void;
}

const persist = (patch: Partial<AppSettings>) => {
  void window.componentVault?.saveAppSettings?.(patch).catch(() => undefined);
};

export const useAppStore = create<AppStore>((set, get) => ({
  settings: defaultAppSettings(),
  libraries: [],
  selectedLibraryId: null,
  selectedComponentId: null,
  isHydrated: false,
  mutationVersion: 0,
  hydrate: async () => {
    const api = window.componentVault;
    if (!api) {
      set({ isHydrated: true });
      return;
    }

    const hydrationVersion = get().mutationVersion;
    const settingsPromise = api.getAppSettings?.().catch(() => defaultAppSettings())
      ?? Promise.resolve(defaultAppSettings());
    const librariesPromise = api.listLibraries?.().catch(() => [])
      ?? Promise.resolve([]);
    const [settings, libraries] = await Promise.all([settingsPromise, librariesPromise]);
    set((state) => state.mutationVersion === hydrationVersion
      ? {
        settings,
        libraries,
        selectedLibraryId: settings.lastLibraryId,
        selectedComponentId: settings.lastComponentId,
        isHydrated: true,
      }
      : { libraries, isHydrated: true });
  },
  setViewMode: (viewMode) => {
    set((state) => ({
      settings: { ...state.settings, viewMode },
      mutationVersion: state.mutationVersion + 1,
    }));
    persist({ viewMode });
  },
  setSelectedLibraryId: (selectedLibraryId) => {
    set((state) => ({
      selectedLibraryId,
      selectedComponentId: null,
      mutationVersion: state.mutationVersion + 1,
    }));
    persist({ lastLibraryId: selectedLibraryId, lastComponentId: null });
  },
  setSelectedComponentId: (selectedComponentId) => {
    set((state) => ({ selectedComponentId, mutationVersion: state.mutationVersion + 1 }));
    persist({ lastComponentId: selectedComponentId });
  },
  updateLayout: (patch) => {
    set((state) => ({
      settings: { ...state.settings, ...patch },
      mutationVersion: state.mutationVersion + 1,
    }));
    persist(patch);
  },
}));
