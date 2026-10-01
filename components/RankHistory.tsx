import { utcTime } from "@/lib/format";
import styles from "./trends.module.css";

// A topic's place in the combined top 10 over the last 7 days: one line, rank
// 1 at the top, broken where the topic was out of the top 10. Server-rendered
// SVG; each point shows its time and rank on hover, and a table view follows.

const W = 640;
const H = 180;
const PAD = { left: 30, right: 12, top: 10, bottom: 24 };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function RankHistory({ history, end }: { history: { at: string; rank: number }[]; end: string }) {
  if (history.length === 0) return <p className={styles.tableView}>No time in the combined top 10 in the last 7 days.</p>;

  const endMs = new Date(end).getTime();
  const startMs = endMs - 7 * DAY;
  const x = (ms: number) => PAD.left + ((ms - startMs) / (endMs - startMs)) * (W - PAD.left - PAD.right);
  const y = (rank: number) => PAD.top + ((rank - 1) / 9) * (H - PAD.top - PAD.bottom);

  // Break the line where hourly rankings are missing (out of the top 10).
  const segments: { at: number; rank: number }[][] = [];
  for (const point of history) {
    const at = new Date(point.at).getTime();
    const last = segments.at(-1)?.at(-1);
    if (last && at - last.at <= 1.5 * HOUR) segments.at(-1)!.push({ at, rank: point.rank });
    else segments.push([{ at, rank: point.rank }]);
  }

  const days = Array.from({ length: 8 }, (_, i) => startMs + i * DAY);
  const best = Math.min(...history.map((h) => h.rank));

  return (
    <figure>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Rank in the combined top 10 over the last 7 days; best #${best}, in the top 10 for ${history.length} hourly rankings.`}
      >
        {[1, 5, 10].map((rank) => (
          <g key={rank}>
            <line className={styles.gridLine} x1={PAD.left} x2={W - PAD.right} y1={y(rank)} y2={y(rank)} />
            <text className={styles.axisText} x={PAD.left - 8} y={y(rank) + 4} textAnchor="end">
              #{rank}
            </text>
          </g>
        ))}
        {days.map((ms, i) => (
          <text key={ms} className={styles.axisText} x={x(ms)} y={H - 6} textAnchor={i === 0 ? "start" : i === 7 ? "end" : "middle"}>
            {new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
          </text>
        ))}
        {segments.map((segment) =>
          segment.length > 1 ? (
            <polyline
              key={`line-${segment[0].at}`}
              className={styles.line}
              points={segment.map((p) => `${x(p.at).toFixed(1)},${y(p.rank).toFixed(1)}`).join(" ")}
            />
          ) : null,
        )}
        {segments.flat().map((p) => (
          <g key={p.at}>
            <circle className={styles.hit} cx={x(p.at)} cy={y(p.rank)} r={9}>
              <title>{`${utcTime(new Date(p.at).toISOString())}: #${p.rank}`}</title>
            </circle>
            <circle className={styles.point} cx={x(p.at)} cy={y(p.rank)} r={4} pointerEvents="none" />
          </g>
        ))}
      </svg>
      <details className={styles.tableView}>
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Hour (UTC)</th>
              <th scope="col">Rank</th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((h) => (
              <tr key={h.at}>
                <td>{utcTime(h.at)}</td>
                <td>#{h.rank}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
