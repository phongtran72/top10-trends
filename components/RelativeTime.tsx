"use client";

import { useSyncExternalStore } from "react";
import { relativeTime, utcTime } from "@/lib/format";

// Cached HTML would freeze a relative time, so the server renders the UTC
// time and the browser replaces it with "N min ago", refreshed every 30 s.

const TICK_MS = 30_000;

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
}

// Rounded to the tick so the snapshot stays stable between ticks.
const clientNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const serverNow = () => null;

export function RelativeTime({ iso, prefix }: { iso: string; prefix?: string }) {
  const now = useSyncExternalStore(subscribe, clientNow, serverNow);
  const text = now === null ? `at ${utcTime(iso)}` : relativeTime(iso, now);
  return (
    <time dateTime={iso} title={utcTime(iso)}>
      {prefix ? `${prefix} ${text}` : text}
    </time>
  );
}
