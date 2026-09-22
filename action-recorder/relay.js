/**
 * relay.js — ISOLATED world content script.
 * Bridges messages from MAIN world (recorder.js via window.postMessage)
 * to background service worker (chrome.runtime.sendMessage).
 *
 * On load, asks background for recording state so newly opened tabs /
 * navigated pages join an active session.
 */

const MESSAGE_SOURCE = 'ACTION_RECORDER';
const MESSAGE_VERSION = 1;

function isValidMessage(msg) {
  return (
    msg &&
    typeof msg === 'object' &&
    msg.source === MESSAGE_SOURCE &&
    msg.version === MESSAGE_VERSION &&
    typeof msg.type === 'string' &&
    msg.payload !== undefined
  );
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  const msg = event.data;
  if (!isValidMessage(msg)) return;

  try {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        return;
      }
    });
  } catch (err) {
    // Extension context invalidated; fail silently
  }
});

// Ask background whether a session is active (covers new tabs + navigations)
try {
  chrome.runtime.sendMessage({
    source: MESSAGE_SOURCE,
    version: MESSAGE_VERSION,
    type: 'GET_RECORDING_STATE',
    payload: {}
  }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp && resp.recording && resp.sessionId) {
      window.postMessage({
        source: MESSAGE_SOURCE,
        version: MESSAGE_VERSION,
        type: 'START_RECORDING',
        payload: { sessionId: resp.sessionId, settings: resp.settings || null }
      }, '*');
    }
  });
} catch (err) { /* fail silently */ }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.source !== MESSAGE_SOURCE) return;

  try {
    window.postMessage({
      source: MESSAGE_SOURCE,
      version: MESSAGE_VERSION,
      type: msg.type,
      payload: msg.payload
    }, '*');
  } catch (err) {
    // Fail silently
  }

  sendResponse({ received: true });
  return true;
});
