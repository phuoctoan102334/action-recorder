# Action Recorder

Chrome Extension (Manifest V3) that records user UI actions and associated network requests for automation/QA replay.

## Features

- UI Event Recording (click, input, change, submit, keydown, focus, blur, scroll)
- Network Interception (Fetch + XHR) with causal correlation to UI actions
- Target Extraction (CSS selectors, DOM path, XPath, bounding rect)
- Sensitive Data Masking (passwords/credit cards always masked, others configurable)
- JSON Export & Playwright Export
- Settings Persistence via chrome.storage.sync

## Project Structure

```
├── action-recorder/   # Chrome extension source
├── docs/              # Project specs and planning
└── README.md
```

## Installation

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `action-recorder/`

## License

MIT
