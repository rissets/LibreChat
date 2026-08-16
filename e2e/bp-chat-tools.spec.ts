import { expect, test } from '@playwright/test';
import type { Download, Page } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { NEW_CHAT_PATH } from './specs/mock/helpers';
import { validateHostPreflightUrl } from './setup/provider-preflight';

/**
 * BP Chat's four manually selected capabilities.  These tests intentionally use
 * the browser (rather than probing MCP/config endpoints) so a passing test is
 * evidence of the rendered control and resulting user-visible output.
 *
 * Run this suite only with `npm run e2e:bp` against the running BP Compose
 * deployment. The generic `npm run e2e` command intentionally remains the
 * upstream LibreChat local harness.
 */
const CURATED_SKILL_ID = 'official-document-checklist';
const CURATED_SKILL_PATH = 'official-document-checklist/SKILL.md';

export function assertCuratedSkillDeploymentContract(): void {
  const manifestPath = path.resolve(__dirname, '../../../skill/manifest.yaml');
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const entry = manifest.match(new RegExp(`^  - id: ${CURATED_SKILL_ID}$[\\s\\S]*?^    path: (.+)$`, 'm'));
  if (!entry || entry[1] !== CURATED_SKILL_PATH) {
    throw new Error(`manifest must list ${CURATED_SKILL_ID} at exactly ${CURATED_SKILL_PATH}`);
  }
  const skillPath = path.resolve(path.dirname(manifestPath), entry[1]);
  if (!fs.statSync(skillPath).isFile() || path.basename(skillPath) !== 'SKILL.md') {
    throw new Error(`manifest skill path must be an existing SKILL.md: ${entry[1]}`);
  }
  const skillEntry = manifest.slice(manifest.indexOf(`  - id: ${CURATED_SKILL_ID}`), manifest.indexOf('\n  - id:', manifest.indexOf(`  - id: ${CURATED_SKILL_ID}`) + 1));
  if (!skillEntry.includes('mcp:bp-department-tools:document_checklist')) {
    throw new Error('curated skill manifest must allow document_checklist');
  }
  const compose = fs.readFileSync(path.resolve(__dirname, '../../../compose.yaml'), 'utf8');
  if (!/[- ]+\.\/skill:\/app\/skills:ro/.test(compose) || /codex/i.test(compose.slice(compose.indexOf('./skill:/app/skills:ro') - 200, compose.indexOf('./skill:/app/skills:ro') + 100))) {
    throw new Error('BP compose must mount ./skill at /app/skills and exclude Codex paths');
  }
}

test('host preflight rejects Docker/internal URLs but accepts localhost forwards', () => {
  for (const host of ['access-broker', 'searxng', 'department-tools']) {
    expect(() => validateHostPreflightUrl('fixture', `http://${host}:8080`)).toThrow();
  }
  expect(() => validateHostPreflightUrl('fixture', 'http://service.internal:8080')).toThrow();
  expect(() => validateHostPreflightUrl('fixture', 'http://172.16.0.1:8080')).toThrow();
  expect(() => validateHostPreflightUrl('fixture', 'http://172.31.255.254:8080')).toThrow();
  expect(validateHostPreflightUrl('fixture', 'http://127.0.0.1:8080').hostname).toBe('127.0.0.1');
  expect(validateHostPreflightUrl('fixture', 'http://localhost:8080').hostname).toBe('localhost');
});

test.beforeAll(() => {
  assertCuratedSkillDeploymentContract();
  if (process.env.BP_CHAT_E2E !== '1') {
    throw new Error('BP Chat E2E requires BP_CHAT_E2E=1 and a deterministic BP Chat provider; refusing to skip.');
  }
});

async function openTools(page: Page) {
  await page.getByRole('button', { name: 'Tools Options' }).click();
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function readZipEntries(bytes: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const dataStart = nameStart + nameLength + extraLength;
    const data = bytes.subarray(dataStart, dataStart + size);
    entries.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    offset = dataStart + size;
  }
  return entries;
}

