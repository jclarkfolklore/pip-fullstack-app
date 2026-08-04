// IndexedDB is the day-to-day autosave target (works fully offline, no
// server, and — unlike the File System Access API — is available when this
// app is opened by double-clicking index.html, and on mobile/tablet
// browsers). The .sqlite file export/import below is the portable backup:
// it's a real SQLite file you can back up, move between devices, or hand to
// Claude to inspect between chat sessions.

import { debounce } from '../lib/dom.js';

const IDB_NAME = 'pip-todo';
const IDB_STORE = 'snapshots';
const IDB_KEY = 'main';

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadSnapshot() {
  try {
    const idb = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);
      req.onsuccess = () => resolve(req.result ? req.result.bytes : null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[pip] could not read IndexedDB snapshot', err);
    return null;
  }
}

async function writeSnapshot(bytes) {
  try {
    const idb = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ bytes, savedAt: new Date().toISOString() }, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[pip] could not write IndexedDB snapshot', err);
  }
}

export const saveSnapshotDebounced = debounce((exportFn) => {
  writeSnapshot(exportFn());
}, 500);

export function downloadDatabaseFile(bytes, filename = 'pip-todo.sqlite') {
  const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickDatabaseFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sqlite,.db';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      const buf = await file.arrayBuffer();
      resolve(new Uint8Array(buf));
    };
    input.click();
  });
}
