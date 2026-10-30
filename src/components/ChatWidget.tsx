"use client";
/**
 * Floating support assistant. Talks to /api/support/chat, which answers
 * from catalog/policy data (or a grounded model when a key is configured).
 * Voice agents are a later phase — see docs/LIMITATIONS.md.
 */
import { useState } from "react";
import type { Dict } from "../i18n/dictionaries";

interface Msg { role: "user" | "assistant"; text: string }

export default function ChatWidget({ dict, locale }: { dict: Dict; locale: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: dict.chat_greeting }]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const res = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, locale }),
      });
      const data = (await res.json()) as { answer?: string };
      setMsgs((m) => [...m, { role: "assistant", text: data.answer ?? "…" }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "…" }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-widget">
      {open && (
        <div className="chat-panel" role="dialog" aria-label={dict.chat_t}>
          <div className="chat-head">
            <span>✦ {dict.chat_t}</span>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>
          <div className="chat-msgs">
            {msgs.map((m, i) => (
              <p key={i} className={`chat-msg chat-${m.role}`}>{m.text}</p>
            ))}
            {busy && <p className="chat-msg chat-assistant">…</p>}
          </div>
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
