# Action Recorder — Phased Delivery Plan

## Phase 1: Core MVP

**Goal:** Record UI actions + fetch/XHR correlation + mask + persist + export JSON.

**Files:** manifest.json, recorder.js, relay.js, background.js, db.js, masking.js, popup.html, popup.js, popup.css, README.md

### Tasks

| # | Task | Depends | Output |
|---|------|---------|--------|
| 1.1 | Create manifest.json | — | Manifest loads in Chrome |
| 1.2 | Implement relay.js (message bridge) | 1.1 | Messages flow from MAIN → ISOLATED → background |
| 1.3 | Implement db.js (IndexedDB wrapper) | 1.1 | Stores: sessions, actions, networkEvents |
| 1.4 | Implement masking.js (deep mask) | — | deepMaskJSON() works for nested objects |
| 1.5 | Implement recorder.js — DOM event capture | 1.1, 1.2 | Click, input, change, submit, keydown, focus, blur recorded |
| 1.6 | Implement recorder.js — target extraction | 1.5 | getTargetMetadata() returns selectors, DOM path, XPath |
| 1.7 | Implement recorder.js — fetch interceptor | 1.5 | Fetch calls captured with causedByAction |
| 1.8 | Implement recorder.js — XHR interceptor | 1.5 | XHR calls captured with causedByAction |
| 1.9 | Implement background.js — message validation + persist | 1.2, 1.3, 1.4 | Messages validated, masked, stored in IndexedDB |
| 1.10 | Implement popup UI | 1.9 | Start/Stop/Clear/Export buttons work |
| 1.11 | Implement JSON export | 1.9 | exportForAutomation() produces valid JSON |
| 1.12 | Create test page + manual testing | 1.5–1.11 | All test scenarios T1–T6, T8–T12 pass |
| 1.13 | Write README.md | 1.12 | Full documentation |

### Exit Criteria
- Click a button → action recorded in IndexedDB
- Button triggers fetch → networkEvent recorded with correct causedByAction
- Password input → value masked in stored data
- Export produces valid JSON with actions + network + correlations
- No native page behavior broken

---

## Phase 2: Extended Recording

**Goal:** WebSocket, SPA navigation, sendBeacon, async context propagation.

**Files:** recorder.js (updates), README.md (updates)

### Tasks

| # | Task | Depends | Output |
|---|------|---------|--------|
| 2.1 | WebSocket interceptor | Phase 1 | Connect/send/message/close/error events recorded |
| 2.2 | SPA navigation tracking | Phase 1 | pushState/replaceState/popstate/hashchange recorded |
| 2.3 | SendBeacon interceptor | Phase 1 | Beacon calls captured |
| 2.4 | Async context patching | Phase 1 | setTimeout/Promise carry action context |
| 2.5 | Input coalescing (buffer + flush) | Phase 1 | Typing "hello" produces 1 action, not 5 |
| 2.6 | Update README with limitations | 2.1–2.5 | Document async guarantees and gaps |

### Exit Criteria
- WebSocket lifecycle recorded with connectionId
- SPA navigation events recorded
- setTimeout(() => fetch(...)) carries correct causedByAction (best-effort)
- Typing in input field coalesces to single action

---

## Phase 3: Advanced Features

**Goal:** Shadow DOM, Playwright export, options page.

**Files:** exporter.js, options.html, options.js, recorder.js (updates), README.md (updates)

### Tasks

| # | Task | Depends | Output |
|---|------|---------|--------|
| 3.1 | Shadow DOM detection + traversal | Phase 1 | isInShadowDOM, shadowHostPath in target metadata |
| 3.2 | Shadow DOM selectors | 3.1 | Host → shadow root → target path |
| 3.3 | Playwright script export | Phase 1 | exporter.js generates pseudo-Playwright code |
| 3.4 | Options page | Phase 1 | Config: max body size, sensitive keys, capture toggles |
| 3.5 | Response body masking | Phase 1 | Response JSON also runs deepMaskJSON |
| 3.6 | Content-type aware capture | Phase 1 | Skip binary, capture JSON/text/form-urlencoded |

### Exit Criteria
- Shadow DOM elements recorded with correct metadata
- Playwright export produces runnable script (with masked values)
- Options page saves settings
- Binary responses not captured (only metadata)

---

## Phase 4: Polish

**Goal:** Edge cases, performance, documentation.

### Tasks

| # | Task | Depends | Output |
|---|------|---------|--------|
| 4.1 | Performance audit | Phase 3 | No querySelectorAll("*"), no unnecessary reads |
| 4.2 | Edge case testing | Phase 3 | Cross-origin iframes, CSP pages, service workers |
| 4.3 | Error resilience audit | Phase 3 | All try/catch, no uncaught errors in page context |
| 4.4 | Final README polish | 4.1–4.3 | Complete documentation with all limitations |
| 4.5 | Chrome Web Store prep | 4.4 | Screenshots, description, privacy policy |

---

## Dependency Graph

```
Phase 1 (MVP)
  1.1 → 1.2, 1.3, 1.5
  1.4 (independent)
  1.5 → 1.6, 1.7, 1.8
  1.2, 1.3, 1.4 → 1.9
  1.9 → 1.10, 1.11
  1.5–1.11 → 1.12
  1.12 → 1.13

Phase 2 → depends on Phase 1 complete
Phase 3 → depends on Phase 1 complete (some depend on Phase 2)
Phase 4 → depends on Phase 3 complete
```

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Async context propagation unreliable | causedByAction may be wrong for async callbacks | Document limitation, best-effort only |
| XHR override breaks framework | Angular/jQuery may fail | Test with real frameworks in Phase 1 |
| IndexedDB write performance | May lag on rapid events | Batch writes, buffer in memory |
| Shadow DOM selector fragility | Selectors may break on re-render | Prefer XPath + DOM path |
