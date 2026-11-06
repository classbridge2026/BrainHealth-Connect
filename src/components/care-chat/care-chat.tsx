"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { ProfilePhoto } from "@/components/profile-photo";
import type { ChatLine, ChatPerson } from "@/lib/care-chat/service";
import {
  forgetChatFile,
  forgetChatPartner,
  messagesForOffline,
  recallChatFile,
  recallPeople,
  recallThread,
  rememberChatFile,
  rememberPeople,
  rememberThread,
} from "@/lib/care-chat/device-copy";
import { useChatUnread } from "@/components/care-chat/unread";
import "./care-chat.css";

type ActiveChat = {
  id: string;
  name: string;
  detail: string;
  imageUserId: string;
  imageVersion: string | null;
  conversationId: string | null;
  messages: ChatLine[];
  online: boolean;
  seenAt: string | null;
  canReply: boolean;
};

type Delivery = "sending" | "sent" | "read" | "failed";

type ViewLine = ChatLine & { state: Delivery; previewUrl?: string; pendingFile?: File; progress?: number };
type FileLook = { href: string; downloadHref: string; name: string; mime: string; size?: number };
type BlobState = { status: "idle" | "loading" | "ready" | "error"; progress: number; url: string };

const blobJobs = new Map<string, { state: BlobState; listeners: Set<(state: BlobState) => void> }>();

function writeChatUrl(url: string, mode: "push" | "replace") {
  const current = window.history.state;
  const data = current && typeof current === "object" ? { ...current, __NA: true } : { __NA: true };
  if (mode === "push") window.history.pushState(data, "", url);
  else window.history.replaceState(data, "", url);
}

function publishBlob(href: string, state: BlobState) {
  const job = blobJobs.get(href);
  if (!job) return;
  job.state = state;
  job.listeners.forEach((fn) => fn(state));
}

function fileIds(href: string): { side: "patient" | "doctor" | "admin"; partnerId: string; messageId: string } | null {
  const url = new URL(href, "https://carecircle.local");
  const side = url.searchParams.get("side");
  const partnerId = url.searchParams.get("partner");
  const messageId = url.searchParams.get("message");
  if (side !== "patient" && side !== "doctor" && side !== "admin") return null;
  if (!partnerId || !messageId) return null;
  return { side, partnerId, messageId };
}

async function keepChatFile(userId: string, href: string, blob: Blob) {
  const ids = fileIds(href);
  if (!ids || !userId) return;
  await rememberChatFile({
    userId,
    side: ids.side,
    partnerId: ids.partnerId,
    messageId: ids.messageId,
    name: ids.messageId,
    mime: blob.type || "application/octet-stream",
    bytes: await blob.arrayBuffer(),
  });
}

async function pullChatBlob(href: string, expectedSize: number, userId: string) {
  const ids = fileIds(href);
  if (ids && userId) {
    const saved = await recallChatFile({ userId, side: ids.side, partnerId: ids.partnerId, messageId: ids.messageId });
    if (saved) {
      publishBlob(href, { status: "ready", progress: 100, url: URL.createObjectURL(saved) });
      return;
    }
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    publishBlob(href, { status: "error", progress: 0, url: "" });
    return;
  }
  try {
    const response = await fetch(href, { credentials: "same-origin" });
    if (!response.ok) {
      publishBlob(href, { status: "error", progress: 0, url: "" });
      return;
    }
    const total = Number(response.headers.get("content-length")) || expectedSize || 0;
    const mime = response.headers.get("content-type") || undefined;
    const reader = response.body?.getReader();
    if (!reader) {
      const blob = await response.blob();
      await keepChatFile(userId, href, blob);
      publishBlob(href, { status: "ready", progress: 100, url: URL.createObjectURL(blob) });
      return;
    }
    const chunks: BlobPart[] = [];
    let loaded = 0;
    publishBlob(href, { status: "loading", progress: 0, url: "" });
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      const progress = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
      publishBlob(href, { status: "loading", progress, url: "" });
    }
    const blob = new Blob(chunks, mime ? { type: mime } : undefined);
    await keepChatFile(userId, href, blob);
    publishBlob(href, { status: "ready", progress: 100, url: URL.createObjectURL(blob) });
  } catch {
    publishBlob(href, { status: "error", progress: blobJobs.get(href)?.state.progress ?? 0, url: "" });
  }
}

function listenChatBlob(href: string, expectedSize: number, userId: string, onChange: (state: BlobState) => void) {
  let job = blobJobs.get(href);
  if (!job) {
    job = { state: { status: "loading", progress: 0, url: "" }, listeners: new Set() };
    blobJobs.set(href, job);
    void pullChatBlob(href, expectedSize, userId);
  }
  onChange(job.state);
  job.listeners.add(onChange);
  return () => {
    job.listeners.delete(onChange);
  };
}

function retryChatBlob(href: string) {
  blobJobs.delete(href);
}

