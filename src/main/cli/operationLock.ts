import { open, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const LOCK_FILE_NAME = 'component-vault.operation.lock';
const LOCK_STARTUP_GRACE_MS = 5_000;

export class DatabaseBusyError extends Error {
  readonly code = 'database-busy';

  constructor() {
    super('Component Vault is busy. Retry after the current operation finishes.');
  }
}

export class OperationLock {
  private released = false;

  private constructor(private readonly lockPath: string) {}

  static async acquire(userDataPath: string): Promise<OperationLock> {
    const lockPath = join(userDataPath, LOCK_FILE_NAME);
    try {
      const file = await open(lockPath, 'wx', 0o600);
      await file.writeFile(`${process.pid}\n`, 'utf8');
      await file.close();
      return new OperationLock(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        if (await reclaimDeadOwner(lockPath)) return OperationLock.acquire(userDataPath);
        throw new DatabaseBusyError();
      }
      throw error;
    }
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    await unlink(this.lockPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}

const reclaimDeadOwner = async (lockPath: string): Promise<boolean> => {
  const [contents, metadata] = await Promise.all([
    readFile(lockPath, 'utf8').catch(() => ''),
    stat(lockPath).catch(() => null),
  ]);
  if (!metadata || Date.now() - metadata.mtimeMs < LOCK_STARTUP_GRACE_MS) return false;
  const pid = Number.parseInt(contents.trim(), 10);
  if (!Number.isSafeInteger(pid) || pid <= 0 || processIsAlive(pid)) return false;
  await unlink(lockPath).catch(() => undefined);
  return true;
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};
