import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createPrivateStorage } from "@/lib/storage/private-storage";
import { careFileError, careMessageError, chatFileMime, chatStorageKey, clearCareChat, deleteCareMessage, sendCareFile, sendCareMessage, unreadCareChats } from "./service";

const patientId = "11111111-1111-4111-8111-111111111111";
const doctorId = "22222222-2222-4222-8222-222222222222";

function database(booked: boolean) {
  const db = {
    patientProfile: { findUnique: async () => ({ id: patientId }) },
    doctorProfile: { findUnique: async () => ({ id: doctorId }) },
    appointment: { findFirst: async () => (booked ? { id: "visit" } : null) },
    careConversation: {
      upsert: async () => ({ id: "thread" }),
    },
    careMessage: {
      create: async ({ data }: { data: { body: string } }) => ({ id: "message", body: data.body, createdAt: new Date("2026-11-05T12:00:00.000Z") }),
    },
  };
  return db as unknown as PrismaClient;
}

describe("care chat", () => {
  it("asks for a message before sending", () => {
    expect(careMessageError("  ")).toBe("Write a message before sending.");
  });

  it("accepts a photo and refuses an unknown file", () => {
    expect(careFileError({ name: "scan.png", mime: "image/png", size: 1200 })).toBeNull();
    expect(careFileError({ name: "notes.exe", mime: "application/octet-stream", size: 1200 })).toMatch(/photo/);
    expect(careFileError({ name: "clip.mp4", mime: "video/mp4", size: 16 * 1024 * 1024 })).toMatch(/15 MB/);
    expect(careFileError({ name: "Voice message.webm", mime: "audio/webm;codecs=opus", size: 4000 })).toBeNull();
    expect(careFileError({ name: "Voice message.webm", mime: "audio/webm", size: 5 * 1024 * 1024 })).toMatch(/4 MB/);
  });

  it("does not delete a message for a doctor the patient has not booked", async () => {
    const result = await deleteCareMessage(database(false), {
      actorUserId: "patient-user",
      side: "patient",
      partnerProfileId: "33333333-3333-4333-8333-333333333333",
      messageId: "44444444-4444-4444-8444-444444444444",
    });
    expect(result).toEqual({ ok: false, message: "You can message only a doctor you have booked." });
  });

  it("keeps chat files on a private object key", () => {
    expect(chatStorageKey("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBe(
      "care-chat/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(() => chatStorageKey("../x", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toThrow("INVALID_STORAGE_KEY");
  });

  it("treats a Word file as a document even without a mime type", () => {
    expect(chatFileMime("letter.docx", "")).toMatch(/wordprocessingml/);
    expect(careFileError({ name: "letter.docx", mime: "", size: 1200 })).toBeNull();
  });

  it("still sends a document when the private bucket is unavailable", async () => {
    const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const db = {
      ...database(true),
      careConversation: { upsert: async () => ({ id: conversationId }) },
      $queryRaw: async () => [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", body: "letter.docx", createdAt: new Date("2026-11-06T12:00:00.000Z") }],
      $executeRaw: async () => 1,
    } as unknown as PrismaClient;
    const result = await sendCareFile(
      db,
      {
        actorUserId: "patient-doc-user",
        side: "patient",
        partnerProfileId: doctorId,
        body: "",
        file: { name: "letter.docx", mime: "", bytes: Buffer.from("docx") },
      },
      createPrivateStorage({}),
    );
    expect(result).toMatchObject({ ok: true, message: { file: { name: "letter.docx" } } });
  });

  it("stores a photo in private storage instead of the database", async () => {
    const put: Array<{ key: string; mimeType: string; size: number }> = [];
    const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const messageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const db = {
      ...database(true),
      careConversation: { upsert: async () => ({ id: conversationId }) },
      $queryRaw: async () => [{ id: messageId, body: "scan.png", createdAt: new Date("2026-11-06T12:00:00.000Z") }],
      $executeRaw: async () => 1,
    } as unknown as PrismaClient;
    const result = await sendCareFile(
      db,
      {
        actorUserId: "patient-file-user",
        side: "patient",
        partnerProfileId: doctorId,
        body: "",
        file: { name: "scan.png", mime: "image/png", bytes: Buffer.from("png") },
      },
      {
        configured: true,
        async put({ key, body, mimeType }) {
          put.push({ key, mimeType, size: body.byteLength });
          return { ok: true };
        },
        async read() {
          return { ok: false, reason: "not_found" };
        },
        async remove() {
          return { ok: true };
        },
      },
    );
    expect(result).toMatchObject({ ok: true, conversationId, message: { file: { name: "scan.png", mime: "image/png", size: 3 } } });
    expect(put[0]?.key.startsWith(`care-chat/${conversationId}/`)).toBe(true);
    expect(put[0]).toMatchObject({ mimeType: "image/png", size: 3 });
  });

  it("refuses a doctor the patient has not booked", async () => {
    const result = await sendCareMessage(database(false), {
      actorUserId: "patient-user",
      side: "patient",
      partnerProfileId: doctorId,
      body: "Hello",
    });
    expect(result).toEqual({ ok: false, message: "You can message only a doctor you have booked." });
  });

  it("uses the same chat when the booked doctor is also the administrator", async () => {
    const db = {
      ...database(true),
      doctorProfile: { findUnique: async () => ({ id: doctorId, userId: "staff-user" }) },
      user: { findFirst: async () => ({ id: "staff-user" }) },
    } as unknown as PrismaClient;
    const result = await sendCareMessage(db, {
      actorUserId: "patient-user",
      side: "patient",
      partnerProfileId: doctorId,
      body: "Hello doctor",
    });
    expect(result).toMatchObject({ ok: true, conversationId: "thread", message: { body: "Hello doctor", mine: true } });
  });

  it("still refuses an administrator the patient has not booked", async () => {
    const db = {
      ...database(false),
      doctorProfile: { findUnique: async () => ({ id: doctorId, userId: "staff-user" }) },
      user: { findFirst: async () => ({ id: "staff-user" }) },
    } as unknown as PrismaClient;
    const result = await sendCareMessage(db, {
      actorUserId: "patient-user",
      side: "patient",
      partnerProfileId: doctorId,
      body: "Hello admin",
    });
    expect(result).toEqual({ ok: false, message: "You can't message an administrator." });
  });

  it("sends when the patient has a booked visit with that doctor", async () => {
    const result = await sendCareMessage(database(true), {
      actorUserId: "patient-user",
      side: "patient",
      partnerProfileId: doctorId,
      body: "  Hello doctor  ",
    });
    expect(result).toMatchObject({ ok: true, conversationId: "thread", message: { body: "Hello doctor", mine: true, readAt: null } });
  });

  it("counts unread messages from the other person", async () => {
    const db = {
      ...database(true),
      careConversation: {
        findMany: async () => [{ id: "thread", patientProfileId: patientId, doctorProfileId: doctorId }],
      },
      careMessage: {
        groupBy: async () => [{ conversationId: "thread", _count: { _all: 3 } }],
      },
    } as unknown as PrismaClient;
    await expect(unreadCareChats(db, "patient-user", "patient")).resolves.toEqual({
      total: 3,
      byPartner: [{ id: doctorId, unread: 3 }],
    });
  });

  it("clears the chat for the current person only", async () => {
    const sql: string[] = [];
    const db = {
      ...database(true),
      careConversation: {
        findUnique: async () => ({ id: "thread" }),
        delete: async () => {
          throw new Error("must not delete the shared conversation");
        },
      },
      $queryRaw: async () => [],
      $executeRaw: async (strings: TemplateStringsArray) => {
        sql.push(strings.join(" "));
        return 1;
      },
    } as unknown as PrismaClient;
    await expect(clearCareChat(db, { actorUserId: "patient-user", side: "patient", partnerProfileId: doctorId })).resolves.toEqual({ ok: true });
    expect(sql.join(" ")).toMatch(/patientClearedAt/);
    expect(sql.join(" ")).not.toMatch(/doctorClearedAt/);
  });
});
