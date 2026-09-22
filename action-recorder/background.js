/**
 * background.js — Service Worker.
 * Single onMessage dispatcher: relay protocol + popup commands.
 * Validates, masks, persists to IndexedDB.
 */

import {
  deepMaskJSON, maskHeaders, maskBodyValue
} from './masking.js';
import {
  openDB, saveSession, getSession, getAllSessions, deleteSession,
  saveAction, saveActions, getActionsBySession, countActionsBySession,
  saveNetworkEvent, getNetworkEventsBySession, countNetworkEventsBySession
} from './db.js';

// ─── Settings ───

const DEFAULT_SETTINGS = {
  captureUIEvents: true,
  captureNetworkRequests: true,
  captureWebSocket: false,
  captureSPANavigation: false,
  captureIframes: true,
  maxRequestBodySize: 64 * 1024,
  maxResponseBodySize: 256 * 1024,
  maxOuterHTML: 2000,
  maxText: 5000,
  sensitiveData: {
    passwords: { masked: true, locked: true },
    creditCards: { masked: true, locked: true },
    authorization: { masked: true, locked: false },
    cookies: { masked: true, locked: false },
    apiKeys: { masked: true, locked: false },
    accessTokens: { masked: true, locked: false },
    refreshTokens: { masked: true, locked: false }
  },
  customSensitiveKeywords: [],
  asyncContextPropagation: false,
  exportFormat: 'json',
  maskInExport: true
};

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get('settings', (result) => {
      resolve(result.settings || DEFAULT_SETTINGS);
    });
  });
}

async function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ settings }, resolve);
  });
}

function asKeywordSet(list) {
  return new Set((list || []).map(k => String(k).trim()).filter(Boolean));
}

// ─── User Record Keys ───

function getUserRecordKeys(settings) {
  const keys = new Set();
  const sd = settings.sensitiveData || {};
  const addNorm = (k) => keys.add(k.toLowerCase().replace(/[-_\s]/g, ''));
  if (!sd.authorization?.masked) { addNorm('authorization'); addNorm('auth'); keys.add('authorization'); keys.add('auth'); }
  if (!sd.cookies?.masked) { addNorm('cookie'); addNorm('cookies'); keys.add('cookie'); keys.add('cookies'); }
  if (!sd.apiKeys?.masked) { addNorm('api_key'); addNorm('apikey'); keys.add('api_key'); keys.add('apikey'); keys.add('api-key'); }
  if (!sd.accessTokens?.masked) { addNorm('access_token'); addNorm('accesstoken'); keys.add('access_token'); keys.add('accesstoken'); }
  if (!sd.refreshTokens?.masked) { addNorm('refresh_token'); addNorm('refreshtoken'); keys.add('refresh_token'); keys.add('refreshtoken'); }
  return keys;
}

// ─── Session state (chrome.storage.session — survives SW restarts) ───

async function readSessionState() {
  return new Promise((resolve) => {
    chrome.storage.session.get(['activeSessionId', 'lastSessionId'], (result) => {
      resolve({
        activeSessionId: result.activeSessionId || null,
        lastSessionId: result.lastSessionId || null
      });
    });
  });
}

async function writeSessionState(patch) {
  return new Promise((resolve) => {
    chrome.storage.session.set(patch, resolve);
  });
}

/**
 * Restore active session after SW restart; demote orphan sessions stuck
 * in "recording" when no activeSessionId (browser was closed mid-recording).
 */
async function initSessionState() {
  try {
    await openDB();
    const { activeSessionId } = await readSessionState();
    if (activeSessionId) {
      const session = await getSession(activeSessionId);
      if (session && session.status === 'recording') return;
      // storage has id but DB says stopped/gone → clear state
      if (!session || session.status !== 'recording') {
        await writeSessionState({ activeSessionId: null });
      }
      return;
    }
    const sessions = await getAllSessions();
    const now = Date.now();
    for (const s of sessions) {
      if (s.status === 'recording') {
        s.status = 'stopped';
        s.endedAt = s.endedAt || now;
        await saveSession(s);
      }
    }
  } catch (err) {
    console.error('initSessionState failed:', err);
  }
}

