/**
 * Unsent recording segments, kept in IndexedDB until S3 has them, so a page
 * reload or a crashed tab doesn't lose audio. Every call is best-effort: a
 * browser without IndexedDB (private mode, blocked storage) still records,
 * just without surviving a reload.
 */
const DB_NAME = "ally-scribe-segments";
const STORE = "segments";

export interface StoredSegment {
  id: string; // `${chatId}:${index}`
  chatId: number;
  index: number;
  blob: Blob;
  contentType: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return open().then(
    db =>
      new Promise<T | null>(resolve => {
        if (!db) return resolve(null);
        try {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export const segmentStore = {
  put: (s: StoredSegment) => run("readwrite", store => store.put(s)).then(() => undefined),
  remove: (chatId: number, index: number) =>
    run("readwrite", store => store.delete(`${chatId}:${index}`)).then(() => undefined),
  get: (chatId: number, index: number) =>
    run<StoredSegment | undefined>("readonly", store => store.get(`${chatId}:${index}`)).then(
      r => r ?? undefined,
    ),
  all: () => run<StoredSegment[]>("readonly", store => store.getAll()).then(r => r ?? []),
};
