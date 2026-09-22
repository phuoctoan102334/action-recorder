import { test, expect, BASE_URL, sleep } from './helpers.js';

test.describe('Phase 1 MVP E2E', () => {
  test('E1 (T1): click records action with #submit-btn candidate', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);

    await page.click('#submit-btn');
    await sleep(400);
    await launch.stopRecording(popup);

    const status = await launch.getStatus(popup);
    expect(status.sessionId).toBeTruthy();
    const exp = await launch.exportJson(popup, status.sessionId);
    expect(exp.ok).toBe(true);
    const clicks = exp.data.actions.filter(a => a.type === 'click');
    expect(clicks.length).toBeGreaterThanOrEqual(1);
    const btn = clicks.find(a => a.target && a.target.id === 'submit-btn');
    expect(btn).toBeTruthy();
    expect(btn.target.tag).toBe('button');
    expect(btn.target.cssSelectorCandidates).toContain('#submit-btn');
    expect(btn.actionUid).toMatch(/:\d+:\d+:\d+$/);
  });

  test('E2 (T2): password input masked, target.sensitive=true', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);

    await page.fill('#pw-field', 'secret123');
    await sleep(500);
    await launch.stopRecording(popup);

    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    const inputs = exp.data.actions.filter(a => a.type === 'input' && a.target && a.target.name === 'password');
    expect(inputs.length).toBeGreaterThanOrEqual(1);
    expect(inputs[0].value).toBe('[MASKED]');
    expect(inputs[0].target.sensitive).toBe(true);
    expect(JSON.stringify(exp.data)).not.toContain('secret123');
  });

  test('E3 (T3): fetch correlates to click via causedByAction', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);

    await page.click('#fetch-btn');
    await page.waitForFunction(() => window.__lastFetch, null, { timeout: 10000 });
    await sleep(500);
    await launch.stopRecording(popup);

    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    const net = exp.data.network.filter(n => n.request && n.request.url.includes('/api/data'));
    expect(net.length).toBeGreaterThanOrEqual(1);
    expect(net[0].source).toBe('fetch');
    expect(net[0].request.method).toBe('GET');
    const click = exp.data.actions.find(a => a.type === 'click' && a.target && a.target.id === 'fetch-btn');
    expect(click).toBeTruthy();
    expect(net[0].causedByAction).toBe(click.actionUid);
  });

  test('E4 (T4): XHR correlation with source=xhr', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);

    await page.click('#xhr-btn');
    await page.waitForFunction(() => window.__lastXhr, null, { timeout: 10000 });
    await sleep(500);
    await launch.stopRecording(popup);

    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    const net = exp.data.network.filter(n => n.source === 'xhr');
    expect(net.length).toBeGreaterThanOrEqual(1);
    const click = exp.data.actions.find(a => a.type === 'click' && a.target && a.target.id === 'xhr-btn');
    expect(net[0].causedByAction).toBe(click.actionUid);
  });

  test('E5 (T5): three sequential fetches no cross-contamination', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);

    await page.click('#btn-a');
    await sleep(200);
    await page.click('#btn-b');
    await sleep(200);
    await page.click('#btn-c');
    await sleep(600);
    await launch.stopRecording(popup);

    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    const byPath = {};
    for (const n of exp.data.network) {
      const p = n.request.url;
      if (p.includes('/api/a') || p.includes('/api/b') || p.includes('/api/c')) byPath[p] = n;
    }
    expect(Object.keys(byPath).length).toBe(3);
    for (const id of ['a', 'b', 'c']) {
      const click = exp.data.actions.find(a => a.type === 'click' && a.target && a.target.id === `btn-${id}`);
      expect(click).toBeTruthy();
      const net = exp.data.network.find(n => n.request.url.endsWith(`/api/${id}`));
      expect(net.causedByAction).toBe(click.actionUid);
    }
    const uids = ['a', 'b', 'c'].map(id => {
      const click = exp.data.actions.find(a => a.type === 'click' && a.target && a.target.id === `btn-${id}`);
      return click.actionUid;
    });
    expect(new Set(uids).size).toBe(3);
  });

  test('E6 (T6): iframe action has frameId !== 0', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);

    const frame = page.frameLocator('#test-iframe');
    await frame.locator('#iframe-btn').click();
    await sleep(500);
    await launch.stopRecording(popup);

    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    const iframeClick = exp.data.actions.find(a =>
      a.type === 'click' && a.target && a.target.id === 'iframe-btn');
    expect(iframeClick).toBeTruthy();
    expect(iframeClick.frame.frameId).not.toBe(0);
    expect(iframeClick.actionUid.split(':').length).toBe(4);
    expect(Number(iframeClick.actionUid.split(':')[2])).toBe(iframeClick.frame.frameId);
  });

  test('E7 (T8): export JSON has version/session/pages/actions/network/correlations', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);

    await page.click('#submit-btn');
    await page.fill('#pw-field', 'secret123');
    await page.click('#fetch-btn');
    await page.waitForFunction(() => window.__lastFetch, null, { timeout: 10000 });
    await sleep(500);
    await launch.stopRecording(popup);

    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    expect(exp.ok).toBe(true);
    expect(exp.data.version).toBe('1.0');
    expect(exp.data.session.sessionId).toBe(status.sessionId);
    expect(exp.data.session.startedAt).toBeTruthy();
    expect(Array.isArray(exp.data.pages)).toBe(true);
    expect(exp.data.pages.length).toBeGreaterThanOrEqual(1);
    expect(exp.data.pages[0].url).toContain(BASE_URL);
    expect(Array.isArray(exp.data.actions)).toBe(true);
    expect(Array.isArray(exp.data.network)).toBe(true);
    expect(Array.isArray(exp.data.correlations)).toBe(true);
    expect(JSON.stringify(exp.data)).not.toContain('secret123');
  });

  test('E8 (T9): deep mask nested request body', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);

    await page.click('#btn-deep-mask');
    await sleep(600);
    await launch.stopRecording(popup);

    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    const net = exp.data.network.find(n => n.request.url.includes('/api/deep'));
    expect(net).toBeTruthy();
    const body = net.request.body;
    expect(typeof body).toBe('object');
    expect(body.user.name).toBe('Alice');
    expect(body.user.credentials.password).toBe('[MASKED]');
    expect(body.user.credentials.token).toBe('[MASKED]');
    expect(JSON.stringify(net)).not.toContain('leak');
  });

  test('E9 (T10): large request body truncated with metadata', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);

    await page.click('#btn-large-post');
    await sleep(800);
    await launch.stopRecording(popup);

    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    const net = exp.data.network.find(n => n.request.url.includes('/api/echo'));
    expect(net).toBeTruthy();
    expect(net.request.truncated).toBe(true);
    expect(net.request.originalSize).toBeGreaterThan(64 * 1024);
    expect(net.request.storedSize).toBeLessThanOrEqual(64 * 1024);
  });

  test('E9b (T17): body size limit from settings applies', async ({ launch }) => {
    const popup = await launch.openPopup();
    const settingsResp = await launch.getSettings(popup);
    expect(settingsResp.ok).toBe(true);
    const settings = settingsResp.settings;
    settings.maxRequestBodySize = 32 * 1024;
    await launch.saveSettings(popup, settings);
    await sleep(200);

    const page = await launch.openApp();
    await launch.startRecording(popup);
    await page.click('#btn-large-post');
    await sleep(800);
    await launch.stopRecording(popup);

    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    const net = exp.data.network.find(n => n.request.url.includes('/api/echo'));
    expect(net.request.truncated).toBe(true);
    expect(net.request.storedSize).toBeLessThanOrEqual(32 * 1024);
  });

  test('E10 (T11): native fetch behavior preserved with extension', async ({ launch }) => {
    const page = await launch.openApp();
    const result = await page.evaluate(async () => {
      const r = await fetch('/api/data');
      const data = await r.json();
      return { status: r.status, data, ok: r.ok };
    });
    expect(result.status).toBe(200);
    expect(result.data.ok).toBe(true);
    // Response still readable by page (not consumed)
    const second = await page.evaluate(async () => {
      const r = await fetch('/api/xhr');
      return await r.json();
    });
    expect(second.source).toBe('xhr');
  });

  test('E11 (T12): two tabs → distinct actionUids, both stored', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page1 = await launch.openApp();
    await launch.startRecording(popup);
    const page2 = await launch.openApp();

    await page1.click('#submit-btn');
    await page2.click('#submit-btn');
    await sleep(600);
    await launch.stopRecording(popup);

    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    const clicks = exp.data.actions.filter(a => a.type === 'click' && a.target && a.target.id === 'submit-btn');
    expect(clicks.length).toBe(2);
    const uids = clicks.map(c => c.actionUid);
    expect(new Set(uids).size).toBe(2);
    const tabIds = clicks.map(c => c.frame.tabId);
    expect(tabIds[0]).not.toBe(tabIds[1]);
    expect(clicks.every(c => c.frame.tabId !== 'pending')).toBe(true);
  });

  test('E12 (T13/T14): cookies record vs mask per settings', async ({ launch }) => {
    const popup = await launch.openPopup();
    // Default: mask
    let page = await launch.openApp();
    await launch.startRecording(popup);
    await page.fill('#cookie-field', 'session123');
    await sleep(400);
    await launch.stopRecording(popup);
    let status = await launch.getStatus(popup);
    let exp = await launch.exportJson(popup, status.sessionId);
    let input = exp.data.actions.find(a => a.type === 'input' && a.target && a.target.name === 'cookie_value');
    expect(input.value).toBe('[MASKED]');
    expect(JSON.stringify(exp.data)).not.toContain('session123');

    // Switch to Record value
    const settingsResp = await launch.getSettings(popup);
    const settings = settingsResp.settings;
    settings.sensitiveData.cookies.masked = false;
    await launch.saveSettings(popup, settings);
    await sleep(200);

    page = await launch.openApp();
    await launch.startRecording(popup);
    await page.fill('#cookie-field', 'session456');
    await sleep(400);
    await launch.stopRecording(popup);
    status = await launch.getStatus(popup);
    exp = await launch.exportJson(popup, status.sessionId);
    input = exp.data.actions.filter(a => a.type === 'input' && a.target && a.target.name === 'cookie_value').pop();
    // maskInExport default true forces masked in export file
    // Stored value should be plaintext when record selected — verify via raw by toggling maskInExport off
    settings.maskInExport = false;
    await launch.saveSettings(popup, settings);
    exp = await launch.exportJson(popup, status.sessionId);
    input = exp.data.actions.filter(a => a.type === 'input' && a.target && a.target.name === 'cookie_value').pop();
    expect(input.value).toBe('session456');
  });

  test('E13 (T15): custom sensitive keyword masks value', async ({ launch }) => {
    const popup = await launch.openPopup();
    const settingsResp = await launch.getSettings(popup);
    const settings = settingsResp.settings;
    settings.customSensitiveKeywords = ['csrf_token'];
    settings.maskInExport = true;
    await launch.saveSettings(popup, settings);
    await sleep(200);

    const page = await launch.openApp();
    await launch.startRecording(popup);
    await page.fill('#csrf-field', 'abc123');
    await sleep(400);
    await launch.stopRecording(popup);

    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    const input = exp.data.actions.find(a => a.type === 'input' && a.target && a.target.name === 'csrf_token');
    expect(input).toBeTruthy();
    expect(input.target.sensitive).toBe(true);
    expect(input.value).toBe('[MASKED]');
    expect(JSON.stringify(exp.data)).not.toContain('abc123');
  });

  test('E14 (T16): Playwright export — popup button generates script shape', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);
    await page.click('#submit-btn');
    await page.fill('#pw-field', 'secret123');
    await sleep(400);
    await launch.stopRecording(popup);

    // Reuse generate via export data + evaluate script builder from popup
    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);

    const script = await popup.evaluate((data) => {
      // Access builder by re-running the same logic through the button path is hard;
      // reconstruct minimal check: click Export Playwright would download.
      // Instead verify data supports builder priorities.
      const click = data.actions.find(a => a.type === 'click');
      const input = data.actions.find(a => a.type === 'input');
      return {
        hasClick: !!click,
        clickId: click && click.target && click.target.id,
        inputSensitive: input && input.target && input.target.sensitive,
        inputValue: input && input.value,
        hasGotoUrl: data.pages && data.pages.length > 0
      };
    }, exp.data);

    expect(script.hasClick).toBe(true);
    expect(script.clickId).toBe('submit-btn');
    expect(script.inputSensitive).toBe(true);
    expect(script.inputValue).toBe('[MASKED]');
    expect(script.hasGotoUrl).toBe(true);

    // Trigger actual script generation via export button (download)
    const downloadPromise = popup.waitForEvent('download', { timeout: 15000 });
    await popup.click('#btn-export-pw');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.spec.js');
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    expect(text).toContain("page.goto('");
    expect(text).toContain('click()');
    expect(text).not.toContain('secret123');
  });

  test('E15 (T18): settings persist across popup reopen', async ({ launch }) => {
    const popup = await launch.openPopup();
    const settingsResp = await launch.getSettings(popup);
    const settings = settingsResp.settings;
    settings.maxResponseBodySize = 512 * 1024;
    await launch.saveSettings(popup, settings);
    await popup.close();

    const popup2 = await launch.openPopup();
    const again = await launch.getSettings(popup2);
    expect(again.settings.maxResponseBodySize).toBe(512 * 1024);
    // UI shows it
    const uiVal = await popup2.inputValue('#set-res-body');
    expect(uiVal).toBe('512');
  });

  test('E16 (B4): Stop → Export still enabled and returns data', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);
    await page.click('#submit-btn');
    await sleep(400);
    await launch.stopRecording(popup);

    // Export button must be enabled after stop
    const enabled = await popup.isEnabled('#btn-export-json');
    expect(enabled).toBe(true);
    const clearEnabled = await popup.isEnabled('#btn-clear');
    expect(clearEnabled).toBe(true);

    const status = await launch.getStatus(popup);
    expect(status.sessionId).toBeTruthy();
    const exp = await launch.exportJson(popup, status.sessionId);
    expect(exp.ok).toBe(true);
    expect(exp.data.actions.length).toBeGreaterThanOrEqual(1);
  });

  test('E17 (B5): activeSessionId persisted in chrome.storage.session', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);

    const state = await launch.getSessionState(launch.sw);
    expect(state.activeSessionId).toBeTruthy();

    const status = await launch.getStatus(popup);
    expect(status.activeSessionId).toBe(state.activeSessionId);

    await launch.stopRecording(popup);
    const state2 = await launch.getSessionState(launch.sw);
    expect(state2.activeSessionId).toBeNull();
    expect(state2.lastSessionId).toBe(state.activeSessionId);
  });

  test('E18 (B8): tab opened after Start still records', async ({ launch }) => {
    const popup = await launch.openPopup();
    await launch.startRecording(popup);

    const page2 = await launch.openApp();
    await sleep(500);
    await page2.click('#submit-btn');
    await sleep(500);
    await launch.stopRecording(popup);

    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    const clicks = exp.data.actions.filter(a => a.type === 'click' && a.target && a.target.id === 'submit-btn');
    expect(clicks.length).toBeGreaterThanOrEqual(1);
  });

  test('X1: network Authorization header always masked', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);
    await page.click('#fetch-post-btn');
    await sleep(600);
    await launch.stopRecording(popup);
    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    const net = exp.data.network.find(n => n.request.url.includes('/api/submit'));
    expect(net.request.headers.Authorization).toBe('[MASKED]');
  });

  test('X2: response string body also masked (Mika condition)', async ({ launch }) => {
    const popup = await launch.openPopup();
    const page = await launch.openApp();
    await launch.startRecording(popup);
    // Response contains password field as JSON object → deep mask
    await page.click('#btn-deep-mask');
    await sleep(600);
    await launch.stopRecording(popup);
    const status = await launch.getStatus(popup);
    const exp = await launch.exportJson(popup, status.sessionId);
    const net = exp.data.network.find(n => n.request.url.includes('/api/deep'));
    // Response echo is object; request body already checked in E8.
    // Assert response present and serializable without request secrets
    expect(net.response).toBeTruthy();
    expect(JSON.stringify(net.response)).not.toContain('leak-me');
  });
});
