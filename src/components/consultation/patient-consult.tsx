"use client";

import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import {
  BadgeCheck,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  Clock,
  CreditCard,
  LoaderCircle,
  Mic,
  MicOff,
  PhoneOff,
  Settings,
  Stethoscope,
  Video,
  VideoOff,
  Wifi,
} from "lucide-react";
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
import { CareCircleMark } from "@/components/brand";
import { ProfilePhoto } from "@/components/profile-photo";
import { connectionQualityLabel, mediaAccessMessage } from "@/lib/consultations/messages";
import { enableConsultationCamera } from "@/lib/consultations/video-quality";
import { useVoice, VoiceFrame } from "./voice-frame";
import "./patient-consult.css";

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

export function PatientVisitPanel({
  doctorName,
  doctorUserId,
  doctorImageVersion,
  verified,
  specialty,
  service,
  when,
  until,
  statusLabel,
  fee,
  paymentLabel,
  preparation,
  supportEmail,
}: {
  doctorName: string;
  doctorUserId: string;
  doctorImageVersion: string | null;
  verified: boolean;
  specialty: string;
  service: string;
  when: string;
  until: string;
  statusLabel: string;
  fee: string;
  paymentLabel: string;
  preparation: string | null;
  supportEmail: string | null;
}) {
  return (
    <>
      <section className="pc-card" aria-label="Appointment details">
        <h2><CalendarDays size={18} aria-hidden="true" /> Appointment details</h2>
        <ul className="pc-facts">
          <li>
            <CalendarDays size={18} aria-hidden="true" />
            <span>
              <strong>{when}</strong>
              <span>Until {until}</span>
              <span>Africa/Freetown</span>
            </span>
          </li>
          <li>
            <ProfilePhoto userId={doctorUserId} name={doctorName} version={doctorImageVersion} size={40} alt="" />
            <span>
              <strong>
                {doctorName}
                {verified ? <BadgeCheck size={14} aria-label="Verified" /> : null}
              </strong>
              <span>{specialty}</span>
            </span>
          </li>
          <li>
            <Stethoscope size={18} aria-hidden="true" />
            <span>
              <span>Consultation</span>
              <strong>{service}</strong>
            </span>
          </li>
          <li>
            <Video size={18} aria-hidden="true" />
            <span>
              <span>Mode</span>
              <strong>Online consultation</strong>
            </span>
          </li>
          <li>
            <span className="pc-chip">{statusLabel}</span>
          </li>
          <li>
            <CreditCard size={18} aria-hidden="true" />
            <span>
              <span>Payment</span>
              <strong>{paymentLabel}{fee ? ` · ${fee}` : ""}</strong>
            </span>
          </li>
        </ul>
        {preparation ? <p className="pc-help">{preparation}</p> : null}
      </section>
      <section className="pc-card pc-help" aria-label="Help">
        <h2><CircleHelp size={18} aria-hidden="true" /> Help</h2>
        <p>Allow the camera and microphone when the browser asks. You can switch devices from the settings control.</p>
        <p>Leaving the room keeps this appointment open. It does not complete the consultation.</p>
        {supportEmail ? <p>Need help? <a href={`mailto:${supportEmail}`}>{supportEmail}</a></p> : <p>A support email has not been published for this clinic.</p>}
      </section>
    </>
  );
}

function SidePanel({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <aside className={`pc-side${open ? " is-open" : ""}`}>
      <button className="pc-side-toggle" type="button" aria-expanded={open} aria-controls="patient-appointment-panel" onClick={() => setOpen((value) => !value)}>
        Appointment details and help
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <div className="pc-side-body" id="patient-appointment-panel">
        {children}
      </div>
    </aside>
  );
}

