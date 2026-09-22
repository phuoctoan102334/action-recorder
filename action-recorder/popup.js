/**
 * popup.js — Popup UI logic for Action Recorder.
 */

const MS = 'ACTION_RECORDER';
const MV = 1;
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const statusDot = $('#status-dot');
const statusText = $('#status-text');
const sessionIdEl = $('#session-id');
const actionCountEl = $('#action-count');
const networkCountEl = $('#network-count');
const helperText = $('#helper-text');
const btnStart = $('#btn-start');
const btnStop = $('#btn-stop');
const btnExportJson = $('#btn-export-json');
const btnExportPw = $('#btn-export-pw');
const btnClear = $('#btn-clear');
const btnCopySession = $('#copy-session');
const btnSave = $('#btn-save-settings');
const btnReset = $('#btn-reset-settings');
const btnAddKeyword = $('#btn-add-keyword');
const keywordInput = $('#custom-keyword-input');
const keywordTags = $('#keyword-tags');

let activeSessionId = null;
let isRecording = false;
let actionCount = 0;
let networkCount = 0;
let customKeywords = [];

$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    $(`#tab-${tab.dataset.tab}`).classList.add('active');
  });
});

$$('.section-header').forEach(header => {
  header.addEventListener('click', () => {
    const section = $(`#section-${header.dataset.toggle}`);
    if (section) {
      const hidden = section.style.display === 'none';
      section.style.display = hidden ? 'block' : 'none';
      const arrow = hidden ? '▾' : '▸';
      header.textContent = header.textContent.replace(/[▸▾]$/, arrow);
    }
  });
});

function generateSessionId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function renderCounters() {
  actionCountEl.textContent = String(actionCount);
  networkCountEl.textContent = String(networkCount);
  updateExportButtons();
}

function updateRecordingUI(recording) {
  isRecording = recording;
  if (recording) {
    statusDot.className = 'status-dot on';
    statusText.textContent = 'Recording ON';
    sessionIdEl.textContent = activeSessionId || '—';
    helperText.style.display = 'block';
    btnStart.disabled = true;
    btnStop.disabled = false;
  } else {
    statusDot.className = 'status-dot off';
    statusText.textContent = 'Recording OFF';
    helperText.style.display = 'none';
    btnStart.disabled = false;
    btnStop.disabled = true;
    // Keep counters + session id after stop so Export/Clear stay usable (B4)
    if (activeSessionId) {
      sessionIdEl.textContent = activeSessionId;
    }
  }
  renderCounters();
}

function updateExportButtons() {
  const hasData = actionCount > 0 || networkCount > 0;
  btnExportJson.disabled = !hasData || !activeSessionId;
  btnExportPw.disabled = !hasData || !activeSessionId;
  btnClear.disabled = !hasData || !activeSessionId;
}

function loadSettings(settings) {
  if (!settings) return;
  const sd = settings.sensitiveData || {};
  ['authorization', 'cookies', 'apikeys', 'accesstokens', 'refreshtokens'].forEach(key => {
    const settingKey = key === 'apikeys' ? 'apiKeys' : key === 'accesstokens' ? 'accessTokens' : key === 'refreshtokens' ? 'refreshTokens' : key;
    if (sd[settingKey]) {
      const v = sd[settingKey].masked ? 'mask' : 'record';
      const radio = $(`input[name="sens-${key}"][value="${v}"]`);
      if (radio) radio.checked = true;
    }
  });

  const net = $('#set-network');
  if (net) net.checked = settings.captureNetworkRequests !== false;
  const ifr = $('#set-iframes');
  if (ifr) ifr.checked = settings.captureIframes !== false;
  const ac = $('#set-async-context');
  if (ac) ac.checked = settings.asyncContextPropagation === true;
  const me = $('#set-mask-export');
  if (me) me.checked = settings.maskInExport !== false;
  const fmt = $('input[name="export-format"][value="' + (settings.exportFormat || 'json') + '"]');
  if (fmt) fmt.checked = true;

  if (settings.maxRequestBodySize) $('#set-req-body').value = Math.round(settings.maxRequestBodySize / 1024);
  if (settings.maxResponseBodySize) $('#set-res-body').value = Math.round(settings.maxResponseBodySize / 1024);
  if (settings.maxOuterHTML) $('#set-outer-html').value = settings.maxOuterHTML;
  if (settings.maxText) $('#set-text').value = settings.maxText;

  customKeywords = settings.customSensitiveKeywords || [];
  renderKeywordTags();
}