// ─── Message Validation ───

const PROTOCOL_TYPES = new Set([
  'SESSION_START', 'SESSION_STOP', 'ACTION_RECORDED', 'NETWORK_EVENT', 'GET_RECORDING_STATE'
]);

function validateMessage(msg) {
  return msg && typeof msg === 'object' &&
    msg.source === 'ACTION_RECORDER' && msg.version === 1 &&
    PROTOCOL_TYPES.has(msg.type) && msg.payload;
}

function validateAction(a) {
  return a && a.sessionId && a.actionUid && a.timestamp && a.type;
}

function validateNetworkEvent(e) {
  return e && e.sessionId && e.timestamp && e.source;
}

// ─── Action value masking (B1) ───

function categorizeSensitiveTarget(target) {
  if (!target) return null;
  const tagAttrs = [target.name, target.id, target.attributes?.name, target.attributes?.id,
    target.attributes?.autocomplete, target.attributes?.['aria-label'], target.attributes?.placeholder,
    target.attributes?.type]
    .filter(Boolean).join(' ').toLowerCase();

  if (target.attributes?.type === 'password' || /pass(word|wd)|\bpwd\b/.test(tagAttrs)) return 'passwords';
  if (/credit|card_number|cardnumber|cc-number|cvv|cvc/.test(tagAttrs)) return 'creditCards';
  if (/authoriz|^auth$|_auth\b/.test(tagAttrs)) return 'authorization';
  if (/cookie/.test(tagAttrs)) return 'cookies';
  if (/api[_-]?key|apikey/.test(tagAttrs)) return 'apiKeys';
  if (/access[_-]?token|accesstoken/.test(tagAttrs)) return 'accessTokens';
  if (/refresh[_-]?token|refreshtoken/.test(tagAttrs)) return 'refreshTokens';
  return null;
}

function maskActionValue(action, settings, customKeywords) {
  const value = action.value;
  if (value === null || value === undefined) return value;
  if (value === '[MASKED]') return value;
  const target = action.target;
  if (!target || !target.sensitive) return value;

  const cat = categorizeSensitiveTarget(target);
  // Locked categories: always mask regardless of settings
  if (cat === 'passwords' || cat === 'creditCards') return '[MASKED]';

  if (cat && settings.sensitiveData?.[cat]) {
    const cfg = settings.sensitiveData[cat];
    if (cfg.locked) return '[MASKED]';
    return cfg.masked === false ? value : '[MASKED]';
  }

  // Sensitive but uncategorized (custom keyword / generic hit) → mask
  void customKeywords;
  return '[MASKED]';
}

// ─── Buffers ───

let actionBuffer = [];
let networkBuffer = [];
let bufferTimer = null;
// pending actionUid → final actionUid (sessionId:pending:N → sessionId:tabId:frameId:N)
const pendingUidMap = new Map();

function resolveCausedBy(uid) {
  if (!uid) return uid;
  if (pendingUidMap.has(uid)) return pendingUidMap.get(uid);
  if (uid.includes(':pending:')) {
    // leave unresolved (shouldn't normally happen)
    return uid;
  }
  return uid;
}

function flushBuffers() {
  const pending = [];
  if (actionBuffer.length > 0) {
    const batch = actionBuffer.splice(0);
    pending.push(saveActions(batch).catch(err => console.error('Failed to save actions:', err)));
  }
  if (networkBuffer.length > 0) {
    const batch = networkBuffer.splice(0);
    for (const e of batch) {
      pending.push(saveNetworkEvent(e).catch(err => console.error('Failed to save network event:', err)));
    }
  }
  if (bufferTimer) { clearTimeout(bufferTimer); bufferTimer = null; }
  return Promise.all(pending);
}

function scheduleFlush() {
  if (bufferTimer) return;
  bufferTimer = setTimeout(flushBuffers, 500);
}

