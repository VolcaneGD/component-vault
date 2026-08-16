import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('imports an HTML component while retaining the review step', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'component-vault-import-'));
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: process.cwd(),
  });

  try {
    const page = await electronApp.firstWindow();
    await page.getByRole('button', { name: 'Import' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import HTML components' });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('New library name').fill('E2E library');
    await dialog.getByRole('button', { name: 'Create library' }).click();
    await dialog.locator('input[type="file"]').setInputFiles(resolve('tests/fixtures/import/fragment.html'));

    await expect(dialog.getByRole('heading', { name: 'Review candidates' })).toBeVisible();
    await expect(dialog.getByText('Ready')).toBeVisible();
    await dialog.getByRole('button', { name: 'Add 1 component' }).click();
    await expect(dialog.getByText('Added')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close dialog' }).click();

    await expect(page.getByLabel('Component name')).toHaveValue('fragment');
  } finally {
    await electronApp.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});

test('opens a focused code draft without persisting name-only input', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'component-vault-code-'));
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: process.cwd(),
  });

  try {
    const page = await electronApp.firstWindow();
    await page.getByRole('button', { name: 'New component' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create a component' });
    await dialog.getByLabel('New library name').fill('Code library');
    await dialog.getByRole('button', { name: 'Create library' }).click();
    await dialog.getByRole('button', { name: 'Start coding' }).click();

    await expect(page.getByLabel('Component name')).toHaveValue('');
    await expect(page.locator('.monaco-editor .native-edit-context')).toBeFocused();
    await page.getByLabel('Component name').fill('Name only');
    await page.waitForTimeout(600);
    await expect(page.getByText('Add HTML, CSS, or JavaScript before saving.')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Component name')).toHaveValue('');
  } finally {
    await electronApp.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
