# Action Recorder - Technical Specification

## 1. Manifest

MV3 manifest. Permissions: storage, unlimitedStorage, webNavigation. Host permissions: all_urls. Background: service_worker background.js, type module. Action: default_popup popup.html. Two content scripts (all_frames: true, run_at: document_start): recorder.js in MAIN world, relay.js in ISOLATED world.

## 2. Session Model

Session fields: sessionId (UUID v4), startedAt (epoch ms), endedAt (null while recording), status (recording/stopped).

Action UID format: {sessionId}:{tabId}:{frameId}:{actionSeq}. Globally unique across all tabs and frames.

Each content script instance maintains actionSeq (counter) and currentActionContext (set on UI events, read by network interceptors).

## 3. UI Event Recording

Capture phase listeners for: click, input, change, submit, keydown, focus, blur, scroll (debounced 500ms).

Action record fields: sessionId, actionUid, actionId, timestamp, type, page (url, title, viewport), frame (frameId, tabId, frameUrl), target (see section 4), value, keyInfo, mouseInfo, isTrusted.

## 4. Target Extraction

getTargetMetadata(element) returns: tag, id, name, classList, attributes, innerText (max 5000 chars), outerHTML (max 2000 chars), domPath, xpath, cssSelectorCandidates, boundingRect, isInShadowDOM, shadowHostPath.

CSS selector priority: id, data-testid/data-test/data-cy, name, aria-label, role, stable classes, tag+attributes, absolute path.

Hash/random class detection: css-[a-f0-9]+, sc-[A-Za-z]+, Mui[A-Z].*-[a-z0-9]+, _[A-Za-z]+_[A-Za-z0-9]+. These are NOT used as primary selectors.

DOM path: index is position among siblings with same tag name.

XPath priority: id-based, unique attribute-based, absolute path with predicates.

## 5. Shadow DOM

Detection: element.getRootNode() instanceof ShadowRoot. Shadow host path: walk from target to document recording shadow hosts. CSS selectors cannot pierce shadow boundaries. Use XPath or DOM path. Limitation: closed shadow roots cannot be accessed.

## 6. Input Value Recording

### Sensitive Field Detection
Field is sensitive if ANY of:
- type=password
- name/id/autocomplete/aria-label/placeholder matching keywords (password, token, secret, api_key, access_token, refresh_token, authorization, cookie, credit_card, cvv, otp, etc)

### Configurable Masking
Two categories:

**Always masked (locked):** Passwords, Credit Cards. User cannot disable.

**Configurable (default: mask, user can toggle to "Record value"):** Authorization, Cookies, API Keys, Access Tokens, Refresh Tokens.

When user selects Record value, plaintext stored in IndexedDB and included in export.

### Custom Sensitive Keywords
User can add custom keywords. Stored in chrome.storage (sync). Case-insensitive matching. Example: session_id, auth_token, csrf_token.

### Value Handling
- Password: Always [MASKED]
- Sensitive input: [MASKED] or actual value (per config)
- Regular input: Actual value
- textarea: Actual value (masked if sensitive)
- select: Selected option value
- contenteditable: innerText

## 7. Network Interception

Override in MAIN world: window.fetch, XMLHttpRequest.prototype.open/send/setRequestHeader, window.WebSocket, navigator.sendBeacon. All wrapped in try/catch. Must preserve native behavior.

Fetch: capture request metadata, read currentActionContext, call native fetch, clone response with size limit, emit network event with causedByAction, return original response.

XHR: override open/send/setRequestHeader. Capture method, url, headers, body, status, response. Preserve native descriptors.

WebSocket: connectionId per instance. Events: connect, send, message, close, error. causedByAction may be null for long-lived connections.

SendBeacon: capture url, method (POST), body, timestamp, causedByAction.

## 8. UI to Network Correlation

NOT a time-window heuristic. When UI event fires, set currentActionContext = { actionUid, actionId, timestamp }. When network API called, interceptor reads context at that moment: networkEvent.causedByAction = currentActionContext.actionUid.

Limitations: async callbacks may lose context (fundamental browser JS limitation without async_hooks). Concurrent rapid clicks may overwrite. WebSocket lifecycle spans multiple actions.

## 9. Async Context Propagation (Phase 2)

Monkey-patch setTimeout, setInterval, queueMicrotask, Promise.then/catch to carry context. Best-effort only. Must not break native behavior. README must document guarantees and limitations.

## 10. Masking

deepMaskJSON(value): recursive through objects, arrays, nested structures. Case-insensitive key matching.

**Always masked (cannot be disabled by user):** password, passwd, pwd, credit_card, card_number, cvv, cvc.

**Masked by default (user can toggle to Record value in Settings):** token, secret, api_key, apikey, access_token, refresh_token, authorization, cookie, otp.

**Headers always masked:** authorization, cookie, set-cookie, proxy-authorization, x-api-key.

**Configurable masking behavior:** When a field is set to Record value in Settings, deepMaskJSON skips masking for that key pattern. User assumes data security responsibility.

