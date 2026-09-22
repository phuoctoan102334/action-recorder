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
      const arrow = hidden ? '\u25BE' : '\u25B8';
      header.textContent = header.textContent.replace(/[\u25B8\u25BE]$/, arrow);
    }
  });
});

function generateSessionId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function updateRecordingUI(isRecording) {
  if (isRecording) {
    statusDot.className = 'status-dot on';
    statusText.textContent = 'Recording ON';
    sessionIdEl.textContent = activeSessionId || '\u2014';
    helperText.style.display = 'block';
    btnStart.disabled = true;
    btnStop.disabled = false;
  } else {
    statusDot.className = 'status-dot off';
    statusText.textContent = 'Recording OFF';
    helperText.style.display = 'none';
    btnStart.disabled = false;
    btnStop.disabled = true;
    actionCount = 0;
    networkCount = 0;
    actionCountEl.textContent = '0';
    networkCountEl.textContent = '0';
    sessionIdEl.textContent = '\u2014';
    updateExportButtons();
  }
}

function updateExportButtons() {
  const hasData = actionCount > 0 || networkCount > 0;
  btnExportJson.disabled = !hasData;
  btnExportPw.disabled = !hasData;
  btnClear.disabled = !hasData;
}

function loadSettings(settings) {
  const sd = settings.sensitiveData || {};
  ['authorization', 'cookies', 'apikeys', 'accesstokens', 'refreshtokens'].forEach(key => {
    const settingKey = key === 'apikeys' ? 'apiKeys' : key === 'accesstokens' ? 'accessTokens' : key === 'refreshtokens' ? 'refreshTokens' : key;
    if (sd[settingKey]) {
      const v = sd[settingKey].masked ? 'mask' : 'record';
      const radio = $(`input[name="sens-${key}"][value="${v}"]`);
      if (radio) radio.checked = true;
    }
  });

  $('#set-network').checked = settings.captureNetworkRequests !== false;
  $('#set-iframes').checked = settings.captureIframes !== false;
  $('#set-async-context').checked = settings.asyncContextPropagation === true;
  $('#set-mask-export').checked = settings.maskInExport !== false;
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
  return {
    captureUIEvents: true,
    captureNetworkRequests: $('#set-network').checked,
    captureWebSocket: false,
    captureSPANavigation: false,
    captureIframes: $('#set-iframes').checked,
    maxRequestBodySize: Math.max(16, Math.min(256, parseInt($('#set-req-body').value) || 64)) * 1024,
    maxResponseBodySize: Math.max(64, Math.min(1024, parseInt($('#set-res-body').value) || 256)) * 1024,
    maxOuterHTML: Math.max(500, Math.min(5000, parseInt($('#set-outer-html').value) || 2000)),
    maxText: Math.max(1000, Math.min(20000, parseInt($('#set-text').value) || 5000)),
    sensitiveData: {
      passwords: { masked: true, locked: true },
      creditCards: { masked: true, locked: true },
      authorization: { masked: $('input[name="sens-authorization"]:checked').value === 'mask', locked: false },
      cookies: { masked: $('input[name="sens-cookies"]:checked').value === 'mask', locked: false },
      apiKeys: { masked: $('input[name="sens-apikeys"]:checked').value === 'mask', locked: false },
      accessTokens: { masked: $('input[name="sens-accesstokens"]:checked').value === 'mask', locked: false },
      refreshTokens: { masked: $('input[name="sens-refreshtokens"]:checked').value === 'mask', locked: false }
    },
    customSensitiveKeywords: customKeywords,
    asyncContextPropagation: $('#set-async-context').checked,
    exportFormat: $('input[name="export-format"]:checked').value,
    maskInExport: $('#set-mask-export').checked
  };
}

