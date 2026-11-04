"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  Clock,
  Lock,
  Mic,
  MicOff,
  PanelRight,
  PhoneOff,
  RotateCcw,
  Settings,
  Video,
  VideoOff,
  Wifi,
} from "lucide-react";
import { ProfilePhoto } from "@/components/profile-photo";
import {
  VideoTrack,
  isTrackReference,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { ConnectionQuality, ConnectionState, ParticipantEvent, RoomEvent, Track } from "livekit-client";
import { mediaAccessMessage } from "@/lib/consultations/messages";
import { enableConsultationCamera } from "@/lib/consultations/video-quality";
import { useVoice, VoiceFrame } from "./voice-frame";
import "./doctor-room.css";

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function deviceMessage(failure?: string) {
  if (failure === "PermissionDenied") return mediaAccessMessage("denied");
  if (failure === "NotFound") return mediaAccessMessage("missing");
  if (failure === "DeviceInUse") return mediaAccessMessage("busy");
  return mediaAccessMessage("failed");
}

export function DoctorStage({
  aside,
  audioOnly,
  audioOutputId,
  callNotice,
  counterpartImageVersion,
  counterpartName,
  counterpartUserId,
  onCallAgain,
  onEndCall,
  onLeave,
  onReconnect,
  service,
  specialty,
  startedAt,
  starting,
  statusLabel,
}: {
  aside: ReactNode;
  audioOnly: boolean;
  audioOutputId: string;
  callNotice: "declined" | "left" | null;
  counterpartImageVersion: string | null;
  counterpartName: string;
  counterpartUserId: string | null;
  onCallAgain: () => void;
  onEndCall: () => void;
  onLeave: () => void;
  onReconnect: () => void;
  service: string;
  specialty: string;
  startedAt: string | null;
  starting: boolean;
  statusLabel: string;
}) {
  const room = useRoomContext();
  const connection = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [quality, setQuality] = useState(localParticipant.connectionQuality);
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  const [controlBusy, setControlBusy] = useState<null | "mic" | "camera" | "leave" | "end">(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [panel, setPanel] = useState(false);
  const [patientLeft, setPatientLeft] = useState(false);
  const sawPatient = useRef(false);
  const localOrigin = useRef<number | null>(null);
  const [clock, setClock] = useState("00:00:00");

  useEffect(() => {
    const apply = (next: ConnectionQuality) => setQuality(next);
    apply(localParticipant.connectionQuality);
    localParticipant.on(ParticipantEvent.ConnectionQualityChanged, apply);
    return () => {
      localParticipant.off(ParticipantEvent.ConnectionQualityChanged, apply);
    };
  }, [localParticipant]);

  useEffect(() => {
    if (!startedAt && connection !== ConnectionState.Connected) return;
    if (!startedAt && localOrigin.current === null) localOrigin.current = Date.now();
    const origin = startedAt ? Date.parse(startedAt) : localOrigin.current;
    if (origin === null || Number.isNaN(origin)) return;
    const tick = () => setClock(formatDuration(Math.max(0, Math.floor((Date.now() - origin) / 1000))));
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [connection, startedAt]);

  const remotes = participants.filter((participant) => !participant.isLocal);
  const remoteTrack = tracks.find((track) => !track.participant.isLocal) ?? null;
  const localTrack = tracks.find((track) => track.participant.isLocal) ?? null;
  const remote = remotes[0] ?? null;
  const waiting = connection === ConnectionState.Connected && !remote;
  const reconnecting = connection === ConnectionState.Reconnecting || connection === ConnectionState.SignalReconnecting;
  const connected = connection === ConnectionState.Connected;
  const remoteName = remote?.name || counterpartName || "Patient";
  const remoteLevel = useVoice(remote);
  const localLevel = useVoice(localParticipant);
  const remoteCameraOff = !remoteTrack || !isTrackReference(remoteTrack) || remoteTrack.publication?.isMuted === true;
  const localCameraOff = audioOnly || !isCameraEnabled || !localTrack || !isTrackReference(localTrack);
  const recall = callNotice === "declined" || callNotice === "left" || patientLeft;
  const recallText = callNotice === "declined"
    ? "The patient declined the call. Call again if they dropped it by mistake. They will receive the call."
    : "The patient left the call. Call again and they will receive it.";

  useEffect(() => {
    if (remote) {
      sawPatient.current = true;
      setPatientLeft(false);
      return;
    }
    if (sawPatient.current && connected) setPatientLeft(true);
  }, [connected, remote]);

  useEffect(() => {
    const onFailure = (failure?: { name?: string } | string) => {
      const name = typeof failure === "string" ? failure : failure?.name;
      setMediaNote(deviceMessage(name));
    };
    room.on(RoomEvent.MediaDevicesError, onFailure);
    return () => {
      room.off(RoomEvent.MediaDevicesError, onFailure);
    };
  }, [room]);

  useEffect(() => {
    let ignore = false;
    async function loadDevices() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const found = await navigator.mediaDevices.enumerateDevices();
      if (!ignore) setDevices(found);
    }
    void loadDevices();
    return () => {
      ignore = true;
    };
  }, [connection]);

  useEffect(() => {
    if (!audioOutputId) return;
    void room.switchActiveDevice("audiooutput", audioOutputId).catch(() => {
      setMediaNote("This browser could not switch the speaker. Audio continues on the default output.");
    });
  }, [audioOutputId, room]);

  const linkTone = reconnecting || quality === ConnectionQuality.Lost ? "is-down" : !connected || quality === ConnectionQuality.Poor || quality === ConnectionQuality.Unknown ? "is-wait" : "is-good";
  const linkText = reconnecting ? "Reconnecting" : starting || connection === ConnectionState.Connecting ? "Connecting" : !connected ? "Not connected" : quality === ConnectionQuality.Poor ? "Weak connection" : quality === ConnectionQuality.Lost ? "Connection lost" : "Good connection";
  const subtitle = [specialty, service].filter(Boolean).join(" · ");

  async function toggleMic() {
    if (controlBusy) return;
    setControlBusy("mic");
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } finally {
      setControlBusy(null);
    }
  }

  async function toggleCamera() {
    if (audioOnly || controlBusy) return;
    setControlBusy("camera");
    try {
      if (isCameraEnabled) await localParticipant.setCameraEnabled(false);
      else await enableConsultationCamera(localParticipant);
    } finally {
      setControlBusy(null);
    }
  }

  async function chooseDevice(kind: MediaDeviceKind, deviceId: string) {
    if (!deviceId) return;
    await room.switchActiveDevice(kind, deviceId);
  }

  return (
    <div className="dr-room">
      <header className="dr-bar">
        <button className="dr-back" type="button" aria-label="Back to appointments" onClick={() => setConfirmLeave(true)}>
          <ChevronLeft aria-hidden="true" size={18} />
          <span>Back to appointments</span>
        </button>
        <div className="dr-title">
          <strong>{service || "Consultation"}</strong>
          <span>{remoteName}{subtitle ? ` · ${subtitle}` : ""}</span>
        </div>
        <div className="dr-status">
          <span className="dr-chip">{statusLabel || "In progress"}</span>
          <span className={`dr-chip ${linkTone}`} role="status"><Wifi aria-hidden="true" size={14} />{linkText}</span>
          <span className="dr-chip"><Clock aria-hidden="true" size={14} />{clock}</span>
        </div>
        <button className="dr-panel-toggle" type="button" aria-expanded={panel} aria-label="Clinical workspace" onClick={() => setPanel((open) => !open)}>
          <PanelRight aria-hidden="true" size={16} />
          <span>Clinical workspace</span>
        </button>
      </header>
      <div className="dr-body">
        <div className="dr-stage-col">
          <div className={`dr-stage${remoteLevel > 0 ? " is-talking" : ""}`} style={{ "--talk": String(remoteLevel) } as CSSProperties}>
            {remoteTrack && isTrackReference(remoteTrack) && !remoteCameraOff ? (
              <VideoTrack className="dr-video" trackRef={remoteTrack} />
            ) : (
              <div className="dr-idle">
                <VoiceFrame
                  face={counterpartUserId ? <ProfilePhoto userId={counterpartUserId} name={remoteName} version={counterpartImageVersion} size={96} alt="" /> : undefined}
                  label={remoteName}
                  level={remoteLevel}
                />
                <p>{waiting ? "Waiting for the patient" : reconnecting ? "Reconnecting" : "Audio"}</p>
              </div>
            )}
            <p className="dr-name">
              {remote && !remote.isMicrophoneEnabled ? <MicOff aria-hidden="true" size={14} /> : <Mic aria-hidden="true" size={14} />}
              <span>{remoteName}<small>{remoteLevel > 0 ? "Talking" : "Patient"}</small></span>
            </p>
            <div className={`dr-pip${localCameraOff ? " is-audio" : ""}${localLevel > 0 ? " is-talking" : ""}`} style={{ "--talk": String(localLevel) } as CSSProperties}>
              {localTrack && isTrackReference(localTrack) && !localCameraOff ? (
                <VideoTrack className="dr-video" trackRef={localTrack} />
              ) : (
                <VoiceFrame label="You" level={localLevel} face={<Mic aria-hidden="true" size={18} />} />
              )}
              <p className="dr-name is-you">{isMicrophoneEnabled ? <Mic aria-hidden="true" size={12} /> : <MicOff aria-hidden="true" size={12} />} You</p>
            </div>
          </div>
          {mediaNote ? <p className="dr-alert" role="alert">{mediaNote}</p> : null}
          {recall ? (
            <div className="dr-recall" role="status">
              <p>{recallText}</p>
              <button className="dr-primary" type="button" onClick={onCallAgain}>Call again</button>
            </div>
          ) : null}
          {devicesOpen ? (
            <div className="dr-menu">
              <label>
                Microphone
                <select aria-label="Microphone during consultation" onChange={(event) => void chooseDevice("audioinput", event.target.value)}>
                  {devices.filter((device) => device.kind === "audioinput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Microphone"}</option>)}
                </select>
              </label>
              {audioOnly ? null : (
                <label>
                  Camera
                  <select aria-label="Camera during consultation" onChange={(event) => void chooseDevice("videoinput", event.target.value)}>
                    {devices.filter((device) => device.kind === "videoinput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Camera"}</option>)}
                  </select>
                </label>
              )}
              <label>
                Speaker
                <select aria-label="Speaker during consultation" defaultValue={audioOutputId} onChange={(event) => void chooseDevice("audiooutput", event.target.value)}>
                  {devices.filter((device) => device.kind === "audiooutput").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Speaker"}</option>)}
                </select>
              </label>
              <p className="dr-quiet">Screen sharing is not enabled for this consultation.</p>
              <button className="dr-secondary" type="button" onClick={onReconnect}><RotateCcw aria-hidden="true" size={16} />Reconnect</button>
            </div>
          ) : null}
          <div className="dr-dock">
            <button className={`dr-ctrl ${isMicrophoneEnabled ? "" : "is-off"}`} type="button" disabled={controlBusy !== null} aria-pressed={!isMicrophoneEnabled} onClick={() => void toggleMic()}>
              <span>{isMicrophoneEnabled ? <Mic aria-hidden="true" size={18} /> : <MicOff aria-hidden="true" size={18} />}</span>
              {isMicrophoneEnabled ? "Mute" : "Unmute"}
            </button>
            <button className={`dr-ctrl ${isCameraEnabled && !audioOnly ? "" : "is-off"}`} type="button" disabled={audioOnly || controlBusy !== null} aria-pressed={!isCameraEnabled || audioOnly} onClick={() => void toggleCamera()}>
              <span>{isCameraEnabled && !audioOnly ? <Video aria-hidden="true" size={18} /> : <VideoOff aria-hidden="true" size={18} />}</span>
              {audioOnly ? "Audio only" : isCameraEnabled ? "Stop video" : "Start video"}
            </button>
            <button className="dr-ctrl" type="button" aria-expanded={devicesOpen} onClick={() => setDevicesOpen((open) => !open)}>
              <span><Settings aria-hidden="true" size={18} /></span>
              Devices <ChevronDown aria-hidden="true" size={14} />
            </button>
            <button className="dr-leave" type="button" disabled={controlBusy !== null} onClick={() => setConfirmEnd(true)}>
              <PhoneOff aria-hidden="true" size={16} />
              End call
            </button>
          </div>
          <p className="dr-privacy"><Lock aria-hidden="true" size={14} />This consultation is secure and private. Please do not share the link with anyone else.</p>
        </div>
        <aside className={`dr-side${panel ? " is-open" : ""}`}>
          <button className="dr-side-close" type="button" onClick={() => setPanel(false)}>Close workspace</button>
          {aside}
        </aside>
      </div>
      {confirmEnd ? (
        <div className="dr-dialog" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="doctor-end-title">
            <h2 id="doctor-end-title">End the call?</h2>
            <p>The patient leaves the room. You stay on this page and can call again. This does not complete the visit.</p>
            <div className="dr-actions">
              <button className="dr-secondary" type="button" onClick={() => setConfirmEnd(false)}>Stay</button>
              <button className="dr-leave" type="button" disabled={controlBusy !== null} onClick={() => { setControlBusy("end"); setConfirmEnd(false); void room.disconnect().finally(onEndCall); }}>
                <PhoneOff aria-hidden="true" size={16} />
                End call
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmLeave ? (
        <div className="dr-dialog" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="doctor-leave-title">
            <h2 id="doctor-leave-title">End the consultation?</h2>
            <p>The system marks this visit complete. You will not be able to rejoin this consultation.</p>
            <div className="dr-actions">
              <button className="dr-secondary" type="button" onClick={() => setConfirmLeave(false)}>Stay</button>
              <button className="dr-leave" type="button" disabled={controlBusy !== null} onClick={() => { setControlBusy("leave"); void room.disconnect().finally(onLeave); }}>
                <PhoneOff aria-hidden="true" size={16} />
                End consultation
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
