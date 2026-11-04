"use client";

import { useActionState, useEffect, useRef, useState, type ChangeEvent } from "react";
import { removeProfileImageAction, saveProfileImageAction, type ProfileImageState } from "@/app/profile/actions";
import { profileImageSrc } from "@/components/profile-image-src";

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

export function ProfilePhoto({
  userId,
  version,
  size = 40,
  alt = "",
}: {
  userId: string;
  name: string;
  version: string | null;
  size?: number;
  alt?: string;
}) {
  const style = { width: size, height: size };
  if (!version) {
    return (
      <img
        className="inline-flex shrink-0 rounded-full"
        style={style}
        src="/default-avatar.svg"
        alt={alt}
        width={size}
        height={size}
      />
    );
  }
  return (
    <img
      className="inline-flex shrink-0 rounded-full bg-brand-navy object-cover"
      style={style}
      src={profileImageSrc(userId, version)}
      alt={alt}
      width={size}
      height={size}
    />
  );
}

const initial: ProfileImageState = {};

function usePreviewUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

const photoButtonClass =
  "inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border-2 border-solid border-[#0b5f59] bg-[#0F766E] px-4 text-sm font-semibold text-white transition hover:border-[#084842] hover:bg-[#0b5f59] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F766E] disabled:cursor-wait disabled:opacity-70";

function fitsUpload(file: File) {
  return file.size > 0 && file.size <= MAX_PREVIEW_BYTES && (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp");
}

async function photoForUpload(file: File): Promise<File> {
  if (fitsUpload(file)) return file;
  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, 1280 / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("preview");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (let quality = 0.9; quality >= 0.45; quality -= 0.15) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_PREVIEW_BYTES) break;
    }
    if (!blob || blob.size > MAX_PREVIEW_BYTES) throw new Error("large");
    const stem = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${stem}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

export function ProfilePhotoEditor({ userId, name, version }: { userId: string; name: string; version: string | null }) {
  const [saved, save, saving] = useActionState(saveProfileImageAction, initial);
  const [removed, remove, removing] = useActionState(removeProfileImageAction, initial);
  const [file, setFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const applying = useRef(false);
  const preview = usePreviewUrl(file);
  const message = problem || saved.message || removed.message;
  const tone = problem || saved.tone === "error" || removed.tone === "error" ? "error" : saved.tone || removed.tone;
  const ready = file !== null && !preparing && !saving;

  function storeFile(next: File | null) {
    applying.current = true;
    const input = inputRef.current;
    if (input) {
      if (next) {
        const data = new DataTransfer();
        data.items.add(next);
        input.files = data.files;
      } else if (input.value !== "") {
        input.value = "";
      }
    }
    setFile(next);
    queueMicrotask(() => {
      applying.current = false;
    });
  }

  useEffect(() => {
    if (saved.tone !== "ok") return;
    storeFile(null);
    setProblem("");
  }, [saved]);

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    if (applying.current) return;
    const picked = event.currentTarget.files?.[0] ?? null;
    setProblem("");
    if (!picked) {
      storeFile(null);
      return;
    }
    setPreparing(true);
    try {
      storeFile(await photoForUpload(picked));
    } catch {
      storeFile(null);
      setProblem("That photo could not be used. Choose a JPEG, PNG, or WebP picture.");
    } finally {
      setPreparing(false);
    }
  }

  const buttonLabel = preparing ? "Preparing…" : saving ? "Saving…" : file ? "Save photo" : "Choose photo";

  return (
    <div className="flex flex-wrap items-start gap-4">
      {preview ? (
        <img
          className="inline-flex shrink-0 rounded-full bg-brand-navy object-cover ring-2 ring-[#0F766E]"
          style={{ width: 112, height: 112 }}
          src={preview}
          alt={`Preview of the new profile photo for ${name}`}
          width={112}
          height={112}
        />
      ) : (
        <ProfilePhoto userId={userId} name={name} version={version} size={72} alt={`${name} profile photo`} />
      )}
      <div className="grid min-w-0 flex-1 gap-3">
        <form
          action={save}
          className="grid gap-2"
          onSubmit={(event) => {
            const chosen = inputRef.current?.files?.[0];
            if (!chosen || !fitsUpload(chosen)) event.preventDefault();
          }}
        >
          <div className="grid gap-2">
            <span className="text-sm font-semibold text-brand-navy">Profile photo</span>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={inputRef}
                id="profile-photo-file"
                className="absolute h-px w-px overflow-hidden opacity-0"
                name="image"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/*"
                onChange={onPick}
              />
              <button
                className={photoButtonClass}
                type={ready ? "submit" : "button"}
                disabled={preparing || saving}
                onClick={() => {
                  if (!ready) inputRef.current?.click();
                }}
              >
                {buttonLabel}
              </button>
              <span className={`min-w-0 truncate text-sm ${file ? "text-brand-navy" : "text-brand-muted"}`}>{file?.name || "No file chosen"}</span>
              {file && !saving ? (
                <button
                  type="button"
                  className="text-sm font-semibold text-[#0F766E]"
                  onClick={() => {
                    storeFile(null);
                    setProblem("");
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
          {preview && ready ? (
            <p className="text-sm font-semibold text-[#0F766E]" role="status">
              Preview. Save photo replaces the current picture.
            </p>
          ) : null}
          <p className="text-xs leading-5 text-brand-muted">JPEG, PNG, or WebP. Saving replaces the photo that is shown beside your name.</p>
        </form>
        {version ? (
          <form action={remove}>
            <button className="inline-flex h-11 items-center rounded-xl border border-brand-line bg-white px-4 text-sm font-semibold text-brand-navy" disabled={removing} type="submit">
              {removing ? "Removing…" : "Remove photo"}
            </button>
          </form>
        ) : null}
        {message ? (
          <p className={tone === "error" ? "text-sm text-red-700" : "text-sm text-brand-navy"} role={tone === "error" ? "alert" : "status"}>
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
