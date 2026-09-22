/**
 * selectors.js — Target extraction helpers (classic content script + CJS for tests).
 * Loaded before recorder.js; exposed as globalThis.ActionRecorderSelectors.
 */
(function (global) {
  'use strict';

  const HASH_CLASS_PATTERNS = [
    /^css-[a-f0-9]+$/i,
    /^sc-[A-Za-z]+$/,
    /^Mui[A-Z].*-[a-z0-9]+$/,
    /^_[A-Za-z]+_[A-Za-z0-9]+$/
  ];

  const DEFAULT_LIMITS = {
    maxInnerText: 5000,
    maxOuterHTML: 2000
  };

  let limits = { ...DEFAULT_LIMITS };

  function setLimits(next) {
    limits = {
      maxInnerText: next.maxText || DEFAULT_LIMITS.maxInnerText,
      maxOuterHTML: next.maxOuterHTML || DEFAULT_LIMITS.maxOuterHTML
    };
  }

  function isHashClass(cls) {
    return HASH_CLASS_PATTERNS.some(p => p.test(cls));
  }

  function cssEscape(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^\w-]/g, ch => '\\' + ch);
  }

  function buildDomPath(element) {
    const path = [];
    let current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      const tag = current.tagName && current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        const index = siblings.indexOf(current);
        if (siblings.length > 1) {
          path.unshift(tag + '[' + index + ']');
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
    if (element.id) {
      return '//*[@id="' + element.id + '"]';
    }
    for (const attr of ['data-testid', 'data-test', 'data-cy', 'name', 'aria-label']) {
      const val = element.getAttribute(attr);
      if (val) {
        const xpath = '//' + element.tagName.toLowerCase() + '[@' + attr + '="' + val + '"]';
        try {
          if (typeof document !== 'undefined' && document.evaluate && typeof XPathResult !== 'undefined') {
            const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            if (result.snapshotLength === 1) return xpath;
          } else {
            return xpath;
          }
        } catch (e) { /* fall through */ }
      }
    }
    const parts = [];
    let current = element;
    while (current && current !== document) {
      const tag = current.tagName && current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          parts.unshift(tag + '[' + index + ']');
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

    if (element.id) {
      candidates.push('#' + cssEscape(element.id));
    }

    for (const attr of ['data-testid', 'data-test', 'data-cy']) {
      const val = element.getAttribute(attr);
      if (val) candidates.push('[' + attr + '="' + cssEscape(val) + '"]');
    }

    if (element.name) {
      candidates.push(element.tagName.toLowerCase() + '[name="' + cssEscape(element.name) + '"]');
    }

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) candidates.push('[aria-label="' + cssEscape(ariaLabel) + '"]');

    const role = element.getAttribute('role');
    if (role) candidates.push('[role="' + cssEscape(role) + '"]');

    const stableClasses = Array.from(element.classList || []).filter(cls => !isHashClass(cls));
    if (stableClasses.length > 0) {
      candidates.push(element.tagName.toLowerCase() + '.' + stableClasses.map(c => cssEscape(c)).join('.'));
    }

    const tag = element.tagName.toLowerCase();
    const attrs = [];
    for (const attr of ['type', 'role', 'aria-label']) {
      const val = element.getAttribute(attr);
      if (val) attrs.push('[' + attr + '="' + cssEscape(val) + '"]');
    }
    if (attrs.length > 0) {
      candidates.push(tag + attrs.join(''));
    }

    return candidates;
  }

  function buildShadowHostPath(element) {
    const path = [];
    let current = element;
    while (current) {
      const root = current.getRootNode ? current.getRootNode() : null;
      if (root && typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) {
        const host = root.host;
        if (host) {
          const tag = host.tagName.toLowerCase();
          const id = host.id ? '#' + host.id : '';
          path.unshift(tag + id);
          current = host;
          continue;
        }
      }
      break;
    }
    return path;
  }

  function getTargetMetadata(element) {
    if (!element || !element.tagName) return null;

    const meta = {
      tag: element.tagName.toLowerCase(),
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
      shadowHostPath: [],
      sensitive: false
    };

    if (element.attributes) {
      for (const attr of element.attributes) {
        meta.attributes[attr.name] = attr.value;
      }
    }

    try {
      const text = element.innerText || '';
      meta.innerText = text.length > limits.maxInnerText ? text.slice(0, limits.maxInnerText) + '...' : text;
    } catch (e) { /* ignore */ }

    try {
      const html = element.outerHTML || '';
      meta.outerHTML = html.length > limits.maxOuterHTML ? html.slice(0, limits.maxOuterHTML) + '...' : html;
    } catch (e) { /* ignore */ }

    try {
      const rect = element.getBoundingClientRect();
      meta.boundingRect = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    } catch (e) { /* ignore */ }

    try {
      const root = element.getRootNode ? element.getRootNode() : null;
      meta.isInShadowDOM = typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot;
      if (meta.isInShadowDOM) {
        meta.shadowHostPath = buildShadowHostPath(element);
      }
    } catch (e) { /* ignore */ }

    meta.domPath = buildDomPath(element);
    meta.xpath = buildXPath(element);
    meta.cssSelectorCandidates = buildCssSelectors(element);

    return meta;
  }

  const api = {
    setLimits,
    isHashClass,
    buildDomPath,
    buildXPath,
    buildCssSelectors,
    buildShadowHostPath,
    getTargetMetadata,
    HASH_CLASS_PATTERNS,
    DEFAULT_LIMITS
  };

  global.ActionRecorderSelectors = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
