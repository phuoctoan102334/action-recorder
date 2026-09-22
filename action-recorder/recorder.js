/**
 * recorder.js — MAIN world content script.
 * Captures DOM events + network interceptors (fetch, XHR).
 * Sends structured messages to relay.js via window.postMessage.
 */

(function () {
  'use strict';

  const MESSAGE_SOURCE = 'ACTION_RECORDER';
  const MESSAGE_VERSION = 1;

  const DEFAULT_KEYWORDS = [
    'password', 'passwd', 'pwd', 'token', 'secret',
    'api_key', 'apikey', 'api-key', 'access_token', 'accesstoken',
    'refresh_token', 'refreshtoken', 'authorization', 'auth',
    'cookie', 'credit_card', 'card_number', 'cardnumber',
    'cvv', 'cvc', 'otp', 'one_time_password'
  ];

  const SCROLL_DEBOUNCE_MS = 500;
  const SELECTORS = globalThis.ActionRecorderSelectors;

  let sessionId = null;
  let actionSeq = 0;
  let currentActionContext = null;
  let isRecording = false;
  let settings = null;

  function effectiveSettings() {
    return settings || {
      maxRequestBodySize: 64 * 1024,
      maxResponseBodySize: 256 * 1024,
      maxOuterHTML: 2000,
      maxText: 5000,
      captureIframes: true
    };
  }

  function sendMessage(type, payload) {
    if (!isRecording && type !== 'SESSION_START' && type !== 'SESSION_STOP') return;
    try {
      window.postMessage({
        source: MESSAGE_SOURCE,
        version: MESSAGE_VERSION,
        type,
        payload
      }, '*');
    } catch (err) {
      // Fail silently
    }
  }

  function isMainFrame() {
    try { return window === window.top; } catch (e) { return false; }
  }

  function iframesAllowed() {
    return effectiveSettings().captureIframes !== false || isMainFrame();
  }

  function startSession(newSessionId, nextSettings) {
    sessionId = newSessionId;
    actionSeq = 0;
    currentActionContext = null;
    isRecording = true;
    if (nextSettings) {
      settings = nextSettings;
      if (SELECTORS && SELECTORS.setLimits) {
        SELECTORS.setLimits({
          maxOuterHTML: settings.maxOuterHTML,
          maxText: settings.maxText
        });
      }
    }
    sendMessage('SESSION_START', { sessionId, startedAt: Date.now() });
  }

  function stopSession() {
    isRecording = false;
    sendMessage('SESSION_STOP', { sessionId, endedAt: Date.now() });
    sessionId = null;
    settings = null;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== MESSAGE_SOURCE || msg.version !== MESSAGE_VERSION) return;

    if (msg.type === 'START_RECORDING') {
      startSession(msg.payload.sessionId, msg.payload.settings);
    } else if (msg.type === 'STOP_RECORDING') {
      stopSession();
    }
  });

  function generateActionId() {
    return ++actionSeq;
  }

  function getActionUid(actionId) {
    // Final uid is rewritten by background.js with tabId/frameId from sender metadata.
    return `${sessionId}:pending:${actionId}`;
  }

  function allKeywords() {
    const custom = (settings && settings.customSensitiveKeywords) || [];
    return DEFAULT_KEYWORDS.concat(custom);
  }

  function keywordMatches(text, keyword) {
    if (text == null || keyword == null) return false;
    const kw = String(keyword).toLowerCase();
    const field = String(text).toLowerCase();
    if (field === kw) return true;
    const fTokens = field.split(/[^a-z0-9]+/).filter(Boolean);
    const kTokens = kw.split(/[^a-z0-9]+/).filter(Boolean);
    if (kTokens.length === 0) return false;
    if (kTokens.length === 1) {
      return fTokens.includes(kTokens[0]) || (field.endsWith(kTokens[0]) && field.length > kTokens[0].length);
    }
    for (let i = 0; i + kTokens.length <= fTokens.length; i++) {
      let ok = true;
      for (let j = 0; j < kTokens.length; j++) {
        if (fTokens[i + j] !== kTokens[j]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  function isSensitiveField(element) {
    if (!element) return false;
    const tag = element.tagName && element.tagName.toLowerCase();
    if (tag === 'input' && element.type === 'password') return true;
    if (tag === 'input' && (element.type === 'credit-card' || element.autocomplete === 'cc-number')) return true;

    const checkFields = [
      element.name, element.id, element.autocomplete,
      element.getAttribute && element.getAttribute('aria-label'),
      element.placeholder
    ].filter(Boolean);

    const keywords = allKeywords();
    for (const field of checkFields) {
      for (const kw of keywords) {
        if (keywordMatches(field, kw)) return true;
      }
    }
    return false;
  }

  function getElementValue(element) {
    const tag = element.tagName && element.tagName.toLowerCase();

    if (tag === 'input') {
      if (element.type === 'checkbox' || element.type === 'radio') {
        return element.checked;
      }
      return element.value;
    }
    if (tag === 'textarea') return element.value;
    if (tag === 'select') return element.value;
    if (element.isContentEditable) return element.innerText;
    return null;
  }

  function getTargetMetadata(element) {
    const meta = SELECTORS ? SELECTORS.getTargetMetadata(element) : null;
    if (meta) {
      meta.sensitive = isSensitiveField(element);
    }
    return meta;
  }

  function recordAction(eventType, event, value = null) {
    if (!isRecording || !sessionId) return;
    if (!iframesAllowed()) return;

    const actionId = generateActionId();
    const actionUid = getActionUid(actionId);
    const now = Date.now();
    const target = getTargetMetadata(event && event.target);

    const action = {
      sessionId,
      actionUid,
      actionId,
      timestamp: now,
      type: eventType,
      page: {
        url: location.href,
        title: document.title,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      },
      frame: {
        frameId: 'pending',
        tabId: 'pending',
        frameUrl: location.href
      },
      target,
      value,
      keyInfo: null,
      mouseInfo: null,
      isTrusted: event ? (event.isTrusted ?? true) : true
    };

    if (eventType === 'keydown' || eventType === 'keyup') {
      action.keyInfo = {
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey
      };
    }

    if (eventType === 'click') {
      action.mouseInfo = {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
        detail: event.detail
      };
    }

    currentActionContext = { actionUid, actionId, timestamp: now };

    sendMessage('ACTION_RECORDED', action);
  }

  document.addEventListener('click', (e) => {
    recordAction('click', e);
  }, true);

  document.addEventListener('input', (e) => {
    const value = getElementValue(e.target);
    recordAction('input', e, value);
  }, true);

  document.addEventListener('change', (e) => {
    const value = getElementValue(e.target);
    recordAction('change', e, value);
  }, true);

  document.addEventListener('submit', (e) => {
    recordAction('submit', e);
  }, true);

  document.addEventListener('keydown', (e) => {
    recordAction('keydown', e);
  }, true);

  document.addEventListener('focus', (e) => {
    recordAction('focus', e);
  }, true);

  document.addEventListener('blur', (e) => {
    recordAction('blur', e);
  }, true);

  let scrollTimer = null;
  document.addEventListener('scroll', (e) => {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      recordAction('scroll', e);
    }, SCROLL_DEBOUNCE_MS);
  }, true);

  // ─── Network Interception: Fetch ───

  const originalFetch = window.fetch;

  function truncateBodyText(text, maxBytes) {
    const originalSize = text.length;
    if (originalSize <= maxBytes) {
      return { body: text, truncated: false, originalSize, storedSize: originalSize };
    }
    return {
      body: text.slice(0, maxBytes),
      truncated: true,
      originalSize,
      storedSize: maxBytes
    };
  }

  window.fetch = async function (...args) {
    const ctx = currentActionContext;
    const startTime = Date.now();
    const cfg = effectiveSettings();

    let url, init;
    if (typeof Request !== 'undefined' && args[0] instanceof Request) {
      const req = args[0];
      url = req.url;
      init = args[1] || {};
      if (!init.method) init = { ...init, method: req.method };
      if (!init.headers && req.headers) init = { ...init, headers: req.headers };
      if (init.body === undefined && req.method !== 'GET' && req.method !== 'HEAD') {
        try {
          const cloned = req.clone();
          init = { ...init, body: await cloned.text() };
        } catch (e) { /* body may be unavailable */ }
      }
    } else {
      url = args[0];
      init = args[1] || {};
    }

    const method = (init.method || 'GET').toUpperCase();
    const headers = {};
    if (init.headers) {
      if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { headers[k] = v; });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) headers[k] = v;
      } else if (typeof init.headers === 'object') {
        Object.assign(headers, init.headers);
      }
    }

    let body = init.body || null;
    if (body && typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { /* keep string */ }
    }

    const rawBodySize = typeof init.body === 'string' ? init.body.length : 0;
    let requestBody = body;
    let requestTruncated = false;
    let requestOriginalSize = rawBodySize;
    let requestStoredSize = rawBodySize;
    if (typeof init.body === 'string' && init.body.length > cfg.maxRequestBodySize) {
      requestTruncated = true;
      requestOriginalSize = init.body.length;
      requestStoredSize = cfg.maxRequestBodySize;
      const slice = init.body.slice(0, cfg.maxRequestBodySize);
      try { requestBody = JSON.parse(slice); } catch (e) { requestBody = slice; }
    }

    const networkEvent = {
      sessionId,
      timestamp: startTime,
      source: 'fetch',
      causedByAction: ctx ? ctx.actionUid : null,
      connectionId: null,
      request: {
        url: typeof url === 'string' ? url : url.url,
        method,
        headers,
        body: requestBody,
        bodySize: rawBodySize,
        truncated: requestTruncated,
        originalSize: requestOriginalSize,
        storedSize: requestStoredSize
      },
      response: null
    };

    try {
      const response = await originalFetch.apply(this, args);
      const cloned = response.clone();

      networkEvent.response = {
        status: cloned.status,
        statusText: cloned.statusText,
        headers: {},
        body: null,
        bodySize: 0,
        truncated: false,
        originalSize: 0,
        storedSize: 0
      };

      cloned.headers.forEach((v, k) => {
        networkEvent.response.headers[k] = v;
      });

      const contentType = cloned.headers.get('content-type') || '';
      if (contentType.includes('application/json') || contentType.includes('text/') ||
          contentType.includes('application/x-www-form-urlencoded')) {
        try {
          const text = await cloned.text();
          const t = truncateBodyText(text, cfg.maxResponseBodySize);
          networkEvent.response.bodySize = t.originalSize;
          networkEvent.response.truncated = t.truncated;
          networkEvent.response.originalSize = t.originalSize;
          networkEvent.response.storedSize = t.storedSize;
          if (contentType.includes('application/json') && !t.truncated) {
            try {
              networkEvent.response.body = JSON.parse(t.body);
            } catch (e) {
              networkEvent.response.body = t.body;
            }
          } else {
            networkEvent.response.body = t.body;
          }
        } catch (e) { /* ignore body read errors */ }
      }

      sendMessage('NETWORK_EVENT', networkEvent);
      return response;
    } catch (err) {
      networkEvent.response = { status: 0, error: err.message };
      sendMessage('NETWORK_EVENT', networkEvent);
      throw err;
    }
  };

  // ─── Network Interception: XHR ───

  const OriginalXHR = window.XMLHttpRequest;

  function PatchedXHR() {
    const xhr = new OriginalXHR();
    const meta = {
      method: null,
      url: null,
      headers: {},
      requestBody: null,
      startTime: null
    };

    const originalOpen = xhr.open;
    const originalSend = xhr.send;
    const originalSetRequestHeader = xhr.setRequestHeader;

    xhr.open = function (method, url, ...rest) {
      meta.method = (method || 'GET').toUpperCase();
      meta.url = url;
      meta.startTime = Date.now();
      return originalOpen.call(this, method, url, ...rest);
    };

    xhr.setRequestHeader = function (name, value) {
      meta.headers[name] = value;
      return originalSetRequestHeader.call(this, name, value);
    };

    xhr.send = function (body) {
      const ctx = currentActionContext;
      const cfg = effectiveSettings();

      let requestBody;
      if (body && typeof body === 'string') {
        try { requestBody = JSON.parse(body); } catch (e) { requestBody = body; }
      } else {
        requestBody = body;
      }

      const rawSize = typeof body === 'string' ? body.length : 0;
      let truncated = false;
      let originalSize = rawSize;
      let storedSize = rawSize;
      if (typeof body === 'string' && body.length > cfg.maxRequestBodySize) {
        truncated = true;
        originalSize = body.length;
        storedSize = cfg.maxRequestBodySize;
        const slice = body.slice(0, cfg.maxRequestBodySize);
        try { requestBody = JSON.parse(slice); } catch (e) { requestBody = slice; }
      }

      const networkEvent = {
        sessionId,
        timestamp: meta.startTime,
        source: 'xhr',
        causedByAction: ctx ? ctx.actionUid : null,
        connectionId: null,
        request: {
          url: meta.url,
          method: meta.method,
          headers: { ...meta.headers },
          body: requestBody,
          bodySize: rawSize,
          truncated,
          originalSize,
          storedSize
        },
        response: null
      };

      this.addEventListener('load', () => {
        const contentType = this.getResponseHeader('content-type') || '';
        let responseBody = null;
        let bodySize = 0;
        let respTruncated = false;
        let respOriginal = 0;
        let respStored = 0;

        if (contentType.includes('application/json') || contentType.includes('text/') ||
            contentType.includes('application/x-www-form-urlencoded')) {
          const text = this.responseText || '';
          const t = truncateBodyText(text, cfg.maxResponseBodySize);
          bodySize = t.originalSize;
          respTruncated = t.truncated;
          respOriginal = t.originalSize;
          respStored = t.storedSize;
          if (contentType.includes('application/json') && !t.truncated) {
            try { responseBody = JSON.parse(t.body); } catch (e) { responseBody = t.body; }
          } else {
            responseBody = t.body;
          }
        }

        const responseHeaders = {};
        const headerStr = this.getAllResponseHeaders() || '';
        headerStr.split('\r\n').forEach(line => {
          const idx = line.indexOf(':');
          if (idx > 0) {
            responseHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        });

        networkEvent.response = {
          status: this.status,
          statusText: this.statusText,
          headers: responseHeaders,
          body: responseBody,
          bodySize,
          truncated: respTruncated,
          originalSize: respOriginal,
          storedSize: respStored
        };

        sendMessage('NETWORK_EVENT', networkEvent);
      });

      this.addEventListener('error', () => {
        networkEvent.response = { status: 0, error: 'network error' };
        sendMessage('NETWORK_EVENT', networkEvent);
      });

      return originalSend.call(this, body);
    };

    return xhr;
  }

  PatchedXHR.UNSENT = 0;
  PatchedXHR.OPENED = 1;
  PatchedXHR.HEADERS_RECEIVED = 2;
  PatchedXHR.LOADING = 3;
  PatchedXHR.DONE = 4;
  PatchedXHR.prototype = OriginalXHR.prototype;

  window.XMLHttpRequest = PatchedXHR;
})();
