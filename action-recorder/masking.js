/**
 * masking.js — Deep JSON masking for sensitive data.
 * Used by background.js to mask request/response bodies before persisting.
 */

const ALWAYS_MASKED_KEYS = new Set([
  'password', 'passwd', 'pwd',
  'credit_card', 'card_number', 'cardnumber',
  'cvv', 'cvc', 'cvv2'
]);

const DEFAULT_MASKABLE_KEYS = [
  'token', 'secret', 'api_key', 'apikey', 'api-key',
  'access_token', 'accesstoken',
  'refresh_token', 'refreshtoken',
  'authorization', 'auth',
  'cookie', 'cookies',
  'otp', 'one_time_password', 'session_token', 'sessionid', 'session_id'
];

const SENSITIVE_HEADERS = new Set([
  'authorization', 'cookie', 'set-cookie',
  'proxy-authorization', 'x-api-key'
]);

function tokenize(s) {
  return String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Case-insensitive keyword match on a field/key name.
 * - Single-token keyword must match a whole token (or camel/concat suffix): 'author' does NOT match 'auth'.
 * - Multi-token keyword must match consecutive tokens: 'csrf_token' matches 'csrf_token', 'my_csrf_token'.
 */
export function keywordMatches(text, keyword) {
  if (text == null || keyword == null) return false;
  const kw = String(keyword).trim().toLowerCase();
  if (!kw) return false;
  const field = String(text).toLowerCase();
  if (field === kw) return true;
  const fTokens = tokenize(field);
  const kTokens = tokenize(kw);
  if (kTokens.length === 0) return false;
  if (kTokens.length === 1) {
    if (fTokens.includes(kTokens[0])) return true;
    // camelCase / concatenated: 'userToken'.includes handled via suffix on lowercase
    if (field.endsWith(kTokens[0]) && field.length > kTokens[0].length) return true;
    return false;
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

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[-_\s]/g, '');
}

function customMatches(key, customKeywords) {
  if (!customKeywords || customKeywords.size === 0) return false;
  for (const kw of customKeywords) {
    if (keywordMatches(key, kw)) return true;
  }
  return false;
}

export function shouldMaskKey(key, userRecordKeys = new Set(), customKeywords = new Set()) {
  const lower = normalizeKey(key);
  for (const ak of ALWAYS_MASKED_KEYS) {
    if (lower === normalizeKey(ak)) return true;
  }
  if (userRecordKeys.has(lower) || userRecordKeys.has(String(key).toLowerCase())) return false;
  if (customMatches(key, customKeywords)) return true;
  for (const dk of DEFAULT_MASKABLE_KEYS) {
    if (lower === normalizeKey(dk)) return true;
  }
  return false;
}

export function deepMaskJSON(value, userRecordKeys = new Set(), customKeywords = new Set()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(item => deepMaskJSON(item, userRecordKeys, customKeywords));
  if (typeof value === 'object') {
    const masked = {};
    for (const [k, v] of Object.entries(value)) {
      if (shouldMaskKey(k, userRecordKeys, customKeywords)) {
        masked[k] = '[MASKED]';
      } else if (typeof v === 'object' && v !== null) {
        masked[k] = deepMaskJSON(v, userRecordKeys, customKeywords);
      } else {
        masked[k] = v;
      }
    }
    return masked;
  }
  return value;
}

export function maskHeaders(headers, userRecordKeys = new Set(), customKeywords = new Set()) {
  if (!headers || typeof headers !== 'object') return headers;
  const masked = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(k.toLowerCase()) || shouldMaskKey(k, userRecordKeys, customKeywords)) {
      masked[k] = '[MASKED]';
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

export function maskFormBody(body, userRecordKeys = new Set(), customKeywords = new Set()) {
  if (!body || typeof body !== 'string') return body;
  try {
    const params = new URLSearchParams(body);
    const masked = new URLSearchParams();
    for (const [k, v] of params.entries()) {
      masked.set(k, shouldMaskKey(k, userRecordKeys, customKeywords) ? '[MASKED]' : v);
    }
    return masked.toString();
  } catch {
    return body;
  }
}

function looksLikeFormBody(s) {
  if (s.length > 1024 * 1024) return false;
  if (s.trimStart().startsWith('{') || s.trimStart().startsWith('[')) return false;
  return /^[^=&\s]+=[^=&]*(&[^=&\s]+=[^=&]*)*$/.test(s);
}

/**
 * Pattern-scan a text/plain body: mask values of sensitive keys in
 * key=value and "key":"value" occurrences (SPEC §10).
 */
export function maskTextBody(body, userRecordKeys = new Set(), customKeywords = new Set()) {
  if (typeof body !== 'string' || body.length === 0) return body;
  if (looksLikeFormBody(body)) {
    return maskFormBody(body, userRecordKeys, customKeywords);
  }
  let out = body;
  // "key": "value" / "key":"value"
  out = out.replace(/("([^"\\]|\\.)*")(\s*:\s*)("(?:[^"\\]|\\.)*")/g, (match, keyPart, _k, colon, valPart) => {
    let key;
    try { key = JSON.parse(keyPart); } catch { return match; }
    if (shouldMaskKey(key, userRecordKeys, customKeywords)) {
      return `${keyPart}${colon}"[MASKED]"`;
    }
    return match;
  });
  // key=value (also key:value without quotes)
  out = out.replace(/\b([A-Za-z0-9_.-]+)\s*=\s*([^\s&;"',]+)/g, (match, key, val) => {
    if (shouldMaskKey(key, userRecordKeys, customKeywords)) {
      return `${key}=[MASKED]`;
    }
    return match;
  });
  return out;
}

/**
 * Mask any body value: object → deepMaskJSON, string → maskTextBody, else pass through.
 */
export function maskBodyValue(body, userRecordKeys = new Set(), customKeywords = new Set()) {
  if (body == null) return body;
  if (typeof body === 'object') return deepMaskJSON(body, userRecordKeys, customKeywords);
  if (typeof body === 'string') return maskTextBody(body, userRecordKeys, customKeywords);
  return body;
}
