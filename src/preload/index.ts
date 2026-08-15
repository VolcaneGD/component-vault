import { contextBridge, ipcRenderer } from 'electron';
import type { ComponentVaultApi } from '../shared/contracts';
import { IPC_CHANNELS } from '../main/ipc/registerIpc';

const componentVaultApi: ComponentVaultApi = {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion),
  listLibraries: () => ipcRenderer.invoke(IPC_CHANNELS.libraryList),
  saveLibrary: library => ipcRenderer.invoke(IPC_CHANNELS.librarySave, library),
  deleteLibrary: libraryId => ipcRenderer.invoke(IPC_CHANNELS.libraryDelete, libraryId),
  listComponents: libraryId => ipcRenderer.invoke(IPC_CHANNELS.componentList, libraryId),
  saveComponent: component => ipcRenderer.invoke(IPC_CHANNELS.componentSave, component),
  deleteComponent: componentId => ipcRenderer.invoke(IPC_CHANNELS.componentDelete, componentId),
  reorderComponents: (libraryId, componentIds) => ipcRenderer.invoke(IPC_CHANNELS.componentReorder, libraryId, componentIds),
  searchComponents: (libraryId, query) => ipcRenderer.invoke(IPC_CHANNELS.componentSearch, libraryId, query),
  getAppSettings: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
  saveAppSettings: patch => ipcRenderer.invoke(IPC_CHANNELS.settingsUpdate, patch),
};

contextBridge.exposeInMainWorld('componentVault', componentVaultApi);
