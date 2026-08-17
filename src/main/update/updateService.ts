import type { UpdateSnapshot } from '../../shared/contracts';

interface UpdaterEvents {
  on(event: 'checking-for-update', listener: () => void): unknown;
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'update-not-available', listener: () => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  autoDownload: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdateService {
  getSnapshot(): UpdateSnapshot;
  check(): Promise<UpdateSnapshot>;
  download(): Promise<UpdateSnapshot>;
  install(): void;
  onStatus(listener: (snapshot: UpdateSnapshot) => void): () => void;
}

export const createUpdateService = ({
  updater,
  currentVersion,
  isPackaged,
  isPortable,
}: {
  updater: UpdaterEvents;
  currentVersion: string;
  isPackaged: boolean;
  isPortable: boolean;
}): UpdateService => {
  const listeners = new Set<(snapshot: UpdateSnapshot) => void>();
  let snapshot: UpdateSnapshot = {
    state: isPackaged && !isPortable ? 'idle' : 'unsupported',
    currentVersion,
    message: isPortable ? 'Portable builds are updated manually.' : undefined,
  };
  const publish = (next: UpdateSnapshot) => {
    snapshot = next;
    listeners.forEach(listener => listener(snapshot));
  };
  const isSupported = isPackaged && !isPortable;
  updater.autoDownload = false;
  updater.on('checking-for-update', () => publish({ state: 'checking', currentVersion }));
  updater.on('update-available', info => publish({ state: 'available', currentVersion, availableVersion: info.version }));
  updater.on('update-not-available', () => publish({ state: 'not-available', currentVersion }));
  updater.on('download-progress', progress => publish({ ...snapshot, state: 'downloading', percent: Math.round(progress.percent) }));
  updater.on('update-downloaded', info => publish({ state: 'downloaded', currentVersion, availableVersion: info.version }));
  updater.on('error', () => publish({ state: 'error', currentVersion, message: 'Update check failed.' }));
  return {
    getSnapshot: () => snapshot,
    check: async () => {
      if (!isSupported) return snapshot;
      await updater.checkForUpdates();
      return snapshot;
    },
    download: async () => {
      if (!isSupported || snapshot.state !== 'available') return snapshot;
      publish({ ...snapshot, state: 'downloading', percent: 0 });
      await updater.downloadUpdate();
      return snapshot;
    },
    install: () => { if (isSupported && snapshot.state === 'downloaded') updater.quitAndInstall(); },
    onStatus: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
};
