/**
 * relay.js — ISOLATED world content script.
 * Bridges messages from MAIN world (recorder.js via window.postMessage)
 * to background service worker (chrome.runtime.sendMessage).
 *
 * ONLY forwards messages with the correct source marker.
 * Validates message structure before forwarding.
 */

const MESSAGE_SOURCE = 'ACTION_RECORDER';
const MESSAGE_VERSION = 1;

/**
 * Validate incoming postMessage from MAIN world.
 * @param {*} msg
 * @returns {boolean}
 */
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

/**
 * Listen for messages from MAIN world (recorder.js).
 */
window.addEventListener('message', (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;

  const msg = event.data;
  if (!isValidMessage(msg)) return;

  // Forward to background service worker
  try {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        // Background may not be ready; fail silently
        return;
      }
    });
  } catch (err) {
    // Extension context invalidated or other error; fail silently
  }
});

/**
 * Listen for messages from background (e.g., popup commands).
 * Also handles chrome.tabs.sendMessage from popup.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.source !== MESSAGE_SOURCE) return;

  // Forward background/popup messages to MAIN world (recorder.js)
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
