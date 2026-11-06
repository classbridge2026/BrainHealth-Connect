"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { ProfilePhoto } from "@/components/profile-photo";
import type { ChatLine, ChatPerson } from "@/lib/care-chat/service";
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
};

type Delivery = "sending" | "sent" | "read" | "failed";

type ViewLine = ChatLine & { state: Delivery; previewUrl?: string; pendingFile?: File; progress?: number };
type FileLook = { href: string; downloadHref: string; name: string; mime: string };

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

function VoiceNote({ src, mine }: { src: string; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const bars = waveOf(src);
  const progress = length > 0 ? Math.min(1, time / length) : 0;

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }

  function seek(event: MouseEvent<HTMLButtonElement>) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(length) || length <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * length;
    setTime(audio.currentTime);
  }

  return (
    <div className={`care-chat-voice${mine ? " is-mine" : ""}`}>
      <button type="button" className="care-chat-voice-play" aria-label={playing ? "Pause voice message" : "Play voice message"} onClick={toggle}>
        {playing ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
        )}
      </button>
      <span className="care-chat-voice-body">
        <button type="button" className="care-chat-voice-wave" onClick={seek} aria-label="Voice message progress">
          {bars.map((height, index) => (
            <i key={index} className={index / bars.length < progress ? "is-played" : undefined} style={{ height }} />
          ))}
        </button>
        <span>{clock(Math.max(0, Math.floor(playing || time > 0 ? time : length)))}</span>
      </span>
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
    </div>
  );
}