function assertWorkbookPackage(bytes: Buffer) {
  const entries = readZipEntries(bytes);
  for (const name of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
    expect(entries.has(name), `XLSX is missing ZIP entry ${name}`).toBe(true);
  expect(entries.get('xl/workbook.xml')!.toString()).toMatch(/<sheet\b[^>]*name=/);
  expect(entries.get('xl/worksheets/sheet1.xml')!.toString()).toMatch(/<worksheet(?:\s|>)/);
}

const assistantMessages = (page: Page) => page.getByTestId('messages-view');

 test.describe('BP Chat manual tools and artifacts', () => {
  test('image generation is off by default and returns a concise success', async ({ page }) => {
    await page.addInitScript(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('LAST_IMAGE_GENERATION_TOGGLE_')) localStorage.removeItem(key);
      }
    });
    await page.goto(NEW_CHAT_PATH);
    await openTools(page);
    const image = page.getByTestId('tools-menu-image-generation');
    await expect(image).toHaveAttribute('aria-checked', 'false');
    await image.click();
    await expect(image).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await page.getByRole('textbox', { name: 'Message input' }).fill('Generate a simple office illustration.');
    await page.getByRole('textbox', { name: 'Message input' }).press('Enter');
    await expect(assistantMessages(page).getByRole('img').first()).toBeVisible({ timeout: 120_000 });
    const text = (await assistantMessages(page).innerText()).trim();
    expect(text).toContain('Gambar berhasil dibuat.');
    expect(text.length).toBeLessThan(160);
  });

  test('web research calls the native tool, then disabling it makes no new call', async ({ page }) => {
    await page.goto(NEW_CHAT_PATH);
    await openTools(page);
    const search = page.getByText('Web Search', { exact: true });
    await expect(search).toBeVisible();
    await search.click();
    await page.keyboard.press('Escape');
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.fill('Research the latest BP market update and cite sources.');
    await input.press('Enter');
    await expect.poll(async () => {
      const id = new URL(page.url()).pathname.split('/c/')[1];
      if (!id) return [];
      const messages = await page.request.get(`/api/messages/${id}`).then((r) => r.json());
      return (messages ?? []).flatMap((m: { content?: Array<{ type?: string; tool_call?: { name?: string; output?: string } }> }) =>
        (m.content ?? []).filter((p) => p.type === 'tool_call' && p.tool_call?.name === 'web_research_mcp_bp-department-tools'));
    }, { timeout: 120_000 }).not.toHaveLength(0);
    const before = new URL(page.url()).pathname.split('/c/')[1];
    await openTools(page);
    await search.click();
    await page.keyboard.press('Escape');
    await input.fill('What is BP Batam?');
    await input.press('Enter');
    await expect(assistantMessages(page)).toContainText(/BP|Batam/i, { timeout: 120_000 });
    const messages = await page.request.get(`/api/messages/${before}`).then((r) => r.json());
    const calls = (messages ?? []).flatMap((m: { content?: Array<{ type?: string; tool_call?: { name?: string } }> }) =>
      (m.content ?? []).filter((p) => p.type === 'tool_call' && p.tool_call?.name === 'web_research_mcp_bp-department-tools'));
    expect(calls).toHaveLength(1);
  });

  test('spreadsheet request exposes a downloadable, valid xlsx artifact', async ({ page }) => {
    await page.goto(NEW_CHAT_PATH);
    await page.getByRole('textbox', { name: 'Message input' }).fill('Create an XLSX with one sheet and three rows.');
    await page.getByRole('textbox', { name: 'Message input' }).press('Enter');
    const downloadButton = assistantMessages(page).getByRole('button', { name: /download/i }).last();
    await expect(downloadButton).toBeVisible({ timeout: 120_000 });
    const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);
    expect(download.suggestedFilename().toLowerCase()).toMatch(/\.xlsx$/);
    const bytes = await downloadBytes(download);
    expect(bytes.length).toBeGreaterThan(100);
    // Validate the OOXML package and workbook parts, not just its ZIP signature.
    expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK');
    assertWorkbookPackage(bytes);
  });

  test('curated application skill is invoked through Skills UI and returns its permitted result', async ({ page }) => {
    await page.goto('/skills');
    await expect(page.getByText(/BP Chat|document/i).first()).toBeVisible();
    await expect(page.getByText(/codex|e2e-deployment-skill/i)).toHaveCount(0);
    await page.goto(NEW_CHAT_PATH);
    await openTools(page);
    await page.getByTestId('tools-menu-skills').click();
    await page.keyboard.press('Escape');

    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.fill(`$${CURATED_SKILL_ID}`);
    const skillOption = page.locator('button[id^="skill-item-"]').filter({ hasText: /official document checklist/i }).first();
    await expect(skillOption).toBeVisible();
    await skillOption.click();
    await expect(page.getByText(/official-document-checklist|Official document checklist/i).first()).toBeVisible();
    await input.fill('Create a checklist for an internal work document.');
    await input.press('Enter');
    await expect.poll(async () => {
      const id = new URL(page.url()).pathname.split('/c/')[1];
      if (!id) return [];
      const messages = await page.request.get(`/api/messages/${id}`).then((r) => r.json());
      return (messages ?? []).flatMap((m: { content?: Array<{ type?: string; tool_call?: { name?: string } }> }) =>
        (m.content ?? []).filter((p) => p.type === 'tool_call' && p.tool_call?.name === 'document_checklist_mcp_bp-department-tools'));
    }, { timeout: 120_000 }).not.toHaveLength(0);
    await expect(assistantMessages(page)).toContainText(/Checklist .*dokumen|approval|persetujuan/i, { timeout: 120_000 });
  });
});

