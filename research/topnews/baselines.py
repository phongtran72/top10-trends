"""5.5 · Baselines: rule-based forecasts that any model has to beat.

Two forecasts, scored on the latest stretch of data held out by time:

- **lifespan** (the days horizon, here per list): at every hourly fetch, for
  every item in a list's top 10, how many more hours it stays. Three rules:
  `median_left` (the Kaplan–Meier median of the time left at this age,
  fitted only on what was known before the split), `as_long_again` (it lasts
  as long again as it has so far, at least an hour: the Lindy rule) and
  `one_more_hour`. Scored fairly by "still listed k hours later?"
  (`score_horizons`), and by error in hours on stays that have ended, which
  favors short stays when the test stretch is short.
- **breakout** (the hours horizon): PLAN.md's rule, "on 2 platforms within 2
  hours of first appearing", forecasts that a story reaches 3 or more
  platforms within 6 hours. Scored by precision, recall and lead time.
  A forecast hour counts only when every list was being collected and the
  6 hours after it are in the data.

Durations are whole hours, as in RQ1 (topnews.lifecycle).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

RULES = ("median_left", "as_long_again", "one_more_hour")
BREAKOUT_PLATFORMS = 3
BREAKOUT_HOURS = 6
ALERT_PLATFORMS = 2
ALERT_WITHIN_HOURS = 2


def split_time(items: pd.DataFrame, train_share: float = 0.7) -> pd.Timestamp:
    """The time that leaves the first `train_share` of the data's span for training."""
    start, end = items["fetched_at"].min(), items["fetched_at"].max()
    return start + (end - start) * train_share


def training_spells(spells: pd.DataFrame, split: pd.Timestamp) -> pd.DataFrame:
    """The spells as they looked at `split`: those started before it, cut off there. A spell still running
    at the split is censored there, so nothing after the split leaks into training."""
    started = spells[(spells["start"] < split) & ~spells["left_censored"]]
    end_known = (started["end"] <= split) & ~started["right_censored"]
    # Running at the split: first sighting to the last fetch before it, as lifecycle measures running stays.
    hours = np.where(end_known, started["hours"], ((split - started["start"]).dt.total_seconds() / 3600).round())
    return started.assign(hours=hours, right_censored=~end_known)


def median_left_table(train: pd.DataFrame) -> pd.DataFrame:
    """Per list: the Kaplan–Meier median of the hours left, by age in hours, from the training spells."""
    from lifelines import KaplanMeierFitter

    rows = []
    for list_id, group in train.groupby("list_id"):
        km = KaplanMeierFitter().fit(group["hours"], event_observed=~group["right_censored"])
        left = km.conditional_time_to_event_.iloc[:, 0]
        cap = float(group["hours"].max())
        for age in range(int(cap) + 1):
            known = left[left.index <= age]
            value = float(known.iloc[-1]) if len(known) else cap
            rows.append({"list_id": list_id, "age": age, "median_left": max(1.0, min(value, cap)) if np.isfinite(value) else cap})
    return pd.DataFrame(rows)


def lifespan_forecasts(spells: pd.DataFrame, split: pd.Timestamp, table: pd.DataFrame) -> pd.DataFrame:
    """One forecast per item and hourly fetch after the split, with each rule's guess and, for stays that
    ended, the hours actually left."""
    rows = []
    usable = spells[~spells["left_censored"]]
    lookup = table.set_index(["list_id", "age"])["median_left"] if len(table) else pd.Series(dtype=float)
    caps = table.groupby("list_id")["age"].max() if len(table) else pd.Series(dtype=float)
    for spell in usable.itertuples(index=False):
        for age in range(int(spell.hours)):
            at = spell.start + pd.to_timedelta(age, unit="h")
            if at < split:
                continue
            if spell.list_id not in caps.index:
                continue  # no training spells for this list
            key = (spell.list_id, min(age, int(caps[spell.list_id])))
            rows.append(
                {
                    "list_id": spell.list_id,
                    "title": spell.title,
                    "at": at,
                    "age": age,
                    "actual_left": np.nan if spell.right_censored else spell.hours - age,
                    "observed_left": spell.hours - age,  # a lower bound when the stay hadn't ended
                    "ended": not spell.right_censored,
                    "median_left": float(lookup.get(key, np.nan)),
                    "as_long_again": float(max(1, age)),
                    "one_more_hour": 1.0,
                }
            )
    return pd.DataFrame(rows)


