// @vitest-environment node

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';

let electronApplication: ElectronApplication | null = null;
let testDirectory: string | null = null;

afterEach(async () => {
  await electronApplication?.close().catch(() => undefined);
  electronApplication = null;
  if (testDirectory) rmSync(testDirectory, {
    force: true,
    recursive: true,
    maxRetries: 5,
    retryDelay: 100,
  });
  testDirectory = null;
});

describe('real Electron recovery lifecycle', () => {
  it('isolates sessions and consumes an abnormal completed save once', async () => {
    testDirectory = mkdtempSync(join(resolve('node_modules'), '.component-vault-recovery-electron-'));
    const databasePath = join(testDirectory, 'component-vault.sqlite');
    const mainBundle = join(testDirectory, 'main.cjs');
    await build({
      entryPoints: [resolve('tests/electron/fixtures/recovery-lifecycle-main.ts')],
      outfile: mainBundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron', 'better-sqlite3'],
    });

    const launch = async (action: string) => {
      const resultPath = join(testDirectory!, `${action}-${Date.now()}.json`);
      electronApplication = await electron.launch({
        args: [mainBundle],
        env: {
          ...process.env,
          COMPONENT_VAULT_TEST_ACTION: action,
          COMPONENT_VAULT_TEST_DATABASE: databasePath,
          COMPONENT_VAULT_TEST_RESULT: resultPath,
        } as Record<string, string>,
      });
      await vi.waitFor(() => expect(existsSync(resultPath)).toBe(true), {
        timeout: 10_000,
        interval: 50,
      });
      return JSON.parse(readFileSync(resultPath, 'utf8')) as {
        recovery: { componentId: string } | null;
        fetched: { componentId: string } | null;
        fetchedAgain: { componentId: string } | null;
        acknowledged: boolean | null;
        acknowledgedAgain: boolean | null;
        afterAcknowledgement?: { componentId: string } | null;
      };
    };

    const closeCleanly = async () => {
      await electronApplication!.close();
      electronApplication = null;
    };
    const terminateAbnormally = async () => {
      const mainPid = await electronApplication!.evaluate(() => process.pid);
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(mainPid), '/T', '/F']);
      } else {
        process.kill(mainPid, 'SIGKILL');
      }
      electronApplication = null;
    };

    await launch('save-clean');
    await closeCleanly();

    expect(await launch('no-save-abnormal')).toEqual({
      recovery: null,
      fetched: null,
      fetchedAgain: null,
      acknowledged: null,
      acknowledgedAgain: null,
    });
    await terminateAbnormally();

    expect(await launch('inspect-clean')).toEqual({
      recovery: null,
      fetched: null,
      fetchedAgain: null,
      acknowledged: null,
      acknowledgedAgain: null,
    });
    await closeCleanly();

    await launch('save-abnormal');
    await terminateAbnormally();

    expect(await launch('inspect-no-ack-abnormal')).toEqual({
      recovery: expect.objectContaining({ componentId: 'abnormal-z' }),
      fetched: expect.objectContaining({ componentId: 'abnormal-z' }),
      fetchedAgain: expect.objectContaining({ componentId: 'abnormal-z' }),
      acknowledged: null,
      acknowledgedAgain: null,
    });
    await terminateAbnormally();

    expect(await launch('inspect-ack-clean')).toEqual({
      recovery: expect.objectContaining({ componentId: 'abnormal-z' }),
      fetched: expect.objectContaining({ componentId: 'abnormal-z' }),
      fetchedAgain: expect.objectContaining({ componentId: 'abnormal-z' }),
      acknowledged: true,
      acknowledgedAgain: false,
      afterAcknowledgement: null,
    });
    await closeCleanly();
  }, 45_000);
});
