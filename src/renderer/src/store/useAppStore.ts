import { create } from 'zustand';
import {
  defaultAppSettings,
  type AppSettings,
  type ComponentRecord,
  type ComponentSaveInput,
  type LibraryRecord,
  type SoftDeleteToken,
  type ViewMode,
} from '../../../shared/contracts';

export interface PendingDeletion {
  token: SoftDeleteToken;
  component: ComponentRecord;
  previousIndex: number;
}

interface AppStore {
  settings: AppSettings;
  libraries: LibraryRecord[];
  components: ComponentRecord[];
  componentsLibraryId: string | null;
  selectedLibraryId: string | null;
  selectedComponentId: string | null;
  selectedComponentIds: string[];
  draftOrigins: Record<string, string>;
  searchQuery: string;
  selectedTags: string[];
  isHydrated: boolean;
  mutationVersion: number;
  pendingDeletions: PendingDeletion[];
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
  beginCodeComponent: (libraryId: string) => ComponentRecord;
  consumeDraftOrigin: (componentId: string, draftOriginId: string) => void;
  acceptSavedComponents: (components: ComponentRecord[]) => Promise<void>;
  acceptLibrary: (library: LibraryRecord) => void;
  saveComponent: (component: ComponentSaveInput) => Promise<ComponentRecord>;
  duplicateComponent: (component: ComponentRecord) => Promise<ComponentRecord>;
  deleteComponent: (componentId: string) => Promise<void>;
  undoDelete: (token: SoftDeleteToken) => Promise<void>;
  expireDeletion: (token: SoftDeleteToken) => Promise<void>;
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
const draftOperationTails = new Map<string, Promise<ComponentRecord>>();
const cancelledDraftIds = new Set<string>();
let hydrationInFlight: Promise<void> | null = null;

const isSoftDeleteToken = (value: unknown): value is SoftDeleteToken => {
  if (!value || typeof value !== 'object') return false;
  const token = value as Partial<SoftDeleteToken>;
  return typeof token.componentId === 'string'
    && typeof token.deletedAt === 'string'
    && typeof token.expiresAt === 'string';
};

const sameDeleteToken = (left: SoftDeleteToken, right: SoftDeleteToken): boolean =>
  left.componentId === right.componentId && left.deletedAt === right.deletedAt;

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

const canPersistCodeDraft = (component: ComponentSaveInput): boolean =>
  Boolean(component.name.trim())
  && Boolean(component.html.trim() || component.css.trim() || component.javascript.trim());

const removeDraftOrigins = (
  origins: Record<string, string>,
  predicate: (componentId: string, draftOriginId: string) => boolean,
): Record<string, string> => Object.fromEntries(
  Object.entries(origins).filter(([componentId, draftOriginId]) => !predicate(componentId, draftOriginId)),
);

const retainSelectedDraftOrigin = (
  origins: Record<string, string>,
  selectedComponentId: string | null,
): Record<string, string> => selectedComponentId && origins[selectedComponentId]
  ? { [selectedComponentId]: origins[selectedComponentId] }
  : {};

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
  draftOrigins: {},
  searchQuery: '',
  selectedTags: [],
  isHydrated: false,
  mutationVersion: 0,
  pendingDeletions: [],
  hydrate: () => {
    if (hydrationInFlight) return hydrationInFlight;
    const hydration = (async () => {
      const api = window.componentVault;
      if (!api) {
        set((state) => ({
          isHydrated: true,
          draftOrigins: retainSelectedDraftOrigin(state.draftOrigins, state.selectedComponentId),
        }));
        return;
      }

      const hydrationVersion = get().mutationVersion;
      const settingsPromise = api.getAppSettings?.().catch(() => defaultAppSettings())
        ?? Promise.resolve(defaultAppSettings());
      const librariesPromise = api.listLibraries?.().catch(() => [])
        ?? Promise.resolve([]);
      const recoveryPromise = api.getRecoverySnapshot?.().catch(() => null)
        ?? Promise.resolve(null);
      const [settings, libraries, recovery] = await Promise.all([
        settingsPromise, librariesPromise, recoveryPromise,
      ]);
      const recoveredLibraryId = recovery
        && libraries.some((library) => library.id === recovery.libraryId)
        ? recovery.libraryId
        : null;
      let recoveryApplied = false;
      set((state) => {
        if (state.mutationVersion === hydrationVersion) {
          recoveryApplied = Boolean(recovery && recoveredLibraryId);
          return {
            settings,
            libraries,
            selectedLibraryId: recoveredLibraryId ?? settings.lastLibraryId,
            selectedComponentId: recoveredLibraryId ? recovery!.componentId : settings.lastComponentId,
            draftOrigins: {},
            isHydrated: true,
          };
        }
        return {
          libraries,
          draftOrigins: retainSelectedDraftOrigin(state.draftOrigins, state.selectedComponentId),
          isHydrated: true,
        };
      });
      if (recoveryApplied && recovery) {
        await api.ackRecoverySnapshot?.(recovery).catch(() => false);
      }
    })();
    hydrationInFlight = hydration;
    void hydration.finally(() => {
      if (hydrationInFlight === hydration) hydrationInFlight = null;
    }).catch(() => undefined);
    return hydration;
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
      draftOrigins: {},
      mutationVersion: state.mutationVersion + 1,
    }));
    persist({ lastLibraryId: selectedLibraryId, lastComponentId: null });
  },
  setSelectedComponentId: (selectedComponentId) => {
    set((state) => ({
      selectedComponentId,
      draftOrigins: retainSelectedDraftOrigin(state.draftOrigins, selectedComponentId),
      mutationVersion: state.mutationVersion + 1,
    }));
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
        draftOrigins: {},
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
  beginCodeComponent: (libraryId) => {
    const now = new Date().toISOString();
    const draft: ComponentRecord = {
      id: `draft:${crypto.randomUUID()}`,
      libraryId,
      name: '',
      description: '',
      category: '',
      tags: [],
      html: '',
      css: '',
      javascript: '',
      sourceType: 'manual',
      originalFileName: null,
      previewPolicy: {
        allowScripts: false,
        allowForms: false,
        allowPopups: false,
        externalNetworkEnabled: false,
        allowedOrigins: [],
      },
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    set((state) => ({
      components: state.componentsLibraryId === libraryId ? [...state.components, draft] : [draft],
      componentsLibraryId: libraryId,
      selectedLibraryId: libraryId,
      selectedComponentId: draft.id,
      selectedComponentIds: [],
      settings: { ...state.settings, viewMode: 'workbench' },
      draftOrigins: {},
      mutationVersion: state.mutationVersion + 1,
    }));
    persist({ viewMode: 'workbench', lastLibraryId: libraryId, lastComponentId: null });
    return draft;
  },
  consumeDraftOrigin: (componentId, draftOriginId) => {
    set((state) => {
      if (state.draftOrigins[componentId] !== draftOriginId) return state;
      return {
        draftOrigins: removeDraftOrigins(
          state.draftOrigins,
          (savedId) => savedId === componentId,
        ),
      };
    });
  },
  acceptSavedComponents: async (savedComponents) => {
    if (savedComponents.length === 0) return;
    const last = savedComponents.at(-1)!;
    if (get().componentsLibraryId === last.libraryId) {
      set((state) => {
        const existingIds = new Set(state.components.map((component) => component.id));
        return {
          components: [
            ...state.components,
            ...savedComponents.filter((component) => !existingIds.has(component.id)),
          ],
          mutationVersion: state.mutationVersion + 1,
        };
      });
      return;
    }
    let loaded: ComponentRecord[] = [];
    try {
      loaded = await window.componentVault.listComponents(last.libraryId);
    } catch {
      // The saved records still provide a consistent target view when reloading fails.
    }
    const savedById = new Map(savedComponents.map((component) => [component.id, component]));
    const components = [
      ...loaded.map((component) => savedById.get(component.id) ?? component),
      ...savedComponents.filter((component) => !loaded.some((item) => item.id === component.id)),
    ];
    set((state) => ({
      components,
      componentsLibraryId: last.libraryId,
      selectedLibraryId: last.libraryId,
      selectedComponentId: last.id,
      selectedComponentIds: [],
      draftOrigins: {},
      mutationVersion: state.mutationVersion + 1,
    }));
    persist({ lastLibraryId: last.libraryId, lastComponentId: last.id });
  },
  acceptLibrary: (library) => {
    set((state) => ({
      libraries: state.libraries.some((item) => item.id === library.id)
        ? state.libraries.map((item) => item.id === library.id ? library : item)
        : [...state.libraries, library],
      selectedLibraryId: library.id,
      mutationVersion: state.mutationVersion + 1,
    }));
    persist({ lastLibraryId: library.id });
  },
  saveComponent: async (component) => {
    if (component.id?.startsWith('draft:')) {
      if (!canPersistCodeDraft(component)) {
        const liveDraft = get().components.find((item) => item.id === component.id);
        if (!liveDraft) throw new Error('Component save cancelled because the draft is closed');
        const transient = { ...liveDraft, ...component, id: liveDraft.id };
        set((state) => ({
          components: state.components.map((item) => item.id === liveDraft.id ? transient : item),
        }));
        return transient;
      }
      const draftId = component.id;
      set((state) => ({
        components: state.components.map((item) => item.id === draftId
          ? { ...item, ...component, id: draftId }
          : item),
      }));
      const previous = draftOperationTails.get(draftId);
      const operation = (previous ? previous.catch(() => undefined) : Promise.resolve(undefined))
        .then(async (previousSaved): Promise<ComponentRecord> => {
          const liveId = previousSaved?.id ?? draftId;
          const live = get().components.find((item) => item.id === liveId);
          if (!live) throw new Error('Component save cancelled because the draft is closed');
          const saved = await window.componentVault.saveComponent({
            ...toSaveInput(live),
            id: previousSaved ? live.id : undefined,
          });
          if (cancelledDraftIds.has(draftId)) {
            await window.componentVault.deleteComponent(saved.id);
            cancelledDraftIds.delete(draftId);
            return saved;
          }
          let result = saved;
          set((state) => {
            const latest = state.components.find((item) => item.id === liveId);
            if (!latest) return state;
            result = mergeSavedEnvelopeWithLiveDraft(saved, latest);
            const isInitialSelectedRekey = liveId === draftId && state.selectedComponentId === liveId;
            return {
              components: state.components.map((item) => item.id === liveId ? result : item),
              selectedComponentId: isInitialSelectedRekey ? saved.id : state.selectedComponentId,
              draftOrigins: isInitialSelectedRekey
                ? { ...state.draftOrigins, [saved.id]: draftId }
                : state.draftOrigins,
            };
          });
          persist({ lastComponentId: saved.id });
          return result;
        });
      draftOperationTails.set(draftId, operation);
      void operation.finally(() => {
        if (draftOperationTails.get(draftId) === operation) {
          draftOperationTails.delete(draftId);
          cancelledDraftIds.delete(draftId);
        }
      }).catch(() => undefined);
      return operation;
    }
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
    if (componentId.startsWith('draft:')) {
      if (draftOperationTails.has(componentId)) cancelledDraftIds.add(componentId);
      set((state) => {
        const components = state.components.filter((component) => component.id !== componentId);
        return {
          components,
          selectedComponentId: state.selectedComponentId === componentId
            ? components[0]?.id ?? null
            : state.selectedComponentId,
          selectedComponentIds: state.selectedComponentIds.filter((id) => id !== componentId),
          draftOrigins: removeDraftOrigins(
            state.draftOrigins,
            (savedId, originId) => savedId === componentId || originId === componentId,
          ),
        };
      });
      persist({ lastComponentId: null });
      return;
    }
    deletingComponentIds.add(componentId);
    componentMutationGenerations.set(componentId, mutationGeneration(componentId) + 1);
    try {
      await enqueueComponentOperation(componentId, async () => {
        const liveBeforeDelete = get().components.find((component) => component.id === componentId);
        const previousIndex = get().components.findIndex((component) => component.id === componentId);
        if (!liveBeforeDelete) throw new Error('Component could not be deleted because it is closed');
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
            pendingDeletions: isSoftDeleteToken(deleted)
              ? [
                ...state.pendingDeletions.filter((pending) => pending.component.id !== componentId),
                { token: deleted, component: liveBeforeDelete, previousIndex },
              ]
              : state.pendingDeletions,
            draftOrigins: removeDraftOrigins(
              state.draftOrigins,
              (savedId, originId) => savedId === componentId || originId === componentId,
            ),
          };
        });
      });
    } finally {
      deletingComponentIds.delete(componentId);
    }
  },
  undoDelete: async (token) => {
    const pending = get().pendingDeletions.find((item) => sameDeleteToken(item.token, token));
    if (!pending) return;
    deletingComponentIds.add(token.componentId);
    try {
      const restored = await enqueueComponentOperation(token.componentId, () =>
        window.componentVault.restoreDeletedComponent(token));
      set((state) => {
        const pendingDeletions = state.pendingDeletions.filter((item) => !sameDeleteToken(item.token, token));
        if (!restored || state.componentsLibraryId !== restored.libraryId
          || state.components.some((component) => component.id === restored.id)) {
          return { pendingDeletions };
        }
        const components = [...state.components];
        components.splice(Math.min(pending.previousIndex, components.length), 0, restored);
        persist({ lastComponentId: restored.id });
        return {
          pendingDeletions,
          components,
          selectedComponentId: restored.id,
        };
      });
    } finally {
      deletingComponentIds.delete(token.componentId);
    }
  },
  expireDeletion: async (token) => {
    try {
      await window.componentVault.finalizeDeletedComponent(token);
    } finally {
      set((state) => ({
        pendingDeletions: state.pendingDeletions.filter((item) => !sameDeleteToken(item.token, token)),
      }));
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