export function PatientConsultFrame({
  systemName,
  counterpart,
  specialty,
  service,
  statusLabel,
  statusTone,
  clock,
  aside,
  onBack,
  alert,
  dock,
  children,
  stageClass,
  stageStyle,
}: {
  systemName: string;
  counterpart: string;
  specialty: string;
  service: string;
  statusLabel: string;
  statusTone: "wait" | "good" | "down";
  clock?: string | null;
  aside: ReactNode;
  onBack: () => void;
  alert?: ReactNode;
  dock?: ReactNode;
  children: ReactNode;
  stageClass?: string;
  stageStyle?: CSSProperties;
}) {
  const subtitle = [specialty, service].filter(Boolean).join(" · ");
  return (
    <div className="pc-shell">
      <header className="pc-header">
        <button className="pc-back" type="button" onClick={onBack} aria-label="Back to appointments">
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <div className="pc-brand">
          <CareCircleMark className="h-9 w-9 bg-white" />
          <span>{systemName}</span>
        </div>
        <div className="pc-header-meta">
          <div className="pc-who">
            <strong>{counterpart}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <p className={`pc-status is-${statusTone}`} role="status">
            <Wifi size={14} aria-hidden="true" />
            {statusLabel}
          </p>
          {clock ? <p className="pc-clock"><Clock size={14} aria-hidden="true" />{clock}</p> : null}
        </div>
      </header>
      <div className="pc-body">
        <div className="pc-main">
          <div className={stageClass ? `pc-stage ${stageClass}` : "pc-stage"} style={stageStyle}>{children}</div>
          {alert}
          {dock}
        </div>
        <SidePanel>{aside}</SidePanel>
      </div>
    </div>
  );
}