function renderKeywordTags() {
  keywordTags.innerHTML = '';
  customKeywords.forEach((kw, i) => {
    const tag = document.createElement('span');
    tag.className = 'keyword-tag';
    const txt = document.createTextNode(kw + ' ');
    tag.appendChild(txt);
    const remove = document.createElement('span');
    remove.className = 'remove';
    remove.dataset.index = i;
    remove.textContent = '\u00D7';
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

function buildPlaywrightSelector(target) {
  if (!target) return 'body';
  const c = target.cssSelectorCandidates || [];
  if (c.length > 0) return c[0];
  if (target.id) return '#' + target.id;
  if (target.tag) return target.tag;
  return 'body';
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
    lines.push("  await page.goto('" + url + "');");
    for (const action of pages[url]) {
      const sel = buildPlaywrightSelector(action.target);
      if (action.type === 'click') {
        lines.push("  await page.locator('" + sel + "').click();");
      } else if (action.type === 'input' || action.type === 'change') {
        if (action.value != null) {
          const val = String(action.value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          lines.push("  await page.locator('" + sel + "').fill('" + val + "');");
        }
      } else if (action.type === 'keydown') {
        if (action.keyInfo && action.keyInfo.key) {
          lines.push("  await page.keyboard.press('" + action.keyInfo.key + "');");
        }
      }
    }
  }
  lines.push("});");
  return lines.join("\n");
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
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'START_RECORDING',
          source: MS,
          version: MV,
          payload: { sessionId: activeSessionId }
        }).catch(() => {});
      }
    });
    updateRecordingUI(true);
  });
});

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'SESSION_STOP',
    source: MS,
    version: MV,
    payload: { sessionId: activeSessionId, endedAt: Date.now() }
  }, () => {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'STOP_RECORDING',
          source: MS,
          version: MV,
          payload: { sessionId: activeSessionId }
        }).catch(() => {});
      }
    });
    updateRecordingUI(false);
  });
});

btnClear.addEventListener('click', () => {
  if (!activeSessionId) return;
  if (!confirm('Clear all recorded data for this session?')) return;
  chrome.runtime.sendMessage({ type: 'DELETE_SESSION', sessionId: activeSessionId }, () => {
    updateRecordingUI(false);
  });
});

btnCopySession.addEventListener('click', () => {
  const text = sessionIdEl.textContent;
  if (text && text !== '\u2014') {
    navigator.clipboard.writeText(text).then(() => {
      btnCopySession.textContent = '\u2705';
      setTimeout(() => { btnCopySession.textContent = '\uD83D\uDCCB'; }, 1500);
    });
  }
});

btnExportJson.addEventListener('click', () => {
  if (!activeSessionId) return;
  chrome.runtime.sendMessage({ type: 'EXPORT_JSON', sessionId: activeSessionId }, (resp) => {
    if (resp && resp.ok) downloadJSON(resp.data, 'action-recorder-' + activeSessionId + '.json');
  });
});

btnExportPw.addEventListener('click', () => {
  if (!activeSessionId) return;
  chrome.runtime.sendMessage({ type: 'EXPORT_JSON', sessionId: activeSessionId }, (resp) => {
    if (resp && resp.ok) {
      const script = generatePlaywrightScript(resp.data);
      downloadText(script, 'action-recorder-' + activeSessionId + '.spec.js');
    }
  });
});

btnSave.addEventListener('click', () => {
  const settings = collectSettings();
  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, (resp) => {
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
    const idx = parseInt(e.target.dataset.index);
    customKeywords.splice(idx, 1);
    renderKeywordTags();
  }
});

// Listen for messages from background to update counters
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.source === MS && msg.version === MV) {
    if (msg.type === 'ACTION_RECORDED') {
      actionCount++;
      actionCountEl.textContent = actionCount;
      updateExportButtons();
    } else if (msg.type === 'NETWORK_EVENT') {
      networkCount++;
      networkCountEl.textContent = networkCount;
      updateExportButtons();
    }
  }
});

// Initialize on load
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (response && response.activeSessionId) {
    activeSessionId = response.activeSessionId;
    updateRecordingUI(true);
  }
});

chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
  if (response && response.ok) {
    loadSettings(response.settings);
  }
});