// ─── Broadcast to tabs (B8) ───

async function broadcastToTabs(type, payload) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (e) {
    return;
  }
  for (const tab of tabs) {
    if (tab.id == null) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, {
        source: 'ACTION_RECORDER',
        version: 1,
        type,
        payload
      });
    } catch (e) {
      // Tab has no content script (chrome:// etc.) — skip
    }
  }
}

async function startBroadcast(sessionId) {
  const settings = await getSettings();
  await broadcastToTabs('START_RECORDING', { sessionId, settings });
}

async function stopBroadcast(sessionId) {
  await broadcastToTabs('STOP_RECORDING', { sessionId });
}

async function sendStateToTab(tabId) {
  const { activeSessionId } = await readSessionState();
  if (!activeSessionId) return;
  const settings = await getSettings();
  try {
    await chrome.tabs.sendMessage(tabId, {
      source: 'ACTION_RECORDER',
      version: 1,
      type: 'START_RECORDING',
      payload: { sessionId: activeSessionId, settings }
    });
  } catch (e) { /* no content script */ }
}

// ─── Protocol message handling ───

/**
 * True when the message came from a content script running in a web page
 * (echo of our own broadcast). Popup opened as a tab has sender.tab set but
 * sender.url is chrome-extension:// — those must still trigger broadcasts.
 */
function isFromPageContentScript(sender) {
  if (!sender || !sender.tab) return false;
  const url = sender.url || (sender.tab && sender.tab.url) || '';
  return !String(url).startsWith('chrome-extension://');
}

async function handleProtocolMessage(msg, sender) {
  const { type, payload } = msg;
  const settings = await getSettings();
  const userRecordKeys = getUserRecordKeys(settings);
  const customKeywords = asKeywordSet(settings.customSensitiveKeywords);

  switch (type) {
    case 'GET_RECORDING_STATE': {
      const { activeSessionId } = await readSessionState();
      if (!activeSessionId) return { ok: true, recording: false };
      return { ok: true, recording: true, sessionId: activeSessionId, settings };
    }

    case 'SESSION_START': {
      const session = {
        sessionId: payload.sessionId,
        startedAt: payload.startedAt,
        endedAt: null,
        status: 'recording'
      };
      await saveSession(session);
      await writeSessionState({ activeSessionId: payload.sessionId, lastSessionId: payload.sessionId });
      pendingUidMap.clear();
      // Broadcast unless this is an echo from a page content script (sender.url is the page, not the extension)
      if (!isFromPageContentScript(sender)) {
        await startBroadcast(payload.sessionId);
      }
      return { ok: true };
    }

    case 'SESSION_STOP': {
      const session = await getSession(payload.sessionId);
      if (session) {
        session.endedAt = payload.endedAt;
        session.status = 'stopped';
        await saveSession(session);
      }
      await flushBuffers();
      const state = await readSessionState();
      if (state.activeSessionId === payload.sessionId) {
        await writeSessionState({ activeSessionId: null, lastSessionId: payload.sessionId });
      }
      if (!isFromPageContentScript(sender)) {
        await stopBroadcast(payload.sessionId);
      }
      return { ok: true };
    }

    case 'ACTION_RECORDED': {
      if (!validateAction(payload)) return { ok: false, error: 'invalid action' };
      if (!settings.captureUIEvents) return { ok: true };
      if (sender && sender.tab) {
        const tabId = sender.tab.id;
        const frameId = sender.frameId != null ? sender.frameId : 0;
        payload.frame = payload.frame || {};
        payload.frame.tabId = tabId;
        payload.frame.frameId = frameId;
        const pendingUid = payload.actionUid;
        const finalUid = `${payload.sessionId}:${tabId}:${frameId}:${payload.actionId}`;
        payload.actionUid = finalUid;
        if (pendingUid && pendingUid !== finalUid) {
          pendingUidMap.set(pendingUid, finalUid);
        }
      }
      payload.value = maskActionValue(payload, settings, customKeywords);
      if (payload.target) {
        payload.target.sensitive = payload.target.sensitive === true;
      }
      actionBuffer.push(payload);
      scheduleFlush();
      return { ok: true };
    }

    case 'NETWORK_EVENT': {
      if (!validateNetworkEvent(payload)) return { ok: false, error: 'invalid network event' };
      if (!settings.captureNetworkRequests) return { ok: true };
      if (payload.causedByAction) {
        payload.causedByAction = resolveCausedBy(payload.causedByAction);
      }
      if (payload.request) {
        if (payload.request.headers) {
          payload.request.headers = maskHeaders(payload.request.headers, userRecordKeys, customKeywords);
        }
        if (payload.request.body !== null && payload.request.body !== undefined) {
          payload.request.body = maskBodyValue(payload.request.body, userRecordKeys, customKeywords);
        }
        payload.request.truncated = payload.request.truncated === true;
        if (payload.request.originalSize == null) payload.request.originalSize = payload.request.bodySize || 0;
        if (payload.request.storedSize == null) payload.request.storedSize = payload.request.truncated
          ? settings.maxRequestBodySize : payload.request.originalSize;
      }
      if (payload.response) {
        if (payload.response.headers) {
          payload.response.headers = maskHeaders(payload.response.headers, userRecordKeys, customKeywords);
        }
        if (payload.response.body !== null && payload.response.body !== undefined) {
          payload.response.body = maskBodyValue(payload.response.body, userRecordKeys, customKeywords);
        }
        payload.response.truncated = payload.response.truncated === true;
        if (payload.response.originalSize == null) payload.response.originalSize = payload.response.bodySize || 0;
        if (payload.response.storedSize == null) {
          payload.response.storedSize = payload.response.truncated
            ? settings.maxResponseBodySize : payload.response.originalSize;
        }
      }
      networkBuffer.push(payload);
      scheduleFlush();
      return { ok: true };
    }

    default:
      return { ok: false, error: 'unknown type' };
  }
}

