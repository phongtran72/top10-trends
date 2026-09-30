import styles from "./trends.module.css";

// Change in the combined top 10 against about 24 hours earlier: ▲ up, ▼ down,
// "=" unchanged, "new" when it wasn't there. Nothing when there's no ranking
// from a day earlier to compare with.
export function RankChange({ change, compared }: { change: number | null; compared: boolean }) {
  if (!compared) return null;
  if (change === null) return <span className={`${styles.change} ${styles.fresh}`}>new</span>;
  if (change === 0) {
    return (
      <span className={`${styles.change} ${styles.same}`} title="Same place as a day ago">
        =
      </span>
    );
  }
  const up = change > 0;
  return (
    <span
      className={`${styles.change} ${up ? styles.up : styles.down}`}
      title={`${up ? "Up" : "Down"} ${Math.abs(change)} since a day ago`}
    >
      {up ? "▲" : "▼"} {Math.abs(change)}
    </span>
  );
}
