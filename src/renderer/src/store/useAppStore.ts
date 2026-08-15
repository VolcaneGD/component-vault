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
  selectedComponentIds: string[];
  searchQuery: string;
  selectedTags: string[];
  isHydrated: boolean;
  mutationVersion: number;
  hydrate: () => Promise<void>;
  setViewMode: (viewMode: ViewMode) => void;
  setSelectedLibraryId: (libraryId: string | null) => void;
  setSelectedComponentId: (componentId: string | null) => void;
  setSearchQuery: (query: string) => void;
  toggleTag: (tag: string) => void;
  clearFilters: () => void;
  toggleComponentSelection: (componentId: string) => void;
  clearComponentSelection: () => void;
  loadComponents: (libraryId: string) => Promise<void>;
  reorderComponents: (libraryId: string, componentIds: string[]) => Promise<void>;
  updateComponentDraft: (component: ComponentRecord) => void;
  saveComponent: (component: ComponentSaveInput) => Promise<ComponentRecord>;
  duplicateComponent: (component: ComponentRecord) => Promise<ComponentRecord>;
  deleteComponent: (componentId: string) => Promise<void>;
  updateLayout: (patch: Partial<AppSettings>) => void;
}

const persist = (patch: Partial<AppSettings>) => {
  void window.componentVault?.saveAppSettings?.(patch).catch(() => undefined);
};

const componentOperationTails = new Map<string, Promise<unknown>>();
const componentMutationGenerations = new Map<string, number>();
const deletingComponentIds = new Set<string>();
const reorderOperationTails = new Map<string, Promise<void>>();
const reorderLatestGenerations = new Map<string, number>();
const reorderConfirmedOrders = new Map<string, string[]>();

const mutationGeneration = (componentId: string): number =>
  componentMutationGenerations.get(componentId) ?? 0;

const reorderLiveComponents = (
  components: ComponentRecord[],
  requestedOrder: string[],
): ComponentRecord[] => {
  const liveById = new Map(components.map((component) => [component.id, component]));
  const requestedIds = new Set(requestedOrder);
  return [
    ...requestedOrder.map((id) => liveById.get(id)).filter(Boolean) as ComponentRecord[],
    ...components.filter((component) => !requestedIds.has(component.id)),
  ];
};

const reconcileOrderMembership = (requestedOrder: string[], components: ComponentRecord[]): string[] => {
  const liveIds = new Set(components.map((component) => component.id));
  const requestedIds = new Set(requestedOrder);
  return [
    ...requestedOrder.filter((id) => liveIds.has(id)),
    ...components.map((component) => component.id).filter((id) => !requestedIds.has(id)),
  ];
};

