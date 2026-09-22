# Action Recorder — Project Overview

## Goal

Record user interactions on websites (clicks, inputs, navigation) and the network requests those interactions trigger, producing a structured dataset for automation/QA replay.

## Core Problem

When a user clicks a login button, a `fetch("/api/login")` fires. Existing tools either:
- Record UI events only (no network context)
- Record network only (no UI context)
- Use time-window heuristics to correlate them (unreliable)

**Action Recorder** correlates UI actions with network requests by reading the **execution context at the moment the network API is called**, not by guessing based on timing.

## Architecture

```
                    WEB PAGE
                       │
             ┌─────────▼─────────┐
             │ recorder.js       │
             │ MAIN world        │
             │                   │
             │ DOM events        │
             │ fetch / XHR       │
             │ WebSocket         │
             │ sendBeacon        │
             └─────────┬─────────┘
                       │ window.postMessage
                       ▼
             ┌───────────────────┐
             │ relay.js          │
             │ ISOLATED world    │
             └─────────┬─────────┘
                       │ chrome.runtime.sendMessage
                       ▼
             ┌───────────────────┐
             │ background.js     │
             │ Service Worker    │
             │                   │
             │ validate          │
             │ deep mask         │
             │ IndexedDB         │
             │ export            │
             └───────────────────┘
```

### Why MAIN world for recorder?

Content scripts in ISOLATED world cannot access page JavaScript. Network interceptors (fetch/XHR override) must run in the same JS context as the page to see API calls.

### Why ISOLATED for relay?

`chrome.runtime.sendMessage` is only available in content script context (ISOLATED world). The relay bridges MAIN → ISOLATED → background.

## Constraints

| Constraint | Reason |
|-----------|--------|
| No `chrome.debugger` | Keep extension publishable, no DevTools Protocol dependency |
| No Puppeteer/Selenium | Pure extension, no external tools |
| No time-window heuristic | Unreliable correlation; use execution context instead |
| Mask before persist | Never store plaintext passwords/tokens/cookies |
| IndexedDB not chrome.storage | 5MB limit on chrome.storage; unlimitedStorage only helps quota |
| `all_frames: true` | Record actions in iframes too |

## MVP Scope (Phase 1)

These features must work before anything else:

1. DOM event recording (click, input, change, submit, keydown, focus, blur)
2. Fetch interceptor with `causedByAction` correlation
3. XHR interceptor with `causedByAction` correlation
4. Target extraction (selector, DOM path, XPath)
5. Input masking (password fields, sensitive keywords)
6. Deep JSON masking for request/response bodies
7. IndexedDB persistence (sessions, actions, networkEvents stores)
8. Popup UI with Recorder tab + Settings tab
9. Configurable sensitive data masking (per-field mask/record toggle)
10. Custom sensitive keywords
11. JSON export for automation replay
12. Playwright script export

### Not MVP (Phase 2+)

- WebSocket recording
- SPA navigation tracking (pushState/popstate)
- Shadow DOM support
- SendBeacon interceptor
- Async context propagation (setTimeout/Promise patching)

## File Structure

```
action-recorder/
├── manifest.json        # MV3 manifest
├── recorder.js          # MAIN world: DOM events + network interceptors
├── relay.js             # ISOLATED world: message bridge
├── background.js        # Service Worker: validate, mask, persist, export
├── db.js                # IndexedDB wrapper
├── masking.js           # Deep JSON masking
├── exporter.js          # JSON + Playwright export
├── popup.html           # Popup UI (Recorder tab + Settings tab)
├── popup.js             # Popup logic
├── popup.css            # Popup styles
└── README.md            # Full documentation
```

## Key Design Decisions

### 1. Causal Correlation via Execution Context

When a UI event fires:
```javascript
currentActionContext = { actionUid, actionId, timestamp };
```

When page code calls a network API, the interceptor reads this context:
```javascript
const nativeFetch = window.fetch;
window.fetch = async function(...args) {
    const ctx = currentActionContext; // read NOW
    // ... make request ...
    networkEvent.causedByAction = ctx.actionUid;
    return nativeFetch.apply(this, args);
};
```

**Limitation:** If the network call happens in an async callback (setTimeout, Promise), the context may have been overwritten by a newer event. This is a fundamental limitation of browser JS semantics without `async_hooks`. See `README.md` for details.

### 2. Masking at Background Layer

Recorder runs in MAIN world (untrusted). Masking logic lives in background service worker. Recorder sends raw data; background masks before persisting. This separation means:
- Recorder stays lightweight
- Masking rules are centralized
- If masking logic changes, no content script update needed

### 3. Configurable Sensitive Data Masking

Sensitive data masking is configurable per field type:

| Field | Default | User can change |
|-------|---------|-----------------|
| Passwords | Always mask | No (locked) |
| Credit Cards | Always mask | No (locked) |
| Authorization | Mask | Yes → Record value |
| Cookies | Mask | Yes → Record value |
| API Keys | Mask | Yes → Record value |
| Access Tokens | Mask | Yes → Record value |
| Refresh Tokens | Mask | Yes → Record value |

When user chooses "Record value" for a field, plaintext is stored in IndexedDB and included in export. A warning badge indicates exposed sensitive data.

### 4. Popup UI (Single Page, Two Tabs)

Settings live inside the popup as a Settings tab, not a separate options.html page. This keeps everything accessible from one click. The popup has two views:
- **Recorder tab**: status, session, counters, action buttons
- **Settings tab**: capture settings, body limits, sensitive data, correlation, export

### 5. Session-Tab-Frame Model

```
actionUid = sessionId + tabId + frameId + actionSeq
```

Each iframe gets its own `frameId` (from `sender.frameId`). `actionUid` is globally unique. No assumption of global `actionId` across frames.

## Known Limitations

1. **Async context propagation is best-effort.** Cannot guarantee 100% causal correlation for callbacks in setTimeout/Promise chains without debugger API.
2. **WebSocket lifecycle spans multiple actions.** `causedByAction` may be null for messages not directly tied to a UI event.
3. **Shadow DOM selectors are limited.** CSS selectors cannot pierce shadow boundaries; relies on XPath and DOM path.
4. **Response body capture may fail** for streaming/chunked responses or binary content.
5. **No telemetry, no external network calls.** Extension is local-only.
6. **Sensitive data recording is opt-in.** If user chooses "Record value", that data is stored in plaintext in IndexedDB. User assumes responsibility for data security.
