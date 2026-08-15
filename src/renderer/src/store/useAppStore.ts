import { create } from 'zustand';
import {
  defaultAppSettings,
  type AppSettings,
  type ComponentRecord,
  type ComponentSaveInput,
  type LibraryRecord,
  type ViewMode,
} from '../../../shared/contracts';

interface AppStore {
  settings: AppSettings;
  libraries: LibraryRecord[];
  components: ComponentRecord[];
  componentsLibraryId: string | null;
  selectedLibraryId: string | null;
  selectedComponentId: string | null;
  isHydrated: boolean;
  mutationVersion: number;
  hydrate: () => Promise<void>;
  setViewMode: (viewMode: ViewMode) => void;
  setSelectedLibraryId: (libraryId: string | null) => void;
  setSelectedComponentId: (componentId: string | null) => void;
  loadComponents: (libraryId: string) => Promise<void>;
  updateComponentDraft: (component: ComponentRecord) => void;
  saveComponent: (component: ComponentSaveInput) => Promise<ComponentRecord>;
  duplicateComponent: (component: ComponentRecord) => Promise<ComponentRecord>;
  deleteComponent: (componentId: string) => Promise<void>;
  updateLayout: (patch: Partial<AppSettings>) => void;
}

const persist = (patch: Partial<AppSettings>) => {
  void window.componentVault?.saveAppSettings?.(patch).catch(() => undefined);
};

let componentSaveQueue: Promise<unknown> = Promise.resolve();

const toSaveInput = (component: ComponentRecord): ComponentSaveInput => ({
  id: component.id,
  libraryId: component.libraryId,
  name: component.name,
  description: component.description,
  category: component.category,
  html: component.html,
  css: component.css,
  javascript: component.javascript,
  sourceType: component.sourceType,
  originalFileName: component.originalFileName,
  tags: component.tags,
  previewPolicy: component.previewPolicy,
});

export const useAppStore = create<AppStore>((set, get) => ({
  settings: defaultAppSettings(),
  libraries: [],
  components: [],
  componentsLibraryId: null,
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
      components: [],
      componentsLibraryId: null,
      mutationVersion: state.mutationVersion + 1,
    }));
    persist({ lastLibraryId: selectedLibraryId, lastComponentId: null });
  },
  setSelectedComponentId: (selectedComponentId) => {
    set((state) => ({ selectedComponentId, mutationVersion: state.mutationVersion + 1 }));
    persist({ lastComponentId: selectedComponentId });
  },
  loadComponents: async (libraryId) => {
    const components = await window.componentVault.listComponents(libraryId);
    set((state) => {
      const selectedIsAvailable = components.some((component) => component.id === state.selectedComponentId);
      const selectedComponentId = selectedIsAvailable
        ? state.selectedComponentId
        : components[0]?.id ?? null;
      if (selectedComponentId !== state.selectedComponentId) {
        persist({ lastComponentId: selectedComponentId });
      }
      return { components, componentsLibraryId: libraryId, selectedComponentId };
    });
  },
  updateComponentDraft: (component) => {
    set((state) => ({
      components: state.components.map((item) => item.id === component.id ? component : item),
    }));
  },
  saveComponent: async (component) => {
    const operation = componentSaveQueue.catch(() => undefined).then(async () => {
      const liveComponent = component.id
        ? get().components.find((item) => item.id === component.id)
        : undefined;
      const saved = await window.componentVault.saveComponent(
        liveComponent ? toSaveInput(liveComponent) : component,
      );
      set((state) => ({
        components: state.components.some((item) => item.id === saved.id)
          ? state.components.map((item) => item.id === saved.id ? saved : item)
          : [...state.components, saved],
        selectedComponentId: saved.id,
      }));
      persist({ lastComponentId: saved.id });
      return saved;
    });
    componentSaveQueue = operation;
    return operation;
  },
  duplicateComponent: async (component) => {
    const input: ComponentSaveInput = {
      libraryId: component.libraryId,
      name: `${component.name} copy`,
      description: component.description,
      category: component.category,
      html: component.html,
      css: component.css,
      javascript: component.javascript,
      sourceType: 'duplicate',
      originalFileName: component.originalFileName,
      tags: component.tags,
      previewPolicy: component.previewPolicy,
    };
    return get().saveComponent(input);
  },
  deleteComponent: async (componentId) => {
    const deleted = await window.componentVault.deleteComponent(componentId);
    if (!deleted) throw new Error('Component could not be deleted');
    set((state) => {
      const components = state.components.filter((component) => component.id !== componentId);
      const selectedComponentId = state.selectedComponentId === componentId
        ? components[0]?.id ?? null
        : state.selectedComponentId;
      persist({ lastComponentId: selectedComponentId });
      return { components, selectedComponentId };
    });
  },
  updateLayout: (patch) => {
    const normalizedPatch = patch.editorPreviewRatio === undefined
      ? patch
      : { ...patch, editorPreviewRatio: Math.min(0.8, Math.max(0.25, patch.editorPreviewRatio)) };
    set((state) => ({
      settings: { ...state.settings, ...normalizedPatch },
      mutationVersion: state.mutationVersion + 1,
    }));
    persist(normalizedPatch);
  },
}));
