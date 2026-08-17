import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createUpdateService } from '../../src/main/update/updateService';

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  checkForUpdates = vi.fn(async () => undefined);
  downloadUpdate = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();
}

describe('UpdateService', () => {
  it('does not contact GitHub from an unpackaged or portable build', async () => {
    const unpackagedUpdater = new FakeUpdater();
    const unpackaged = createUpdateService({ updater: unpackagedUpdater, currentVersion: '1.0.8', isPackaged: false, isPortable: false });
    await expect(unpackaged.check()).resolves.toMatchObject({ state: 'unsupported' });
    expect(unpackagedUpdater.checkForUpdates).not.toHaveBeenCalled();

    const portableUpdater = new FakeUpdater();
    const portable = createUpdateService({ updater: portableUpdater, currentVersion: '1.0.8', isPackaged: true, isPortable: true });
    await expect(portable.check()).resolves.toMatchObject({ state: 'unsupported' });
    expect(portableUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('downloads and installs only after explicit user actions', async () => {
    const updater = new FakeUpdater();
    const service = createUpdateService({ updater, currentVersion: '1.0.8', isPackaged: true, isPortable: false });
    updater.emit('update-available', { version: '1.0.9' });
    expect(service.getSnapshot()).toMatchObject({ state: 'available', availableVersion: '1.0.9' });
    await service.download();
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    updater.emit('download-progress', { percent: 51.2 });
    expect(service.getSnapshot()).toMatchObject({ state: 'downloading', percent: 51 });
    updater.emit('update-downloaded', { version: '1.0.9' });
    service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });
});
