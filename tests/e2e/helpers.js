import { test as base, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, '../../action-recorder');
const FIXTURE_PORT = 8976;
const BASE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;

let fixtureProc = null;

async function ensureFixtureServer() {
  if (fixtureProc) return;
  const res = await fetch(`${BASE_URL}/api/data`).then(r => r.ok).catch(() => false);
  if (res) return;
  fixtureProc = spawn(process.execPath, [path.join(__dirname, 'fixture-server.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FIXTURE_PORT: String(FIXTURE_PORT) }
  });
  fixtureProc.stdout.on('data', () => {});
  fixtureProc.stderr.on('data', (d) => console.error('[fixture]', d.toString()));
  for (let i = 0; i < 50; i++) {
    try {
      const ok = await fetch(`${BASE_URL}/api/data`).then(r => r.ok);
      if (ok) return;
    } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error('fixture server failed to start');
}

export const test = base.extend({
  launch: async ({}, use) => {
    await ensureFixtureServer();
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`
      ]
    });
    // Wait for service worker (background)
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
    }
    const extensionId = sw.url().split('/')[2];

    const helpers = {
      context,
      sw,
      extensionId,
      async openApp() {
        const page = await context.newPage();
        await page.goto(BASE_URL + '/');
        return page;
      },
      async openPopup() {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/popup.html`);
        await page.waitForSelector('#btn-start');
        return page;
      },
      async startRecording(popup) {
        await popup.waitForSelector('#btn-start');
        // btn-start disabled → currently recording; stop first for a clean session
        const recording = await popup.evaluate(() => document.getElementById('btn-start').disabled === true);
        if (recording) {
          await popup.click('#btn-stop');
          await popup.waitForFunction(() => document.getElementById('btn-start').disabled === false);
          await sleep(200);
        }
        await popup.click('#btn-start');
        await popup.waitForFunction(() => {
          const t = document.getElementById('status-text');
          return t && t.textContent.includes('ON');
        });
        // Allow broadcast to reach content scripts
        await sleep(300);
      },
      async stopRecording(popup) {
        await popup.click('#btn-stop');
        await popup.waitForFunction(() => {
          const t = document.getElementById('status-text');
          return t && t.textContent.includes('OFF');
        });
        await sleep(300);
      },
      async getStatus(page) {
        return page.evaluate(() => new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (r) => resolve(r));
        }));
      },
      async exportJson(page, sessionId) {
        return page.evaluate((sid) => new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'EXPORT_JSON', sessionId: sid }, (r) => resolve(r));
        }), sessionId);
      },
      async getSettings(page) {
        return page.evaluate(() => new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (r) => resolve(r));
        }));
      },
      async saveSettings(page, settings) {
        return page.evaluate((s) => new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: s }, (r) => resolve(r));
        }), settings);
      },
      async getSessionState(sw) {
        return sw.evaluate(() => chrome.storage.session.get(['activeSessionId', 'lastSessionId']));
      },
      async close() {
        await context.close();
      }
    };

    await use(helpers);
    await context.close();
    if (fixtureProc) {
      fixtureProc.kill();
      fixtureProc = null;
    }
  }
});

export { BASE_URL, FIXTURE_PORT, sleep };
export const expect = base.expect;
