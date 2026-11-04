"use client";

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RoomAudioRenderer, RoomContext, useConnectionState } from "@livekit/components-react";
import "@livekit/components-styles";
import { ConnectionError, ConnectionErrorReason, ConnectionState, DisconnectReason, Room, RoomEvent } from "livekit-client";
import { connectionFailureMessage } from "@/lib/consultations/messages";
import { consultationRoomOptions, enableConsultationCamera } from "@/lib/consultations/video-quality";
import { DoctorStage } from "./doctor-stage";
import { PatientLiveStage } from "./patient-consult";
import "./consult.css";

class RoomErrorBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFail();
  }

  render() {
    if (this.state.failed) return <p role="alert">{connectionFailureMessage()}</p>;
    return this.props.children;
  }
}

function isCancelledConnection(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error instanceof ConnectionError && error.reason === ConnectionErrorReason.Cancelled) return true;
  const reasonName = "reasonName" in error ? String((error as { reasonName?: unknown }).reasonName) : "";
  return error.name === "ConnectionError" && (reasonName === "Cancelled" || error.message === "Client initiated disconnect" || error.message === "Connection attempt aborted");
}

const callStops = new Map<string, number>();

function cancelCallStop(appointmentId: string) {
  const timer = callStops.get(appointmentId);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  callStops.delete(appointmentId);
}

function scheduleCallStop(appointmentId: string) {
  cancelCallStop(appointmentId);
  callStops.set(appointmentId, window.setTimeout(() => {
    callStops.delete(appointmentId);
    void fetch(`/api/appointments/${appointmentId}/consultation/calling`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      keepalive: true,
    });
  }, 8000));
}

function DoctorCallSignal({ appointmentId, role }: { appointmentId: string; role: "patient" | "doctor" }) {
  const connection = useConnectionState();

  useEffect(() => {
    if (role !== "doctor" || connection !== ConnectionState.Connected) return;
    cancelCallStop(appointmentId);
    let stop = false;
    async function beat() {
      try {
        await fetch(`/api/appointments/${appointmentId}/consultation/calling`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
      } catch {
        // The next signal tries again.
      }
    }
    void beat();
    const timer = window.setInterval(() => {
      if (!stop) void beat();
    }, 10_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
      scheduleCallStop(appointmentId);
    };
  }, [appointmentId, connection, role]);

  return null;
}

export function LiveSession({
  appointmentId,
  role,
  serverUrl,
  token,
  audioOnly,
  audioDeviceId,
  videoDeviceId,
  audioOutputId,
  startedAt,
  specialty,
  service,
  counterpartName,
  counterpartUserId = null,
  counterpartImageVersion = null,
  aside,
  callNotice = null,
  onBack,
  onCallAgain,
  onDoctorEnded,
  onEndCall,
  onLeave,
  onReconnect,
  onConnectionFailed,
  systemName = "CareCircle MindTogether",
  statusLabel = "",
}: {
  appointmentId: string;
  role: "patient" | "doctor";
  serverUrl: string;
  token: string;
  audioOnly: boolean;
  audioDeviceId: string;
  videoDeviceId: string;
  audioOutputId: string;
  startedAt: string | null;
  verified: boolean;
  specialty: string;
  service: string;
  counterpartName: string;
  counterpartUserId?: string | null;
  counterpartImageVersion?: string | null;
  aside: ReactNode;
  callNotice?: "declined" | "left" | null;
  onBack: () => void;
  onCallAgain?: () => void;
  onDoctorEnded?: () => void;
  onEndCall?: () => void;
  onLeave: () => void;
  onReconnect: () => void;
  onConnectionFailed: () => void;
  systemName?: string;
  statusLabel?: string;
}) {
  const [room] = useState(() => new Room(consultationRoomOptions()));
  const [starting, setStarting] = useState(true);
  const onConnectionFailedRef = useRef(onConnectionFailed);
  const onDoctorEndedRef = useRef(onDoctorEnded);
  useEffect(() => {
    onConnectionFailedRef.current = onConnectionFailed;
  }, [onConnectionFailed]);
  useEffect(() => {
    onDoctorEndedRef.current = onDoctorEnded;
  }, [onDoctorEnded]);
  const reportFailure = useCallback((error: unknown) => {
    if (isCancelledConnection(error)) return;
    onConnectionFailedRef.current();
  }, []);

  useEffect(() => {
    let disposed = false;
    let started = false;
    const timer = window.setTimeout(() => {
      started = true;
      void room.connect(serverUrl, token).then(async () => {
        if (disposed) {
          await room.disconnect();
          return;
        }
        setStarting(false);
        try {
          await room.localParticipant.setMicrophoneEnabled(true, audioDeviceId ? { deviceId: { exact: audioDeviceId } } : undefined);
        } catch {
          // The room stays open. The stage reports a camera or microphone problem.
        }
        if (!audioOnly) {
          try {
            await enableConsultationCamera(room.localParticipant, videoDeviceId);
          } catch {
            // Audio can continue when the camera is busy or missing.
          }
        }
      }).catch((error: unknown) => {
        if (disposed || isCancelledConnection(error)) return;
        setStarting(false);
        reportFailure(error);
      });
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (started && room.state !== ConnectionState.Disconnected) void room.disconnect();
    };
  }, [audioDeviceId, audioOnly, reportFailure, room, serverUrl, token, videoDeviceId]);

  useEffect(() => {
    if (role !== "patient") return;
    const onDisconnected = (reason?: DisconnectReason) => {
      if (reason !== DisconnectReason.ROOM_DELETED && reason !== DisconnectReason.PARTICIPANT_REMOVED && reason !== DisconnectReason.SERVER_SHUTDOWN) return;
      onDoctorEndedRef.current?.();
    };
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [role, room]);

  return (
    <RoomErrorBoundary onFail={onConnectionFailed}>
      <RoomContext.Provider value={room}>
        <RoomAudioRenderer />
        <DoctorCallSignal appointmentId={appointmentId} role={role} />
        {role === "patient" ? (
          <PatientLiveStage
            aside={aside}
            audioOnly={audioOnly}
            audioOutputId={audioOutputId}
            counterpartImageVersion={counterpartImageVersion}
            counterpartName={counterpartName}
            counterpartUserId={counterpartUserId}
            onBack={onBack}
            onLeave={onLeave}
            onReconnect={onReconnect}
            service={service}
            specialty={specialty}
            startedAt={startedAt}
            starting={starting}
            systemName={systemName}
          />
        ) : (
          <DoctorStage
            aside={aside}
            audioOnly={audioOnly}
            audioOutputId={audioOutputId}
            callNotice={callNotice ?? null}
            counterpartImageVersion={counterpartImageVersion}
            counterpartName={counterpartName}
            counterpartUserId={counterpartUserId}
            onCallAgain={onCallAgain ?? (() => undefined)}
            onEndCall={onEndCall ?? onLeave}
            onLeave={onLeave}
            onReconnect={onReconnect}
            service={service}
            specialty={specialty}
            startedAt={startedAt}
            starting={starting}
            statusLabel={statusLabel}
          />
        )}
      </RoomContext.Provider>
    </RoomErrorBoundary>
  );
}