function collectSettings() {
  const checked = (name) => {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : 'mask';
  };
  return {
    captureUIEvents: true,
    captureNetworkRequests: $('#set-network').checked,
    captureWebSocket: false,
    captureSPANavigation: false,
    captureIframes: $('#set-iframes').checked,
    maxRequestBodySize: Math.max(16, Math.min(256, parseInt($('#set-req-body').value, 10) || 64)) * 1024,
    maxResponseBodySize: Math.max(64, Math.min(1024, parseInt($('#set-res-body').value, 10) || 256)) * 1024,
    maxOuterHTML: Math.max(500, Math.min(5000, parseInt($('#set-outer-html').value, 10) || 2000)),
    maxText: Math.max(1000, Math.min(20000, parseInt($('#set-text').value, 10) || 5000)),
    sensitiveData: {
      passwords: { masked: true, locked: true },
      creditCards: { masked: true, locked: true },
      authorization: { masked: checked('sens-authorization') === 'mask', locked: false },
      cookies: { masked: checked('sens-cookies') === 'mask', locked: false },
      apiKeys: { masked: checked('sens-apikeys') === 'mask', locked: false },
      accessTokens: { masked: checked('sens-accesstokens') === 'mask', locked: false },
      refreshTokens: { masked: checked('sens-refreshtokens') === 'mask', locked: false }
    },
    customSensitiveKeywords: customKeywords,
    asyncContextPropagation: $('#set-async-context').checked,
    exportFormat: (document.querySelector('input[name="export-format"]:checked') || { value: 'json' }).value,
    maskInExport: $('#set-mask-export').checked
  };
}

function renderKeywordTags() {
  keywordTags.innerHTML = '';
  customKeywords.forEach((kw, i) => {
    const tag = document.createElement('span');
    tag.className = 'keyword-tag';
    tag.appendChild(document.createTextNode(kw + ' '));
    const remove = document.createElement('span');
    remove.className = 'remove';
    remove.dataset.index = String(i);
    remove.textContent = '×';
    tag.appendChild(remove);
    keywordTags.appendChild(tag);
  });
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return String(value).replace(/[^\w-]/g, ch => '\\' + ch);
}

function implicitRole(target) {
  const tag = target.tag;
  const attrs = target.attributes || {};
  if (attrs.role) return attrs.role;
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const type = attrs.type || 'text';
    if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'search') return 'searchbox';
    if (type === 'email' || type === 'url' || type === 'tel' || type === 'password' || type === 'text') return 'textbox';
  }
  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') return 'heading';
  return null;
}

