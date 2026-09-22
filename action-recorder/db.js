/**
 * db.js — IndexedDB wrapper for Action Recorder.
 * Stores: sessions, actions, networkEvents.
 */

const DB_NAME = 'action_recorder';
const DB_VERSION = 1;

let dbInstance = null;

export function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'sessionId' });
        s.createIndex('startedAt', 'startedAt', { unique: false });
        s.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains('actions')) {
        const a = db.createObjectStore('actions', { keyPath: 'actionUid' });
        a.createIndex('sessionId', 'sessionId', { unique: false });
        a.createIndex('timestamp', 'timestamp', { unique: false });
        a.createIndex('actionId', 'actionId', { unique: false });
        a.createIndex('tabId', 'tabId', { unique: false });
        a.createIndex('frameId', 'frameId', { unique: false });
      }
      if (!db.objectStoreNames.contains('networkEvents')) {
        const n = db.createObjectStore('networkEvents', { keyPath: 'id', autoIncrement: true });
        n.createIndex('sessionId', 'sessionId', { unique: false });
        n.createIndex('timestamp', 'timestamp', { unique: false });
        n.createIndex('causedByAction', 'causedByAction', { unique: false });
        n.createIndex('connectionId', 'connectionId', { unique: false });
      }
    };
    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      dbInstance.onclose = () => { dbInstance = null; };
      resolve(dbInstance);
    };
    request.onerror = (event) => reject(new Error(`IndexedDB open failed: ${event.target.error}`));
  });
}

export function closeDB() {
  if (dbInstance) { dbInstance.close(); dbInstance = null; }
}

function txPromise(storeNames, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    fn(tx, resolve, reject);
    tx.onerror = (e) => reject(new Error(`Transaction failed: ${e.target.error}`));
  }));
}

export function saveSession(session) {
  return txPromise('sessions', 'readwrite', (tx) => {
    tx.objectStore('sessions').put(session);
  });
}

export function getSession(sessionId) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction('sessions', 'readonly').objectStore('sessions').get(sessionId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(new Error(`getSession failed: ${e.target.error}`));
  }));
}

export function getAllSessions() {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(new Error(`getAllSessions failed: ${e.target.error}`));
  }));
}

export function deleteSession(sessionId) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'actions', 'networkEvents'], 'readwrite');
    tx.objectStore('sessions').delete(sessionId);
    const aStore = tx.objectStore('actions');
    const aReq = aStore.index('sessionId').openCursor(IDBKeyRange.only(sessionId));
    aReq.onsuccess = (e) => { const c = e.target.result; if (c) { c.delete(); c.continue(); } };
    const nStore = tx.objectStore('networkEvents');
    const nReq = nStore.index('sessionId').openCursor(IDBKeyRange.only(sessionId));
    nReq.onsuccess = (e) => { const c = e.target.result; if (c) { c.delete(); c.continue(); } };
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(new Error(`deleteSession failed: ${e.target.error}`));
  }));
}

export function saveAction(action) {
  return txPromise('actions', 'readwrite', (tx) => {
    tx.objectStore('actions').put(action);
  });
}

export function saveActions(actions) {
  return txPromise('actions', 'readwrite', (tx) => {
    const store = tx.objectStore('actions');
    for (const a of actions) store.put(a);
  });
}

export function getActionsBySession(sessionId) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction('actions', 'readonly').objectStore('actions')
      .index('sessionId').getAll(IDBKeyRange.only(sessionId));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(new Error(`getActionsBySession failed: ${e.target.error}`));
  }));
}

export function saveNetworkEvent(event) {
  return txPromise('networkEvents', 'readwrite', (tx) => {
    tx.objectStore('networkEvents').put(event);
  });
}

export function saveNetworkEvents(events) {
  return txPromise('networkEvents', 'readwrite', (tx) => {
    const store = tx.objectStore('networkEvents');
    for (const e of events) store.put(e);
  });
}

export function getNetworkEventsBySession(sessionId) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction('networkEvents', 'readonly').objectStore('networkEvents')
      .index('sessionId').getAll(IDBKeyRange.only(sessionId));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(new Error(`getNetworkEventsBySession failed: ${e.target.error}`));
  }));
}
