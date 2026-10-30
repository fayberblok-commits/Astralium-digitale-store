"use client";
/** Fires one analytics event on mount (Phase 6, feature 27). No-ops when the beacon is absent. */
import { useEffect, useRef } from "react";
import { track, type TrackType } from "../lib/track-client";

export default function TrackEvent({ type, productId }: { type: TrackType; productId?: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track(type, productId ? { productId } : undefined);
  }, [type, productId]);
  return null;
}
