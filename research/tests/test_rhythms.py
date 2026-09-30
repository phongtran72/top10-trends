import numpy as np
import pandas as pd
import pytest

from topnews import rhythms


def fetches(source, start, lists, run_start=1, metrics=None, region="global", offsets=None, urls=None):
    """Synthetic stored-list rows: one fetch per list, an hour apart unless `offsets` (hours) are given.
    `metrics` and `urls` are per fetch: one value for every item, or a list per item."""
    rows = []
    for i, titles in enumerate(lists):
        hours = offsets[i] if offsets is not None else i
        at = pd.Timestamp(start, tz="UTC") + pd.to_timedelta(hours, unit="h")
        for rank, title in enumerate(titles, start=1):
            metric = None if metrics is None else metrics[i]
            url = None if urls is None else urls[i]
            rows.append(
                {
                    "run_id": run_start + i,
                    "source_id": source,
                    "region": region,
                    "rank": rank,
                    "title": title,
                    "url": url[rank - 1] if isinstance(url, list) else url,
                    "fetched_at": at,
                    "metric_value": metric[rank - 1] if isinstance(metric, list) else metric,
                }
            )
    return pd.DataFrame(rows)


def test_title_key_matches_loosely():
    assert rhythms.title_key("  #World  Series ") == "world series"
    assert rhythms.title_key("#WorldSeries2026") == "world series 2026"  # split like the pipeline
    assert rhythms.title_key("#NBAFinals") == "nba finals"
    assert rhythms.title_key("#meermittwoch") == "meermittwoch"


def test_list_id_names_regional_lists():
    assert rhythms.list_id("bluesky", "global") == "bluesky"
    assert rhythms.list_id("google_trends", "us") == "google_trends (us)"


def test_turnover_counts_new_items_and_skips_first_fetch():
    items = fetches("mastodon", "2026-10-01T00:07", [["a", "b"], ["a", "c"], ["#C", "d"]])
    t = rhythms.turnover(rhythms.list_runs(items))
    assert t["new"].tolist() == [1, 1]  # c is new, then d ("#C" matches "c")
    assert t["share_new"].tolist() == [0.5, 0.5]


def test_turnover_follows_a_bluesky_topic_through_a_title_change():
    items = fetches(
        "bluesky",
        "2026-10-01T00:07",
        [["Jack Smith testifies to Senate"], ["Schmitt remarks on Jack Smith"]],
        urls=["https://bsky.app/feed/43f0", "https://bsky.app/feed/43f0"],
    )
    assert rhythms.turnover(rhythms.list_runs(items))["new"].tolist() == [0]


def test_turnover_only_looks_at_the_top_ten():
    deep = [f"t{n}" for n in range(12)]
    reordered = deep[10:] + deep[:10]  # t10 and t11 move up into the top 10
    t = rhythms.turnover(rhythms.list_runs(fetches("twitch", "2026-10-01T00:07", [deep, reordered])))
    assert t["new"].tolist() == [2]


def test_comparisons_skip_missed_runs():
    items = fetches("mastodon", "2026-10-01T00:07", [["a"], ["b"], ["c"]], offsets=[0, 1, 5])
    assert len(rhythms.comparisons(rhythms.list_runs(items))) == 1  # 00:07→01:07 only; 01:07→05:07 is a gap


def test_comparisons_pair_an_extra_run_with_the_fetch_an_hour_earlier():
    items = fetches("mastodon", "2026-10-01T00:07", [["a"], ["b"], ["b"]], offsets=[0, 0.9, 1.0])
    pairs = rhythms.comparisons(rhythms.list_runs(items))
    # the 01:07 fetch is 6 minutes after an extra run at 01:01, so it pairs with 00:07 instead
    assert pairs["previous_run_id"].tolist() == [1, 1]
    assert pairs["gap_hours"].round(1).tolist() == [0.9, 1.0]


def test_novelty_counts_first_appearances_with_zeros_and_skips_the_opening_fetch():
    items = fetches("google_trends", "2026-10-01T00:07", [["a", "b"], ["a", "c"], ["c", "a"]], region="us")
    n = rhythms.novelty(items)
    assert n["list_id"].unique().tolist() == ["google_trends (us)"]
    assert n["first_time"].tolist() == [1, 0]


