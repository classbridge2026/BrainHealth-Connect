"use client";

import { useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ChevronLeft, Mic, PanelRight, Video } from "lucide-react";
import { liveKitUnavailableMessage } from "@/lib/consultations/messages";
import { VoiceFrame } from "./voice-frame";
import "./doctor-room.css";

function meter(value: string) {
  if (/offline/i.test(value)) return "Offline";
  if (/internet/i.test(value)) return "Connected";
  if (/preview is on|microphone is on|tone was played|listed/i.test(value)) return "Ready";
  if (/not used|audio only/i.test(value)) return "Off";
  if (/denied|not found|busy|could not|not detectable|not tested|not checked/i.test(value)) return "Check";
  return "Ready";
}

export function DoctorLobby({
  aside,
  audioInput,
  audioLevel,
  audioOnly,
  audioOutput,
  cameraStatus,
  canJoin,
  checking,
  configured,
  counterpart,
  devices,
  droppedMessage,
  holdMessage,
  internet,
  joinError,
  joining,
  mediaError,
  message,
  micStatus,
  onAudioInput,
  onAudioOnly,
  onAudioOutput,
  onBack,
  onCallAgain,
  onJoin,
  onTest,
  onTestSpeaker,
  onVideoInput,
  previewRef,
  ready,
  service,
  speakerNote,
  specialty,
  statusLabel,
  videoInput,
  waitingName,
  callNotice,
}: {
  aside: ReactNode;
  audioInput: string;
  audioLevel: number | null;
  audioOnly: boolean;
  audioOutput: string;
  cameraStatus: string;
  canJoin: boolean;
  checking: boolean;
  configured: boolean;
  counterpart: string;
  devices: { audio: MediaDeviceInfo[]; video: MediaDeviceInfo[]; output: MediaDeviceInfo[] };
  droppedMessage: string | null;
  holdMessage: string | null;
  internet: string;
  joinError: string | null;
  joining: boolean;
  mediaError: string | null;
  message: string;
  micStatus: string;
  onAudioInput: (value: string) => void;
  onAudioOnly: (value: boolean) => void;
  onAudioOutput: (value: string) => void;
  onBack: () => void;
  onCallAgain: () => void;
  onJoin: () => void;
  onTest: () => void;
  onTestSpeaker: () => void;
  onVideoInput: (value: string) => void;
  previewRef: RefObject<HTMLVideoElement | null>;
  ready: boolean;
  service: string;
  speakerNote: string | null;
  specialty: string;
  statusLabel: string;
  videoInput: string;
  waitingName: string | null;
  callNotice: "declined" | "left" | null;
}) {
  const [panel, setPanel] = useState(false);
  const subtitle = [specialty, service].filter(Boolean).join(" · ");
  return (
    <section className="dr-live">
      <div className="dr-room">
        <header className="dr-bar">
          <button className="dr-back" type="button" onClick={onBack}>
            <ChevronLeft aria-hidden="true" size={18} />
            <span>Back to appointments</span>
          </button>
          <div className="dr-title">
            <strong>{counterpart || "Consultation"}</strong>
            <span>{subtitle || "Online consultation"}</span>
          </div>
          <div className="dr-status">
            <span className="dr-chip">{statusLabel || "Online consultation"}</span>
            <span className="dr-chip is-wait">Not connected</span>
          </div>
          <button className="dr-panel-toggle" type="button" aria-expanded={panel} aria-label="Clinical workspace" onClick={() => setPanel((open) => !open)}>
            <PanelRight aria-hidden="true" size={16} />
            <span>Clinical workspace</span>
          </button>
        </header>
        <div className="dr-body">
          <div className="dr-stage-col">
            {!configured ? <p className="dr-alert" role="status">{liveKitUnavailableMessage()}</p> : null}
            {configured && !canJoin ? <p className="dr-card" role="status">{message}</p> : null}
            {configured && canJoin ? (
              <div className="dr-card dr-lobby">
                <div className="dr-lobby-scroll">
                  <h2>Check your camera and microphone</h2>
                  <div
                    className={`dr-frame${audioOnly ? " is-audio" : ""}${(audioLevel ?? 0) > 0.08 ? " is-talking" : ""}`}
                    style={{ "--talk": String(Math.min(1, audioLevel ?? 0)) } as CSSProperties}
                  >
                    {ready && !audioOnly ? <video ref={previewRef} autoPlay muted playsInline /> : (
                      <VoiceFrame
                        face={audioOnly ? <Mic aria-hidden="true" size={28} /> : <Video aria-hidden="true" size={28} />}
                        label={audioOnly ? "Audio" : counterpart || "You"}
                        level={audioLevel ?? 0}
                      />
                    )}
                    <p className="dr-frame-name">{audioOnly ? "Audio" : ready ? "You" : "Preview"}</p>
                  </div>
                  <div className="dr-menu">
                    <label>
                      <span>Camera</span>
                      <select aria-label="Camera" value={videoInput} disabled={audioOnly || devices.video.length === 0} onChange={(event) => onVideoInput(event.target.value)}>
                        <option value="">{devices.video.length === 0 ? "No camera listed yet" : "Default camera"}</option>
                        {devices.video.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Camera"}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Microphone</span>
                      <select aria-label="Microphone" value={audioInput} disabled={devices.audio.length === 0} onChange={(event) => onAudioInput(event.target.value)}>
                        <option value="">{devices.audio.length === 0 ? "No microphone listed yet" : "Default microphone"}</option>
                        {devices.audio.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Microphone"}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Speaker</span>
                      <select aria-label="Speaker" value={audioOutput} disabled={devices.output.length === 0} onChange={(event) => onAudioOutput(event.target.value)}>
                        <option value="">{devices.output.length === 0 ? "Not available in this browser" : "Default speaker"}</option>
                        {devices.output.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Speaker"}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="dr-check" title="The microphone is still required.">
                    <input checked={audioOnly} type="checkbox" onChange={(event) => onAudioOnly(event.target.checked)} />
                    Audio only
                  </label>
                  <ul className="dr-meters" aria-label="Device check">
                    <li><span>Internet</span><strong>{meter(internet)}</strong></li>
                    <li><span>Camera</span><strong>{audioOnly ? "Off" : meter(cameraStatus)}</strong></li>
                    <li><span>Microphone</span><strong>{meter(micStatus)}</strong></li>
                    <li><span>Speaker</span><strong>{meter(speakerNote ?? (devices.output.length > 0 ? "Listed" : "Not detectable in this browser."))}</strong></li>
                  </ul>
                  <dl className="dr-facts">
                    <div><div><dt>Internet</dt><dd>{internet}</dd></div></div>
                    <div><div><dt>Camera</dt><dd>{cameraStatus}</dd></div></div>
                    <div><div><dt>Microphone</dt><dd>{micStatus}</dd></div></div>
                    <div><div><dt>Speaker</dt><dd>{speakerNote ?? (devices.output.length > 0 ? "Listed. Play a tone to test it." : "Not detectable in this browser.")}</dd></div></div>
                  </dl>
                  {waitingName ? <p role="status">{waitingName} is in the waiting room. Admit them to start the visit.</p> : null}
                  {holdMessage ? <p role="status">{holdMessage}</p> : null}
                  {callNotice === "declined" ? <p className="dr-recall" role="status">The patient declined the call. Call again if they dropped it by mistake. They will receive the call.</p> : null}
                  {callNotice === "left" ? <p className="dr-recall" role="status">The patient left the call. Call again and they will receive it.</p> : null}
                  {droppedMessage ? <p className="dr-alert" role="alert">{droppedMessage}</p> : null}
                  {mediaError ? <p className="dr-alert" role="alert">{mediaError}</p> : null}
                  {joinError ? <p className="dr-alert" role="alert">{joinError}</p> : null}
                </div>
                <div className="dr-actions">
                  <button className="dr-secondary" type="button" disabled={checking} onClick={onTest}>{checking ? "Testing…" : "Test devices"}</button>
                  <button className="dr-secondary" type="button" onClick={onTestSpeaker}>Play test tone</button>
                  {callNotice ? <button className="dr-primary" type="button" disabled={joining} onClick={onCallAgain}>{joining ? "Calling…" : "Call again"}</button> : null}
                  <button className="dr-primary" type="button" disabled={!ready || joining} onClick={onJoin}>{joining ? "Joining…" : waitingName ? "Admit patient" : "Join consultation"}</button>
                </div>
              </div>
            ) : null}
            <p className="dr-privacy">This consultation is secure and private. Please do not share the link with anyone else.</p>
          </div>
          <aside className={`dr-side${panel ? " is-open" : ""}`}>
            <button className="dr-side-close" type="button" onClick={() => setPanel(false)}>Close workspace</button>
            {aside}
          </aside>
        </div>
      </div>
    </section>
  );
}
