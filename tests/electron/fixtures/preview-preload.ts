import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('componentVault', { testMarker: true });
