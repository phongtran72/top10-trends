import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getArchiveDays } from "@/lib/cached";
import { dayName } from "@/lib/format";
import styles from "./archive.module.css";

export const metadata: Metadata = {
  title: "Archive",
  description: "Past combined top 10s, hour by hour, for every day since the site began.",
  alternates: { canonical: "/archive" },
};

// The archive's index: every day that has a combined top 10, newest first.
// Renders per request (never at build time) from cached data.
export default async function ArchiveIndex() {
  await connection();
  const days = await getArchiveDays();

  return (
    <>
      <h1 className="page-title">Archive</h1>
      <p className="lede">Every hourly top 10 across platforms, by day. Days are UTC days.</p>

      {days.length > 0 ? (
        <ul className={styles.days}>
          {days.map((day) => (
            <li key={day.date}>
              <Link href={`/archive/${day.date}`} className={styles.day}>
                <span className={styles.dayName}>{dayName(day.date)}</span>
                <span className={styles.dayMeta}>
                  {day.lists} hourly list{day.lists === 1 ? "" : "s"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No combined top 10 has been recorded yet.</p>
      )}
    </>
  );
}
