import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  openDB, closeDB, saveSession, getSession, getAllSessions, deleteSession,
  saveActions, getActionsBySession, countActionsBySession,
  saveNetworkEvent, getNetworkEventsBySession, countNetworkEventsBySession
} from '../../action-recorder/db.js';

function makeAction(uid, sessionId, extra = {}) {
  return {
    sessionId,
    actionUid: uid,
    actionId: 1,
    timestamp: Date.now(),
    type: 'click',
    frame: { tabId: 1, frameId: 0 },
    ...extra
  };
}

describe('U5: db roundtrip', () => {
  beforeEach(async () => {
    // fresh DB per test via close + delete
    closeDB();
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('action_recorder');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
    await openDB();
  });

  it('saves and gets session', async () => {
    await saveSession({ sessionId: 's1', startedAt: 1, endedAt: null, status: 'recording' });
    const s = await getSession('s1');
    expect(s.sessionId).toBe('s1');
    expect(s.status).toBe('recording');
  });

  it('unique actionUid prevents overwrite (B2 regression)', async () => {
    const a1 = makeAction('s1:1:0:1', 's1');
    const a2 = makeAction('s1:2:0:1', 's1'); // different tab, same seq
    await saveActions([a1, a2]);
    const all = await getActionsBySession('s1');
    expect(all.length).toBe(2);
    expect(await countActionsBySession('s1')).toBe(2);
  });

  it('deleteSession cascades actions and networkEvents', async () => {
    await saveSession({ sessionId: 's2', startedAt: 1, endedAt: null, status: 'stopped' });
    await saveActions([makeAction('s2:1:0:1', 's2')]);
    await saveNetworkEvent({ sessionId: 's2', timestamp: 1, source: 'fetch', causedByAction: null });
    expect(await countActionsBySession('s2')).toBe(1);
    expect(await countNetworkEventsBySession('s2')).toBe(1);

    await deleteSession('s2');
    expect(await getSession('s2')).toBeNull();
    expect(await countActionsBySession('s2')).toBe(0);
    expect(await countNetworkEventsBySession('s2')).toBe(0);
  });

  it('getAllSessions lists sessions', async () => {
    await saveSession({ sessionId: 'a', startedAt: 1, status: 'stopped' });
    await saveSession({ sessionId: 'b', startedAt: 2, status: 'stopped' });
    const all = await getAllSessions();
    expect(all.length).toBe(2);
  });
});