def test_flow_measures_hourly_growth_not_totals():
    items = fetches(
        "hacker_news",
        "2026-10-01T00:07",
        [["old", "new"], ["old", "new"], ["old", "new"]],
        metrics=[[900, 10], [910, 50], [920, 130]],  # old has the big total, new the growth
        urls=[["u/old", "u/new"]] * 3,
    )
    f = rhythms.flow(items)
    assert f["rate"].tolist() == [25.0, 45.0]  # medians of (10, 40) and (10, 80)
    assert f["matched"].tolist() == [2, 2]
    assert f["relative"].round(3).tolist() == [round(25 / 35, 3), round(45 / 35, 3)]


def test_flow_drops_resets_and_matches_items_from_deeper_in_the_last_list():
    deep = [f"t{n}" for n in range(12)]
    items = fetches(
        "mastodon",
        "2026-10-01T23:07",
        [deep, deep[11:] + deep[:11]],  # t11 rises from #12 to #1
        metrics=[[100] * 12, [150] + [5] * 11],  # t11 grows; the others look reset
        offsets=[0, 1],
    )
    f = rhythms.flow(items)
    assert f["matched"].tolist() == [1]
    assert f["rate"].tolist() == [50.0]


def test_flow_leaves_out_google_and_lists_without_a_metric():
    items = pd.concat(
        [
            fetches("google_trends", "2026-10-01T00:07", [["a"], ["a"]], metrics=[200, 500], region="us"),
            fetches("twitch", "2026-10-01T00:07", [["g"], ["g"]], run_start=10),
        ]
    )
    assert rhythms.flow(items).empty


def test_with_clock_adds_local_time():
    df = pd.DataFrame({"fetched_at": [pd.Timestamp("2026-10-01T16:07", tz="UTC")]})
    clocked = rhythms.with_clock(df)
    assert clocked.loc[0, "hour_utc"] == 16
    assert clocked.loc[0, "hour_local"] == 12  # EDT is UTC-4
    assert clocked.loc[0, "weekday_local"] == "Thursday"


def hourly(values, start="2026-10-01T04:07"):
    times = pd.date_range(start, periods=len(values), freq="h", tz="UTC")
    return rhythms.with_clock(pd.DataFrame({"list_id": "bluesky", "fetched_at": times, "share_new": values}))


def test_hour_effect_waits_for_enough_days():
    assert rhythms.hour_effect(hourly([0.2] * 20), "share_new") is None


def test_hour_effect_finds_a_planted_pattern_despite_busy_days():
    rng = np.random.default_rng(1)
    n = 24 * 6
    local_hour = pd.date_range("2026-10-01T04:07", periods=n, freq="h", tz="UTC").tz_convert(rhythms.AUDIENCE_TZ).hour
    day_level = np.repeat(rng.normal(0, 0.2, 6), 24)  # some days are busier overall
    values = 0.3 + 0.2 * (local_hour == 9) + day_level + rng.normal(0, 0.02, n)
    result = rhythms.hour_effect(hourly(values), "share_new")
    assert result is not None
    row = result.iloc[0]
    assert row["peak_hour"] == 9
    assert row["f_pvalue"] < 0.001
    assert row["peak_minus_low"] == pytest.approx(0.2, abs=0.05)


def test_hour_effect_flags_pure_noise_about_one_time_in_twenty():
    rng = np.random.default_rng(2)
    pvalues = [
        rhythms.hour_effect(hourly(0.3 + rng.normal(0, 0.05, 24 * 6)), "share_new").iloc[0]["f_pvalue"]
        for _ in range(200)
    ]
    assert 0.01 <= np.mean(np.array(pvalues) < 0.05) <= 0.10


def test_by_hour_reports_fetches_and_days():
    table = rhythms.by_hour(hourly([0.1] * 48), "share_new")
    assert set(table["n"]) == {2}
    assert set(table["days"]) == {2}
