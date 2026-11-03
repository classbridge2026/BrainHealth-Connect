import { shareImage, shareImageAlt, shareImageContentType, shareImageSize } from "@/lib/brand/share-card";

export const runtime = "nodejs";
export const alt = shareImageAlt;
export const size = shareImageSize;
export const contentType = shareImageContentType;
export const revalidate = 300;

export default shareImage;