**Body format handling:** JSON (parse, mask, re-serialize), form-urlencoded (parse, mask), multipart (metadata only), text/plain (store with pattern scan), binary (metadata only).

Response JSON also runs through deepMaskJSON. Not just request.

## 11. Body Size Limits

Default values (configurable in Settings tab):
- MAX_REQUEST_BODY_SIZE = 64KB (range: 16-256 KB)
- MAX_RESPONSE_BODY_SIZE = 256KB (range: 64-1024 KB)
- MAX_OUTER_HTML = 2000 chars (range: 500-5000)
- MAX_TEXT = 5000 chars (range: 1000-20000)

If exceeded: { truncated: true, originalSize, storedSize }. Never crash recorder. Values validated and clamped to range on save.

## 12. IndexedDB Schema

Database: action_recorder. Stores: sessions (key: sessionId, indexes: startedAt, status), actions (key: actionUid, indexes: sessionId, timestamp, actionId, tabId, frameId), networkEvents (key: auto-increment, indexes: sessionId, timestamp, causedByAction, connectionId).

Background opens database lazily, does not hold connection longer than needed.

## 13. Message Validation

Protocol: window.postMessage must include source: ACTION_RECORDER, version: 1. Relay only forwards correct messages. Background validates: message.type known, payload exists, sessionId valid UUID, actionUid format correct. Do not trust arbitrary postMessage.

## 14. Tab/Frame Context

Background uses sender.tab.id and sender.frameId from chrome.runtime.sendMessage. Do NOT trust tabId/frameId sent by page. Background overrides with sender metadata.

## 15. Navigation Tracking

**Scope note (MVP):** Navigation *recording* is **không thuộc MVP lần này** — full navigation event capture (recording `{ type: "navigation", url, timestamp }` via webNavigation API) is deferred and not part of Phase 1 acceptance. The `webNavigation` permission is used in this MVP **only** for B8 broadcast: `webNavigation.onCommitted` triggers `sendStateToTab` so newly committed pages join an active recording session. No navigation action/event is written to IndexedDB or export.

SPA navigation (pushState/replaceState, popstate, hashchange → `{ type: "spa_navigation", from, to, timestamp }`): Phase 2, out of MVP scope. Preserve native history API behavior when implemented.

## 16. Input Coalescing

Buffer input events. Commit on blur, change, submit, or timeout (1-2s). Avoids 100 actions for typing "hello". Keep metadata for automation.

## 17. Export Format

exportForAutomation(sessionId) output: { version, session, pages, actions, network, correlations }. Network references causedByAction by actionUid.

Playwright export: generate pseudo Playwright script. Selector priority: data-testid, role/name, label, name, id, stable CSS, XPath. Sensitive values become process.env.SECRET_VALUE or MASKED.

## 18. Error Handling

Every interceptor wrapped in try/catch. Fail silently. Never throw into application code. Preserve native APIs.

## 19. Performance

No querySelectorAll("*") per event. Target extraction only processes target + ancestors. Skip body capture for binary content. Priority types: application/json, text/*, application/x-www-form-urlencoded.

## 20. Security

No plaintext storage of cookies, Authorization, passwords, tokens, API keys. No external network calls. Local-only. No analytics/telemetry.

## 21. Popup UI

Single popup with two tabs: Recorder and Settings.

### Recorder Tab
- Recording indicator: ON (red dot) / OFF (gray dot)
- Session ID with copy-to-clipboard button
- Actions counter (number of UI events recorded)
- Network counter (number of network events recorded)
- Stop Recording button (red, enabled when ON)
- Start Recording button (enabled when OFF)
- Export JSON button (enabled when data exists)
- Export Playwright button (enabled when data exists)
- Clear Session button (red, enabled when data exists)
- Helper text: "New session will be created when you start recording again" (shown when ON)

### Settings Tab (Accordion sections)
- **Capture Settings:** toggles for UI events (required), network requests, WebSocket (Phase 2), SPA navigation (Phase 2), iframes
- **Body Size Limits:** input fields with unit dropdown and range hints (16-256 KB for request, 64-1024 KB for response, 500-5000 chars for outerHTML, 1000-20000 chars for innerText)
- **Sensitive Data:** Passwords/Credit Cards locked with Always mask; Authorization/Cookies/API Keys/Access Tokens/Refresh Tokens with Mask/Record value radio toggle
- **Custom Sensitive Keywords:** input field + Add button + keyword tags with remove (x)
- **Correlation:** async context propagation toggle with "best-effort" note
- **Export:** default format (JSON/Playwright) radio + mask values in export toggle
- Save Settings + Reset Defaults buttons

### Mini Popup (Collapsed)
Compact view: Recording status, Session ID, Actions count, Network count.

## 22. Settings Persistence

Settings stored in chrome.storage.sync. Loaded on popup open and background init. Changes applied immediately after Save. Reset Defaults restores all to initial values.
