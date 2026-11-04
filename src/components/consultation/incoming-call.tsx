"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic, PhoneOff, Video } from "lucide-react";
import { ProfilePhoto } from "@/components/profile-photo";
import { startRingtone } from "./ringtone";
import "./incoming-call.css";

export function IncomingCallDialog({
  doctorName,
  doctorUserId = null,
  doctorImageVersion = null,
  when,
  joining,
  error,
  channel,
  onAccept,
  onDecline,
}: {
  doctorName: string;
  doctorUserId?: string | null;
  doctorImageVersion?: string | null;
  when: string;
  joining: boolean;
  error: string | null;
  channel: "audio" | "video";
  onAccept: () => void;
  onDecline: () => void;
}) {
  const acceptRef = useRef<HTMLButtonElement>(null);
  const audio = channel === "audio";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    acceptRef.current?.focus();
  }, [mounted]);

  useEffect(() => {
    if (joining) return;
    return startRingtone();
  }, [joining]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !joining) onDecline();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [joining, onDecline]);

  if (!mounted) return null;

  return createPortal(
    <div className="incoming-call" role="presentation">
      <section className="incoming-card" role="dialog" aria-modal="true" aria-labelledby="incoming-consultation-title">
        <p className="incoming-kicker">Incoming consultation</p>
        <div className="incoming-avatar">
          <i aria-hidden="true" />
          <i aria-hidden="true" />
          {doctorUserId ? (
            <ProfilePhoto userId={doctorUserId} name={doctorName} version={doctorImageVersion} size={112} alt="" />
          ) : (
            <img src="/default-avatar.svg" alt="" width={112} height={112} />
          )}
        </div>
        <h2 id="incoming-consultation-title">{doctorName} is calling</h2>
        <p className="incoming-when">{when} · Africa/Freetown</p>
        <p className="incoming-note">{audio ? "This visit was booked as audio. Accept to join with your microphone." : "This visit was booked as video. Accept to join with your camera."}</p>
        {error ? <p className="incoming-error" role="alert">{error}</p> : null}
        <div className="incoming-actions">
          <button className="incoming-decline" type="button" disabled={joining} onClick={onDecline}>
            <span><PhoneOff size={22} aria-hidden="true" /></span>
            Decline
          </button>
          <button ref={acceptRef} className={audio ? "incoming-audio" : "incoming-video"} type="button" disabled={joining} onClick={onAccept}>
            <span>{audio ? <Mic size={22} aria-hidden="true" /> : <Video size={22} aria-hidden="true" />}</span>
            {joining ? "Connecting…" : audio ? "Accept audio" : "Accept video"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
