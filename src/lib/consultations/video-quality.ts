import { VideoPresets, type RoomOptions, type TrackPublishOptions, type VideoCaptureOptions } from "livekit-client";

const sharp = {
  simulcast: true,
  degradationPreference: "maintain-resolution",
} as const;

/** Capture and publish steps, sharpest first. A camera that cannot do 1080p still joins at 720p. */
export function cameraCaptureOptions(deviceId = ""): Array<{ capture: VideoCaptureOptions; publish: TrackPublishOptions }> {
  const device = deviceId ? { deviceId: { exact: deviceId } } : {};
  return [
    {
      capture: { ...device, resolution: VideoPresets.h1080.resolution },
      publish: {
        ...sharp,
        videoEncoding: VideoPresets.h1080.encoding,
        videoSimulcastLayers: [VideoPresets.h540, VideoPresets.h720],
      },
    },
    {
      capture: { ...device, resolution: VideoPresets.h720.resolution },
      publish: {
        ...sharp,
        videoEncoding: VideoPresets.h720.encoding,
        videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h540],
      },
    },
  ];
}

export function consultationRoomOptions(): RoomOptions {
  const preset = VideoPresets.h720;
  return {
    adaptiveStream: { pixelDensity: 2 },
    dynacast: true,
    videoCaptureDefaults: { resolution: preset.resolution },
    publishDefaults: {
      ...sharp,
      videoEncoding: preset.encoding,
      videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h540],
    },
  };
}

export async function enableConsultationCamera(
  participant: {
    setCameraEnabled: (
      enabled: boolean,
      options?: VideoCaptureOptions,
      publishOptions?: TrackPublishOptions,
    ) => Promise<unknown>;
  },
  deviceId = "",
) {
  let lastError: unknown;
  for (const step of cameraCaptureOptions(deviceId)) {
    try {
      await participant.setCameraEnabled(true, step.capture, step.publish);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The camera could not be started.");
}
