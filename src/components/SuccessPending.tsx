"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Unverified/pending state of the success page (thermal fix): in the
 * redirect flow the capture happens in the PayPal webhook, which can
 * land seconds after the buyer returns — the page used to show a
 * static "pending" line and strand the buyer until they happened to
 * reload at the right moment. This poller reloads the page every 3s
 * (bounded, ~60s) so the verified state + download buttons appear on
 * their own, and offers a manual re-check button meanwhile.
 */
export default function SuccessPending({ note, checkLabel }: { note: string; checkLabel: string }) {
  const [attempts, setAttempts] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (attempts >= 20) return;
    timer.current = setTimeout(() => {
      setAttempts((a) => a + 1);
      location.reload();
    }, 3000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [attempts]);

  return (
    <>
      <p className="muted">{note}</p>
      <p style={{ marginTop: 14 }}>
        <button type="button" className="btn btn-ghost" onClick={() => location.reload()}>
          ↻ {checkLabel}
        </button>
      </p>
    </>
  );
}
