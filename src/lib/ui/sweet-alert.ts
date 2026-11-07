"use client";

import { useEffect, useRef, type FormEvent } from "react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";

type Tone = "ok" | "error";

function classes(danger = false) {
  return {
    popup: "care-alert",
    title: "care-alert-title",
    htmlContainer: "care-alert-text",
    actions: "care-alert-actions",
    confirmButton: danger ? "care-alert-confirm is-danger" : "care-alert-confirm",
    cancelButton: "care-alert-cancel",
  };
}

export async function confirmAction(options: {
  title: string;
  text: string;
  confirmText: string;
  danger?: boolean;
}) {
  const result = await Swal.fire({
    title: options.title,
    text: options.text,
    icon: options.danger ? "warning" : "question",
    iconColor: options.danger ? "#9b2330" : "#0f766e",
    showCancelButton: true,
    focusCancel: Boolean(options.danger),
    reverseButtons: true,
    buttonsStyling: false,
    confirmButtonText: options.confirmText,
    cancelButtonText: "Go back",
    customClass: classes(options.danger),
  });
  return result.isConfirmed;
}

export function showVisitReminder(patientName: string, when: string) {
  return Swal.fire({
    title: "Get ready",
    text: `Get ready for the appointment for ${patientName}. It starts at ${when}.`,
    icon: "info",
    iconColor: "#0f766e",
    allowOutsideClick: false,
    allowEscapeKey: false,
    buttonsStyling: false,
    confirmButtonText: "OK",
    customClass: classes(false),
  });
}

export function showOutcome(options: { title?: string; text: string; tone: Tone }) {
  const ok = options.tone === "ok";
  return Swal.fire({
    title: options.title ?? (ok ? "Done" : "Check this"),
    text: options.text,
    icon: ok ? "success" : "error",
    iconColor: ok ? "#0f766e" : "#9b2330",
    buttonsStyling: false,
    confirmButtonText: "OK",
    customClass: classes(false),
  });
}

export function useOutcomeAlert(message: string | undefined, pending: boolean, tone: Tone = "error") {
  const waiting = useRef(false);
  useEffect(() => {
    if (pending) {
      waiting.current = true;
      return;
    }
    if (!waiting.current || !message) return;
    waiting.current = false;
    void showOutcome({ text: message, tone });
  }, [message, pending, tone]);
}

export function useConfirmedSubmit(options: {
  title: string;
  text: string;
  confirmText: string;
  danger?: boolean;
}) {
  const allowed = useRef(false);
  return function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (allowed.current) {
      allowed.current = false;
      return;
    }
    event.preventDefault();
    const form = event.currentTarget;
    void confirmAction(options).then((ok) => {
      if (!ok) return;
      allowed.current = true;
      form.requestSubmit();
    });
  };
}