function ChatFileView({ line, href, downloadHref, onOpen }: { line: ViewLine; href?: string; downloadHref?: string; onOpen?: (look: FileLook) => void }) {
  const file = line.file;
  if (!file) return null;
  const sending = line.state === "sending";
  const look = href ? { href, downloadHref: downloadHref || href, name: file.name, mime: file.mime } : null;
  if (file.mime.startsWith("audio/")) return href ? <VoiceNote src={href} mine={line.mine} /> : <p className="care-chat-file-name">{file.name}</p>;
  if (file.mime.startsWith("image/") || file.mime.startsWith("video/")) {
    return (
      <div className={`care-chat-media${sending ? " is-sending" : ""}`}>
        <button type="button" className="care-chat-media-open" disabled={sending || !look} onClick={() => look && onOpen?.(look)}>
          {href && file.mime.startsWith("image/") ? (
            <img src={href} alt={file.name} />
          ) : null}
          {href && file.mime.startsWith("video/") ? (
            <video src={href} preload="metadata" playsInline muted />
          ) : null}
        </button>
        {sending ? (
          <span className="care-chat-send-ring" aria-label={`Sending ${line.progress ?? 0}%`}>
            <b style={{ ["--sent" as string]: `${line.progress ?? 8}%` }} />
            <em>{line.progress ? `${line.progress}%` : "Sending"}</em>
          </span>
        ) : look ? (
          <span className="care-chat-media-actions">
            <button type="button" onClick={() => onOpen?.(look)}>View</button>
            <a href={look.downloadHref} download={file.name}>Download</a>
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div className={`care-chat-doc-card${sending ? " is-sending" : ""}`}>
      <span className="care-chat-doc-mark">{file.mime.includes("pdf") ? "PDF" : file.mime.includes("word") || file.name.endsWith(".doc") || file.name.endsWith(".docx") ? "DOC" : "FILE"}</span>
      <span>
        <strong>{file.name}</strong>
        <em>{fileSize(file.size)}{sending ? ` · ${line.progress ? `${line.progress}%` : "Sending"}` : ""}</em>
      </span>
      {look && !sending ? (
        <span className="care-chat-doc-actions">
          <button type="button" onClick={() => onOpen?.(look)}>View</button>
          <a href={look.downloadHref} download={file.name}>Download</a>
        </span>
      ) : null}
    </div>
  );
}

function FileViewer({ look, onClose }: { look: FileLook; onClose: () => void }) {
  const [src, setSrc] = useState(look.href);
  const [text, setText] = useState("");
  const kind = look.mime.startsWith("image/") ? "image" : look.mime.startsWith("video/") ? "video" : look.mime === "application/pdf" ? "pdf" : look.mime === "text/plain" ? "text" : "file";

  useEffect(() => {
    let stop = false;
    let objectUrl = "";
    setSrc(look.href);
    setText("");
    void (async () => {
      try {
        const response = await fetch(look.href);
        if (!response.ok || stop) return;
        const blob = await response.blob();
        if (kind === "text") {
          const body = await blob.text();
          if (!stop) setText(body);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        if (!stop) setSrc(objectUrl);
      } catch {
        // The original signed-in file route still opens.
      }
    })();
    return () => {
      stop = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, look.href]);

  return (
    <div className="care-chat-viewer" role="dialog" aria-modal="true" aria-label={look.name}>
      <header>
        <strong>{look.name}</strong>
        <a href={look.downloadHref} download={look.name}>Download</a>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <div className="care-chat-viewer-stage">
        {kind === "image" ? <img src={src} alt={look.name} /> : null}
        {kind === "video" ? <video src={src} controls autoPlay playsInline /> : null}
        {kind === "pdf" ? <iframe className="care-chat-viewer-frame" title={look.name} src={src} /> : null}
        {kind === "text" ? <pre className="care-chat-viewer-text">{text || "Opening…"}</pre> : null}
        {kind === "file" ? (
          <p className="care-chat-viewer-doc">
            <a href={src} target="_blank" rel="noreferrer">Open</a>
            <a href={look.downloadHref} download={look.name}>Download</a>
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

export function CareChat({
  listHref,
  side,
  people,
  active,
}: {
  listHref: string;
  side: "patient" | "doctor";
  people: ChatPerson[];
  active: ActiveChat | null;
}) {
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
    const next = (active?.messages ?? []).map(viewOf);
    setLines(next);
    setConversationId(active?.conversationId ?? null);
    setDraft("");
    setError("");
    setOnline(active?.online ?? false);
    setSeenAt(active?.seenAt ?? null);
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
  }, [active]);

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
    const key = `${side}:${active.id}`;
    let stop = false;
    async function pull() {
      if (stop || document.visibilityState === "hidden" || chatPolls.has(key)) return;
      chatPolls.add(key);
      const confirmed = [...linesRef.current].reverse().find((line) => line.state === "sent" || line.state === "read");
      const query = new URLSearchParams({ side, partner: active!.id, after: confirmed?.at ?? "" });
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
          return changed ? next : current;
        });
      } catch {
        // The next check tries again.
      } finally {
        chatPolls.delete(key);
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
  }, [active, side]);

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
            const progress = Math.max(1, Math.round((event.loaded / event.total) * 100));
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
      setLines((current) => current.map((line) => {
        if (line.id !== localId) return line;
        return { ...viewOf(payload.line!), previewUrl: line.previewUrl };
      }));
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
      setLines((current) => current.filter((item) => item.id !== line.id));
      setOpenMenu(null);
    } catch {
      setError("That message could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
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
      progress: file ? 1 : undefined,
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
      setConfirmClear(false);
    } catch {
      setError("The chat could not be cleared.");
    } finally {
      setClearing(false);
    }
  }

  const presence = online ? "Online" : seenAt ? `Last seen ${listWhen(seenAt)}` : null;

  return (
    <section className={`care-chat ${active ? "is-open" : ""}`} aria-label="Messages">
      <aside className="care-chat-list">
        <header>
          <h1>Messages</h1>
          <p>{side === "patient" ? "Only doctors you have booked." : "Only patients who booked you."}</p>
        </header>
        {people.length === 0 ? (
          <p className="care-chat-empty">{side === "patient" ? "Book a visit to start a conversation. Other doctors stay hidden." : "Patients show up here after they book a visit with you."}</p>
        ) : (
          <ul>
            {people.map((person) => {
              const current = person.id === active?.id;
              const unread = current ? 0 : chatUnread.byPartner[person.id] ?? person.unread;
              return (
                <li key={person.id}>
                  <Link href={`${listHref}/${person.id}`} aria-current={current ? "page" : undefined}>
                    <span className={current && online ? "care-chat-avatar is-online" : "care-chat-avatar"}>
                      <ProfilePhoto userId={person.imageUserId} name={person.name} version={person.imageVersion} size={48} alt="" />
                    </span>
                    <span>
                      <strong>{person.name}</strong>
                      <em>{person.preview || person.detail}</em>
                    </span>
                    <span className="care-chat-row-meta">
                      {person.when ? <time dateTime={person.when} suppressHydrationWarning>{listWhen(person.when)}</time> : null}
                      {unread > 0 ? <b>{unread > 9 ? "9+" : unread}</b> : null}
                    </span>
                  </Link>
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
              <Link href={listHref} className="care-chat-back" aria-label="Back to messages">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 5.5 9 12l6.5 6.5" /></svg>
              </Link>
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
            {confirmClear ? (
              <div className="care-chat-clear-bar">
                <p>This clears messages from your chat only. {active.name} will still have them.</p>
                <button type="button" onClick={() => void wipe()} disabled={clearing}>{clearing ? "Clearing" : "Clear chat"}</button>
                <button type="button" onClick={() => setConfirmClear(false)}>Cancel</button>
              </div>
            ) : null}
            <div ref={logRef} className="care-chat-log" aria-live="polite">
              {lines.length === 0 ? <p className="care-chat-empty">Say hello. This stays between you and {active.name}.</p> : null}
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
                          href={line.previewUrl || (!line.id.startsWith("local-") ? fileHref(side, active.id, line.id) : undefined)}
                          downloadHref={line.id.startsWith("local-") ? line.previewUrl : fileHref(side, active.id, line.id, true)}
                          onOpen={setViewer}
                        />
                      ) : null}
                      {line.body && line.body !== line.file?.name ? <p>{line.body}</p> : null}
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
            <form onSubmit={send} className={recording ? "is-recording" : undefined}>
              {attachment ? (
                <div className="care-chat-file-chip">
                  {attachment.type.startsWith("image/") && attachmentPreview ? <img src={attachmentPreview} alt="" /> : null}
                  {attachment.type.startsWith("video/") && attachmentPreview ? <video src={attachmentPreview} muted playsInline /> : null}
                  {attachment.type.startsWith("audio/") && attachmentPreview ? <VoiceNote src={attachmentPreview} mine /> : null}
                  <span>{attachment.name}<em>{fileSize(attachment.size)}</em></span>
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
            {viewer ? <FileViewer look={viewer} onClose={() => setViewer(null)} /> : null}
          </>
        ) : (
          <div className="care-chat-welcome">
            <h2>{people.length === 0 ? "No conversations yet" : "Choose a person"}</h2>
            <p>{side === "patient" ? "Open a doctor you have booked to send a private message." : "Open a patient who booked you to reply."}</p>
          </div>
        )}
      </div>
    </section>
  );
}