function escapeJs(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** SPEC §17 selector priority: data-testid → role/name → label → name → id → stable CSS → XPath */
function buildPlaywrightLocator(action) {
  const t = action.target;
  if (!t) return "page.locator('body')";
  const attrs = t.attributes || {};

  if (attrs['data-testid']) return `page.getByTestId('${escapeJs(attrs['data-testid'])}')`;
  if (attrs['data-test']) return `page.locator('[data-test="${cssEscape(attrs['data-test'])}"]')`;
  if (attrs['data-cy']) return `page.locator('[data-cy="${cssEscape(attrs['data-cy'])}"]')`;

  const role = implicitRole(t);
  const name = (t.innerText && t.innerText.slice(0, 80).trim()) || attrs['aria-label'] || null;
  if (role && name) {
    return `page.getByRole('${role}', { name: '${escapeJs(name)}' })`;
  }
  if (attrs['aria-label']) return `page.getByLabel('${escapeJs(attrs['aria-label'])}')`;
  if (t.name) return `page.locator('${escapeJs(`${t.tag}[name="${t.name}"]`)}')`;
  if (t.id) return `page.locator('#${cssEscape(t.id)}')`;
  if (t.cssSelectorCandidates && t.cssSelectorCandidates.length > 0) {
    return `page.locator('${escapeJs(t.cssSelectorCandidates[0])}')`;
  }
  if (t.xpath) return `page.locator('xpath=${escapeJs(t.xpath)}')`;
  if (t.domPath && t.domPath.length > 0) {
    return `page.locator('${escapeJs('/' + t.domPath.join('/'))}')`;
  }
  return "page.locator('body')";
}

function valueForExport(action) {
  if (action.value == null) return null;
  if (action.target && action.target.sensitive) {
    return action.value === '[MASKED]' ? null : action.value;
  }
  return action.value;
}

function generatePlaywrightScript(data) {
  const lines = [];
  lines.push("const { test, expect } = require('@playwright/test');");
  lines.push("");
  lines.push("test('recorded session', async ({ page }) => {");
  const pages = {};
  for (const action of data.actions || []) {
    const url = (action.page && action.page.url) || 'about:blank';
    if (!pages[url]) pages[url] = [];
    pages[url].push(action);
  }
  for (const url of Object.keys(pages)) {
    lines.push(`  await page.goto('${escapeJs(url)}');`);
    for (const action of pages[url]) {
      const loc = buildPlaywrightLocator(action);
      if (action.type === 'click') {
        lines.push(`  await ${loc}.click();`);
      } else if (action.type === 'input' || action.type === 'change') {
        const raw = valueForExport(action);
        if (raw != null && typeof raw !== 'boolean') {
          const val = escapeJs(String(raw));
          lines.push(`  await ${loc}.fill('${val}');`);
        } else if (action.target && action.target.sensitive) {
          lines.push(`  await ${loc}.fill(process.env.SECRET_VALUE || '');`);
        } else if (typeof raw === 'boolean') {
          lines.push(`  await ${loc}.setChecked(${raw});`);
        }
      } else if (action.type === 'keydown') {
        if (action.keyInfo && action.keyInfo.key) {
          lines.push(`  await page.keyboard.press('${escapeJs(action.keyInfo.key)}');`);
        }
      } else if (action.type === 'submit') {
        lines.push(`  await ${loc}.press('Enter');`);
      }
    }
  }
  lines.push("});");
  return lines.join('\n');
}

// ─── Event Listeners ───

btnStart.addEventListener('click', () => {
  activeSessionId = generateSessionId();
  actionCount = 0;
  networkCount = 0;
  chrome.runtime.sendMessage({
    type: 'SESSION_START',
    source: MS,
    version: MV,
    payload: { sessionId: activeSessionId, startedAt: Date.now() }
  }, () => {
    void chrome.runtime.lastError;
    updateRecordingUI(true);
  });
});

btnStop.addEventListener('click', () => {
  if (!activeSessionId) return;
  const sid = activeSessionId;
  chrome.runtime.sendMessage({
    type: 'SESSION_STOP',
    source: MS,
    version: MV,
    payload: { sessionId: sid, endedAt: Date.now() }
  }, () => {
    void chrome.runtime.lastError;
    // Keep counters and activeSessionId so export still works (B4)
    updateRecordingUI(false);
  });
});

btnClear.addEventListener('click', () => {
  if (!activeSessionId) return;
  if (!confirm('Clear all recorded data for this session?')) return;
  const sid = activeSessionId;
  chrome.runtime.sendMessage({ type: 'DELETE_SESSION', sessionId: sid }, (resp) => {
    void chrome.runtime.lastError;
    if (resp && resp.ok) {
      actionCount = 0;
      networkCount = 0;
      activeSessionId = null;
      sessionIdEl.textContent = '—';
      updateRecordingUI(false);
    }
  });
});

btnCopySession.addEventListener('click', () => {
  const text = sessionIdEl.textContent;
  if (text && text !== '—') {
    navigator.clipboard.writeText(text).then(() => {
      btnCopySession.textContent = '✅';
      setTimeout(() => { btnCopySession.textContent = '📋'; }, 1500);
    });
  }
});

btnExportJson.addEventListener('click', () => {
  if (!activeSessionId) return;
  chrome.runtime.sendMessage({ type: 'EXPORT_JSON', sessionId: activeSessionId }, (resp) => {
    void chrome.runtime.lastError;
    if (resp && resp.ok && resp.data) {
      downloadJSON(resp.data, 'action-recorder-' + activeSessionId + '.json');
    }
  });
});

btnExportPw.addEventListener('click', () => {
  if (!activeSessionId) return;
  chrome.runtime.sendMessage({ type: 'EXPORT_JSON', sessionId: activeSessionId }, (resp) => {
    void chrome.runtime.lastError;
    if (resp && resp.ok && resp.data) {
      const script = generatePlaywrightScript(resp.data);
      downloadText(script, 'action-recorder-' + activeSessionId + '.spec.js');
    }
  });
});

btnSave.addEventListener('click', () => {
  const settings = collectSettings();
  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, (resp) => {
    void chrome.runtime.lastError;
    if (resp && resp.ok) {
      btnSave.textContent = 'Saved!';
      setTimeout(() => { btnSave.textContent = 'Save Settings'; }, 1500);
    }
  });
});

