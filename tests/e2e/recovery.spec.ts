import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/main/database/database';
import { createLibraryService } from '../../src/main/services/library';

test('relaunch after an abnormal termination recovers only the last completed autosave', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'component-vault-recovery-'));
  const path = join(directory, 'component-vault.sqlite');
  const databases: ReturnType<typeof openDatabase>[] = [];
  try {
    const firstDatabase = openDatabase(path);
    databases.push(firstDatabase);
    const firstRun = createLibraryService(firstDatabase);
    expect(firstRun.startSession()).toBeNull();
    const library = firstRun.saveLibrary({ name: 'Recovery', description: '' });
    const completed = firstRun.saveComponent(componentInput(library.id, 'Completed autosave'));
    expect(() => firstRun.saveComponent({
      ...componentInput(library.id, 'Failed newer draft'),
      previewPolicy: {
        allowScripts: false, allowForms: false, allowPopups: false,
        externalNetworkEnabled: true, allowedOrigins: ['http://blocked.example'],
      },
    })).toThrow('Invalid preview policy');
    firstDatabase.close(); // Simulates a process loss before clean-shutdown acknowledgement.

    const relaunchedDatabase = openDatabase(path);
    databases.push(relaunchedDatabase);
    const relaunched = createLibraryService(relaunchedDatabase);
    expect(relaunched.startSession()).toEqual({
      libraryId: library.id,
      componentId: completed.id,
      completedAt: completed.updatedAt,
    });
    const recovery = {
      libraryId: library.id,
      componentId: completed.id,
      completedAt: completed.updatedAt,
    };
    expect(relaunched.getRecoverySnapshot()).toEqual(recovery);
    expect(relaunched.getRecoverySnapshot()).toEqual(recovery);
    expect(relaunched.ackRecoverySnapshot(recovery)).toBe(true);
    expect(relaunched.getRecoverySnapshot()).toBeNull();
    expect(relaunched.getComponent(completed.id)?.name).toBe('Completed autosave');
    relaunched.markCleanShutdown();
    relaunchedDatabase.close();

    const cleanDatabase = openDatabase(path);
    databases.push(cleanDatabase);
    expect(createLibraryService(cleanDatabase).startSession()).toBeNull();
    cleanDatabase.close();
  } finally {
    for (const database of databases) {
      if (database.db.open) database.close();
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('a clean save cannot leak through a later no-save crash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'component-vault-recovery-isolation-'));
  const path = join(directory, 'component-vault.sqlite');
  const databases: ReturnType<typeof openDatabase>[] = [];
  try {
    const firstDatabase = openDatabase(path);
    databases.push(firstDatabase);
    const firstRun = createLibraryService(firstDatabase);
    firstRun.startSession();
    const library = firstRun.saveLibrary({ name: 'Isolation', description: '' });
    firstRun.saveComponent(componentInput(library.id, 'Clean X'));
    firstRun.markCleanShutdown();
    firstDatabase.close();

    const secondDatabase = openDatabase(path);
    databases.push(secondDatabase);
    const secondRun = createLibraryService(secondDatabase);
    expect(secondRun.startSession()).toBeNull();
    expect(secondRun.getRecoverySnapshot()).toBeNull();
    secondDatabase.close(); // Abnormal termination before any save in this session.

    const thirdDatabase = openDatabase(path);
    databases.push(thirdDatabase);
    const thirdRun = createLibraryService(thirdDatabase);
    expect(thirdRun.startSession()).toBeNull();
    expect(thirdRun.getRecoverySnapshot()).toBeNull();
    thirdDatabase.close();
  } finally {
    for (const database of databases) {
      if (database.db.open) database.close();
    }
    await rm(directory, { recursive: true, force: true });
  }
});

const componentInput = (libraryId: string, name: string) => ({
  libraryId, name, description: '', category: 'Buttons', html: '<button>Saved</button>', css: '', javascript: '',
  sourceType: 'editor', originalFileName: null, tags: [],
  previewPolicy: {
    allowScripts: false, allowForms: false, allowPopups: false,
    externalNetworkEnabled: false, allowedOrigins: [],
  },
});
