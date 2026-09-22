/**
 * recorder.js — MAIN world content script.
 * Captures DOM events + network interceptors (fetch, XHR).
 * Sends structured messages to relay.js via window.postMessage.
 */

(function () {
  'use strict';

  // ─── Constants ───

  const MESSAGE_SOURCE = 'ACTION_RECORDER';
  const MESSAGE_VERSION = 1;

  const SENSITIVE_KEYWORDS = [
    'password', 'passwd', 'pwd', 'token', 'secret',
    'api_key', 'apikey', 'api-key', 'access_token', 'accesstoken',
    'refresh_token', 'refreshtoken', 'authorization', 'auth',
    'cookie', 'credit_card', 'card_number', 'cardnumber',
    'cvv', 'cvc', 'otp', 'one_time_password'
  ];

  const HASH_CLASS_PATTERNS = [
    /^css-[a-f0-9]+$/i,
    /^sc-[A-Za-z]+$/,
    /^Mui[A-Z].*-[a-z0-9]+$/,
    /^_[A-Za-z]+_[A-Za-z0-9]+$/
  ];

  const MAX_INNER_TEXT = 5000;
  const MAX_OUTER_HTML = 2000;
  const SCROLL_DEBOUNCE_MS = 500;

  // ─── State ───

  let sessionId = null;
  let actionSeq = 0;
  let currentActionContext = null;
  let isRecording = false;

  // ─── Message Sending ───

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

  // ─── Session Control ───

  function startSession(newSessionId) {
    sessionId = newSessionId;
    actionSeq = 0;
    currentActionContext = null;
    isRecording = true;
    sendMessage('SESSION_START', { sessionId, startedAt: Date.now() });
  }

  function stopSession() {
    isRecording = false;
    sendMessage('SESSION_STOP', { sessionId, endedAt: Date.now() });
    sessionId = null;
  }

  // Listen for session control messages from relay.js
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== MESSAGE_SOURCE || msg.version !== MESSAGE_VERSION) return;

    if (msg.type === 'START_RECORDING') {
      startSession(msg.payload.sessionId);
    } else if (msg.type === 'STOP_RECORDING') {
      stopSession();
    }
  });

  // ─── Utility ───

  function generateActionId() {
    return ++actionSeq;
  }

  function getActionUid(actionId) {
    // tabId and frameId will be set by background.js from sender metadata
    return `${sessionId}:pending:${actionId}`;
  }

  function isSensitiveField(element) {
    if (!element) return false;
    const tag = element.tagName?.toLowerCase();
    if (tag === 'input' && element.type === 'password') return true;

    const checkFields = [
      element.name, element.id, element.autocomplete,
      element.getAttribute('aria-label'), element.placeholder
    ].filter(Boolean).map(s => s.toLowerCase());

    for (const field of checkFields) {
      for (const kw of SENSITIVE_KEYWORDS) {
        if (field.includes(kw)) return true;
      }
    }
    return false;
  }

  function getElementValue(element) {
    const tag = element.tagName?.toLowerCase();

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

  // ─── Target Extraction ───

  function getTargetMetadata(element) {
    if (!element || !element.tagName) return null;

    const meta = {
      tag: element.tagName?.toLowerCase(),
      id: element.id || null,
      name: element.name || null,
      classList: Array.from(element.classList || []),
      attributes: {},
      innerText: null,
      outerHTML: null,
      domPath: [],
      xpath: null,
      cssSelectorCandidates: [],
      boundingRect: null,
      isInShadowDOM: false,
      shadowHostPath: []
    };

    // Attributes
    if (element.attributes) {
      for (const attr of element.attributes) {
        meta.attributes[attr.name] = attr.value;
      }
    }

    // Inner text (truncated)
    try {
      const text = element.innerText || '';
      meta.innerText = text.length > MAX_INNER_TEXT ? text.slice(0, MAX_INNER_TEXT) + '...' : text;
    } catch {}

    // Outer HTML (truncated)
    try {
      const html = element.outerHTML || '';
      meta.outerHTML = html.length > MAX_OUTER_HTML ? html.slice(0, MAX_OUTER_HTML) + '...' : html;
    } catch {}

    // Bounding rect
    try {
      const rect = element.getBoundingClientRect();
      meta.boundingRect = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    } catch {}

    // Shadow DOM detection
    try {
      const root = element.getRootNode();
      meta.isInShadowDOM = root instanceof ShadowRoot;
      if (meta.isInShadowDOM) {
        meta.shadowHostPath = buildShadowHostPath(element);
      }
    } catch {}

    // DOM path
    meta.domPath = buildDomPath(element);

    // XPath
    meta.xpath = buildXPath(element);

    // CSS selector candidates
    meta.cssSelectorCandidates = buildCssSelectors(element);

    return meta;
  }

  function buildDomPath(element) {
    const path = [];
    let current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      const tag = current.tagName?.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        const index = siblings.indexOf(current);
        if (siblings.length > 1) {
          path.unshift(`${tag}[${index}]`);
        } else {
          path.unshift(tag);
        }
      } else {
        path.unshift(tag);
      }
      current = parent;
    }
    return path;
  }

  function buildXPath(element) {
    // Try id-based first
    if (element.id) {
      return `//*[@id="${element.id}"]`;
    }

    // Try unique attribute
    for (const attr of ['data-testid', 'data-test', 'data-cy', 'name', 'aria-label']) {
      const val = element.getAttribute(attr);
      if (val) {
        const xpath = `//${element.tagName?.toLowerCase()}[@${attr}="${val}"]`;
        try {
          const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          if (result.snapshotLength === 1) return xpath;
        } catch {}
      }
    }

    // Absolute path with predicates
    const parts = [];
    let current = element;
    while (current && current !== document) {
      const tag = current.tagName?.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          parts.unshift(`${tag}[${index}]`);
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }
      current = parent;
    }
    return '/' + parts.join('/');
  }

  function buildCssSelectors(element) {
    const candidates = [];

    // 1. ID selector
    if (element.id) {
      candidates.push(`#${CSS.escape(element.id)}`);
    }

    // 2. data-testid / data-test / data-cy
    for (const attr of ['data-testid', 'data-test', 'data-cy']) {
      const val = element.getAttribute(attr);
      if (val) candidates.push(`[${attr}="${CSS.escape(val)}"]`);
    }

    // 3. Name attribute
    if (element.name) {
      candidates.push(`${element.tagName?.toLowerCase()}[name="${CSS.escape(element.name)}"]`);
    }

    // 4. Aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) candidates.push(`[aria-label="${CSS.escape(ariaLabel)}"]`);

    // 5. Role
    const role = element.getAttribute('role');
    if (role) candidates.push(`[role="${CSS.escape(role)}"]`);

    // 6. Stable classes (exclude hash/random patterns)
    const stableClasses = Array.from(element.classList || []).filter(cls => {
      return !HASH_CLASS_PATTERNS.some(p => p.test(cls));
    });
    if (stableClasses.length > 0) {
      const selector = `${element.tagName?.toLowerCase()}.${stableClasses.map(c => CSS.escape(c)).join('.')}`;
      candidates.push(selector);
    }

    // 7. Tag + unique attributes
    const tag = element.tagName?.toLowerCase();
    if (tag) {
      const attrs = [];
      for (const attr of ['type', 'role', 'aria-label']) {
        const val = element.getAttribute(attr);
        if (val) attrs.push(`[${attr}="${CSS.escape(val)}"]`);
      }
      if (attrs.length > 0) {
        candidates.push(`${tag}${attrs.join('')}`);
      }
    }

    return candidates;
  }

  function buildShadowHostPath(element) {
    const path = [];
    let current = element;
    while (current) {
      const root = current.getRootNode();
      if (root instanceof ShadowRoot) {
        const host = root.host;
        if (host) {
          const tag = host.tagName?.toLowerCase();
          const id = host.id ? `#${host.id}` : '';
          path.unshift(`${tag}${id}`);
          current = host;
          continue;
        }
      }
      break;
    }
    return path;
  }

  // ─── DOM Event Recording ───

  function recordAction(eventType, event, value = null) {
    if (!isRecording || !sessionId) return;

    const actionId = generateActionId();
    const actionUid = getActionUid(actionId);
    const now = Date.now();

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
        frameId: 'pending', // Set by background.js
        tabId: 'pending',   // Set by background.js
        frameUrl: location.href
      },
      target: getTargetMetadata(event?.target),
      value,
      keyInfo: null,
      mouseInfo: null,
      isTrusted: event?.isTrusted ?? true
    };

    // Add key info for keyboard events
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

    // Add mouse info for click events
    if (eventType === 'click') {
      action.mouseInfo = {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
        detail: event.detail
      };
    }

    // Set action context for network correlation
    currentActionContext = { actionUid, actionId, timestamp: now };

    sendMessage('ACTION_RECORDED', action);
  }

  // ─── Event Listeners ───

  // Click
  document.addEventListener('click', (e) => {
    recordAction('click', e);
  }, true);

  // Input
  document.addEventListener('input', (e) => {
    const value = getElementValue(e.target);
    recordAction('input', e, value);
  }, true);

  // Change
  document.addEventListener('change', (e) => {
    const value = getElementValue(e.target);
    recordAction('change', e, value);
  }, true);

  // Submit
  document.addEventListener('submit', (e) => {
    recordAction('submit', e);
  }, true);

  // Keydown
  document.addEventListener('keydown', (e) => {
    recordAction('keydown', e);
  }, true);

  // Focus
  document.addEventListener('focus', (e) => {
    recordAction('focus', e);
  }, true);

  // Blur
  document.addEventListener('blur', (e) => {
    recordAction('blur', e);
  }, true);

  // Scroll (debounced)
  let scrollTimer = null;
  document.addEventListener('scroll', (e) => {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      recordAction('scroll', e);
    }, SCROLL_DEBOUNCE_MS);
  }, true);

  // ─── Network Interception: Fetch ───

  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const ctx = currentActionContext;
    const startTime = Date.now();

    let url, init;
    if (args[0] instanceof Request) {
      url = args[0].url;
      init = args[1] || {};
    } else {
      url = args[0];
      init = args[1] || {};
    }

    const method = (init.method || 'GET').toUpperCase();
    const headers = {};
    if (init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { headers[k] = v; });
      } else if (typeof init.headers === 'object') {
        Object.assign(headers, init.headers);
      }
    }

    let body = init.body || null;
    if (body && typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }

    const networkEvent = {
      sessionId,
      timestamp: startTime,
      source: 'fetch',
      causedByAction: ctx?.actionUid || null,
      connectionId: null,
      request: {
        url: typeof url === 'string' ? url : url.url,
        method,
        headers,
        body,
        bodySize: typeof init.body === 'string' ? init.body.length : 0
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
        truncated: false
      };

      cloned.headers.forEach((v, k) => {
        networkEvent.response.headers[k] = v;
      });

      // Try to read response body
      const contentType = cloned.headers.get('content-type') || '';
      if (contentType.includes('application/json') || contentType.includes('text/')) {
        try {
          const text = await cloned.text();
          networkEvent.response.bodySize = text.length;
          if (text.length <= 262144) { // 256KB
            try {
              networkEvent.response.body = JSON.parse(text);
            } catch {
              networkEvent.response.body = text;
            }
          } else {
            networkEvent.response.truncated = true;
            networkEvent.response.body = text.slice(0, 262144);
          }
        } catch {}
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

      if (body && typeof body === 'string') {
        try { meta.requestBody = JSON.parse(body); } catch {
          meta.requestBody = body;
        }
      } else {
        meta.requestBody = body;
      }

      const networkEvent = {
        sessionId,
        timestamp: meta.startTime,
        source: 'xhr',
        causedByAction: ctx?.actionUid || null,
        connectionId: null,
        request: {
          url: meta.url,
          method: meta.method,
          headers: { ...meta.headers },
          body: meta.requestBody,
          bodySize: typeof body === 'string' ? body.length : 0
        },
        response: null
      };

      this.addEventListener('load', () => {
        const contentType = this.getResponseHeader('content-type') || '';
        let responseBody = null;
        let bodySize = 0;
        let truncated = false;

        if (contentType.includes('application/json') || contentType.includes('text/')) {
          const text = this.responseText || '';
          bodySize = text.length;
          if (text.length <= 262144) {
            try { responseBody = JSON.parse(text); } catch {
              responseBody = text;
            }
          } else {
            truncated = true;
            responseBody = text.slice(0, 262144);
          }
        }

        const responseHeaders = {};
        const headerStr = this.getAllResponseHeaders() || '';
        headerStr.split('\r\n').forEach(line => {
          const [name, ...rest] = line.split(':');
          if (name && rest.length) {
            responseHeaders[name.trim()] = rest.join(':').trim();
          }
        });

        networkEvent.response = {
          status: this.status,
          statusText: this.statusText,
          headers: responseHeaders,
          body: responseBody,
          bodySize,
          truncated
        };

        sendMessage('NETWORK_EVENT', networkEvent);
      });

      return originalSend.call(this, body);
    };

    return xhr;
  }

  // Preserve static properties
  PatchedXHR.UNSENT = 0;
  PatchedXHR.OPENED = 1;
  PatchedXHR.HEADERS_RECEIVED = 2;
  PatchedXHR.LOADING = 3;
  PatchedXHR.DONE = 4;
  PatchedXHR.prototype = OriginalXHR.prototype;

  window.XMLHttpRequest = PatchedXHR;
})();
