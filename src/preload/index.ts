import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  PREVIEW_REQUEST_BLOCKED_CHANNEL,
  type ComponentVaultApi,
  type PreviewBlockedRequest,
} from '../shared/contracts';
import { IPC_CHANNELS } from '../shared/ipcChannels';

const componentVaultApi: ComponentVaultApi = {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion),
  getElectronVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetElectronVersion),
  getRecoverySnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.appGetRecoverySnapshot),
  ackRecoverySnapshot: snapshot => ipcRenderer.invoke(IPC_CHANNELS.appAckRecoverySnapshot, snapshot),
  openExternal: url => ipcRenderer.invoke(IPC_CHANNELS.appOpenExternal, url),
  listLibraries: () => ipcRenderer.invoke(IPC_CHANNELS.libraryList),
  saveLibrary: library => ipcRenderer.invoke(IPC_CHANNELS.librarySave, library),
  deleteLibrary: libraryId => ipcRenderer.invoke(IPC_CHANNELS.libraryDelete, libraryId),
  listComponents: libraryId => ipcRenderer.invoke(IPC_CHANNELS.componentList, libraryId),
  saveComponent: component => ipcRenderer.invoke(IPC_CHANNELS.componentSave, component),
  deleteComponent: componentId => ipcRenderer.invoke(IPC_CHANNELS.componentDelete, componentId),
  restoreDeletedComponent: token => ipcRenderer.invoke(IPC_CHANNELS.componentRestore, token),
  finalizeDeletedComponent: token => ipcRenderer.invoke(IPC_CHANNELS.componentFinalizeDelete, token),
  reorderComponents: (libraryId, componentIds) => ipcRenderer.invoke(IPC_CHANNELS.componentReorder, libraryId, componentIds),
  searchComponents: (libraryId, query) => ipcRenderer.invoke(IPC_CHANNELS.componentSearch, libraryId, query),
  getAppSettings: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
  saveAppSettings: patch => ipcRenderer.invoke(IPC_CHANNELS.settingsUpdate, patch),
  importHtmlFiles: (paths, options) => ipcRenderer.invoke(IPC_CHANNELS.componentImportHtml, paths, options),
  copyText: text => ipcRenderer.invoke(IPC_CHANNELS.clipboardWriteText, text),
  saveStandaloneHtml: payload => ipcRenderer.invoke(IPC_CHANNELS.exportSaveStandalone, payload),
  saveCssFile: (suggestedFileName, css) => ipcRenderer.invoke(IPC_CHANNELS.exportSaveCss, suggestedFileName, css),
  getPathForFile: file => webUtils.getPathForFile(file),
  configurePreviewNetwork: request => ipcRenderer.invoke(IPC_CHANNELS.previewConfigureNetwork, request),
  releasePreviewNetwork: previewId => ipcRenderer.invoke(IPC_CHANNELS.previewReleaseNetwork, previewId),
  onPreviewRequestBlocked: listener => {
    const receiveBlockedRequest = (_event: Electron.IpcRendererEvent, event: PreviewBlockedRequest) => listener(event);
    ipcRenderer.on(PREVIEW_REQUEST_BLOCKED_CHANNEL, receiveBlockedRequest);
    return () => ipcRenderer.removeListener(PREVIEW_REQUEST_BLOCKED_CHANNEL, receiveBlockedRequest);
  },
};

contextBridge.exposeInMainWorld('componentVault', componentVaultApi);
