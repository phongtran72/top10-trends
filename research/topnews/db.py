"""Read-only access to the project's database for research notebooks.

Connects only as the research_reader role (SETUP.md §14), whose sessions are
read-only and whose grants allow SELECT only. The connection string comes from
RESEARCH_DATABASE_URL in the repository's .env.local, never from a notebook.

    from topnews import db
    engine = db.engine()          # loads .env.local, refuses any other role
    db.table_counts(engine)
    snaps = db.snapshots(engine, days=7)
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_VAR = "RESEARCH_DATABASE_URL"
READER_ROLE = "research_reader"

TABLES = ("sources", "fetch_runs", "trend_items", "topics", "topic_items", "rankings", "topic_snapshots", "tiktok_curves")

# YouTube's developer policies cap stored API data at 30 days and forbid
# deriving new metrics from it, so helpers leave YouTube rows out unless a
# notebook asks for them, and anything saved to research/data/ should too.
EXCLUDED_BY_DEFAULT = ("youtube",)


def load_env() -> None:
    """Loads the repository's .env.local without overriding real environment variables."""
    load_dotenv(REPO_ROOT / ".env.local", override=False)


def research_url(raw: str | None = None) -> str:
    """The SQLAlchemy URL for RESEARCH_DATABASE_URL, refusing any role but research_reader."""
    url = (raw if raw is not None else os.environ.get(ENV_VAR, "")).strip()
    if not url:
        raise RuntimeError(f"{ENV_VAR} is not set; see SETUP.md §14 and research/README.md")
    parts = urlsplit(url)
    if parts.scheme not in ("postgres", "postgresql"):
        raise ValueError(f"{ENV_VAR} must be a postgres:// connection string")
    # Supabase's pooler names users "<role>.<project ref>".
    role = unquote(parts.username or "").split(".")[0]
    if role != READER_ROLE:
        raise ValueError(f"{ENV_VAR} must connect as {READER_ROLE}, not {role or 'no user'}; research never writes")
    return "postgresql+psycopg://" + url.split("://", 1)[1]


def engine(raw: str | None = None) -> Engine:
    """A read-only SQLAlchemy engine; every session is also set read-only on connect."""
    if raw is None:
        load_env()
    eng = create_engine(research_url(raw), connect_args={"sslmode": "require"}, pool_pre_ping=True)

    @event.listens_for(eng, "connect")
    def _read_only(dbapi_connection, _record):  # noqa: ANN001
        with dbapi_connection.cursor() as cursor:
            cursor.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
        dbapi_connection.commit()

    return eng


def query(eng: Engine, sql: str, **params) -> pd.DataFrame:
    """Runs one SELECT and returns a DataFrame. Use :name placeholders for parameters."""
    with eng.connect() as conn:
        return pd.read_sql_query(text(sql), conn, params=params)


def expand(df: pd.DataFrame, column: str, prefix: str) -> pd.DataFrame:
    """Spreads a JSON column of {source: value} into one column per source (for example rank_bluesky)."""
    wide = pd.json_normalize(df[column].tolist()).add_prefix(prefix)
    wide.index = df.index
    return pd.concat([df.drop(columns=[column]), wide], axis=1)


def table_counts(eng: Engine) -> pd.DataFrame:
    """Row count of every table."""
    rows = [{"table": t, "rows": int(query(eng, f"select count(*) as n from {t}")["n"].iloc[0])} for t in TABLES]
    return pd.DataFrame(rows)


def _since(days: float | None) -> str:
    return "" if days is None else "and {col} > now() - make_interval(secs => :seconds)"


def fetch_runs(eng: Engine, days: float | None = 7) -> pd.DataFrame:
    """One row per source, region and run: status, item count, short error."""
    where = _since(days).format(col="started_at")
    return query(
        eng,
        f"select source_id, region, started_at, finished_at, status, item_count, error from fetch_runs where true {where} order by started_at",
        **({} if days is None else {"seconds": days * 86400}),
    )