// ─── Export ───

async function exportForAutomation(sessionId) {
  const settings = await getSettings();
  const session = await getSession(sessionId);
  if (!session) throw new Error('Session not found: ' + sessionId);
  const actions = await getActionsBySession(sessionId);
  const network = await getNetworkEventsBySession(sessionId);

  const sortedActions = actions.sort((a, b) => a.timestamp - b.timestamp);
  const sortedNetwork = network.sort((a, b) => a.timestamp - b.timestamp);

  // Safety net: rewrite any network causedByAction still pointing at pending uids
  const uidByActionId = new Map();
  for (const a of sortedActions) {
    if (a.actionUid && a.actionId != null) {
      uidByActionId.set(`${a.sessionId}:${a.actionId}`, a.actionUid);
    }
  }
  for (const n of sortedNetwork) {
    if (n.causedByAction && String(n.causedByAction).includes(':pending:')) {
      const parts = String(n.causedByAction).split(':');
      // sessionId:pending:actionId → sessionId:actionId
      const key = `${parts[0]}:${parts[2]}`;
      if (uidByActionId.has(key)) {
        n.causedByAction = uidByActionId.get(key);
      } else if (pendingUidMap.has(n.causedByAction)) {
        n.causedByAction = pendingUidMap.get(n.causedByAction);
      }
    }
  }

  const pages = [];
  const seen = new Set();
  for (const a of sortedActions) {
    const url = a.page && a.page.url;
    if (url && !seen.has(url)) {
      seen.add(url);
      pages.push({ url, title: (a.page && a.page.title) || '' });
    }
  }

  const emptyKeys = new Set();
  let outActions = sortedActions;
  let outNetwork = sortedNetwork;
  if (settings.maskInExport !== false) {
    outActions = sortedActions.map(a => {
      const copy = { ...a };
      if (copy.target && copy.target.sensitive && copy.value !== '[MASKED]' && copy.value != null) {
        copy.value = '[MASKED]';
      }
      return copy;
    });
    outNetwork = sortedNetwork.map(n => {
      const copy = { ...n };
      if (copy.request && copy.request.body !== undefined) {
        copy.request = { ...copy.request, body: deepMaskJSON(copy.request.body, emptyKeys, emptyKeys) };
        if (typeof copy.request.body === 'string') {
          copy.request.body = maskBodyValue(copy.request.body, emptyKeys, emptyKeys);
        }
      }
      if (copy.response && copy.response.body !== undefined) {
        copy.response = {
          ...copy.response,
          body: typeof copy.response.body === 'object'
            ? deepMaskJSON(copy.response.body, emptyKeys, emptyKeys)
            : maskBodyValue(copy.response.body, emptyKeys, emptyKeys)
        };
      }
      return copy;
    });
  }

  return {
    version: '1.0',
    session: {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      endedAt: session.endedAt
    },
    pages,
    actions: outActions,
    network: outNetwork,
    correlations: outActions.map(a => ({
      actionUid: a.actionUid,
      actionType: a.type,
      target: (a.target && a.target.tag) || 'unknown',
      networkEvents: outNetwork
        .filter(n => n.causedByAction === a.actionUid)
        .map(n => ({ url: n.request?.url, method: n.request?.method }))
    }))
  };
}