const enqueueComponentOperation = <T>(componentId: string, operation: () => Promise<T>): Promise<T> => {
  const previous = componentOperationTails.get(componentId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  componentOperationTails.set(componentId, current);
  void current.finally(() => {
    if (componentOperationTails.get(componentId) === current) componentOperationTails.delete(componentId);
  }).catch(() => undefined);
  return current;
};

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

const mergeSavedEnvelopeWithLiveDraft = (
  saved: ComponentRecord,
  live: ComponentRecord,
): ComponentRecord => ({
  ...live,
  id: saved.id,
  createdAt: saved.createdAt,
  updatedAt: saved.updatedAt,
  deletedAt: saved.deletedAt,
});

export const useAppStore = create<AppStore>((set, get) => ({
  settings: defaultAppSettings(),
  libraries: [],
  components: [],
  componentsLibraryId: null,
  selectedLibraryId: null,
  selectedComponentId: null,
  selectedComponentIds: [],
  searchQuery: '',
  selectedTags: [],
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
      selectedComponentIds: [],
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
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  toggleTag: (tag) => set((state) => ({
    selectedTags: state.selectedTags.includes(tag)
      ? state.selectedTags.filter((item) => item !== tag)
      : [...state.selectedTags, tag],
  })),
  clearFilters: () => set({ searchQuery: '', selectedTags: [] }),
  toggleComponentSelection: (componentId) => set((state) => ({
    selectedComponentIds: state.selectedComponentIds.includes(componentId)
      ? state.selectedComponentIds.filter((id) => id !== componentId)
      : [...state.selectedComponentIds, componentId],
  })),
  clearComponentSelection: () => set({ selectedComponentIds: [] }),
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
      return {
        components,
        componentsLibraryId: libraryId,
        selectedComponentId,
        selectedComponentIds: state.selectedComponentIds.filter((id) =>
          components.some((component) => component.id === id)),
      };
    });
  },
  reorderComponents: async (libraryId, componentIds) => {
    const current = get().components;
    if (new Set(componentIds).size !== componentIds.length
      || componentIds.length !== current.length
      || componentIds.some((id) => !current.some((component) => component.id === id))) {
      throw new Error('Component order is incomplete');
    }

    const previousTail = reorderOperationTails.get(libraryId);
    if (!previousTail) reorderConfirmedOrders.set(libraryId, current.map((component) => component.id));
    const generation = (reorderLatestGenerations.get(libraryId) ?? 0) + 1;
    reorderLatestGenerations.set(libraryId, generation);
    set((state) => ({ components: reorderLiveComponents(state.components, componentIds) }));

    const persistOrder = async () => {
      const live = get();
      const requestOrder = live.componentsLibraryId === libraryId
        ? reconcileOrderMembership(componentIds, live.components)
        : componentIds;
      await window.componentVault.reorderComponents(libraryId, requestOrder);
      reorderConfirmedOrders.set(libraryId, requestOrder);
    };
    const operation = previousTail
      ? previousTail.catch(() => undefined).then(persistOrder)
      : persistOrder();
    reorderOperationTails.set(libraryId, operation);
    try {
      await operation;
    } catch (error) {
      if (generation === reorderLatestGenerations.get(libraryId)) {
        const confirmedOrder = reorderConfirmedOrders.get(libraryId) ?? [];
        set((state) => ({
          components: reorderLiveComponents(state.components, confirmedOrder),
        }));
      }
      throw error;
    } finally {
      if (reorderOperationTails.get(libraryId) === operation) {
        reorderOperationTails.delete(libraryId);
      }
    }
  },
  updateComponentDraft: (component) => {
    set((state) => ({
      components: state.components.map((item) => item.id === component.id ? component : item),
    }));
  },
  saveComponent: async (component) => {
    if (!component.id) {
      const saved = await window.componentVault.saveComponent(component);
      set((state) => ({
        components: [...state.components, saved],
        selectedComponentId: saved.id,
      }));
      persist({ lastComponentId: saved.id });
      return saved;
    }

    const componentId = component.id;
    const requestedGeneration = mutationGeneration(componentId);
    if (deletingComponentIds.has(componentId)) {
      throw new Error('Component save cancelled because deletion is pending');
    }
    return enqueueComponentOperation(componentId, async () => {
      if (deletingComponentIds.has(componentId)
        || mutationGeneration(componentId) !== requestedGeneration) {
        throw new Error('Component save cancelled because deletion is pending');
      }
      const liveBeforeSave = get().components.find((item) => item.id === componentId);
      if (!liveBeforeSave) throw new Error('Component save cancelled because the component is closed');
      const saved = await window.componentVault.saveComponent(toSaveInput(liveBeforeSave));
      if (deletingComponentIds.has(componentId)
        || mutationGeneration(componentId) !== requestedGeneration) return saved;

      let result = saved;
      set((state) => {
        const liveAfterSave = state.components.find((item) => item.id === componentId);
        if (!liveAfterSave) return state;
        result = mergeSavedEnvelopeWithLiveDraft(saved, liveAfterSave);
        return {
          components: state.components.map((item) => item.id === componentId ? result : item),
        };
      });
      return result;
    });
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
    deletingComponentIds.add(componentId);
    componentMutationGenerations.set(componentId, mutationGeneration(componentId) + 1);
    try {
      await enqueueComponentOperation(componentId, async () => {
        const deleted = await window.componentVault.deleteComponent(componentId);
        if (!deleted) throw new Error('Component could not be deleted');
        set((state) => {
          const components = state.components.filter((component) => component.id !== componentId);
          const selectedComponentId = state.selectedComponentId === componentId
            ? components[0]?.id ?? null
            : state.selectedComponentId;
          if (selectedComponentId !== state.selectedComponentId) {
            persist({ lastComponentId: selectedComponentId });
          }
          return {
            components,
            selectedComponentId,
            selectedComponentIds: state.selectedComponentIds.filter((id) => id !== componentId),
          };
        });
      });
    } finally {
      deletingComponentIds.delete(componentId);
    }
  },
  updateLayout: (patch) => {
    const normalizedPatch: Partial<AppSettings> = { ...patch };
    if (patch.editorPreviewRatio !== undefined) {
      normalizedPatch.editorPreviewRatio = Math.min(0.8, Math.max(0.25, patch.editorPreviewRatio));
    }
    if (patch.galleryColumns !== undefined) {
      normalizedPatch.galleryColumns = Math.min(4, Math.max(1, Math.round(patch.galleryColumns))) as 1 | 2 | 3 | 4;
    }
    set((state) => ({
      settings: { ...state.settings, ...normalizedPatch },
      mutationVersion: state.mutationVersion + 1,
    }));
    persist(normalizedPatch);
  },
}));