export function PatientLobby({
  systemName,
  counterpart,
  specialty,
  service,
  aside,
  onBack,
  configured,
  canJoin,
  message,
  droppedMessage,
  holdMessage = null,
  audioOnly,
  audioInput,
  audioOutput,
  videoInput,
  devices,
  ready,
  checking,
  joining,
  mediaError,
  joinError,
  previewRef,
  audioLevel,
  onAudioOnly,
  onAudioInput,
  onVideoInput,
  onAudioOutput,
  onTest,
  arrived,
  onArrive,
  channelLocked = false,
}: {
  systemName: string;
  counterpart: string;
  specialty: string;
  service: string;
  aside: ReactNode;
  onBack: () => void;
  configured: boolean;
  canJoin: boolean;
  message: string;
  droppedMessage: string | null;
  holdMessage?: string | null;
  audioOnly: boolean;
  audioInput: string;
  audioOutput: string;
  videoInput: string;
  devices: { audio: MediaDeviceInfo[]; video: MediaDeviceInfo[]; output: MediaDeviceInfo[] };
  ready: boolean;
  checking: boolean;
  joining: boolean;
  mediaError: string | null;
  joinError: string | null;
  previewRef: RefObject<HTMLVideoElement | null>;
  audioLevel: number | null;
  onAudioOnly: (value: boolean) => void;
  onAudioInput: (value: string) => void;
  onVideoInput: (value: string) => void;
  onAudioOutput: (value: string) => void;
  onTest: () => void;
  arrived: boolean;
  onArrive: () => void;
  channelLocked?: boolean;
}) {
  const [devicesOpen, setDevicesOpen] = useState(false);
  const blocked = !configured || !canJoin;
  const statusLabel = joining
    ? "Connecting"
    : droppedMessage
      ? "Disconnected"
      : blocked
        ? "Not open"
        : ready
          ? "Ready to join"
          : "Not connected";
  const statusTone = joining || (ready && !droppedMessage) ? "good" : droppedMessage ? "down" : "wait";
  const stageMessage = droppedMessage || holdMessage || (!configured || !canJoin ? message : null);
  const talk = Math.min(1, Math.max(0, audioLevel ?? 0));
  const talking = talk > 0.08;

  return (
    <PatientConsultFrame
      alert={mediaError || joinError ? <p className="pc-alert" role="alert">{joinError || mediaError}</p> : null}
      aside={aside}
      clock={null}
      counterpart={counterpart}
      dock={blocked ? null : (
        <div className="pc-dock-wrap">
          {devicesOpen ? (
            <div className="pc-menu">
              <label>
                Microphone
                <select aria-label="Microphone" value={audioInput} onChange={(event) => onAudioInput(event.target.value)}>
                  <option value="">{devices.audio.length === 0 ? "No microphone listed yet" : "Default microphone"}</option>
                  {devices.audio.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Microphone"}</option>)}
                </select>
              </label>
              <label>
                Camera
                <select aria-label="Camera" value={videoInput} disabled={audioOnly} onChange={(event) => onVideoInput(event.target.value)}>
                  <option value="">{devices.video.length === 0 ? "No camera listed yet" : "Default camera"}</option>
                  {devices.video.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Camera"}</option>)}
                </select>
              </label>
              <label>
                Speaker
                <select aria-label="Speaker" value={audioOutput} onChange={(event) => onAudioOutput(event.target.value)}>
                  <option value="">{devices.output.length === 0 ? "Default speaker" : "Default speaker"}</option>
                  {devices.output.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Speaker"}</option>)}
                </select>
              </label>
            </div>
          ) : null}
          <div className="pc-dock">
            <button className="pc-ctrl" type="button" disabled={checking} aria-label={checking ? "Testing" : "Test devices"} onClick={onTest}>
              {checking ? <LoaderCircle size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
              <span className="pc-label">{checking ? "Testing" : "Test devices"}</span>
            </button>
            <button className={`pc-ctrl${audioOnly ? " is-off" : ""}`} type="button" disabled={channelLocked} aria-label={audioOnly ? "Audio only" : "Camera on"} aria-pressed={audioOnly} title={channelLocked ? (audioOnly ? "This visit was booked as audio." : "This visit was booked as video.") : undefined} onClick={() => onAudioOnly(!audioOnly)}>
              {audioOnly ? <VideoOff size={18} aria-hidden="true" /> : <Video size={18} aria-hidden="true" />}
              <span className="pc-label">{audioOnly ? "Audio only" : "Camera on"}</span>
            </button>
            <button className={`pc-ctrl${devicesOpen ? " is-on" : ""}`} type="button" aria-label="Devices" aria-expanded={devicesOpen} onClick={() => setDevicesOpen((value) => !value)}>
              <Settings size={18} aria-hidden="true" />
              <span className="pc-label">Devices</span>
            </button>
            {arrived ? (
              <button className="pc-join" type="button" disabled>Waiting for the doctor</button>
            ) : (
              <button className="pc-join" type="button" disabled={!ready || joining} onClick={onArrive}>I&apos;ve arrived</button>
            )}
          </div>
        </div>
      )}
      onBack={onBack}
      service={service}
      specialty={specialty}
      stageClass={talking ? "is-talking" : undefined}
      stageStyle={{ "--talk": String(talk) } as CSSProperties}
      statusLabel={statusLabel}
      statusTone={statusTone}
      systemName={systemName}
    >
      {ready && !audioOnly ? (
        <video ref={previewRef} autoPlay muted playsInline />
      ) : blocked ? (
        <div className="pc-idle">
          <h2>This consultation is not open</h2>
          <p>{stageMessage || message}</p>
        </div>
      ) : (
        <VoiceFrame
          face={audioOnly ? <Mic aria-hidden="true" size={28} /> : <Video aria-hidden="true" size={28} />}
          label={audioOnly ? "Audio" : counterpart || "You"}
          level={talk}
        />
      )}
      {blocked ? null : <p className="pc-frame-name">{audioOnly ? "Audio" : ready && !audioOnly ? (talking ? "Talking" : "You") : "Preview"}</p>}
      {arrived && !blocked ? <p className="pc-stage-note">You are in the waiting room. The doctor will admit you.</p> : null}
      {stageMessage && !blocked ? <p className="pc-stage-note">{stageMessage}</p> : null}
    </PatientConsultFrame>
  );
}

export function PatientLiveStage({
  aside,
  audioOnly,
  audioOutputId,
  counterpartImageVersion,
  counterpartName,
  counterpartUserId,
  onBack,
  onLeave,
  onReconnect,
  service,
  specialty,
  startedAt,
  starting,
  systemName,
}: {
  aside: ReactNode;
  audioOnly: boolean;
  audioOutputId: string;
  counterpartImageVersion: string | null;
  counterpartName: string;
  counterpartUserId: string | null;
  onBack: () => void;
  onLeave: () => void;
  onReconnect: () => void;
  service: string;
  specialty: string;
  startedAt: string | null;
  starting: boolean;
  systemName: string;
}) {
  const room = useRoomContext();
  const connection = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const [quality, setQuality] = useState(localParticipant.connectionQuality);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  const [controlBusy, setControlBusy] = useState<null | "mic" | "camera" | "leave">(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    const apply = (next: ConnectionQuality) => setQuality(next);
    apply(localParticipant.connectionQuality);
    localParticipant.on(ParticipantEvent.ConnectionQualityChanged, apply);
    return () => {
      localParticipant.off(ParticipantEvent.ConnectionQualityChanged, apply);
    };
  }, [localParticipant]);

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
    navigator.mediaDevices?.addEventListener?.("devicechange", loadDevices);
    return () => {
      ignore = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", loadDevices);
    };
  }, [connection]);

  useEffect(() => {
    if (!audioOutputId) return;
    void room.switchActiveDevice("audiooutput", audioOutputId).catch(() => {
      setMediaNote("This browser could not switch the speaker. Audio continues on the default output.");
    });
  }, [audioOutputId, room]);

  useEffect(() => {
    if (connection !== ConnectionState.Connected && !startedAt) return;
    const origin = startedAt ? Date.parse(startedAt) : Date.now();
    if (Number.isNaN(origin)) return;
    const tick = () => setClock(formatDuration(Math.max(0, Math.floor((Date.now() - origin) / 1000))));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [connection, startedAt]);

  const remote = participants.find((participant) => !participant.isLocal) ?? null;
  const remoteTrack = tracks.find((track) => !track.participant.isLocal) ?? null;
  const localTrack = tracks.find((track) => track.participant.isLocal) ?? null;
  const waiting = connection === ConnectionState.Connected && !remote;
  const reconnecting = connection === ConnectionState.Reconnecting || connection === ConnectionState.SignalReconnecting;
  const connected = connection === ConnectionState.Connected;
  const remoteName = remote?.name || counterpartName || "Your doctor";
  const remoteLevel = useVoice(remote);
  const localLevel = useVoice(localParticipant);
  const remoteCameraOff = !remoteTrack || !isTrackReference(remoteTrack) || remoteTrack.publication?.isMuted === true;
  const localCameraOff = audioOnly || !isCameraEnabled || !localTrack || !isTrackReference(localTrack);
  const statusLabel = reconnecting
    ? "Reconnecting"
    : starting || connection === ConnectionState.Connecting
      ? "Connecting"
      : waiting
        ? "Waiting for your doctor"
        : connected
          ? connectionQualityLabel(quality)
          : "Disconnected";
  const statusTone = reconnecting || connection === ConnectionState.Disconnected ? "down" : connected && !waiting ? "good" : "wait";

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

  function leaveRoom() {
    setControlBusy("leave");
    void room.disconnect().finally(onLeave);
  }

  return (
    <PatientConsultFrame
      alert={mediaNote ? <p className="pc-alert" role="alert">{mediaNote}</p> : null}
      aside={aside}
      clock={connected || reconnecting ? clock : null}
      counterpart={remoteName}
      dock={(
        <div className="pc-dock-wrap">
          {devicesOpen ? (
            <div className="pc-menu">
              <label>
                Microphone
                <select aria-label="Microphone during consultation" onChange={(event) => void chooseDevice("audioinput", event.target.value)}>
                  {devices.filter((device) => device.kind === "audioinput").map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>{device.label || "Microphone"}</option>
                  ))}
                </select>
              </label>
              {audioOnly ? null : (
                <label>
                  Camera
                  <select aria-label="Camera during consultation" onChange={(event) => void chooseDevice("videoinput", event.target.value)}>
                    {devices.filter((device) => device.kind === "videoinput").map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>{device.label || "Camera"}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Speaker
                <select aria-label="Speaker during consultation" defaultValue={audioOutputId} onChange={(event) => void chooseDevice("audiooutput", event.target.value)}>
                  {devices.filter((device) => device.kind === "audiooutput").map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>{device.label || "Speaker"}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={onReconnect}>Reconnect</button>
              <p>Leaving does not complete the appointment. You can rejoin while it is still open.</p>
            </div>
          ) : null}
          <div className="pc-dock" aria-label="Call controls">
            <button className={`pc-ctrl${isMicrophoneEnabled ? "" : " is-off"}`} type="button" disabled={controlBusy !== null} aria-label={isMicrophoneEnabled ? "Mute" : "Unmute"} aria-pressed={!isMicrophoneEnabled} onClick={() => void toggleMic()}>
              {isMicrophoneEnabled ? <Mic size={18} aria-hidden="true" /> : <MicOff size={18} aria-hidden="true" />}
              <span className="pc-label">{isMicrophoneEnabled ? "Mute" : "Unmute"}</span>
            </button>
            <button className={`pc-ctrl${isCameraEnabled && !audioOnly ? "" : " is-off"}`} type="button" disabled={audioOnly || controlBusy !== null} aria-label={audioOnly ? "Audio only" : isCameraEnabled ? "Stop video" : "Start video"} aria-pressed={!isCameraEnabled || audioOnly} onClick={() => void toggleCamera()}>
              {isCameraEnabled && !audioOnly ? <Video size={18} aria-hidden="true" /> : <VideoOff size={18} aria-hidden="true" />}
              <span className="pc-label">{audioOnly ? "Audio only" : isCameraEnabled ? "Stop video" : "Start video"}</span>
            </button>
            <button className={`pc-ctrl${devicesOpen ? " is-on" : ""}`} type="button" aria-label="Devices" aria-expanded={devicesOpen} onClick={() => setDevicesOpen((value) => !value)}>
              <Settings size={18} aria-hidden="true" />
              <span className="pc-label">Devices</span>
            </button>
            <button className="pc-leave" type="button" disabled={controlBusy !== null} aria-label="Leave" onClick={() => setConfirmLeave(true)}>
              <PhoneOff size={18} aria-hidden="true" />
              Leave
            </button>
          </div>
        </div>
      )}
      onBack={() => {
        if (connection === ConnectionState.Disconnected) onBack();
        else setConfirmLeave(true);
      }}
      service={service}
      specialty={specialty}
      stageClass={remoteLevel > 0 ? "is-talking" : undefined}
      stageStyle={{ "--talk": String(remoteLevel) } as CSSProperties}
      statusLabel={statusLabel}
      statusTone={statusTone}
      systemName={systemName}
    >
      {remoteTrack && isTrackReference(remoteTrack) && !remoteCameraOff ? (
        <VideoTrack className="pc-video" trackRef={remoteTrack} />
      ) : (
        <div className="pc-idle">
          <VoiceFrame
            face={counterpartUserId ? <ProfilePhoto userId={counterpartUserId} name={remoteName} version={counterpartImageVersion} size={88} alt="" /> : <Mic aria-hidden="true" size={28} />}
            label={remoteName}
            level={remoteLevel}
          />
          <p>
            {reconnecting
              ? "Reconnecting"
              : starting || connection === ConnectionState.Connecting
                ? "Connecting"
                : waiting
                  ? "Waiting for your doctor"
                  : "Audio"}
          </p>
        </div>
      )}
      {remote ? (
        <p className="pc-name">
          {remote.isMicrophoneEnabled ? <Mic size={14} aria-hidden="true" /> : <MicOff size={14} aria-hidden="true" />}
          {remoteName}{remoteLevel > 0 ? " · Talking" : ""}
        </p>
      ) : null}
      <div className={`pc-pip${localCameraOff ? " is-audio" : ""}${localLevel > 0 ? " is-talking" : ""}`} aria-label="Your camera">
        {localTrack && isTrackReference(localTrack) && !localCameraOff ? (
          <VideoTrack className="pc-video" trackRef={localTrack} />
        ) : (
          <VoiceFrame face={<Mic aria-hidden="true" size={16} />} label="You" level={localLevel} />
        )}
        <span className="pc-pip-label">{isMicrophoneEnabled ? "You" : "You · muted"}</span>
      </div>
      {confirmLeave ? (
        <div className="pc-dialog" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="patient-leave-title">
            <h2 id="patient-leave-title">Leave the consultation?</h2>
            <p>You can rejoin while the appointment is still open. Leaving does not complete the consultation.</p>
            <div className="pc-dialog-actions">
              <button className="pc-ctrl" type="button" onClick={() => setConfirmLeave(false)}>Stay</button>
              <button className="pc-leave" type="button" disabled={controlBusy !== null} onClick={leaveRoom}>
                <PhoneOff size={18} aria-hidden="true" />
                Leave
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PatientConsultFrame>
  );
}