def score_horizons(forecasts: pd.DataFrame, data_end: pd.Timestamp, ks: tuple[int, ...] = (1, 2, 3)) -> pd.DataFrame:
    """The fair score: "still listed k hours later?", for each k, per list and rule.

    A rule says yes when it gives more than k hours left. Only forecasts made
    at least k hours before the end of the data count, and for those the
    answer is known whether the stay ended or not: unlike error in hours,
    long stays aren't dropped for still running. `still_listed` is the true
    share, so a rule must beat always answering the more common answer.
    """
    rows = []
    for k in ks:
        in_data = forecasts["at"] + pd.to_timedelta(k, unit="h") <= data_end + pd.to_timedelta(15, unit="min")
        # An ended stay was last listed observed_left - 1 hours later. A stay that hadn't ended was last seen
        # observed_left hours later (lifecycle's hours run first to last sighting); after that its answer is
        # unknown (it might come back, or the data stops), so those forecasts are left out.
        unknown = ~forecasts["ended"] & (forecasts["observed_left"] < k)
        known = forecasts[in_data & ~unknown]
        truth = pd.Series(
            np.where(known["ended"], known["observed_left"] > k, known["observed_left"] >= k), index=known.index
        )
        for list_id, group in known.groupby("list_id"):
            t = truth[group.index]
            for rule in RULES:
                rows.append(
                    {
                        "list_id": list_id,
                        "k_hours": k,
                        "rule": rule,
                        "forecasts": len(group),
                        "still_listed": float(t.mean()),
                        "accuracy": float(((group[rule] > k) == t).mean()),
                    }
                )
    return pd.DataFrame(rows)


def score_lifespans(forecasts: pd.DataFrame) -> pd.DataFrame:
    """Per list and rule, on forecasts whose stay has ended: mean and median error in hours, and the share
    within an hour. Biased toward short stays when the test stretch is short (long ones are still running and
    left out); score_horizons isn't."""
    scored = forecasts.dropna(subset=["actual_left"])
    rows = []
    for list_id, group in scored.groupby("list_id"):
        for rule in RULES:
            error = (group[rule] - group["actual_left"]).abs()
            rows.append(
                {
                    "list_id": list_id,
                    "rule": rule,
                    "forecasts": len(group),
                    "mean_error_hours": float(error.mean()),
                    "median_error_hours": float(error.median()),
                    "within_1h": float((error <= 1).mean()),
                }
            )
    return pd.DataFrame(rows)


def story_platform_starts(stories: pd.DataFrame) -> pd.DataFrame:
    """From topnews.leadlag.story_pairs: each story's earliest sighting on each platform."""
    sides = pd.concat(
        [
            stories[["story", "platform_a", "first_a", "censored"]].set_axis(["story", "platform", "first", "censored"], axis=1),
            stories[["story", "platform_b", "first_b", "censored"]].set_axis(["story", "platform", "first", "censored"], axis=1),
        ]
    )
    return sides.groupby(["story", "platform"]).agg(first=("first", "min"), censored=("censored", "any")).reset_index()


def breakout_forecasts(starts: pd.DataFrame, hours: list[pd.Timestamp], data_end: pd.Timestamp) -> pd.DataFrame:
    """At each forecast hour, for each story already seen and not yet on 3 platforms: whether the rule
    alerts, and whether the story reached 3 platforms within the next 6 hours. Hours without 6 hours of
    data after them are left out."""
    rows = []
    window = pd.to_timedelta(BREAKOUT_HOURS, unit="h")
    for at in hours:
        if at + window > data_end:
            continue
        for story, group in starts.groupby("story"):
            if group["censored"].any():
                continue  # already listed when a source's data began: its start is unknown
            seen = group[group["first"] <= at].sort_values("first")
            if seen.empty or len(seen) >= BREAKOUT_PLATFORMS:
                continue
            first = seen["first"].min()
            within = seen[seen["first"] <= first + pd.to_timedelta(ALERT_WITHIN_HOURS, unit="h")]
            by_end = group[group["first"] <= at + window].sort_values("first")
            reached = len(by_end) >= BREAKOUT_PLATFORMS
            reached_at = by_end["first"].iloc[BREAKOUT_PLATFORMS - 1] if reached else pd.NaT
            rows.append(
                {
                    "story": story,
                    "at": at,
                    "platforms": len(seen),
                    "alert": len(within) >= ALERT_PLATFORMS,
                    "breakout": reached,
                    "lead_hours": (reached_at - at).total_seconds() / 3600 if reached else np.nan,
                }
            )
    return pd.DataFrame(rows, columns=["story", "at", "platforms", "alert", "breakout", "lead_hours"])


def score_breakouts(forecasts: pd.DataFrame) -> dict:
    """Precision (share of alerts followed by a breakout), recall (share of breakouts alerted) and the median
    lead time of correct alerts, over story-hours. Stories that never matched across lists can neither
    alert nor break out, so they're not counted."""
    alerts, hits = forecasts["alert"], forecasts["alert"] & forecasts["breakout"]
    return {
        "story_hours": len(forecasts),
        "alerts": int(alerts.sum()),
        "breakouts": int(forecasts["breakout"].sum()),
        "precision": float(hits.sum() / alerts.sum()) if alerts.sum() else float("nan"),
        "recall": float(hits.sum() / forecasts["breakout"].sum()) if forecasts["breakout"].sum() else float("nan"),
        "median_lead_hours": float(forecasts.loc[hits, "lead_hours"].median()) if hits.any() else float("nan"),
    }
