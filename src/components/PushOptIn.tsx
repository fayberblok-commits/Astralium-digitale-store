"use client";
/**
 * Web Push opt-in (Phase 6, feature 28). Rendered only when the
 * pwa_push flag is on. Handles the full browser lifecycle: permission →
 * pushManager.subscribe with the server VAPID key → POST subscription.
 * Unsubscribing calls the unsubscribe endpoint and the browser API.
 * When push is unsupported the control honestly says so.
 */
import { useEffect, useState } from "react";
import type { Dict } from "../i18n/dictionaries";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "unknown" | "unsupported" | "off" | "on" | "busy" | "error";

export default function PushOptIn({ dict }: { dict: Dict }) {
  const [state, setState] = useState<State>("unknown");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        setState(sub ? "on" : "off");
      } catch {
        setState("off");
      }
    })();
  }, []);

  async function enable() {
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState("off"); return; }
      const keyRes = await fetch("/api/push/key");
      const keyData = (await keyRes.json()) as { publicKey?: string };
      if (!keyRes.ok || !keyData.publicKey) { setState("error"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      setState(res.ok ? "on" : "error");
    } catch {
      setState("error");
    }
  }

  async function disable() {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setState("error");
    }
  }

  if (state === "unknown") return null;
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>{dict.push_t}</h3>
      <p className="muted">{dict.push_d}</p>
      {state === "unsupported" ? (
        <p><span className="pill pill-bad">{dict.push_unsupported}</span></p>
      ) : state === "on" ? (
        <p>
          <span className="pill pill-ok">{dict.push_enabled}</span>{" "}
          <button type="button" className="btn btn-ghost" onClick={disable}>
            {dict.push_disable}
          </button>
        </p>
      ) : (
        <p>
          <button type="button" className="btn btn-primary" onClick={enable} disabled={state === "busy"}>
            {dict.push_enable}
          </button>
          {state === "error" ? <> <span className="pill pill-bad">{dict.push_error}</span></> : null}
        </p>
      )}
    </div>
  );
}
