# Action Recorder

Chrome Extension (Manifest V3) that records user UI actions and associated network requests for automation/QA replay.

## Features

- **UI Event Recording:** Click, input, change, submit, keydown, focus, blur, scroll
- **Network Interception:** Fetch and XHR with causal correlation to UI actions
- **Target Extraction:** CSS selectors, DOM path, XPath, bounding rect
- **Sensitive Data Masking:** Passwords/credit cards always masked, other fields configurable
- **Custom Sensitive Keywords:** Add your own keywords for masking
- **Configurable Body Size Limits:** Adjust max request/response body sizes
- **JSON Export:** Structured data for automation replay
- **Playwright Export:** Pseudo-Playwright test scripts
- **Settings Persistence:** All settings saved via chrome.storage.sync

## Installation

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `action-recorder/` directory

## Usage

1. Click the extension icon
2. **Recorder tab:** Click "Start Recording"
3. Interact with any webpage
4. Click "Stop Recording"
5. Export as JSON or Playwright script

## Settings

Click the "Settings" tab to configure:

- **Capture Settings:** Toggle network requests, iframes
- **Body Size Limits:** Adjust max request/response body sizes
- **Sensitive Data:** Configure which fields to mask vs record
- **Custom Keywords:** Add custom sensitive field keywords
- **Export:** Choose default format and mask behavior

## Architecture

```
recorder.js (MAIN world) → relay.js (ISOLATED) → background.js (Service Worker) → IndexedDB
```

- **recorder.js:** Captures DOM events and network interceptors in the page's JS context
- **relay.js:** Bridges messages from MAIN world to background via chrome.runtime
- **background.js:** Validates, masks, and persists data to IndexedDB
- **db.js:** IndexedDB wrapper for sessions, actions, networkEvents stores
- **masking.js:** Deep JSON masking for sensitive data

## File Structure

```
action-recorder/
├── manifest.json        # MV3 manifest
├── recorder.js          # MAIN world: DOM events + network interceptors
├── relay.js             # ISOLATED world: message bridge
├── background.js        # Service Worker: validate, mask, persist, export
├── db.js                # IndexedDB wrapper
├── masking.js           # Deep JSON masking
├── popup.html           # Popup UI (Recorder tab + Settings tab)
├── popup.js             # Popup logic
├── popup.css            # Popup styles
├── test-page.html       # Manual test page
├── test-iframe.html     # iframe test content
└── README.md            # This file
```

## Known Limitations

1. **Async context propagation is best-effort.** Network calls in setTimeout/Promise chains may not correlate to the correct UI action.
2. **WebSocket lifecycle spans multiple actions.** `causedByAction` may be null for WebSocket messages.
3. **Shadow DOM selectors are limited.** CSS selectors cannot pierce shadow boundaries.
4. **Response body capture may fail** for streaming/chunked responses or binary content.
5. **Sensitive data recording is opt-in.** If you choose "Record value", that data is stored in plaintext.

## Testing

1. Load the extension
2. Open `test-page.html` in Chrome
3. Click the extension icon → Start Recording
4. Perform actions on the test page
5. Stop Recording → Export JSON
6. Verify data in IndexedDB via DevTools → Application → IndexedDB

## License

MIT
