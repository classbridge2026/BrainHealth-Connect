import { describe, expect, it, vi } from "vitest";
import { VideoPresets, VideoPresets43 } from "livekit-client";
import { cameraCaptureOptions, consultationRoomOptions, enableConsultationCamera } from "./video-quality";

describe("consultation video quality", () => {
  it("publishes above 480p and asks a large stage for the sharp layer", () => {
    const options = consultationRoomOptions();
    expect(options.videoCaptureDefaults?.resolution?.height).toBe(720);
    expect(options.publishDefaults?.videoEncoding?.maxBitrate).toBe(VideoPresets.h720.encoding.maxBitrate);
    expect(options.publishDefaults?.videoEncoding?.maxBitrate).toBeGreaterThan(VideoPresets43.h480.encoding.maxBitrate);
    expect(options.adaptiveStream).toEqual({ pixelDensity: 2 });
    expect(options.publishDefaults?.degradationPreference).toBe("maintain-resolution");
  });

  it("tries 1080p before 720p", () => {
    const steps = cameraCaptureOptions("cam-1");
    expect(steps.map((step) => step.capture.resolution?.height)).toEqual([1080, 720]);
    expect(steps[0]?.capture.deviceId).toEqual({ exact: "cam-1" });
    expect(steps[0]?.publish.videoEncoding?.maxBitrate).toBe(VideoPresets.h1080.encoding.maxBitrate);
    expect(steps[1]?.publish.videoSimulcastLayers?.map((layer) => layer.height)).toEqual([360, 540]);
  });

  it("falls back to 720p when the camera cannot open at 1080p", async () => {
    const setCameraEnabled = vi.fn(async (_enabled: boolean, options?: { resolution?: { height?: number } }) => {
      if (options?.resolution?.height === 1080) throw new Error("overconstrained");
    });
    await enableConsultationCamera({ setCameraEnabled }, "cam-1");
    expect(setCameraEnabled).toHaveBeenCalledTimes(2);
    expect(setCameraEnabled.mock.calls[1]?.[1]?.resolution?.height).toBe(720);
  });
});
