/**
 * background.js — Service Worker.
 * Receives messages from relay.js, validates, masks, persists to IndexedDB.
 */

import { deepMaskJSON, maskHeaders, shouldMaskKey } from './masking.js';
import {
  openDB, saveSession, getSession, getAllSessions, deleteSession,
  saveAction, saveActions, getActionsBySession,
  saveNetworkEvent, getNetworkEventsBySession
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

// ─── User Record Keys ───

function getUserRecordKeys(settings) {
  const keys = new Set();
  const sd = settings.sensitiveData || {};
  if (!sd.authorization?.masked) { keys.add('authorization'); keys.add('auth'); }
  if (!sd.cookies?.masked) { keys.add('cookie'); keys.add('cookies'); }
  if (!sd.apiKeys?.masked) { keys.add('api_key'); keys.add('apikey'); keys.add('api-key'); }
  if (!sd.accessTokens?.masked) { keys.add('access_token'); keys.add('accesstoken'); }
  if (!sd.refreshTokens?.masked) { keys.add('refresh_token'); keys.add('refreshtoken'); }
  return keys;
}

// ─── Message Validation ───

const VALID_TYPES = new Set(['SESSION_START', 'SESSION_STOP', 'ACTION_RECORDED', 'NETWORK_EVENT']);

function validateMessage(msg) {
  return msg && typeof msg === 'object' &&
    msg.source === 'ACTION_RECORDER' && msg.version === 1 &&
    VALID_TYPES.has(msg.type) && msg.payload;
}

function validateAction(a) {
  return a && a.sessionId && a.actionUid && a.timestamp && a.type;
}

function validateNetworkEvent(e) {
  return e && e.sessionId && e.timestamp && e.source;
}

// ─── Message Handling ───

let actionBuffer = [];
let networkBuffer = [];
let bufferTimer = null;

function flushBuffers() {
  if (actionBuffer.length > 0) {
    const batch = actionBuffer.splice(0);
    saveActions(batch).catch(err => console.error('Failed to save actions:', err));
  }
  if (networkBuffer.length > 0) {
    const batch = networkBuffer.splice(0);
    for (const e of batch) {
      saveNetworkEvent(e).catch(err => console.error('Failed to save network event:', err));
    }
  }
  if (bufferTimer) { clearTimeout(bufferTimer); bufferTimer = null; }
}

function scheduleFlush() {
  if (bufferTimer) return;
  bufferTimer = setTimeout(flushBuffers, 500);
}

async function handleMessage(msg) {
  if (!validateMessage(msg)) return;

  const { type, payload } = msg;
  const settings = await getSettings();
  const userRecordKeys = getUserRecordKeys(settings);

  switch (type) {
    case 'SESSION_START': {
      const session = {
        sessionId: payload.sessionId,
        startedAt: payload.startedAt,
        endedAt: null,
        status: 'recording'
      };
      await saveSession(session);
      activeSessionId = payload.sessionId;
      break;
    }

    case 'SESSION_STOP': {
      const session = await getSession(payload.sessionId);
      if (session) {
        session.endedAt = payload.endedAt;
        session.status = 'stopped';
        await saveSession(session);
      }
      flushBuffers();
      if (activeSessionId === payload.sessionId) activeSessionId = null;
      break;
    }

    case 'ACTION_RECORDED': {
      if (!validateAction(payload)) return;
      if (!settings.captureUIEvents) return;
      actionBuffer.push(payload);
      scheduleFlush();
      break;
    }

    case 'NETWORK_EVENT': {
      if (!validateNetworkEvent(payload)) return;
      if (!settings.captureNetworkRequests) return;
      if (payload.request) {
        if (payload.request.headers) {
          payload.request.headers = maskHeaders(payload.request.headers, userRecordKeys);
        }
        if (payload.request.body && typeof payload.request.body === 'object') {
          payload.request.body = deepMaskJSON(payload.request.body, userRecordKeys);
        }
      }
      if (payload.response) {
        if (payload.response.headers) {
          payload.response.headers = maskHeaders(payload.response.headers, userRecordKeys);
        }
        if (payload.response.body && typeof payload.response.body === 'object') {
          payload.response.body = deepMaskJSON(payload.response.body, userRecordKeys);
        }
      }
      networkBuffer.push(payload);
      scheduleFlush();
      break;
    }
  }
}

// ─── Listener ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(() => {
    sendResponse({ ok: true });
  }).catch(err => {
    console.error('Message handling error:', err);
    sendResponse({ ok: false, error: err.message });
  });
  return true;
});

// ─── Export ───

async function exportForAutomation(sessionId) {
  const session = await getSession(sessionId);
  const actions = await getActionsBySession(sessionId);
  const network = await getNetworkEventsBySession(sessionId);

  return {
    version: '1.0',
    session: {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      endedAt: session.endedAt
    },
    actions: actions.sort((a, b) => a.timestamp - b.timestamp),
    network: network.sort((a, b) => a.timestamp - b.timestamp),
    correlations: actions.map(a => ({
      actionUid: a.actionUid,
      actionType: a.type,
      target: a.target?.tag || 'unknown',
      networkEvents: network
        .filter(n => n.causedByAction === a.actionUid)
        .map(n => ({ url: n.request?.url, method: n.request?.method }))
    }))
  };
}

// ─── Popup Communication ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATUS') {
    sendResponse({ activeSessionId });
    return true;
  }
  if (msg.type === 'EXPORT_JSON') {
    exportForAutomation(msg.sessionId).then(data => {
      sendResponse({ ok: true, data });
    }).catch(err => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
  if (msg.type === 'GET_SESSIONS') {
    getAllSessions().then(sessions => {
      sendResponse({ ok: true, sessions });
    }).catch(err => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
  if (msg.type === 'DELETE_SESSION') {
    deleteSession(msg.sessionId).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
  if (msg.type === 'GET_SETTINGS') {
    getSettings().then(settings => {
      sendResponse({ ok: true, settings });
    });
    return true;
  }
  if (msg.type === 'SAVE_SETTINGS') {
    saveSettings(msg.settings).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
});

let activeSessionId = null;

chrome.runtime.onInstalled.addListener(() => {
  openDB().catch(err => console.error('DB init failed:', err));
});
