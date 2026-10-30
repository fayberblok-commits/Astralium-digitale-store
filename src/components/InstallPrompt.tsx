"use client";
/**
 * PWA install prompt (Phase 6, feature 28). Captures the browser's
 * `beforeinstallprompt` event and offers installation in the store's
 * own UI; dismissal is remembered for the session. Browsers without
 * the event (e.g. iOS Safari) simply never see the banner — no fake
 * install affordance is shown.
 */
import { useEffect, useState } from "react";
import type { Dict } from "../i18n/dictionaries";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPrompt({ dict }: { dict: Dict }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("astralium-install-dismissed")) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => setVisible(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!visible || !deferred) return null;
  const dismiss = () => {
    sessionStorage.setItem("astralium-install-dismissed", "1");
    setVisible(false);
  };
  return (
    <div className="install-banner" role="dialog" aria-live="polite">
      <div>
        <strong>{dict.install_t}</strong>
        <p className="muted" style={{ margin: "4px 0 0" }}>{dict.install_d}</p>
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            await deferred.prompt();
            const choice = await deferred.userChoice;
            if (choice.outcome === "accepted") setVisible(false);
            else dismiss();
          }}
        >
          {dict.install_btn}
        </button>
        <button type="button" className="btn btn-ghost" onClick={dismiss}>
          {dict.install_dismiss}
        </button>
      </div>
    </div>
  );
}
