"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { connectionFailureMessage, mediaAccessMessage } from "@/lib/consultations/messages";
import { declinedCallIds } from "./declined-calls";
import { DoctorLobby } from "./doctor-lobby";
import { ConsultationLoadingMark } from "./loading-mark";
import { PatientLobby } from "./patient-consult";
import "./consult.css";

const LiveSession = dynamic(() => import("./live-session").then((mod) => mod.LiveSession), {
  ssr: false,
  loading: () => <ConsultationLoadingMark />,
});

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function ConsultationSession({
  appointmentId,
  canJoin,
  configured,
  counterpart,
  when,
  returnHref,
  message,
  role,
  accept = null,
  counterpartUserId = null,
  counterpartImageVersion = null,
  specialty = "",
  service = "",
  verified = false,
  aside = null,
  startedAt = null,
  systemName = "CareCircle MindTogether",
  statusLabel = "",
}: {
  appointmentId: string;
  canJoin: boolean;
  configured: boolean;
  counterpart: string;
  when: string;
  returnHref: string;
  message: string;
  role: "patient" | "doctor";
  accept?: "video" | "audio" | null;
  counterpartUserId?: string | null;
  counterpartImageVersion?: string | null;
  specialty?: string;
  service?: string;
  verified?: boolean;
  aside?: ReactNode;
  startedAt?: string | null;
  systemName?: string;
  statusLabel?: string;
}) {
  const router = useRouter();
  const previewRef = useRef<HTMLVideoElement>(null);
  const previewStream = useRef<MediaStream | null>(null);
  const leaving = useRef(false);
  const [audioOnly, setAudioOnly] = useState(false);
  const [checking, setChecking] = useState(false);
  const [ready, setReady] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [connection, setConnection] = useState<{ serverUrl: string; token: string } | null>(null);
  const [dropped, setDropped] = useState(false);
  const [devices, setDevices] = useState<{ audio: MediaDeviceInfo[]; video: MediaDeviceInfo[]; output: MediaDeviceInfo[] }>({ audio: [], video: [], output: [] });
  const [audioInput, setAudioInput] = useState("");
  const [videoInput, setVideoInput] = useState("");
  const [audioOutput, setAudioOutput] = useState("");
  const [speakerNote, setSpeakerNote] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number | null>(null);
  const [arrived, setArrived] = useState(false);
  const [internet, setInternet] = useState("Not checked");
  const [cameraStatus, setCameraStatus] = useState("Not tested");
  const [micStatus, setMicStatus] = useState("Not tested");
  const [incoming, setIncoming] = useState<{ callId: string; doctorName: string; doctorUserId: string | null; doctorImageVersion: string | null; when: string } | null>(null);
  const [patientWaiting, setPatientWaiting] = useState(false);
  const [callNotice, setCallNotice] = useState<null | "declined" | "left">(null);
  const [holdMessage, setHoldMessage] = useState<string | null>(null);
  const started = useRef(false);
  const joinLock = useRef(false);
  const autoCall = useRef<string | null>(null);
  const selfHangup = useRef(false);
  const joinRef = useRef<(audioOnly: boolean) => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (previewRef.current && previewStream.current) previewRef.current.srcObject = previewStream.current;
  }, [ready, audioOnly]);

  useEffect(() => () => stopStream(previewStream.current), []);

  useEffect(() => {
    const update = () => setInternet(navigator.onLine ? "This browser reports an internet connection" : "This browser reports that you are offline");
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const stream = previewStream.current;
    const track = stream?.getAudioTracks()[0];
    if (!ready || !track) return;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let stop = false;
    const tick = () => {
      if (stop) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      setAudioLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      stop = true;
      window.cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
    };
  }, [ready, audioInput]);

  async function testSpeaker() {
    const context = new AudioContext();
    const withSink = context as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    try {
      if (audioOutput && withSink.setSinkId) await withSink.setSinkId(audioOutput);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.04;
      oscillator.frequency.value = 440;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.35);
      setSpeakerNote(audioOutput && !withSink.setSinkId
        ? "A tone was played through the default speaker. This browser cannot choose another output."
        : "A short test tone was played.");
    } catch {
      setSpeakerNote("The test tone could not be played. Check the speaker connection and try again.");
    } finally {
      window.setTimeout(() => void context.close(), 700);
    }
  }

  async function checkDevices(nextAudioOnly = audioOnly, nextAudio = audioInput, nextVideo = videoInput) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError(mediaAccessMessage("insecure"));
      return;
    }
    setMediaError(null);
    setChecking(true);
    setReady(false);
    setAudioLevel(null);
    stopStream(previewStream.current);
    previewStream.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: nextAudio ? { deviceId: { exact: nextAudio } } : true,
        video: nextAudioOnly ? false : nextVideo ? { deviceId: { exact: nextVideo } } : true,
      });
      previewStream.current = stream;
      const found = await navigator.mediaDevices.enumerateDevices();
      const audio = found.filter((device) => device.kind === "audioinput");
      const video = found.filter((device) => device.kind === "videoinput");
      const output = found.filter((device) => device.kind === "audiooutput");
      setDevices({ audio, video, output });
      const hasMic = stream.getAudioTracks().some((track) => track.readyState === "live");
      const hasCamera = stream.getVideoTracks().some((track) => track.readyState === "live");
      setMicStatus(hasMic ? "Microphone is on" : "No live microphone track");
      setCameraStatus(nextAudioOnly ? "Not used for audio only" : hasCamera ? "Camera preview is on" : "No live camera track");
      setInternet(navigator.onLine ? "This browser reports an internet connection" : "This browser reports that you are offline");
      setReady(hasMic);
      if (!hasMic) setMediaError(mediaAccessMessage("missing"));
    } catch (error) {
      setReady(false);
      setAudioLevel(null);
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setMicStatus("Permission denied");
        setCameraStatus(nextAudioOnly ? "Not used for audio only" : "Permission denied");
        setMediaError(mediaAccessMessage("denied"));
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setMicStatus("No microphone found");
        setCameraStatus(nextAudioOnly ? "Not used for audio only" : "No camera found");
        setMediaError(mediaAccessMessage("missing"));
      } else if (name === "NotReadableError" || name === "AbortError") {
        setMicStatus("Device is busy");
        setCameraStatus(nextAudioOnly ? "Not used for audio only" : "Device is busy");
        setMediaError(mediaAccessMessage("busy"));
      } else {
        setMicStatus("Could not be opened");
        setCameraStatus(nextAudioOnly ? "Not used for audio only" : "Could not be opened");
        setMediaError(mediaAccessMessage("failed"));
      }
    } finally {
      setChecking(false);
    }
  }

  async function join(nextAudioOnly = audioOnly) {
    if (joinLock.current) return;
    joinLock.current = true;
    leaving.current = false;
    selfHangup.current = false;
    setAudioOnly(nextAudioOnly);
    setJoinError(null);
    setDropped(false);
    setHoldMessage(null);
    setCallNotice(null);
    setJoining(true);
    stopStream(previewStream.current);
    previewStream.current = null;
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/consultation/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioOnly: nextAudioOnly }),
      });
      const payload = (await response.json()) as { serverUrl?: string; token?: string; error?: string };
      if (!response.ok || !payload.serverUrl || !payload.token) {
        setJoinError(payload.error || connectionFailureMessage());
        setReady(false);
        return;
      }
      setConnection({ serverUrl: payload.serverUrl, token: payload.token });
    } catch {
      setJoinError(connectionFailureMessage());
    } finally {
      joinLock.current = false;
      setJoining(false);
    }
  }

  useEffect(() => {
    joinRef.current = join;
  });

  useEffect(() => {
    if (role !== "patient" || !configured || connection || !incoming) return;
    if (declinedCallIds().includes(incoming.callId)) return;
    if (autoCall.current === incoming.callId) return;
    autoCall.current = incoming.callId;
    void joinRef.current(audioOnly);
  }, [audioOnly, configured, connection, incoming, role]);

  useEffect(() => {
    if (role !== "patient" || !accept || started.current || !configured) return;
    started.current = true;
    void joinRef.current(accept === "audio");
  }, [accept, configured, role]);

  useEffect(() => {
    if (role !== "patient" || !connection || !accept) return;
    router.replace(`/patient/appointments/${appointmentId}/consultation`);
  }, [accept, appointmentId, connection, role, router]);

  useEffect(() => {
    if (role !== "patient" || !configured || connection) return;
    let stop = false;
    async function look() {
      try {
        const response = await fetch(`/api/appointments/${appointmentId}/consultation/call`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { calling?: boolean; ended?: boolean; callId?: string; doctorName?: string; doctorUserId?: string; doctorImageVersion?: string | null; when?: string };
        if (stop) return;
        if (payload.calling && payload.callId && payload.doctorName) {
          setHoldMessage(null);
          setIncoming({
            callId: payload.callId,
            doctorName: payload.doctorName,
            doctorUserId: payload.doctorUserId || null,
            doctorImageVersion: payload.doctorImageVersion ?? null,
            when: payload.when || when,
          });
        } else {
          setIncoming(null);
          if (payload.ended) setHoldMessage("The doctor ended the call. Stay on this page to be called again.");
        }
      } catch {
        // The waiting screen stays up. The next check tries again.
      }
    }
    let timer = 0;
    function schedule() {
      if (stop) return;
      timer = window.setTimeout(() => {
        void look().finally(schedule);
      }, 3000);
    }
    void look().finally(schedule);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [appointmentId, configured, connection, role, when]);

  useEffect(() => {
    if (role !== "patient" || connection || !arrived) return;
    let stop = false;
    async function ping(method: "POST" | "DELETE") {
      try {
        await fetch(`/api/appointments/${appointmentId}/consultation/waiting`, {
          method,
          headers: { "Content-Type": "application/json" },
          body: "{}",
          keepalive: method === "DELETE",
        });
      } catch {
        // The next signal tries again.
      }
    }
    let timer = 0;
    function schedule() {
      if (stop) return;
      timer = window.setTimeout(() => {
        void ping("POST").finally(schedule);
      }, 4000);
    }
    void ping("POST").finally(schedule);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      void ping("DELETE");
    };
  }, [appointmentId, arrived, connection, role]);

  useEffect(() => {
    if (role !== "doctor" || !canJoin || connection) return;
    let stop = false;
    async function look() {
      try {
        const response = await fetch(`/api/appointments/${appointmentId}/consultation/waiting`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { waiting?: boolean };
        if (!stop) setPatientWaiting(payload.waiting === true);
      } catch {
        // The join screen stays as it is.
      }
    }
    let timer = 0;
    function schedule() {
      if (stop) return;
      timer = window.setTimeout(() => {
        void look().finally(schedule);
      }, 4000);
    }
    void look().finally(schedule);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [appointmentId, canJoin, connection, role]);

  useEffect(() => {
    if (role !== "doctor" || !canJoin) return;
    let stop = false;
    async function look() {
      try {
        const response = await fetch(`/api/appointments/${appointmentId}/consultation/calling`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { notice?: string };
        if (stop) return;
        setCallNotice(payload.notice === "declined" || payload.notice === "left" ? payload.notice : null);
      } catch {
        // The consultation screen stays as it is.
      }
    }
    let timer = 0;
    function schedule() {
      if (stop) return;
      timer = window.setTimeout(() => {
        void look().finally(schedule);
      }, 3000);
    }
    void look().finally(schedule);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [appointmentId, canJoin, role]);

  async function callAgain() {
    setCallNotice(null);
    setHoldMessage(null);
    if (connection) {
      try {
        await fetch(`/api/appointments/${appointmentId}/consultation/calling`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "recall" }),
        });
      } catch {
        setCallNotice("left");
      }
      return;
    }
    void join(audioOnly);
  }

  function doctorEndedCall() {
    if (selfHangup.current || leaving.current) return;
    setConnection(null);
    setIncoming(null);
    setHoldMessage("The doctor ended the call. Stay on this page to be called again.");
  }

  async function endCall() {
    if (leaving.current) return;
    leaving.current = true;
    selfHangup.current = true;
    setConnection(null);
    setCallNotice(null);
    setHoldMessage("You ended the call. The visit is still open. Join again to call the patient.");
    try {
      await fetch(`/api/appointments/${appointmentId}/consultation/calling`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end" }),
        keepalive: true,
      });
      await fetch(`/api/appointments/${appointmentId}/consultation/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        keepalive: true,
      });
    } catch {
      // The call is already closed on this page. The visit stays open.
    }
    leaving.current = false;
  }

  async function leave(failed = false) {
    if (leaving.current) return;
    leaving.current = true;
    setConnection(null);
    try {
      if (role === "doctor" && !failed) {
        const completed = await fetch(`/api/appointments/${appointmentId}/consultation/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          keepalive: true,
        });
        if (!completed.ok) {
          leaving.current = false;
          setHoldMessage("The consultation could not be marked complete. End the consultation again.");
          return;
        }
        await fetch(`/api/appointments/${appointmentId}/consultation/calling`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "end" }),
          keepalive: true,
        });
      }
      await fetch(`/api/appointments/${appointmentId}/consultation/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        keepalive: true,
      });
    } catch {
      // A failed request still returns the person to the appointment.
    }
    if (failed) {
      leaving.current = false;
      setDropped(true);
      return;
    }
    router.push(returnHref);
  }

  function exit() {
    if (connection) void leave(false);
    else router.push(returnHref);
  }

  const inCall = Boolean(connection) && !dropped;

  if (inCall && connection) {
    return (
      <section className={role === "patient" ? "pc-live" : "dr-live"}>
        <LiveSession
          appointmentId={appointmentId}
          role={role}
          audioOnly={audioOnly}
          audioDeviceId={audioInput}
          videoDeviceId={videoInput}
          audioOutputId={audioOutput}
          serverUrl={connection.serverUrl}
          token={connection.token}
          startedAt={startedAt}
          verified={verified}
          specialty={specialty}
          service={service}
          systemName={systemName}
          statusLabel={statusLabel}
          counterpartName={counterpart}
          counterpartUserId={counterpartUserId}
          counterpartImageVersion={counterpartImageVersion}
          aside={aside}
          callNotice={callNotice}
          onBack={exit}
          onCallAgain={() => void callAgain()}
          onDoctorEnded={doctorEndedCall}
          onEndCall={() => void endCall()}
          onLeave={() => void leave(false)}
          onReconnect={() => void join(audioOnly)}
          onConnectionFailed={() => void leave(true)}
        />
      </section>
    );
  }

  if (role === "patient") {
    if (joining) return <ConsultationLoadingMark />;
    return (
      <>
        <PatientLobby
          aside={aside}
          audioInput={audioInput}
          audioLevel={audioLevel}
          audioOnly={audioOnly}
          audioOutput={audioOutput}
          canJoin={canJoin}
          checking={checking}
          configured={configured}
          counterpart={counterpart}
          devices={devices}
          droppedMessage={dropped ? connectionFailureMessage() : null}
          holdMessage={holdMessage}
          joinError={joinError}
          joining={joining}
          mediaError={mediaError}
          message={message}
          previewRef={previewRef}
          ready={ready}
          service={service}
          specialty={specialty}
          systemName={systemName}
          videoInput={videoInput}
          onAudioInput={(value) => { setAudioInput(value); void checkDevices(audioOnly, value, videoInput); }}
          onAudioOnly={(value) => { setAudioOnly(value); setReady(false); setCameraStatus(value ? "Not used for audio only" : "Not tested"); }}
          onAudioOutput={setAudioOutput}
          arrived={arrived}
          onArrive={() => setArrived(true)}
          onBack={exit}
          onTest={() => void checkDevices()}
          onVideoInput={(value) => { setVideoInput(value); void checkDevices(audioOnly, audioInput, value); }}
        />
      </>
    );
  }

  return (
    <DoctorLobby
      aside={aside}
      audioInput={audioInput}
      audioLevel={audioLevel}
      audioOnly={audioOnly}
      audioOutput={audioOutput}
      cameraStatus={cameraStatus}
      canJoin={canJoin}
      checking={checking}
      configured={configured}
      counterpart={counterpart}
      devices={devices}
      droppedMessage={dropped ? connectionFailureMessage() : null}
      holdMessage={holdMessage}
      internet={internet}
      joinError={joinError}
      joining={joining}
      mediaError={mediaError}
      message={message}
      micStatus={micStatus}
      onAudioInput={(value) => { setAudioInput(value); void checkDevices(audioOnly, value, videoInput); }}
      onAudioOnly={(value) => { setAudioOnly(value); setReady(false); setCameraStatus(value ? "Not used for audio only" : "Not tested"); }}
      onAudioOutput={setAudioOutput}
      onBack={exit}
      onCallAgain={() => void callAgain()}
      onJoin={() => void join()}
      onTest={() => void checkDevices()}
      onTestSpeaker={() => void testSpeaker()}
      onVideoInput={(value) => { setVideoInput(value); void checkDevices(audioOnly, audioInput, value); }}
      previewRef={previewRef}
      ready={ready}
      service={service}
      speakerNote={speakerNote}
      specialty={specialty}
      statusLabel={statusLabel}
      videoInput={videoInput}
      waitingName={patientWaiting ? counterpart : null}
      callNotice={callNotice}
    />
  );
}
