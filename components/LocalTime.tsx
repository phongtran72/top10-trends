"use client";

import { useSyncExternalStore } from "react";
import { utcTime } from "@/lib/format";

// An absolute time in the visitor's own time zone. Cached HTML can't know the
// zone, so the server renders UTC and the browser replaces it.

const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

const FORMATS = {
  time: { hour: "numeric", minute: "2-digit" },
  dateTime: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export function LocalTime({ iso, format = "dateTime" }: { iso: string; format?: keyof typeof FORMATS }) {
  const client = useSyncExternalStore(subscribe, onClient, onServer);
  const text = client ? new Date(iso).toLocaleString(undefined, FORMATS[format]) : utcTime(iso);
  return (
    <time dateTime={iso} title={utcTime(iso)}>
      {text}
    </time>
  );
}