// ─── Popup commands ───

async function handlePopupCommand(msg) {
  switch (msg.type) {
    case 'GET_STATUS': {
      const state = await readSessionState();
      const sid = state.activeSessionId || state.lastSessionId;
      let actionCount = 0;
      let networkCount = 0;
      if (sid) {
        try {
          actionCount = await countActionsBySession(sid);
          networkCount = await countNetworkEventsBySession(sid);
        } catch (e) { /* DB not ready */ }
      }
      return {
        activeSessionId: state.activeSessionId,
        lastSessionId: state.lastSessionId,
        sessionId: sid,
        actionCount,
        networkCount
      };
    }
    case 'EXPORT_JSON': {
      const data = await exportForAutomation(msg.sessionId);
      return { ok: true, data };
    }
    case 'GET_SESSIONS': {
      const sessions = await getAllSessions();
      return { ok: true, sessions };
    }
    case 'DELETE_SESSION': {
      await deleteSession(msg.sessionId);
      const state = await readSessionState();
      const patch = {};
      if (state.activeSessionId === msg.sessionId) patch.activeSessionId = null;
      if (state.lastSessionId === msg.sessionId) patch.lastSessionId = null;
      if (Object.keys(patch).length) await writeSessionState(patch);
      return { ok: true };
    }
    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return { ok: true, settings };
    }
    case 'SAVE_SETTINGS': {
      await saveSettings(msg.settings);
      // Push updated settings to recording tabs (limits / captureIframes / keywords)
      const { activeSessionId } = await readSessionState();
      if (activeSessionId) {
        await startBroadcast(activeSessionId);
      }
      return { ok: true };
    }
    default:
      return null;
  }
}

// ─── Single dispatcher (B3) ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const run = async () => {
    if (msg && msg.source === 'ACTION_RECORDER') {
      if (!validateMessage(msg)) return { ok: false, error: 'invalid message' };
      return handleProtocolMessage(msg, sender);
    }
    const popupResp = await handlePopupCommand(msg || {});
    if (popupResp !== null) return popupResp;
    return { ok: false, error: 'unknown message' };
  };
  run()
    .then(resp => sendResponse(resp || { ok: true }))
    .catch(err => {
      console.error('Message handling error:', err);
      sendResponse({ ok: false, error: String(err && err.message || err) });
    });
  return true;
});

// ─── New tabs / navigations get recording state (B8) ───

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id != null) sendStateToTab(tab.id);
});

if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.tabId != null) sendStateToTab(details.tabId);
  });
}

// ─── Init ───

chrome.runtime.onInstalled.addListener(() => {
  initSessionState();
});

initSessionState();