def has_column(eng: Engine, table: str, column: str) -> bool:
    """Whether the database has this column yet (a migration may not be applied everywhere)."""
    found = query(
        eng, "select 1 from information_schema.columns where table_name = :table and column_name = :column",
        table=table, column=column,
    )
    return not found.empty


def trend_items(eng: Engine, days: float | None = 7, include_youtube: bool = False) -> pd.DataFrame:
    """Stored list items (kept 28 days): source, region, rank, title, url, metric, status, match_text,
    fetched_at.
    - `status` is Bluesky's lifecycle label (trending, saturating, cooling, stale), stored since migration
      0004; it's empty before that and for other sources.
    - `match_text` is the extra text the pipeline matches on, as a list: Google's headlines and Bluesky's
      description, stored since migration 0005 (the 2026-10-02 18:07 UTC run); None before that and for
      other sources."""
    where = _since(days).format(col="fetched_at")
    status = "status" if has_column(eng, "trend_items", "status") else "null::text as status"
    match_text = "match_text" if has_column(eng, "trend_items", "match_text") else "null::text[] as match_text"
    excluded = "" if include_youtube else "and source_id <> all(:excluded)"
    params: dict = {} if days is None else {"seconds": days * 86400}
    if not include_youtube:
        params["excluded"] = list(EXCLUDED_BY_DEFAULT)
    return query(
        eng,
        f"select run_id, source_id, region, rank, title, url, metric_value, metric_label, {status}, {match_text}, fetched_at "
        f"from trend_items where true {where} {excluded} order by fetched_at, source_id, rank",
        **params,
    )


def topics(eng: Engine) -> pd.DataFrame:
    """Every topic: slug, label, summary, first and last seen (centroids left out; see topic_centroids)."""
    return query(eng, "select id, slug, label, summary, first_seen, last_seen from topics order by first_seen")


def topic_centroids(eng: Engine) -> pd.DataFrame:
    """Topic ids with their 384-number centroid, for clustering topics into categories."""
    return query(eng, "select id, centroid from topics order by id")


def combined_rankings(eng: Engine, days: float | None = 7) -> pd.DataFrame:
    """The combined top 10 of every run: computed_at, region, rank, topic_id, score."""
    where = _since(days).format(col="computed_at")
    return query(
        eng,
        f"select computed_at, region, rank, topic_id, score from rankings where list = 'combined' {where} order by computed_at, rank",
        **({} if days is None else {"seconds": days * 86400}),
    )


def snapshots(eng: Engine, days: float | None = None, algo_version: str | None = None) -> pd.DataFrame:
    """Hourly topic snapshots (permanent, never YouTube), with ranks and metrics spread into columns."""
    where = _since(days).format(col="taken_at")
    version = "" if algo_version is None else "and algo_version = :algo_version"
    params: dict = {} if days is None else {"seconds": days * 86400}
    if algo_version is not None:
        params["algo_version"] = algo_version
    df = query(
        eng,
        "select taken_at, region, topic_id, position, score, platform_count, news_count, algo_version, ranks, metrics "
        f"from topic_snapshots where true {where} {version} order by taken_at, position nulls last",
        **params,
    )
    if df.empty:
        return df
    return expand(expand(df, "ranks", "rank_"), "metrics", "metric_")


def tiktok_curves(eng: Engine, days: float | None = None) -> pd.DataFrame:
    """TikTok's daily popularity curves (permanent): one row per hashtag, curve and day.

    A curve is named by its last day (`window_end`), and each daily Apify run
    brings a new one. Values are 0–100 within one curve, so compare days
    inside a curve, or line curves up by `window_end`, rather than mixing them.
    """
    where = _since(days).format(col="fetched_at")
    return query(
        eng,
        f"select title, window_end, day, value, direction, fetched_at from tiktok_curves where true {where} order by window_end, title, day",
        **({} if days is None else {"seconds": days * 86400}),
    )
