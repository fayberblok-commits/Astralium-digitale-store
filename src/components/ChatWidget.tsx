"use client";
/**
 * Floating support assistant. Talks to /api/support/chat, which answers
 * from catalog/policy data (or a grounded model when a key is configured).
 *
 * Phase 6 (feature 25): with `supportV2` on, messages stream over SSE
 * from /api/support/stream, a "track my order" form supplies the
 * order id + email the lookup tool requires, and a voice button uses
 * the browser's built-in speech recognition when available (hidden
 * otherwise — client-side only, no keys, no external calls).
 */
import { useEffect, useRef, useState } from "react";
import type { Dict } from "../i18n/dictionaries";

interface Msg { role: "user" | "assistant"; text: string }

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

interface TeamEmployee { id: string; name: { en: string; ar: string }; avatar: string }

export default function ChatWidget({ dict, locale, supportV2 = false }: { dict: Dict; locale: string; supportV2?: boolean }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: dict.chat_greeting }]);
  const [showOrder, setShowOrder] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [orderEmail, setOrderEmail] = useState("");
  const [voiceOk, setVoiceOk] = useState(false);
  const [listening, setListening] = useState(false);
  // Phase 5 upgrade: which AI-team employee is answering (null = the
  // deterministic grounded engine; the header then shows no persona,
  // honestly). TTS uses the browser's speech synthesis when present.
  const [employee, setEmployee] = useState<TeamEmployee | null>(null);
  const [ttsOk, setTtsOk] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setTtsOk(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  function speak(text: string) {
    try {
      const u = new SpeechSynthesisUtterance(text.slice(0, 600));
      u.lang = locale;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* TTS is an enhancement only */ }
  }

  function historyPayload(): { role: "user" | "assistant"; text: string }[] {
    return msgs.slice(-8).map((m) => ({ role: m.role, text: m.text }));
  }

  useEffect(() => {
    if (!supportV2) return;
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (Ctor) {
      const rec = new Ctor();
      rec.interimResults = false;
      recognitionRef.current = rec;
      setVoiceOk(true);
    }
  }, [supportV2]);

  function startVoice() {
    const rec = recognitionRef.current;
    if (!rec || listening) return;
    rec.lang = locale;
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput((prev) => `${prev} ${transcript}`.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  }

  async function sendV1(text: string) {
    const res = await fetch("/api/support/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text, locale, history: historyPayload(),
        orderId: orderId.trim() || undefined,
        email: orderEmail.trim() || undefined,
      }),
    });
    const data = (await res.json()) as { answer?: string; employee?: TeamEmployee };
    if (data.employee) setEmployee(data.employee);
    setMsgs((m) => [...m, { role: "assistant", text: data.answer ?? "…" }]);
  }

  async function sendV2(text: string) {
    const res = await fetch("/api/support/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        locale,
        history: historyPayload(),
        orderId: orderId.trim() || undefined,
        email: orderEmail.trim() || undefined,
      }),
    });
    if (!res.ok || !res.body) throw new Error("STREAM_UNAVAILABLE");
    // Append the assistant bubble, then grow it as deltas arrive.
    setMsgs((m) => [...m, { role: "assistant", text: "" }]);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          const evt = JSON.parse(line.slice(6)) as { delta?: string; employee?: TeamEmployee };
          if (evt.employee) setEmployee(evt.employee);
          if (typeof evt.delta === "string") {
            answer += evt.delta;
            setMsgs((m) => {
              const next = [...m];
              next[next.length - 1] = { role: "assistant", text: answer };
              return next;
            });
          }
        } catch {
          // partial frame — the next read completes it
        }
      }
    }
    if (!answer) setMsgs((m) => [...m.slice(0, -1), { role: "assistant", text: "…" }]);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      if (supportV2) await sendV2(text);
      else await sendV1(text);
    } catch {
      // v2 stream failed (e.g. flag flipped off) — fall back to v1 once.
      try {
        await sendV1(text);
      } catch {
        setMsgs((m) => [...m, { role: "assistant", text: "…" }]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-widget">
      {open && (
        <div className="chat-panel" role="dialog" aria-label={dict.chat_t}>
          <div className="chat-head">
            <span>
              {employee ? `${employee.avatar} ` : "✦ "}{dict.chat_t}
              {employee && (
                <small style={{ display: "block", opacity: 0.85 }}>
                  {dict.chat_speaking_with} {locale === "ar" ? employee.name.ar : employee.name.en}
                </small>
              )}
            </span>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>
          <div className="chat-msgs">
            {msgs.map((m, i) => (
              <p key={i} className={`chat-msg chat-${m.role}`}>
                {m.text}
                {m.role === "assistant" && ttsOk && m.text.length > 1 && (
                  <button
                    type="button" className="icon-btn" aria-label={dict.chat_listen}
                    onClick={() => speak(m.text)} style={{ marginInlineStart: 6 }}
                  >🔊</button>
                )}
              </p>
            ))}
            {busy && msgs[msgs.length - 1]?.role === "user" && <p className="chat-msg chat-assistant">…</p>}
          </div>
          {supportV2 && (
            <div className="chat-tools">
              <button type="button" className="btn btn-ghost" onClick={() => setShowOrder((s) => !s)}>
                {dict.chat_track_order}
              </button>
              {showOrder && (
                <div className="chat-order-form">
                  <input
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                    placeholder={dict.chat_order_id_ph}
                    aria-label={dict.chat_order_id_ph}
                  />
                  <input
                    value={orderEmail}
                    onChange={(e) => setOrderEmail(e.target.value)}
                    placeholder={dict.chat_email_ph}
                    aria-label={dict.chat_email_ph}
                    type="email"
                  />
                </div>
              )}
            </div>
          )}
          <form
            className="chat-form"
            onSubmit={(e) => { e.preventDefault(); void send(); }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={dict.chat_ph}
              aria-label={dict.chat_ph}
            />
            {supportV2 && voiceOk && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={startVoice}
                aria-label={dict.chat_voice}
                aria-pressed={listening}
              >
                {listening ? dict.chat_listening : "🎙"}
              </button>
            )}
            <button type="submit" className="btn btn-primary">{dict.chat_send}</button>
          </form>
        </div>
      )}
      <button type="button" className="chat-fab" onClick={() => setOpen((o) => !o)} aria-label={dict.chat_t}>
        ✦
      </button>
    </div>
  );
}
