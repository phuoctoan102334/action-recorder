# Action Recorder — Test Plan

## Test Environment

Create a local HTML page (`test-page.html`) with:
- Login form (email + password + submit)
- Button with click counter
- Text input with debounce
- Link that triggers SPA navigation (pushState)
- iframe with its own form
- Element inside Shadow DOM
- WebSocket echo server (optional, Phase 2)

## Test Scenarios

### T1: Basic Click Recording

**Setup:** Page with a `<button id="submit-btn">Submit</button>`.

**Steps:**
1. Start recording via popup
2. Click the button
3. Stop recording

**Expected:**
- 1 action recorded with `type: "click"`
- `target.tag === "button"`
- `target.id === "submit-btn"`
- `target.cssSelectorCandidates` includes `#submit-btn`
- `actionUid` is unique
- `timestamp` is valid

---

### T2: Input Recording with Masking

**Setup:** Page with `<input type="password" name="password">`.

**Steps:**
1. Start recording
2. Type "secret123" into password field
3. Click submit
4. Stop recording

**Expected:**
- Input action recorded
- `value` is `[MASKED]`, NOT `secret123`
- `target.sensitive === true`
- Submit action recorded separately

---

### T3: Fetch Correlation

**Setup:** Page with button that triggers `fetch("/api/data")`.

**Steps:**
1. Start recording
2. Click the button
3. Wait for fetch to complete
4. Stop recording

**Expected:**
- 1 action (click) recorded
- 1 networkEvent recorded
- `networkEvent.causedByAction === action.actionUid`
- `networkEvent.request.url` contains "/api/data"
- `networkEvent.request.method === "GET"`

---

### T4: XHR Correlation

**Setup:** Page with button that triggers `XMLHttpRequest` to `/api/xhr-test`.

**Steps:**
1. Start recording
2. Click the button
3. Wait for XHR to complete
4. Stop recording

**Expected:**
- Same as T3 but via XHR path
- `networkEvent.source === "xhr"`

---

### T5: Multiple Sequential Actions

**Setup:** Page with 3 buttons, each triggers different fetch.

**Steps:**
1. Start recording
2. Click button A → fetch("/api/a")
3. Click button B → fetch("/api/b")
4. Click button C → fetch("/api/c")
5. Stop recording