function useChatBlob(href: string | undefined, expectedSize: number, userId: string, localUrl?: string, eager = false) {
  const [attempt, setAttempt] = useState(0);
  const [armed, setArmed] = useState(eager);
  const [state, setState] = useState<BlobState>(() => (
    localUrl ? { status: "ready", progress: 100, url: localUrl } : { status: href ? "idle" : "error", progress: 0, url: "" }
  ));
  const statusRef = useRef(state.status);
  statusRef.current = state.status;
  useEffect(() => {
    if (localUrl) {
      setState({ status: "ready", progress: 100, url: localUrl });
      return;
    }
    if (!href) {
      setState({ status: "error", progress: 0, url: "" });
      return;
    }
    let stop = false;
    const ids = fileIds(href);
    if (!ids || !userId) return;
    void recallChatFile({ userId, side: ids.side, partnerId: ids.partnerId, messageId: ids.messageId }).then((saved) => {
      if (stop || !saved) return;
      setState({ status: "ready", progress: 100, url: URL.createObjectURL(saved) });
    });
    return () => {
      stop = true;
    };
  }, [href, localUrl, userId]);
  useEffect(() => {
    if (!armed || localUrl || !href || statusRef.current === "ready") return;
    return listenChatBlob(href, expectedSize, userId, setState);
  }, [armed, attempt, expectedSize, href, localUrl, userId]);
  useEffect(() => {
    if (!href || localUrl) return;
    const resume = () => {
      if (statusRef.current !== "error") return;
      retryChatBlob(href);
      setAttempt((current) => current + 1);
    };
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
  }, [href, localUrl]);
  return {
    ...state,
    start() {
      setArmed(true);
    },
    retry() {
      if (href) retryChatBlob(href);
      setArmed(true);
      setAttempt((current) => current + 1);
    },
  };
}

function saveUrl(url: string, name: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function LoadRing({ progress, caption }: { progress: number; caption: string }) {
  const shown = Math.min(100, Math.max(0, Math.round(progress)));
  return (
    <span className="care-chat-load-ring" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown} aria-label={caption}>
      <b style={{ ["--sent" as string]: `${shown}%` }} />
      <em>{shown}%</em>
    </span>
  );
}

function shownPreview(preview: string | null) {
  if (!preview || /^voice message\.[a-z0-9]+$/i.test(preview.trim())) return null;
  return preview;
}

function fileHref(side: string, partner: string, messageId: string, download = false) {
  const query = new URLSearchParams({ side, partner, message: messageId });
  if (download) query.set("download", "1");
  return `/api/care-chat/file?${query}`;
}

function fileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function stamp(value: string) {
  const date = new Date(value);
  let hours = date.getHours();
  const period = hours >= 12 ? "AM" : "PM";
  hours = hours % 12 || 12;
  return `${hours}:${pad(date.getMinutes())} ${period}`;
}