btnReset.addEventListener('click', () => {
  if (!confirm('Reset all settings to defaults?')) return;
  const defaults = {
    captureUIEvents: true, captureNetworkRequests: true, captureWebSocket: false,
    captureSPANavigation: false, captureIframes: true,
    maxRequestBodySize: 65536, maxResponseBodySize: 262144,
    maxOuterHTML: 2000, maxText: 5000,
    sensitiveData: {
      passwords: { masked: true, locked: true }, creditCards: { masked: true, locked: true },
      authorization: { masked: true, locked: false }, cookies: { masked: true, locked: false },
      apiKeys: { masked: true, locked: false }, accessTokens: { masked: true, locked: false },
      refreshTokens: { masked: true, locked: false }
    },
    customSensitiveKeywords: [], asyncContextPropagation: false,
    exportFormat: 'json', maskInExport: true
  };
  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: defaults }, () => {
    void chrome.runtime.lastError;
    loadSettings(defaults);
  });
});

btnAddKeyword.addEventListener('click', () => {
  const kw = keywordInput.value.trim();
  if (kw && customKeywords.indexOf(kw) === -1) {
    customKeywords.push(kw);
    renderKeywordTags();
    keywordInput.value = '';
  }
});

keywordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnAddKeyword.click();
});

keywordTags.addEventListener('click', (e) => {
  if (e.target.classList.contains('remove')) {
    const idx = parseInt(e.target.dataset.index, 10);
    customKeywords.splice(idx, 1);
    renderKeywordTags();
  }
});

// Live counters while popup is open (messages forwarded by relay → runtime broadcast)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.source === MS && msg.version === MV && isRecording) {
    if (msg.type === 'ACTION_RECORDED') {
      actionCount++;
      renderCounters();
    } else if (msg.type === 'NETWORK_EVENT') {
      networkCount++;
      renderCounters();
    }
  }
});

// Initialize: status + counts from background (B4/B5)
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (chrome.runtime.lastError || !response) return;
  if (response.actionCount != null) actionCount = response.actionCount;
  if (response.networkCount != null) networkCount = response.networkCount;
  if (response.activeSessionId) {
    activeSessionId = response.activeSessionId;
    updateRecordingUI(true);
  } else if (response.sessionId) {
    activeSessionId = response.sessionId;
    updateRecordingUI(false);
  } else {
    updateRecordingUI(false);
  }
});

chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
  if (chrome.runtime.lastError || !response) return;
  if (response.ok) loadSettings(response.settings);
});