**Expected:**
- 3 actions, 3 networkEvents
- Each networkEvent.causedByAction matches its corresponding button click actionUid
- No cross-contamination (button A's click should NOT be assigned to fetch("/api/b"))

---

### T6: iframe Recording

**Setup:** Page with iframe containing a form with submit button.

**Steps:**
1. Start recording
2. Click submit inside iframe
3. Stop recording

**Expected:**
- Action recorded with `frame.frameId !== 0`
- `frame.frameUrl` is the iframe URL
- `actionUid` includes frameId (unique from main frame actions)

---

### T7: SPA Navigation

**Setup:** Page with link that calls `history.pushState({}, "", "/new-page")`.

**Steps:**
1. Start recording
2. Click the link
3. Stop recording

**Expected (Phase 2):**
- Action recorded (click)
- `spa_navigation` event recorded with `from` and `to` URLs

---

### T8: JSON Export Format

**Setup:** Perform T1-T3, then export.

**Steps:**
1. Complete T1, T2, T3
2. Click "Export JSON" in popup

**Expected:**
- Valid JSON output
- `version === "1.0"`
- `session` object with `sessionId`, `startedAt`, `endedAt`
- `actions` array with all recorded actions
- `network` array with all network events
- Each network event references `actionUid` (not integer ID)
- Password values are `[MASKED]` in export

---

### T9: Deep Masking

**Setup:** Page with form that sends JSON body:
```json
{
  "user": {
    "name": "Alice",
    "credentials": {
      "password": "secret",
      "token": "abc123"
    }
  }
}
```

**Expected:**
- Request body stored as:
```json
{
  "user": {
    "name": "Alice",
    "credentials": {
      "password": "[MASKED]",
      "token": "[MASKED]"
    }
  }
}
```

---

### T10: Large Body Truncation

**Setup:** Page that sends request body > 64KB.

**Expected:**
- Stored body has `truncated: true`
- `originalSize` recorded
- `storedSize` <= 64KB
- No crash, no extension failure

---

### T11: No Native Behavior Change

**Setup:** Page with fetch, XHR, form submit.

**Steps:**
1. WITHOUT extension enabled, record baseline behavior (all requests succeed)
2. Enable extension
3. Repeat same actions

**Expected:**
- All requests succeed identically
- No CORS errors introduced
- No response body consumption (page can still read response)
- No additional network requests from extension

---

### T12: Concurrent Tabs

**Setup:** Open 2 tabs with same page.

**Steps:**
1. Start recording
2. Tab A: click button
3. Tab B: click button
4. Stop recording

**Expected:**
- Both actions recorded
- `frame.tabId` differs between tabs
- `actionUid` unique across tabs

---

### T13: Configurable Masking — Record Value

**Setup:** Page with input `<input type="text" name="cookie_value">`.

**Steps:**
1. Open Settings tab → Sensitive Data → Cookies → select "Record value"
2. Save settings
3. Start recording
4. Type "session123" into cookie_value field
5. Stop recording

**Expected:**
- Input action recorded
- `value` is "session123" (NOT masked)
- Value stored in plaintext in IndexedDB

---

### T14: Configurable Masking — Default Mask

**Setup:** Same as T13 but leave Cookies on default (Mask).

**Steps:**
1. Open Settings tab → verify Cookies is set to "Mask" (default)
2. Start recording
3. Type "session123" into cookie_value field
4. Stop recording

**Expected:**
- Input action recorded
- `value` is `[MASKED]` (NOT "session123")

---

### T15: Custom Sensitive Keywords

**Setup:** Page with input `<input type="text" name="csrf_token">`.

**Steps:**
1. Open Settings tab → Custom Sensitive Keywords
2. Add "csrf_token" as keyword
3. Save settings
4. Start recording
5. Type "abc123" into csrf_token field
6. Stop recording

**Expected:**
- Input action recorded
- `value` is `[MASKED]` because csrf_token matches custom keyword

---

### T16: Playwright Export

**Setup:** Perform T1 (click button).

**Steps:**
1. Start recording
2. Click button
3. Stop recording
4. Click "Export Playwright" in popup

**Expected:**
- Valid pseudo-Playwright script
- Contains `page.goto(...)` for initial page load
- Contains `page.getByRole("button", { name: "Submit" }).click()` or similar
- No sensitive values in export (passwords → process.env.SECRET_VALUE or MASKED)
- Script is readable and follows Playwright conventions

---

### T17: Body Size Limit Configuration

**Setup:** Change max request body size in Settings.

**Steps:**
1. Open Settings → Body Size Limits
2. Change Max request body from 64 to 32 KB
3. Save settings
4. Start recording
5. Send request with body > 32KB
6. Stop recording

**Expected:**
- Stored body has `truncated: true`
- `storedSize` <= 32KB (the new limit)

---

### T18: Settings Persistence

**Steps:**
1. Open Settings tab
2. Change Max response body to 512 KB
3. Toggle WebSocket to ON
4. Close popup
5. Reopen popup → Settings tab

**Expected:**
- Max response body still shows 512 KB
- WebSocket toggle still ON
- Settings persisted across popup close/open

---

## Manual Checklist

- [ ] Extension loads without errors in `chrome://extensions`
- [ ] No console errors in content scripts
- [ ] No console errors in service worker
- [ ] Popup Recorder tab opens and shows correct state
- [ ] Popup Settings tab opens with all sections
- [ ] Start/Stop recording works
- [ ] Clear session works
- [ ] Export JSON produces valid JSON
- [ ] Export Playwright produces valid script
- [ ] Password fields are always masked (cannot disable)
- [ ] Credit Card fields are always masked (cannot disable)
- [ ] Configurable fields (Cookie, Token, etc.) toggle between Mask/Record value
- [ ] Custom sensitive keywords can be added/removed
- [ ] Body size limits can be changed and apply correctly
- [ ] Settings persist after closing popup
- [ ] Reset Defaults restores all settings
- [ ] IndexedDB has correct stores and indexes
- [ ] Extension works on HTTP and HTTPS pages
- [ ] Extension works on pages with iframes
- [ ] Mini popup shows correct state when collapsed
