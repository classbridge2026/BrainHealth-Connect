import type { ChatLine, ChatPerson } from "@/lib/care-chat/service";

export const CHAT_DEVICE_DB = "carecircle-chat";

type Side = "patient" | "doctor" | "admin";

type StoredThread = {
  conversationId: string | null;
  messages: ChatLine[];
};

type StoredFile = {
  name: string;
  mime: string;
  bytes: ArrayBuffer;
};

type Backend = {
  get<T>(store: string, key: string): Promise<T | null>;
  put(store: string, key: string, value: unknown): Promise<void>;
  remove(store: string, key: string): Promise<void>;
  keys(store: string): Promise<string[]>;
};

let backend: Backend | null = null;

function memoryBackend(): Backend {
  const tables = new Map<string, Map<string, unknown>>();
  const table = (store: string) => {
    let rows = tables.get(store);
    if (!rows) {
      rows = new Map();
      tables.set(store, rows);
    }
    return rows;
  };
  return {
    async get(store, key) {
      return (table(store).get(key) as never) ?? null;
    },
    async put(store, key, value) {
      table(store).set(key, value);
    },
    async remove(store, key) {
      table(store).delete(key);
    },
    async keys(store) {
      return [...table(store).keys()];
    },
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openChatDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(CHAT_DEVICE_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ["threads", "files", "people", "meta"]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
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

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbBackend(): Backend {
  return {
    async get(store, key) {
      const db = await openChatDb();
      const value = await requestResult(db.transaction(store, "readonly").objectStore(store).get(key));
      return (value ?? null) as never;
    },
    async put(store, key, value) {
      const db = await openChatDb();
      await requestResult(db.transaction(store, "readwrite").objectStore(store).put(value, key));
    },
    async remove(store, key) {
      const db = await openChatDb();
      await requestResult(db.transaction(store, "readwrite").objectStore(store).delete(key));
    },
    async keys(store) {
      const db = await openChatDb();
      const keys = await requestResult(db.transaction(store, "readonly").objectStore(store).getAllKeys());
      return keys.filter((key): key is string => typeof key === "string");
    },
  };
}

function vault(): Backend {
  if (!backend) backend = typeof indexedDB === "undefined" ? memoryBackend() : idbBackend();
  return backend;
}

async function quietly<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

function threadKey(userId: string, side: Side, partnerId: string) {
  return `${userId}:${side}:${partnerId}`;
}

function fileKey(userId: string, side: Side, partnerId: string, messageId: string) {
  return `${userId}:${side}:${partnerId}:${messageId}`;
}

function peopleKey(userId: string, side: Side) {
  return `${userId}:${side}`;
}

function notifyWorker(userId: string) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready.then((registration) => {
    const message = { type: "chat-forget", userId };
    registration.active?.postMessage(message);
    navigator.serviceWorker.controller?.postMessage(message);
  }).catch(() => undefined);
}

/** Keeps this browser's saved chats for the signed-in person, and drops the previous person's copy. */
export async function claimChatDevice(userId: string) {
  if (!userId) return;
  const current = await quietly(() => vault().get<string>("meta", "user"), null);
  if (current && current !== userId) await forgetChatDevice(current);
  await quietly(() => vault().put("meta", "user", userId), undefined);
}

/** Removes saved chats and asks the service worker to drop cached message pages. */
export async function forgetChatDevice(userId: string) {
  if (!userId) return;
  await quietly(async () => {
    const prefix = `${userId}:`;
    for (const store of ["threads", "files", "people"] as const) {
      const keys = await vault().keys(store);
      await Promise.all(keys.filter((key) => key.startsWith(prefix)).map((key) => vault().remove(store, key)));
    }
    const owner = await vault().get<string>("meta", "user");
    if (owner === userId) await vault().remove("meta", "user");
  }, undefined);
  notifyWorker(userId);
}

export async function rememberPeople(userId: string, side: Side, people: ChatPerson[]) {
  if (!userId) return;
  await quietly(() => vault().put("people", peopleKey(userId, side), people), undefined);
}

export async function recallPeople(userId: string, side: Side): Promise<ChatPerson[] | null> {
  if (!userId) return null;
  return quietly(() => vault().get<ChatPerson[]>("people", peopleKey(userId, side)), null);
}

export async function rememberThread(input: {
  userId: string;
  side: Side;
  partnerId: string;
  conversationId: string | null;
  messages: ChatLine[];
}) {
  if (!input.userId || !input.partnerId) return;
  await quietly(async () => {
    const record: StoredThread = { conversationId: input.conversationId, messages: input.messages };
    await vault().put("threads", threadKey(input.userId, input.side, input.partnerId), record);
    const people = await vault().get<ChatPerson[]>("people", peopleKey(input.userId, input.side));
    if (!people) return;
    const last = input.messages[input.messages.length - 1];
    await vault().put("people", peopleKey(input.userId, input.side), people.map((person) => (
      person.id === input.partnerId
        ? { ...person, preview: last?.body || last?.file?.name || null, when: last?.at ?? null }
        : person
    )));
  }, undefined);
}

export async function recallThread(userId: string, side: Side, partnerId: string): Promise<StoredThread | null> {
  if (!userId || !partnerId) return null;
  return quietly(() => vault().get<StoredThread>("threads", threadKey(userId, side, partnerId)), null);
}

export async function rememberChatFile(input: {
  userId: string;
  side: Side;
  partnerId: string;
  messageId: string;
  name: string;
  mime: string;
  bytes: ArrayBuffer;
}) {
  if (!input.userId || !input.messageId || input.bytes.byteLength < 1) return;
  const record: StoredFile = { name: input.name, mime: input.mime, bytes: input.bytes };
  await quietly(() => vault().put("files", fileKey(input.userId, input.side, input.partnerId, input.messageId), record), undefined);
}

export async function recallChatFile(input: {
  userId: string;
  side: Side;
  partnerId: string;
  messageId: string;
}): Promise<Blob | null> {
  if (!input.userId || !input.messageId) return null;
  const record = await quietly(
    () => vault().get<StoredFile>("files", fileKey(input.userId, input.side, input.partnerId, input.messageId)),
    null,
  );
  if (!record?.bytes || record.bytes.byteLength < 1) return null;
  return new Blob([record.bytes], { type: record.mime || "application/octet-stream" });
}

export async function forgetChatFile(userId: string, side: Side, partnerId: string, messageId: string) {
  if (!userId || !messageId) return;
  await quietly(() => vault().remove("files", fileKey(userId, side, partnerId, messageId)), undefined);
}

export async function forgetChatPartner(userId: string, side: Side, partnerId: string) {
  if (!userId || !partnerId) return;
  await quietly(async () => {
    await vault().remove("threads", threadKey(userId, side, partnerId));
    const prefix = `${fileKey(userId, side, partnerId, "")}`;
    const keys = await vault().keys("files");
    await Promise.all(keys.filter((key) => key.startsWith(prefix)).map((key) => vault().remove("files", key)));
  }, undefined);
}

/** Saved thread wins when this device has one, including a chat that was cleared. */
export function messagesForOffline(server: ChatLine[], stored: ChatLine[] | null): ChatLine[] {
  return stored ?? server;
}
