import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('componentVault', {
  testMarker: true,
  configurePreviewNetwork: (request: unknown) => ipcRenderer.invoke('test:configure-preview-network', request),
  releasePreviewNetwork: (previewId: string) => ipcRenderer.invoke('test:release-preview-network', previewId),
});
