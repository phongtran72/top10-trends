"""RQ4 · News and memes: do news-driven trends last longer than memes?

Works on the stored lists before topic snapshots (with `news_count`) and
outside news data (GDELT, task 5.8) exist. Each trend gets one category:

- `google`: a Google Trends trend. Every one comes with a news story, so
  Google is news by construction and is kept apart;
- `calendar`: a recurring calendar moment: a weekday hashtag (#WIPWednesday),
  a "national … day" or a season's first day. These are memes that come back
  on schedule, the weeks horizon's kind of moment;
- `news-linked`: matched to a Google trend (RQ6's matching, at
  `threshold`), so a news story stands behind it; the stored-list
  counterpart of a snapshot's `news_count`;
- `other`: everything else: games, tech stories, memes, culture.

Lifespans come from RQ1's spells, and spread from RQ6's platform counts.
"""

from __future__ import annotations

import re

import pandas as pd

from .leadlag import PAIR_THRESHOLD

WEEKDAYS = re.compile(r"monday|tuesday|wednesday|thursday|friday|saturday|sunday", re.IGNORECASE)
SEASON_START = re.compile(r"first\s*day\s*of\s*(spring|summer|fall|autumn|winter)", re.IGNORECASE)
# Spaced titles need whole words ("World Series today" is no calendar day);
# one-word hashtags are matched whole ("#internationalpodcastday").
OBSERVANCE_WORDS = re.compile(r"\b(national|international|world)\b.*\b(day|week|month)\b", re.IGNORECASE)
OBSERVANCE_TAG = re.compile(r"(national|international|world)\w*(day|week|month)", re.IGNORECASE)
CATEGORIES = ("google", "calendar", "news-linked", "other")


def is_calendar(title: str) -> bool:
    """A recurring calendar moment, spaced or written as one word: "#WIPWednesday", "national coffee day",
    "#internationalpodcastday", "first day of fall"."""
    text = title.replace("#", "").strip()
    one_word = " " not in text
    return bool(
        WEEKDAYS.search(text)
        or SEASON_START.search(text)
        or OBSERVANCE_WORDS.search(text)
        or (one_word and OBSERVANCE_TAG.fullmatch(text))
    )


def categorize(cp: pd.DataFrame, threshold: float = PAIR_THRESHOLD) -> pd.DataFrame:
    """Adds `category` (see the module notes) and `news_sim`, the best similarity to a Google trend."""
    news_sim = cp["sim_google_trends"] if "sim_google_trends" in cp else pd.Series(float("nan"), index=cp.index)
    category = pd.Series("other", index=cp.index)
    category[news_sim >= threshold] = "news-linked"
    category[cp["title"].map(is_calendar)] = "calendar"
    category[cp["source_id"] == "google_trends"] = "google"
    return cp.assign(category=pd.Categorical(category, categories=CATEGORIES), news_sim=news_sim)


def with_spells(spell_table: pd.DataFrame, categorized: pd.DataFrame) -> pd.DataFrame:
    """RQ1's spells with each trend's category (spells of trends the filters dropped are left out)."""
    return spell_table.merge(categorized[["source_id", "key", "category"]], on=["source_id", "key"], how="inner")


def lifespans(spells_with_category: pd.DataFrame) -> pd.DataFrame:
    """Kaplan–Meier median time in the top 10 and share still listed after 3 hours, per platform and category."""
    from lifelines import KaplanMeierFitter

    rows = []
    usable = spells_with_category[~spells_with_category["left_censored"]]
    for (source, category), group in usable.groupby(["source_id", "category"], observed=True):
        km = KaplanMeierFitter().fit(group["hours"], event_observed=~group["right_censored"])
        rows.append(
            {
                "source_id": source,
                "category": category,
                "spells": len(group),
                "ended": int((~group["right_censored"]).sum()),
                "median_hours": float(km.median_survival_time_),
                "listed_after_3h": float(km.survival_function_at_times(3).iloc[0]),
            }
        )
    return pd.DataFrame(rows)


def spread_by_category(categorized: pd.DataFrame, threshold: float = PAIR_THRESHOLD) -> pd.DataFrame:
    """Per category: trends, and the share seen on another list besides Google (RQ6's matches at `threshold`).
    Google is left out of the count because `news-linked` means matched to Google, which would make its
    spread 100% by definition."""
    sims = categorized[[c for c in categorized.columns if c.startswith("sim_") and c != "sim_google_trends"]]
    return (
        categorized.assign(spread=(sims >= threshold).any(axis=1))
        .groupby("category", observed=True)
        .agg(trends=("trend_id", "size"), spread=("spread", "mean"))
        .reset_index()
    )
