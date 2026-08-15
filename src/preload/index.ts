import { contextBridge, ipcRenderer } from 'electron';
import type { ComponentVaultApi } from '../shared/contracts';

const componentVaultApi: ComponentVaultApi = {
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
};

contextBridge.exposeInMainWorld('componentVault', componentVaultApi);