function listWhen(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay ? stamp(value) : `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function dayLabel(value: string) {
  const date = new Date(value);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function viewOf(line: ChatLine): ViewLine {
  return { ...line, state: line.mine && line.readAt ? "read" : "sent" };
}

function waveOf(seedText: string) {
  let seed = 0;
  for (let index = 0; index < seedText.length; index += 1) seed = (seed * 33 + seedText.charCodeAt(index)) >>> 0;
  return Array.from({ length: 28 }, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return 4 + (seed % 16);
  });
}

function VoiceNote({
  src,
  mine,
  loading,
  progress,
  onRetry,
  onRequest,
  connected = true,
}: {
  src?: string;
  mine: boolean;
  loading?: boolean;
  progress?: number;
  onRetry?: () => void;
  onRequest?: () => void;
  connected?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const bars = waveOf(src || "voice");
  const played = length > 0 ? Math.min(1, time / length) : 0;
  const blocked = loading || !src;

  function toggle() {
    if (!src) {
      onRequest?.();
      return;
    }
    const audio = audioRef.current;
    if (!audio || blocked) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }

  function seek(event: MouseEvent<HTMLButtonElement>) {
    const audio = audioRef.current;
    if (!audio || blocked || !Number.isFinite(length) || length <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * length;
    setTime(audio.currentTime);
  }

  return (
    <div className={`care-chat-voice${mine ? " is-mine" : ""}${loading ? " is-loading" : ""}`}>
      <button
        type="button"
        className="care-chat-voice-play"
        disabled={loading}
        aria-label={loading ? `Downloading voice message ${progress ?? 0}%` : playing ? "Pause voice message" : "Play voice message"}
        onClick={toggle}
      >
        {loading ? (
          <LoadRing progress={progress ?? 0} caption={`Downloading ${progress ?? 0}%`} />
        ) : playing ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
        )}
      </button>
      <span className="care-chat-voice-body">
        <button type="button" className="care-chat-voice-wave" onClick={seek} aria-label="Voice message progress">
          {bars.map((height, index) => (
            <i key={index} className={index / bars.length < played ? "is-played" : undefined} style={{ height }} />
          ))}
        </button>
        <span>
          {loading ? `${progress ?? 0}%` : clock(Math.max(0, Math.floor(playing || time > 0 ? time : length)))}
          {onRetry && !src && !loading ? (
            <button type="button" className="care-chat-blob-retry" onClick={onRetry} disabled={!connected}>{connected ? "Retry" : "Not on this device"}</button>
          ) : null}
        </span>
      </span>
      {src ? (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setTime(0); }}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setLength(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        />
      ) : null}
    </div>
  );
}

function ChatFileView({
  line,
  remoteHref,
  userId,
  connected,
  onOpen,
}: {
  line: ViewLine;
  remoteHref?: string;
  userId: string;
  connected: boolean;
  onOpen?: (look: FileLook) => void;
}) {
  const file = line.file;
  const sending = line.state === "sending";
  const media = Boolean(file && (file.mime.startsWith("image/") || file.mime.startsWith("video/") || file.mime.startsWith("audio/")));
  const blob = useChatBlob(sending ? undefined : remoteHref, file?.size ?? 0, userId, line.previewUrl, media);
  if (!file) return null;
  const readyUrl = sending ? line.previewUrl : blob.url;
  const look = readyUrl
    ? { href: readyUrl, downloadHref: readyUrl, name: file.name, mime: file.mime, size: file.size }
    : remoteHref
      ? { href: remoteHref, downloadHref: remoteHref, name: file.name, mime: file.mime, size: file.size }
      : null;
  const incoming = !sending && media && (blob.status === "idle" || blob.status === "loading");
  const overlay = sending
    ? <LoadRing progress={line.progress ?? 0} caption={`Sending ${line.progress ?? 0}%`} />
    : incoming
      ? <LoadRing progress={blob.progress} caption={`Downloading ${blob.progress}%`} />
      : null;

  if (file.mime.startsWith("audio/")) {
    return (
      <VoiceNote
        src={readyUrl}
        mine={line.mine}
        loading={Boolean(overlay)}
        progress={sending ? line.progress : blob.progress}
        onRetry={blob.status === "error" ? blob.retry : undefined}
        onRequest={blob.start}
        connected={connected}
      />
    );
  }
  if (file.mime.startsWith("image/") || file.mime.startsWith("video/")) {
    return (
      <div className={`care-chat-media${sending || incoming ? " is-loading" : ""}`}>
        <button type="button" className="care-chat-media-open" disabled={!look || Boolean(overlay)} onClick={() => look && blob.status === "ready" && onOpen?.(look)}>
          {readyUrl && file.mime.startsWith("image/") ? <img src={readyUrl} alt={file.name} /> : null}
          {readyUrl && file.mime.startsWith("video/") ? <video src={readyUrl} preload="metadata" playsInline muted /> : null}
        </button>
        {overlay}
        {blob.status === "error" ? (
          <button type="button" className="care-chat-blob-retry" onClick={blob.retry} disabled={!connected}>{connected ? "Retry download" : "Not on this device"}</button>
        ) : look && !overlay ? (
          <span className="care-chat-media-actions">
            <button type="button" onClick={() => onOpen?.(look)}>View</button>
            <button type="button" onClick={() => saveUrl(look.downloadHref, file.name)}>Download</button>
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="care-chat-doc-card">
      <span className="care-chat-doc-mark">{file.mime.includes("pdf") ? "PDF" : file.mime.includes("word") || file.name.endsWith(".doc") || file.name.endsWith(".docx") ? "DOC" : "FILE"}</span>
      <span>
        <strong>{file.name}</strong>
        <em>{fileSize(file.size)}</em>
      </span>
      {look ? (
        <span className="care-chat-doc-actions">
          <button type="button" onClick={() => onOpen?.(look)}>View</button>
          <button type="button" onClick={() => saveUrl(look.downloadHref, file.name)}>Download</button>
        </span>
      ) : blob.status === "error" ? (
        <button type="button" className="care-chat-blob-retry" onClick={blob.retry} disabled={!connected}>{connected ? "Retry" : "Not on this device"}</button>
      ) : null}
    </div>
  );
}

function FileViewer({ look, userId, connected, onClose }: { look: FileLook; userId: string; connected: boolean; onClose: () => void }) {
  const local = look.href.startsWith("blob:");
  const blob = useChatBlob(local ? undefined : look.href, look.size ?? 0, userId, local ? look.href : undefined, true);
  const src = blob.url || (local ? look.href : "");
  const [text, setText] = useState("");
  const kind = look.mime.startsWith("image/") ? "image" : look.mime.startsWith("video/") ? "video" : look.mime === "application/pdf" ? "pdf" : look.mime === "text/plain" ? "text" : "file";

  useEffect(() => {
    if (kind !== "text" || !src) {
      setText("");
      return;
    }
    let stop = false;
    void fetch(src).then((response) => response.text()).then((body) => {
      if (!stop) setText(body);
    }).catch(() => {
      if (!stop) setText("");
    });
    return () => {
      stop = true;
    };
  }, [kind, src]);

  return (
    <div className="care-chat-viewer" role="dialog" aria-modal="true" aria-label={look.name}>
      <header>
        <strong>{look.name}</strong>
        <button type="button" onClick={() => src && saveUrl(src, look.name)} disabled={!src}>Download</button>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <div className={`care-chat-viewer-stage${blob.status !== "ready" ? " is-loading" : ""}`}>
        {blob.status === "error" ? (
          <p className="care-chat-viewer-doc">{connected ? "That file could not be opened." : "Not on this device. It will open after it has been downloaded."}</p>
        ) : blob.status !== "ready" ? (
          <LoadRing progress={blob.progress} caption={`Downloading ${blob.progress}%`} />
        ) : null}
        {kind === "image" && src ? <img src={src} alt={look.name} /> : null}
        {kind === "video" && src ? <video src={src} controls autoPlay playsInline /> : null}
        {kind === "pdf" && src ? <iframe className="care-chat-viewer-frame" title={look.name} src={src} /> : null}
        {kind === "text" ? <pre className="care-chat-viewer-text">{text || (blob.status === "ready" ? "" : "Opening…")}</pre> : null}
        {kind === "file" && src ? (
          <p className="care-chat-viewer-doc">
            <a href={src} target="_blank" rel="noreferrer">Open</a>
            <button type="button" onClick={() => saveUrl(src, look.name)}>Download</button>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function clock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function ChevronIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
}

function TrashIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg>;
}

const chatPolls = new Set<string>();

function deliveryLabel(state: Delivery) {
  if (state === "sending") return "Sending";
  if (state === "read") return "Read";
  if (state === "failed") return "Not sent";
  return "Sent";
}

function savedLines(lines: ViewLine[]): ChatLine[] {
  return lines
    .filter((line) => !line.id.startsWith("local-") && line.state !== "sending" && line.state !== "failed")
    .map((line) => ({ id: line.id, body: line.body, at: line.at, mine: line.mine, readAt: line.readAt, file: line.file }));
}

export function CareChat({
  listHref,
  side,
  userId,
  people,
  active: opened,
}: {
  listHref: string;
  side: "patient" | "doctor" | "admin";
  userId: string;
  people: ChatPerson[];
  active: ActiveChat | null;
}) {
  const [panel, setPanel] = useState<ActiveChat | null>(opened);
  const [quietId, setQuietId] = useState<string | null>(null);
  const active = panel;
  const [roster, setRoster] = useState(people);
  const [connected, setConnected] = useState(true);
  const [lines, setLines] = useState<ViewLine[]>(() => (active?.messages ?? []).map(viewOf));
  const [conversationId, setConversationId] = useState(active?.conversationId ?? null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [online, setOnline] = useState(active?.online ?? false);
  const [seenAt, setSeenAt] = useState(active?.seenAt ?? null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const chatUnread = useChatUnread();
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [viewer, setViewer] = useState<FileLook | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const quietScroll = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const clockRef = useRef(0);
  const recordSecondsRef = useRef(0);
  const linesRef = useRef(lines);
  const seen = useRef(new Set(lines.map((line) => line.id)));
  const seenOnServer = useRef(new Set(lines.map((line) => line.id)));
  linesRef.current = lines;

  useEffect(() => {
    if (panel && panel.id !== opened?.id) return;
    const next = (opened?.messages ?? []).map(viewOf);
    setLines(next);
    setConversationId(opened?.conversationId ?? null);
    setDraft("");
    setError("");
    setOnline(opened?.online ?? false);
    setSeenAt(opened?.seenAt ?? null);
    setAttachment(null);
    setAttachmentPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setConfirmClear(false);
    setOpenMenu(null);
    setViewer(null);
    window.clearInterval(clockRef.current);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    chunksRef.current = [];
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => recorder.stream.getTracks().forEach((track) => track.stop());
      recorder.stop();
    }
    setRecording(false);
    seen.current = new Set(next.map((line) => line.id));
    seenOnServer.current = new Set(next.map((line) => line.id));
    if (userId && opened && navigator.onLine !== false) {
      void rememberThread({
        userId,
        side,
        partnerId: opened.id,
        conversationId: opened.conversationId,
        messages: opened.messages,
      });
    }
    if (!userId || !opened || navigator.onLine !== false) return;
    let stop = false;
    void recallThread(userId, side, opened.id).then((stored) => {
      if (stop || !stored) return;
      const chosen = messagesForOffline(opened.messages, stored.messages);
      setLines(chosen.map(viewOf));
      if (stored.conversationId) setConversationId(stored.conversationId);
      seen.current = new Set(chosen.map((line) => line.id));
      seenOnServer.current = new Set(chosen.map((line) => line.id));
    });
    return () => {
      stop = true;
    };
  }, [opened, panel?.id, side, userId]);

  function openPerson(person: ChatPerson, push: boolean) {
    if (person.id === panel?.id) return;
    setPanel({
      id: person.id,
      name: person.name,
      detail: person.detail,
      imageUserId: person.imageUserId,
      imageVersion: person.imageVersion,
      conversationId: null,
      messages: [],
      online: false,
      seenAt: null,
      canReply: person.canReply,
    });
    setLines([]);
    setConversationId(null);
    setOnline(false);
    setSeenAt(null);
    setDraft("");
    setError("");
    setViewer(null);
    setConfirmClear(false);
    setOpenMenu(null);
    setQuietId(person.id);
    seen.current = new Set();
    seenOnServer.current = new Set();
    if (push) {
      const url = `${listHref}/${person.id}`;
      const onThread = window.location.pathname.startsWith(`${listHref}/`);
      writeChatUrl(url, onThread ? "replace" : "push");
    }
    void recallThread(userId, side, person.id).then((stored) => {
      if (!stored) return;
      setPanel((current) => (current?.id === person.id ? { ...current, conversationId: stored.conversationId, messages: stored.messages } : current));
      setLines((current) => (current.some((line) => !line.id.startsWith("local-")) ? current : stored.messages.map(viewOf)));
      if (stored.conversationId) setConversationId(stored.conversationId);
      seen.current = new Set(stored.messages.map((line) => line.id));
      seenOnServer.current = new Set(stored.messages.map((line) => line.id));
    });
  }

  function closeChat(updateUrl: boolean) {
    setPanel(null);
    setLines([]);
    setConversationId(null);
    setOnline(false);
    setSeenAt(null);
    setDraft("");
    setError("");
    setViewer(null);
    setConfirmClear(false);
    setOpenMenu(null);
    setQuietId(null);
    if (!updateUrl || window.location.pathname === listHref) return;
    writeChatUrl(listHref, "replace");
  }

  const openPersonRef = useRef(openPerson);
  const closeChatRef = useRef(closeChat);
  openPersonRef.current = openPerson;
  closeChatRef.current = closeChat;

  useEffect(() => {
    function onPop(event: PopStateEvent) {
      const path = window.location.pathname;
      const inside = path === listHref || path.startsWith(`${listHref}/`);
      if (!inside) return;
      event.stopImmediatePropagation();
      if (!path.startsWith(`${listHref}/`)) {
        closeChatRef.current(false);
        return;
      }
      const id = decodeURIComponent(path.slice(listHref.length + 1).split("/")[0] ?? "");
      const person = roster.find((item) => item.id === id);
      if (person) openPersonRef.current(person, false);
      else closeChatRef.current(false);
    }
    function onClose() {
      closeChatRef.current(true);
    }
    window.addEventListener("popstate", onPop, true);
    window.addEventListener("care-chat:close", onClose);
    return () => {
      window.removeEventListener("popstate", onPop, true);
      window.removeEventListener("care-chat:close", onClose);
    };
  }, [listHref, roster]);

  useEffect(() => {
    const apply = () => setConnected(navigator.onLine);
    apply();
    window.addEventListener("online", apply);
    window.addEventListener("offline", apply);
    return () => {
      window.removeEventListener("online", apply);
      window.removeEventListener("offline", apply);
    };
  }, []);

  useEffect(() => {
    let stop = false;
    if (navigator.onLine !== false) {
      setRoster(people);
      void rememberPeople(userId, side, people);
      return;
    }
    void recallPeople(userId, side).then((stored) => {
      if (!stop) setRoster(stored ?? people);
    });
    return () => {
      stop = true;
    };
  }, [people, side, userId]);

  useEffect(() => {
    if (!openMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".care-chat-menu")) return;
      setOpenMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [openMenu]);

  useEffect(() => {
    return () => {
      window.clearInterval(clockRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = () => recorder.stream.getTracks().forEach((track) => track.stop());
        recorder.stop();
      }
    };
  }, []);

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    quietScroll.current = true;
    node.scrollTop = node.scrollHeight;
    const frame = window.requestAnimationFrame(() => {
      quietScroll.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [lines, active?.id]);

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    let timer = 0;
    const onScroll = () => {
      if (quietScroll.current) return;
      node.classList.add("is-scrolling");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => node.classList.remove("is-scrolling"), 700);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      node.removeEventListener("scroll", onScroll);
      node.classList.remove("is-scrolling");
      window.clearTimeout(timer);
    };
  }, [active?.id]);

  useEffect(() => {
    if (!active) return;
    const partnerId = active.id;
    const openConversation = active.conversationId;
    const key = `${side}:${partnerId}`;
    let stop = false;
    async function pull() {
      if (stop || document.visibilityState === "hidden" || chatPolls.has(key)) return;
      chatPolls.add(key);
      const confirmed = [...linesRef.current].reverse().find((line) => line.state === "sent" || line.state === "read");
      const query = new URLSearchParams({ side, partner: partnerId, after: confirmed?.at ?? "" });
      try {
        const response = await fetch(`/api/care-chat?${query}`, { cache: "no-store" });
        if (!response.ok || stop) return;
        const payload = (await response.json()) as {
          conversationId?: string | null;
          messages?: ChatLine[];
          reads?: Array<{ id: string; readAt: string }>;
          ids?: string[];
          online?: boolean;
          seenAt?: string | null;
        };
        if (stop) return;
        if (payload.conversationId) setConversationId(payload.conversationId);
        setOnline(Boolean(payload.online));
        setSeenAt(payload.seenAt ?? null);
        const fresh = (payload.messages ?? []).filter((line) => !seen.current.has(line.id));
        const reads = new Map((payload.reads ?? []).map((row) => [row.id, row.readAt]));
        const ids = Array.isArray(payload.ids) ? payload.ids.filter((id) => typeof id === "string") : null;
        if (fresh.length === 0 && reads.size === 0 && !ids) return;
        for (const line of fresh) seen.current.add(line.id);
        setLines((current) => {
          let next = current;
          let changed = false;
          if (ids) {
            const kept = new Set(ids);
            const filtered = next.filter((line) => {
              if (line.id.startsWith("local-") || line.state === "sending" || line.state === "failed") return true;
              if (!seenOnServer.current.has(line.id)) return true;
              return kept.has(line.id);
            });
            if (filtered.length !== next.length) {
              next = filtered;
              changed = true;
            }
            for (const id of ids) seenOnServer.current.add(id);
            for (const id of seenOnServer.current) {
              if (!kept.has(id)) seenOnServer.current.delete(id);
            }
          }
          for (const line of fresh) {
            const localIndex = next.findIndex((item) => item.state === "sending" && item.mine && item.body === line.body);
            const view = viewOf(line);
            if (localIndex >= 0) {
              next = next.map((item, index) => (index === localIndex ? { ...view, previewUrl: item.previewUrl } : item));
              changed = true;
            } else if (!next.some((item) => item.id === line.id)) {
              next = [...next, view];
              changed = true;
            }
          }
          if (reads.size > 0) {
            next = next.map((line) => {
              const readAt = reads.get(line.id);
              if (!readAt || line.readAt === readAt) return line;
              changed = true;
              return { ...line, readAt, state: "read" };
            });
          }
          if (changed) {
            void rememberThread({
              userId,
              side,
              partnerId,
              conversationId: payload.conversationId ?? openConversation,
              messages: savedLines(next),
            });
          }
          return changed ? next : current;
        });
      } catch {
        // The next check tries again.
      } finally {
        chatPolls.delete(key);
        setQuietId((current) => (current === partnerId ? null : current));
      }
    }
    void (async () => {
      while (!stop) {
        await pull();
        await new Promise((resolve) => window.setTimeout(resolve, 4000));
      }
    })();
    return () => {
      stop = true;
    };
  }, [active?.id, side, userId]);

  async function deliver(localId: string, body: string, file?: File | null) {
    if (!active) return;
    setLines((current) => current.map((line) => (line.id === localId && line.state === "failed" ? { ...line, state: "sending" } : line)));
    setError("");
    try {
      let response: Response;
      if (file) {
        const form = new FormData();
        form.set("side", side);
        form.set("partner", active.id);
        form.set("body", body);
        form.set("file", file);
        response = await new Promise<Response>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/care-chat");
          xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable) return;
            const progress = Math.min(100, Math.round((event.loaded / event.total) * 100));
            setLines((current) => current.map((line) => (line.id === localId ? { ...line, progress } : line)));
          };
          xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status, headers: { "content-type": xhr.getResponseHeader("content-type") || "application/json" } }));
          xhr.onerror = () => reject(new Error("network"));
          xhr.send(form);
        });
      } else {
        response = await fetch("/api/care-chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ side, partner: active.id, body }),
        });
      }
      const payload = (await response.json()) as { message?: string; conversationId?: string; line?: ChatLine };
      if (!response.ok || !payload.line) {
        setLines((current) => current.map((line) => (line.id === localId ? { ...line, state: "failed" } : line)));
        setError(payload.message || "The message could not be sent.");
        return;
      }
      seen.current.add(payload.line.id);
      if (payload.conversationId) setConversationId(payload.conversationId);
      if (file) {
        void rememberChatFile({
          userId,
          side,
          partnerId: active.id,
          messageId: payload.line.id,
          name: file.name,
          mime: file.type || "application/octet-stream",
          bytes: await file.arrayBuffer(),
        });
      }
      setLines((current) => {
        const next = current.map((line) => {
          if (line.id !== localId) return line;
          return { ...viewOf(payload.line!), previewUrl: line.previewUrl };
        });
        void rememberThread({
          userId,
          side,
          partnerId: active.id,
          conversationId: payload.conversationId ?? active.conversationId,
          messages: savedLines(next),
        });
        return next;
      });
    } catch {
      setLines((current) => current.map((line) => (line.id === localId ? { ...line, state: "failed" } : line)));
      setError("The message could not be sent.");
    }
  }

  function clearAttachment() {
    setAttachment(null);
    setAttachmentPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }

  function stopRecorder(save: boolean) {
    window.clearInterval(clockRef.current);
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setRecording(false);
      return;
    }
    recorder.onstop = () => {
      recorder.stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setRecording(false);
      const chunks = chunksRef.current;
      chunksRef.current = [];
      if (!save || chunks.length === 0) return;
      const type = (recorder.mimeType || "audio/webm").split(";")[0] || "audio/webm";
      const blob = new Blob(chunks, { type });
      if (blob.size < 1) {
        setError("That voice message was empty.");
        return;
      }
      const extension = type.includes("mp4") ? "m4a" : type.includes("mpeg") ? "mp3" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
      const file = new File([blob], `Voice message.${extension}`, { type });
      setAttachment(file);
      setAttachmentPreview((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(file);
      });
    };
    recorder.stop();
  }

  async function startRecording() {
    if (recording) return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record a voice message.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((item) => MediaRecorder.isTypeSupported(item)) ?? "";
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      } catch {
        stream.getTracks().forEach((track) => track.stop());
        setError("This browser cannot record a voice message.");
        return;
      }
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorderRef.current = recorder;
      recordSecondsRef.current = 0;
      setRecordSeconds(0);
      setRecording(true);
      recorder.start();
      window.clearInterval(clockRef.current);
      clockRef.current = window.setInterval(() => {
        recordSecondsRef.current += 1;
        setRecordSeconds(recordSecondsRef.current);
        if (recordSecondsRef.current >= 180) stopRecorder(true);
      }, 1000);
    } catch {
      setError("Allow the microphone to send a voice message.");
    }
  }

  async function removeMessage(line: ViewLine) {
    if (!active || deletingId) return;
    if (line.id.startsWith("local-")) {
      if (line.previewUrl) URL.revokeObjectURL(line.previewUrl);
      setLines((current) => current.filter((item) => item.id !== line.id));
      setOpenMenu(null);
      return;
    }
    setDeletingId(line.id);
    setError("");
    try {
      const response = await fetch(`/api/care-chat?${new URLSearchParams({ side, partner: active.id, message: line.id })}`, { method: "DELETE" });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(payload.message || "That message could not be deleted.");
        return;
      }
      seenOnServer.current.delete(line.id);
      void forgetChatFile(userId, side, active.id, line.id);
      setLines((current) => {
        const next = current.filter((item) => item.id !== line.id);
        void rememberThread({
          userId,
          side,
          partnerId: active.id,
          conversationId,
          messages: savedLines(next),
        });
        return next;
      });
      setOpenMenu(null);
    } catch {
      setError("That message could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || active.canReply === false) return;
    const body = draft.trim();
    const file = attachment;
    if (!body && !file) {
      setError("Write a message or choose a file.");
      return;
    }
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const previewUrl = file && (file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/")) ? URL.createObjectURL(file) : undefined;
    const pending: ViewLine = {
      id: localId,
      body: body || file?.name || "",
      at: new Date().toISOString(),
      mine: true,
      readAt: null,
      state: "sending",
      progress: file ? 0 : undefined,
      previewUrl,
      pendingFile: file ?? undefined,
      file: file ? { name: file.name, mime: file.type || "application/octet-stream", size: file.size } : null,
    };
    setLines((current) => [...current, pending]);
    setDraft("");
    clearAttachment();
    setError("");
    void deliver(localId, body, file);
  }

  async function wipe() {
    if (!active || clearing) return;
    setClearing(true);
    setError("");
    try {
      const response = await fetch(`/api/care-chat?${new URLSearchParams({ side, partner: active.id })}`, { method: "DELETE" });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(payload.message || "The chat could not be cleared.");
        return;
      }
      setLines([]);
      seen.current = new Set();
      seenOnServer.current = new Set();
      void forgetChatPartner(userId, side, active.id).then(() => rememberThread({
        userId,
        side,
        partnerId: active.id,
        conversationId,
        messages: [],
      }));
      setConfirmClear(false);
    } catch {
      setError("The chat could not be cleared.");
    } finally {
      setClearing(false);
    }
  }

  const presence = online ? "Online" : seenAt ? `Last seen ${listWhen(seenAt)}` : null;

  return (
    <section className={`care-chat ${active ? "is-open" : ""}`} aria-label="Messages" data-no-busy="">
      <aside className="care-chat-list">
        <header>
          <h1>Messages</h1>
          <p>{side === "patient" ? "Only doctors you have booked." : side === "admin" ? "Every patient and doctor." : "Only patients who booked you."}</p>
        </header>
            {!connected ? <p className="care-chat-offline">You are offline. Chats and files you already opened stay on this device.</p> : null}
            {roster.length === 0 ? (
          <p className="care-chat-empty">{side === "patient" ? "Book a visit to start a conversation. Other doctors stay hidden." : "Patients show up here after they book a visit with you."}</p>
        ) : (
          <ul>
            {roster.map((person) => {
              const current = person.id === active?.id;
              const unread = current ? 0 : chatUnread.byPartner[person.id] ?? person.unread;
              return (
            <li key={person.id}>
              <a
                href={`${listHref}/${person.id}`}
                aria-current={current ? "page" : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  openPerson(person, true);
                }}
              >
                    <span className={current && online ? "care-chat-avatar is-online" : "care-chat-avatar"}>
                      <ProfilePhoto userId={person.imageUserId} name={person.name} version={person.imageVersion} size={48} alt="" />
                    </span>
                    <span>
                      <strong>{person.name}</strong>
                      <em>{shownPreview(person.preview) || person.detail}</em>
                    </span>
                    <span className="care-chat-row-meta">
                      {person.when ? <time dateTime={person.when} suppressHydrationWarning>{listWhen(person.when)}</time> : null}
                      {unread > 0 ? <b>{unread > 9 ? "9+" : unread}</b> : null}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
      <div className="care-chat-thread">
        {active ? (
          <>
            <header>
              <a
                href={listHref}
                className="care-chat-back"
                aria-label="Back to messages"
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  closeChat(true);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 5.5 9 12l6.5 6.5" /></svg>
              </a>
              <span className={online ? "care-chat-avatar is-online" : "care-chat-avatar"}>
                <ProfilePhoto userId={active.imageUserId} name={active.name} version={active.imageVersion} size={42} alt="" />
              </span>
              <span>
                <strong>{active.name}</strong>
                <em>
                  {presence ? <span className={online ? "care-chat-presence" : undefined}>{presence}</span> : null}
                  {presence ? " · " : null}
                  {active.detail}
                </em>
              </span>
              <span className="care-chat-menu">
                <button type="button" aria-label="Chat options" aria-expanded={openMenu === "chat"} onClick={() => setOpenMenu((current) => current === "chat" ? null : "chat")}>
                  <ChevronIcon />
                </button>
                {openMenu === "chat" ? (
                  <span className="care-chat-menu-pop">
                    <button type="button" aria-label="Clear chat" onClick={() => { setOpenMenu(null); setConfirmClear(true); }}>
                      <TrashIcon />
                    </button>
                  </span>
                ) : null}
              </span>
            </header>
            {!connected ? <p className="care-chat-offline">You are offline. Messages and files already on this device still open.</p> : null}
            {confirmClear ? (
              <div className="care-chat-clear-bar">
                <p>This clears messages from your chat only. {active.name} will still have them.</p>
                <button type="button" onClick={() => void wipe()} disabled={clearing}>{clearing ? "Clearing" : "Clear chat"}</button>
                <button type="button" onClick={() => setConfirmClear(false)}>Cancel</button>
              </div>
            ) : null}
            <div ref={logRef} className="care-chat-log" aria-live="polite">
              {lines.length === 0 && quietId !== active.id ? <p className="care-chat-empty">Say hello. This stays between you and {active.name}.</p> : null}
              {lines.map((line, index) => {
                const showDay = index === 0 || dayLabel(lines[index - 1]!.at) !== dayLabel(line.at);
                return (
                  <div key={line.id}>
                    {showDay ? <p className="care-chat-day">{dayLabel(line.at)}</p> : null}
                    <article className={`${line.mine ? "is-mine" : ""} is-${line.state}`.trim()}>
                      {line.mine && line.state !== "sending" ? (
                        <span className="care-chat-menu">
                          <button type="button" aria-label="Message options" aria-expanded={openMenu === line.id} onClick={() => setOpenMenu((current) => current === line.id ? null : line.id)}>
                            <ChevronIcon />
                          </button>
                          {openMenu === line.id ? (
                            <span className="care-chat-menu-pop">
                              <button type="button" aria-label="Delete message" onClick={() => void removeMessage(line)} disabled={deletingId === line.id}>
                                <TrashIcon />
                              </button>
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                      {line.file ? (
                        <ChatFileView
                          line={line}
                          remoteHref={!line.id.startsWith("local-") ? fileHref(side, active.id, line.id) : undefined}
                          userId={userId}
                          connected={connected}
                          onOpen={setViewer}
                        />
                      ) : null}
                      {line.body && line.body !== line.file?.name && shownPreview(line.body) ? <p>{line.body}</p> : null}
                      <time dateTime={line.at} suppressHydrationWarning>
                        <span>{stamp(line.at)}</span>
                        {line.mine ? <span className={`care-chat-tick is-${line.state}`}>{deliveryLabel(line.state)}</span> : null}
                      </time>
                      {line.state === "failed" ? (
                        <button type="button" className="care-chat-retry" onClick={() => void deliver(line.id, line.file && line.body === line.file.name ? "" : line.body, line.pendingFile)}>Tap to retry</button>
                      ) : null}
                    </article>
                  </div>
                );
              })}
            </div>
            {active.canReply === false ? (
              <p className="care-chat-locked">You can't message an administrator.</p>
            ) : (
            <form onSubmit={send} className={recording ? "is-recording" : undefined}>
              {attachment ? (
                <div className="care-chat-file-chip">
                  {attachment.type.startsWith("image/") && attachmentPreview ? <img src={attachmentPreview} alt="" /> : null}
                  {attachment.type.startsWith("video/") && attachmentPreview ? <video src={attachmentPreview} muted playsInline /> : null}
                  {attachment.type.startsWith("audio/") && attachmentPreview ? <VoiceNote src={attachmentPreview} mine /> : null}
                  {attachment.type.startsWith("audio/") ? null : <span>{attachment.name}<em>{fileSize(attachment.size)}</em></span>}
                  <button type="button" onClick={clearAttachment}>Remove</button>
                </div>
              ) : null}
              {recording ? (
                <div className="care-chat-record" role="status">
                  <b />
                  <span>Recording {clock(recordSeconds)}</span>
                  <button type="button" onClick={() => stopRecorder(false)}>Cancel</button>
                  <button type="button" onClick={() => stopRecorder(true)}>Done</button>
                </div>
              ) : (
                <>
                  <div className="care-chat-tools">
                    <label className="care-chat-attach">
                      <span className="sr-only">Add a photo, document, or video</span>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,.doc,.docx,video/mp4,video/webm,video/quicktime,audio/webm,audio/mp4,audio/mpeg,audio/wav,audio/ogg"
                        onChange={(event) => {
                          const next = event.target.files?.[0];
                          if (next) {
                            setAttachment(next);
                            setAttachmentPreview((current) => {
                              if (current) URL.revokeObjectURL(current);
                              return next.type.startsWith("image/") || next.type.startsWith("video/") || next.type.startsWith("audio/")
                                ? URL.createObjectURL(next)
                                : null;
                            });
                          }
                          event.target.value = "";
                        }}
                      />
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12.5 14.8 5.7a3 3 0 1 1 4.2 4.2l-8.4 8.5a4.5 4.5 0 0 1-6.4-6.4l8-8" /></svg>
                    </label>
                  </div>
                  <label className="sr-only" htmlFor="care-chat-draft">Message</label>
                  <textarea
                    id="care-chat-draft"
                    value={draft}
                    maxLength={2000}
                    rows={1}
                    placeholder={`Message ${active.name}`}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  {draft.trim().length > 0 || attachment ? (
                    <button type="submit" aria-label="Send message">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-6.2 16-2.3-6.2z" /></svg>
                    </button>
                  ) : (
                    <button type="button" className="care-chat-mic" aria-label="Record a voice message" onClick={() => void startRecording()}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4" /></svg>
                    </button>
                  )}
                </>
              )}
              {error ? <p role="alert">{error}</p> : null}
              {conversationId ? <span className="sr-only">Conversation open</span> : null}
            </form>
            )}
            {viewer ? <FileViewer look={viewer} userId={userId} connected={connected} onClose={() => setViewer(null)} /> : null}
          </>
        ) : (
          <div className="care-chat-welcome">
            <h2>{roster.length === 0 ? "No conversations yet" : "Choose a person"}</h2>
            <p>{side === "patient" ? "Open a doctor you have booked to send a private message." : side === "admin" ? "Choose a person to send a message." : "Open a patient who booked you to reply."}</p>
          </div>
        )}
      </div>
    </section>
  );
}
