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

export function shouldMaskKey(key, userRecordKeys = new Set()) {
  const lower = key.toLowerCase().replace(/[-_\s]/g, '');
  for (const ak of ALWAYS_MASKED_KEYS) {
    if (lower === ak.replace(/[-_\s]/g, '')) return true;
  }
  if (userRecordKeys.has(lower) || userRecordKeys.has(key.toLowerCase())) return false;
  for (const dk of DEFAULT_MASKABLE_KEYS) {
    if (lower === dk.replace(/[-_\s]/g, '')) return true;
  }
  return false;
}

export function deepMaskJSON(value, userRecordKeys = new Set()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(item => deepMaskJSON(item, userRecordKeys));
  if (typeof value === 'object') {
    const masked = {};
    for (const [k, v] of Object.entries(value)) {
      if (shouldMaskKey(k, userRecordKeys)) {
        masked[k] = '[MASKED]';
      } else if (typeof v === 'object' && v !== null) {
        masked[k] = deepMaskJSON(v, userRecordKeys);
      } else {
        masked[k] = v;
      }
    }
    return masked;
  }
  return value;
}

export function maskHeaders(headers, userRecordKeys = new Set()) {
  if (!headers || typeof headers !== 'object') return headers;
  const masked = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(k.toLowerCase()) || shouldMaskKey(k, userRecordKeys)) {
      masked[k] = '[MASKED]';
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

export function maskFormBody(body) {
  if (!body || typeof body !== 'string') return body;
  try {
    const params = new URLSearchParams(body);
    const masked = new URLSearchParams();
    for (const [k, v] of params.entries()) {
      masked.set(k, shouldMaskKey(k) ? '[MASKED]' : v);
    }
    return masked.toString();
  } catch {
    return body;
  }
}
