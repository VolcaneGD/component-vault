import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { openDatabase, type DatabaseContext } from '../../../src/main/database/database';
import { createLibraryService, type LibraryService } from '../../../src/main/services/library';

const databasePath = process.env.COMPONENT_VAULT_TEST_DATABASE;
const resultPath = process.env.COMPONENT_VAULT_TEST_RESULT;
const action = process.env.COMPONENT_VAULT_TEST_ACTION;

if (!databasePath || !resultPath || !action) {
  throw new Error('Missing recovery lifecycle test configuration');
}

let database: DatabaseContext | null = null;
let service: LibraryService | null = null;
const cleanShutdown = action === 'save-clean'
  || action === 'inspect-clean'
  || action === 'inspect-ack-clean';

const component = (id: string) => ({
  id,
  libraryId: 'electron-recovery-library',
  name: id,
  description: '',
  category: 'test',
  html: `<p>${id}</p>`,
  css: '',
  javascript: '',
  tags: [],
  sourceType: 'snippet' as const,
  originalFileName: null,
  previewPolicy: {
    allowScripts: false,
    allowForms: false,
    allowPopups: false,
    externalNetworkEnabled: false,
    allowedOrigins: [],
  },
});

app.on('before-quit', () => {
  if (cleanShutdown) service?.markCleanShutdown();
  if (database?.db.open) database.close();
  database = null;
});

void app.whenReady().then(async () => {
  database = openDatabase(databasePath);
  service = createLibraryService(database);
  const recovery = service.startSession();
  const fetched = service.getRecoverySnapshot();
  const fetchedAgain = service.getRecoverySnapshot();

  if (action === 'save-clean' || action === 'save-abnormal') {
    service.saveLibrary({
      id: 'electron-recovery-library',
      name: 'Electron recovery',
      description: '',
    });
    service.saveComponent(component(action === 'save-clean' ? 'clean-x' : 'abnormal-z'));
  }

  const acknowledged = action === 'inspect-ack-clean' && fetched
    ? service.ackRecoverySnapshot(fetched)
    : null;
  const acknowledgedAgain = action === 'inspect-ack-clean' && fetched
    ? service.ackRecoverySnapshot(fetched)
    : null;
  const afterAcknowledgement = action === 'inspect-ack-clean'
    ? service.getRecoverySnapshot()
    : undefined;

  const testWindow = new BrowserWindow({ show: false });
  await testWindow.loadURL('data:text/html,<title>Recovery lifecycle</title>');
  writeFileSync(resultPath, JSON.stringify({
    recovery,
    fetched,
    fetchedAgain,
    acknowledged,
    acknowledgedAgain,
    afterAcknowledgement,
  }), 'utf8');
});

app.on('window-all-closed', () => {
  if (cleanShutdown) app.quit();
});
