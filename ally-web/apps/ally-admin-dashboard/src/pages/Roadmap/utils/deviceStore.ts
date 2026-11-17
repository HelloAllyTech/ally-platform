/**
 * The device-first store for Roadmap's drafts and offline sends (§4.17: "Drafts save on the
 * device first (IndexedDB) and sync when online, so a lift or a tunnel loses nothing").
 *
 * IndexedDB when the browser has it; otherwise localStorage; otherwise memory for this page only.
 * Every call resolves (never rejects): a storage failure must never block typing.
 */

const DB_NAME = "ally-roadmap";
const DB_VERSION = 1;
export const DEVICE_STORES = ["drafts", "outbox"] as const;
export type DeviceStoreName = (typeof DEVICE_STORES)[number];

const LS_PREFIX = "ally.roadmap.";
const memory = new Map<string, unknown>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

const openDb = (): Promise<IDBDatabase | null> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === "undefined" || !indexedDB) {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        DEVICE_STORES.forEach(name => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
};

const lsKey = (store: DeviceStoreName, key: string) => `${LS_PREFIX}${store}.${key}`;

const fallbackGet = <T>(store: DeviceStoreName, key: string): T | undefined => {
  try {
    const raw = window.localStorage.getItem(lsKey(store, key));
    if (raw != null) return JSON.parse(raw) as T;
  } catch {
    // fall through to memory
  }
  return memory.get(lsKey(store, key)) as T | undefined;
};

const fallbackSet = (store: DeviceStoreName, key: string, value: unknown) => {
  memory.set(lsKey(store, key), value);
  try {
    window.localStorage.setItem(lsKey(store, key), JSON.stringify(value));
  } catch {
    // memory keeps it for this page
  }
};

const fallbackDelete = (store: DeviceStoreName, key: string) => {
  memory.delete(lsKey(store, key));
  try {
    window.localStorage.removeItem(lsKey(store, key));
  } catch {
    // nothing to do
  }
};

const fallbackAll = <T>(store: DeviceStoreName): T[] => {
  const prefix = `${LS_PREFIX}${store}.`;
  const out = new Map<string, T>();
  memory.forEach((value, key) => {
    if (key.startsWith(prefix)) out.set(key, value as T);
  });
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const raw = window.localStorage.getItem(key);
      if (raw != null) out.set(key, JSON.parse(raw) as T);
    }
  } catch {
    // memory only
  }
  return [...out.values()];
};

const run = <T>(
  store: DeviceStoreName,
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest,
): Promise<T | undefined> =>
  openDb().then(
    db =>
      new Promise<T | undefined>(resolve => {
        if (!db) {
          resolve(undefined);
          return;
        }
        try {
          const request = work(db.transaction(store, mode).objectStore(store));
          request.onsuccess = () => resolve(request.result as T);
          request.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );

export const deviceGet = async <T>(store: DeviceStoreName, key: string): Promise<T | undefined> => {
  const db = await openDb();
  if (!db) return fallbackGet<T>(store, key);
  return run<T>(store, "readonly", s => s.get(key));
};

export const deviceSet = async (store: DeviceStoreName, key: string, value: unknown) => {
  const db = await openDb();
  if (!db) {
    fallbackSet(store, key, value);
    return;
  }
  await run(store, "readwrite", s => s.put(value, key));
};

export const deviceDelete = async (store: DeviceStoreName, key: string) => {
  const db = await openDb();
  if (!db) {
    fallbackDelete(store, key);
    return;
  }
  await run(store, "readwrite", s => s.delete(key));
};

export const deviceAll = async <T>(store: DeviceStoreName): Promise<T[]> => {
  const db = await openDb();
  if (!db) return fallbackAll<T>(store);
  return (await run<T[]>(store, "readonly", s => s.getAll())) ?? [];
};

/** For tests: forget the cached connection and the memory fallback. */
export const __resetDeviceStoreForTests = () => {
  dbPromise = null;
  memory.clear();
};

// ── shapes ─────────────────────────────────────────────────────────────────────────────────────

/** A draft as the device holds it. `code` is "new" until the server gives the draft its code. */
export interface DeviceDraft {
  code: string;
  text: string;
  goalId: string | null;
  /** The server version this text was written on; omitted for a draft not yet created. */
  baseVersion?: number;
  updatedAt: number;
  /** False until the server has this exact text. */
  synced: boolean;
}

/** An answer or comment waiting for the network, sent later with the same idempotency key. */
export interface OutboxEntry {
  idempotencyKey: string;
  kind: "answer" | "comment" | "draftAnswer";
  /** Session id (answers, comments) or draft code (draft answers). */
  target: string;
  questionId?: string;
  text?: string;
  optionIds?: string[];
  mentionUserIds?: number[];
  createdAt: number;
}

/** A client idempotency key (8..80 chars). */
export const newIdempotencyKey = (): string => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/** fetchBaseQuery reports an unreachable network as FETCH_ERROR; navigator.onLine says so first. */
export const isOfflineError = (error: unknown): boolean => {
  const status = (error as { status?: unknown })?.status;
  if (status === "FETCH_ERROR" || status === "TIMEOUT_ERROR") return true;
  return typeof navigator !== "undefined" && navigator.onLine === false;
};
