import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { getSystemName } from "./system-name";

export const shareImageSize = { width: 1200, height: 630 };
export const shareImageContentType = "image/png";
export const shareImageAlt = "Mental health appointments and online consultations";

export async function shareImage() {
  const name = await getSystemName();
  const logo = await readFile(path.join(process.cwd(), "public", "icons", "icon-192.png"));
  const src = `data:image/png;base64,${logo.toString("base64")}`;
  const titleSize = name.length > 28 ? 52 : 68;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#0C2B45",
        color: "#ffffff",
        padding: "72px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <img src={src} width={96} height={96} alt="" style={{ borderRadius: 48 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: titleSize, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1 }}>{name}</div>
        <div style={{ marginTop: 20, fontSize: 32, lineHeight: 1.35, color: "#d7e3ee" }}>Mental health appointments and online consultations</div>
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ width: 72, height: 8, borderRadius: 8, background: "#0F766E" }} />
        <div style={{ marginLeft: 18, fontSize: 24, color: "#99f6e4" }}>Sierra Leone</div>
      </div>
    </div>,
    shareImageSize,
  );
}
