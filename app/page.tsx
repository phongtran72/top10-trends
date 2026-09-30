import { PLATFORMS, type SourceDef } from "@/collectors/registry";
import styles from "./page.module.css";

const PHASE_TITLES: Record<number, { title: string; note: string }> = {
  1: { title: "First up", note: "Free sources, no approval needed." },
  3: { title: "Later", note: "Paid, approval-gated or optional sources." },
};

const ROLE_LABELS: Record<SourceDef["role"], string> = {
  lead: "Lead",
  corroborating: "Corroborating",
  system: "System",
};

function groupByPhase(sources: readonly SourceDef[]): [number, SourceDef[]][] {
  const groups = new Map<number, SourceDef[]>();
  for (const source of sources) groups.set(source.phase, [...(groups.get(source.phase) ?? []), source]);
  return [...groups.entries()].sort(([a], [b]) => a - b);
}

export default function Home() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Coming soon</p>
        <h1>Top 10 Social Trends</h1>
        <p className={styles.lede}>
          The top 10 trending topics on each social platform, plus one combined top 10 across all of them,
          refreshed every hour. English-language trends in the US and worldwide.
        </p>
      </header>

      {groupByPhase(PLATFORMS).map(([phase, sources]) => (
        <section key={phase} className={styles.section} aria-labelledby={`phase-${phase}`}>
          <h2 id={`phase-${phase}`}>{PHASE_TITLES[phase]?.title ?? `Phase ${phase}`}</h2>
          <p className={styles.note}>{PHASE_TITLES[phase]?.note}</p>
          <ul className={styles.list}>
            {sources.map((source) => (
              <li key={source.id} className={styles.item}>
                {source.homepage ? (
                  <a href={source.homepage} rel="noopener noreferrer">
                    {source.name}
                  </a>
                ) : (
                  source.name
                )}
                <span className={styles.role} data-role={source.role}>
                  {ROLE_LABELS[source.role]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <footer className={styles.footer}>
        <p>
          Lead sources report live trends and name topics; corroborating sources only boost a topic a lead source
          already has. A personal, non-commercial project.
        </p>
      </footer>
    </main>
  );
}
