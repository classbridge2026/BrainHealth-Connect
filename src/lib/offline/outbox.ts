import { replayBody, syncDecision, type StoredChange } from "./queue";

export type QueuedChange = StoredChange & { id: number };

type Store = {
  add(change: StoredChange): Promise<number>;
  list(): Promise<QueuedChange[]>;
  remove(id: number): Promise<void>;
};

const DB = "carecircle-offline";
const STORE = "changes";

let memory: QueuedChange[] = [];
let nextId = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function memoryStore(): Store {
  return {
    async add(change) {
      const id = nextId;
      nextId += 1;
      memory.push({ ...change, id });
      return id;
    },
    async list() {
      return memory.map((change) => ({ ...change }));
    },
    async remove(id) {
      memory = memory.filter((change) => change.id !== id);
    },
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { autoIncrement: true });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => {
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

function idbStore(): Store {
  return {
    async add(change) {
      const db = await openDb();
      const key = await requestResult(db.transaction(STORE, "readwrite").objectStore(STORE).add(change));
      return Number(key);
    },
    async list() {
      const db = await openDb();
      const cursor = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      return new Promise((resolve, reject) => {
        const rows: QueuedChange[] = [];
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (!current) {
            resolve(rows);
            return;
          }
          rows.push({ ...(current.value as StoredChange), id: Number(current.key) });
          current.continue();
        };
        cursor.onerror = () => reject(cursor.error);
      });
    },
    async remove(id) {
      const db = await openDb();
      await requestResult(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
    },
  };
}

function store(): Store {
  return typeof indexedDB === "undefined" ? memoryStore() : idbStore();
}

export function resetOutboxForTests() {
  memory = [];
  nextId = 1;
  dbPromise = null;
}

export async function enqueueChange(change: StoredChange) {
  return store().add(change);
}

export async function pendingChanges() {
  return store().list();
}

export async function dropChange(id: number) {
  await store().remove(id);
}

export type SyncNotice = { pending: number; failed: number; synced: boolean };

let flushing = false;

/** Sends queued changes in the order they were made. One failure stops the run so later changes stay in order. */
export async function flushChanges(fetchImpl: typeof fetch, hooks: { onNotice: (notice: SyncNotice) => void; onResult?: (id: number, response: Response) => void }) {
  if (flushing) return;
  flushing = true;
  let failed = 0;
  let sent = 0;
  try {
    for (;;) {
      const queued = await pendingChanges();
      if (queued.length === 0) {
        hooks.onNotice({ pending: 0, failed, synced: sent > 0 && failed === 0 });
        return;
      }
      for (const change of queued) {
        let response: Response;
        try {
          response = await fetchImpl(change.url, {
            method: change.method,
            headers: change.headers,
            body: replayBody(change.body),
            credentials: "same-origin",
          });
        } catch {
          hooks.onNotice({ pending: (await pendingChanges()).length, failed, synced: false });
          return;
        }
        const decision = syncDecision(response.status);
        if (decision === "retry") {
          hooks.onNotice({ pending: (await pendingChanges()).length, failed, synced: false });
          return;
        }
        await dropChange(change.id);
        hooks.onResult?.(change.id, response);
        if (decision === "drop") failed += 1;
        else sent += 1;
      }
    }
  } finally {
    flushing = false;
  }
}
