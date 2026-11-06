"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faComments, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { RoleTurn } from "@/lib/guide/role-guide";
import { GuideCopy } from "./guide-copy";
import "./portal-guide.css";

type Message = { id: number; role: "user" | "assistant"; text: string; href?: string; label?: string };

const LIVE = /\b(how many|total|count|should i|what now|attention|waiting|hello|hi)\b/i;

export function GuidePanel<T>({
  access,
  place,
  opening,
  starters,
  answer,
  loadFacts,
}: {
  access: string;
  place: (pathname: string) => string;
  opening: (place: string) => string;
  starters: string[];
  answer: (input: { question: string; pathname: string; previousTopicId: string | null; facts: T | null }) => RoleTurn;
  loadFacts: () => Promise<T | null>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const here = place(pathname);
  const titleId = useId();
  const fieldId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const replyTimer = useRef<number | null>(null);
  const factsRef = useRef<T | null>(null);
  const factsAt = useRef(0);
  const factsRequest = useRef<Promise<T | null> | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [previousTopicId, setPreviousTopicId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([{ id: 1, role: "assistant", text: opening(here) }]);

  function loadOwnFacts() {
    if (factsRequest.current) return factsRequest.current;
    const request = loadFacts()
      .then((facts) => {
        if (facts) {
          factsRef.current = facts;
          factsAt.current = Date.now();
        }
        return facts ?? factsRef.current;
      })
      .catch(() => factsRef.current)
      .finally(() => {
        if (factsRequest.current === request) factsRequest.current = null;
      });
    factsRequest.current = request;
    return request;
  }

  useEffect(() => {
    setMessages((current) => {
      if (current.length !== 1 || current[0]?.role !== "assistant") return current;
      const next = opening(place(pathname));
      return current[0].text === next ? current : [{ ...current[0], text: next }];
    });
  }, [opening, pathname, place]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    void loadOwnFacts();
    const narrow = window.matchMedia("(max-width: 1023px)").matches;
    const previous = document.body.style.overflow;
    if (narrow) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, typing, open]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (replyTimer.current) window.clearTimeout(replyTimer.current);
    };
  }, []);

  function ask(value: string) {
    const question = value.trim();
    if (!question || typing) return;
    const topicId = previousTopicId;
    setDraft("");
    setTyping(true);
    setMessages((current) => [...current, { id: current.length + 1, role: "user", text: question }]);
    replyTimer.current = window.setTimeout(() => {
      void (async () => {
        const live = LIVE.test(question);
        const fresh = factsRef.current !== null && Date.now() - factsAt.current < 60_000;
        if (live && !fresh) await loadOwnFacts();
        else if (!factsRef.current) void loadOwnFacts();
        const reply = answer({ question, pathname, previousTopicId: topicId, facts: factsRef.current });
        setPreviousTopicId(reply.topicId);
        setTyping(false);
        setMessages((current) => [
          ...current,
          { id: current.length + 1, role: "assistant", text: reply.text, href: reply.link?.href, label: reply.link?.label },
        ]);
      })();
    }, 280);
  }

  const showStarters = messages.length === 1 && !typing;

  if (/\/messages(\/|$)/.test(pathname)) return null;

  return (
    <div className={open ? "guide is-open" : "guide"} data-no-busy="">
      {open ? (
        <section className="guide-panel" role="dialog" aria-modal="false" aria-labelledby={titleId}>
          <header className="guide-head">
            <span className="guide-mark" aria-hidden="true">
              <FontAwesomeIcon icon={faComments} />
            </span>
            <span>
              <strong id={titleId}>Assistant</strong>
              <em>
                {access} · You are on {here}
              </em>
            </span>
            <button type="button" className="guide-close" onClick={() => setOpen(false)}>
              <FontAwesomeIcon icon={faXmark} />
              <span className="sr-only">Close chat</span>
            </button>
          </header>
          <div className="guide-thread" ref={threadRef}>
            {messages.map((message) => (
              <div key={message.id} className={message.role === "user" ? "guide-row is-user" : "guide-row"}>
                {message.role === "assistant" ? (
                  <span className="guide-avatar" aria-hidden="true">
                    <FontAwesomeIcon icon={faComments} />
                  </span>
                ) : null}
                <div className={message.role === "user" ? "guide-bubble is-user" : "guide-bubble"}>
                  {message.role === "user" ? (
                    <p>{message.text}</p>
                  ) : (
                    <GuideCopy text={message.text} href={message.href} label={message.label} onOpen={(href) => { setOpen(false); router.push(href); }} />
                  )}
                </div>
              </div>
            ))}
            {typing ? (
              <div className="guide-row">
                <span className="guide-avatar" aria-hidden="true">
                  <FontAwesomeIcon icon={faComments} />
                </span>
                <p className="guide-bubble guide-typing" aria-label="Assistant is typing">
                  <span />
                  <span />
                  <span />
                </p>
              </div>
            ) : null}
          </div>
          {showStarters ? (
            <div className="guide-prompts">
              {starters.map((prompt) => (
                <button key={prompt} type="button" onClick={() => ask(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="guide-form"
            onSubmit={(event) => {
              event.preventDefault();
              ask(draft);
            }}
          >
            <label className="sr-only" htmlFor={fieldId}>
              Message
            </label>
            <textarea
              ref={inputRef}
              id={fieldId}
              rows={2}
              value={draft}
              placeholder="Message"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  ask(draft);
                }
              }}
            />
            <button type="submit" disabled={!draft.trim() || typing}>
              Send
            </button>
          </form>
        </section>
      ) : null}
      <button type="button" className="guide-launch" aria-expanded={open} suppressHydrationWarning onClick={() => setOpen((value) => !value)}>
        <FontAwesomeIcon icon={open ? faXmark : faComments} />
        <span>{open ? "Close" : "Chat"}</span>
      </button>
    </div>
  );
}

