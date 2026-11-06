import { describe, expect, it } from "vitest";
import {
  forgetChatDevice,
  forgetChatFile,
  forgetChatPartner,
  messagesForOffline,
  recallChatFile,
  recallPeople,
  recallThread,
  rememberChatFile,
  rememberPeople,
  rememberThread,
} from "./device-copy";
import type { ChatLine, ChatPerson } from "./service";

const userId = "user-a";
const otherId = "user-b";

function line(id: string, body: string, at: string): ChatLine {
  return { id, body, at, mine: true, readAt: null, file: null };
}

function person(id: string, preview: string | null): ChatPerson {
  return {
    id,
    name: id,
    detail: "Doctor",
    preview,
    when: null,
    unread: 0,
    imageUserId: id,
    imageVersion: null,
    canReply: true,
  };
}

describe("chat device copy", () => {
  it("keeps a downloaded file and the messages after the network is gone", async () => {
    const messages = [line("m1", "Hello", "2026-11-06T10:00:00.000Z")];
    await rememberPeople(userId, "patient", [person("doctor-1", null)]);
    await rememberThread({ userId, side: "patient", partnerId: "doctor-1", conversationId: "c1", messages });
    const bytes = new TextEncoder().encode("photo-bytes").buffer;
    await rememberChatFile({
      userId,
      side: "patient",
      partnerId: "doctor-1",
      messageId: "m1",
      name: "scan.png",
      mime: "image/png",
      bytes,
    });

    expect(messagesForOffline([], messages)).toEqual(messages);
    expect(messagesForOffline([line("newer", "From the server", "2026-11-06T11:00:00.000Z")], null)).toHaveLength(1);
    await expect(recallThread(userId, "patient", "doctor-1")).resolves.toMatchObject({ conversationId: "c1", messages });
    await expect(recallPeople(userId, "patient")).resolves.toMatchObject([{ id: "doctor-1", preview: "Hello" }]);
    const file = await recallChatFile({ userId, side: "patient", partnerId: "doctor-1", messageId: "m1" });
    expect(file?.type).toBe("image/png");
    expect(file?.size).toBe(bytes.byteLength);
  });

  it("drops one file, one chat, or the whole device without touching another person", async () => {
    await rememberThread({
      userId,
      side: "patient",
      partnerId: "doctor-1",
      conversationId: "c1",
      messages: [line("m1", "Hello", "2026-11-06T10:00:00.000Z")],
    });
    await rememberChatFile({
      userId,
      side: "patient",
      partnerId: "doctor-1",
      messageId: "m1",
      name: "scan.png",
      mime: "image/png",
      bytes: new Uint8Array([1, 2, 3]).buffer,
    });
    await rememberThread({
      userId: otherId,
      side: "doctor",
      partnerId: "patient-9",
      conversationId: "c9",
      messages: [line("m9", "Other", "2026-11-06T10:00:00.000Z")],
    });

    await forgetChatFile(userId, "patient", "doctor-1", "m1");
    await expect(recallChatFile({ userId, side: "patient", partnerId: "doctor-1", messageId: "m1" })).resolves.toBeNull();
    await expect(recallThread(userId, "patient", "doctor-1")).resolves.toMatchObject({ conversationId: "c1" });

    await forgetChatPartner(userId, "patient", "doctor-1");
    await expect(recallThread(userId, "patient", "doctor-1")).resolves.toBeNull();

    await forgetChatDevice(userId);
    await expect(recallThread(otherId, "doctor", "patient-9")).resolves.toMatchObject({ conversationId: "c9" });
  });

  it("uses a cleared chat instead of an older copy", () => {
    const stale = [line("m1", "Hello", "2026-11-06T10:00:00.000Z")];
    expect(messagesForOffline(stale, [])).toEqual([]);
  });
});