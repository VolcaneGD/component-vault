import { access, mkdtemp, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OperationLock } from '../../src/main/cli/operationLock';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })));
});

describe('OperationLock', () => {
  it('rejects a second owner until the first lock releases', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'component-vault-lock-'));
    directories.push(userDataPath);
    const first = await OperationLock.acquire(userDataPath);

    await expect(OperationLock.acquire(userDataPath)).rejects.toMatchObject({ code: 'database-busy' });

    await first.release();
    await expect(OperationLock.acquire(userDataPath)).resolves.toBeInstanceOf(OperationLock);
  });

  it('reclaims a lock left by a dead process', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'component-vault-lock-'));
    directories.push(userDataPath);
    const lockPath = join(userDataPath, 'component-vault.operation.lock');
    await writeFile(lockPath, '999999\n', 'utf8');
    const stale = new Date(Date.now() - 6_000);
    await utimes(lockPath, stale, stale);

    await expect(OperationLock.acquire(userDataPath)).resolves.toBeInstanceOf(OperationLock);
  });

  it('never unlinks a replacement lock it no longer owns', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'component-vault-lock-'));
    directories.push(userDataPath);
    const lock = await OperationLock.acquire(userDataPath);
    const lockPath = join(userDataPath, 'component-vault.operation.lock');
    await unlink(lockPath);
    await writeFile(lockPath, 'replacement-owner\n', 'utf8');

    await lock.release();

    await expect(access(lockPath)).resolves.toBeUndefined();
  });
});
