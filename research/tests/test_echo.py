import numpy as np
import pandas as pd
import pytest

from topnews import echo

T0 = pd.Timestamp("2026-10-01T12:07", tz="UTC")


def unit(*values):
    v = np.zeros(echo.DIMENSIONS, dtype=np.float32)
    v[: len(values)] = values
    return v / np.linalg.norm(v)


def table(rows):
    """rows: (source, title, first hours after T0, last hours after T0, fetches)."""
    return pd.DataFrame(
        [
            {
                "trend_id": f"t{i}",
                "source_id": source,
                "key": title.lower(),
                "title": title,
                "first_seen": T0 + pd.to_timedelta(first, unit="h"),
                "last_seen": T0 + pd.to_timedelta(last, unit="h"),
                "best_rank": 1,
                "fetches": fetches,
            }
            for i, (source, title, first, last, fetches) in enumerate(rows)
        ]
    )


def test_the_threshold_comes_from_the_pipelines_config(tmp_path):
    config = tmp_path / "ranking.ts"
    config.write_text("export const TOP_N = 10;\nexport const MATCH_THRESHOLD = 0.86;\n")
    assert echo.pipeline_threshold(config) == 0.86
    config.write_text("export const TOP_N = 10;\n")
    with pytest.raises(ValueError):
        echo.pipeline_threshold(config)
    assert echo.HEADLINE_THRESHOLD == echo.pipeline_threshold()  # the real config
    assert echo.HEADLINE_THRESHOLD in echo.THRESHOLDS


def test_trends_collapse_fetches_and_regions_per_platform():
    items = pd.DataFrame(
        [
            {"run_id": 1, "source_id": "x", "region": "global", "rank": 3, "title": "World Series", "url": "u", "fetched_at": T0},
            {"run_id": 2, "source_id": "x", "region": "us", "rank": 1, "title": "#WorldSeries ", "url": "u", "fetched_at": T0},
            {"run_id": 3, "source_id": "x", "region": "us", "rank": 2, "title": "world series", "url": "u", "fetched_at": T0 + pd.to_timedelta(1, unit="h")},
            {"run_id": 4, "source_id": "bluesky", "region": "global", "rank": 1, "title": "Old name", "url": "b/1", "fetched_at": T0},
            {"run_id": 5, "source_id": "bluesky", "region": "global", "rank": 4, "title": "New name", "url": "b/1", "fetched_at": T0 + pd.to_timedelta(1, unit="h")},
        ]
    )
    t = echo.trends(items).set_index("source_id")
    assert t.loc["x", "best_rank"] == 1 and t.loc["x", "fetches"] == 3  # one trend across both X regions
    assert t.loc["bluesky", "title"] == "New name"  # followed through the rename by url
    assert t.loc["bluesky", "fetches"] == 2


def cp_fixture():
    t = table(
        [
            ("google_trends", "world series", 0, 2, 3),
            ("bluesky", "Dodgers win the World Series", 1, 3, 3),
            ("twitch", "Just Chatting", 0, 5, 6),
            ("mastodon", "world series", 60, 61, 2),  # two days later: outside the slack
        ]
    )
    vectors = np.stack([unit(1, 0.1), unit(1, 0.3), unit(0, 1), unit(1, 0.1)])
    return echo.cross_platform(t, vectors, slack_hours=24)


def test_cross_platform_finds_the_best_match_on_each_other_platform_within_the_slack():
    cp = cp_fixture().set_index("source_id")
    assert cp.loc["google_trends", "best_platform"] == "bluesky"
    assert cp.loc["google_trends", "sim_bluesky"] == pytest.approx(cp.loc["google_trends", "best_sim"])
    assert np.isnan(cp.loc["google_trends", "sim_google_trends"])  # never its own platform
    assert np.isnan(cp.loc["google_trends", "sim_mastodon"])  # two days apart
    assert np.isnan(cp.loc["mastodon", "best_sim"])  # nothing near it in time
    assert cp.loc["google_trends", "match_bluesky"] == "t1"  # which trend it was
    assert cp.loc["google_trends", "match_google_trends"] is None


def test_a_lagged_list_pairs_only_with_its_partners():
    t = table(
        [
            ("tiktok", "#firstdayoffall", 0, 1, 1),
            ("x", "first day of fall", 0, 1, 2),
            ("pinterest", "first day of fall", 0, 1, 1),
        ]
    )
    cp = echo.cross_platform(t, np.stack([unit(1), unit(1), unit(1, 0.2)])).set_index("source_id")
    assert np.isnan(cp.loc["tiktok", "sim_x"]) and np.isnan(cp.loc["x", "sim_tiktok"])  # a week apart
    assert cp.loc["tiktok", "best_platform"] == "pinterest"  # though X's title is the closer one
    assert cp.loc["pinterest", "match_tiktok"] == "t0"
    assert cp.loc["x", "best_platform"] == "pinterest"  # the other lists pair as before


def test_may_pair_takes_any_lagged_map():
    source = np.array(["a", "b", "c", "a"])
    allowed = echo.may_pair(source, {"a": frozenset()})
    assert not allowed[0].any() and not allowed[:, 3].any()  # "a" pairs with nothing
    assert allowed[1, 2] and allowed[2, 1] and not allowed[1, 1]


def test_every_source_the_pipeline_leaves_unscored_is_lagged_here(tmp_path):
    config = tmp_path / "ranking.ts"
    config.write_text('export const UNSCORED_SOURCES: ReadonlySet<string> = new Set(["tiktok", "pinterest"]);\n')
    assert echo.pipeline_unscored(config) == {"tiktok", "pinterest"}
    config.write_text("export const MATCH_THRESHOLD = 0.86;\n")
    with pytest.raises(ValueError):
        echo.pipeline_unscored(config)
    assert echo.pipeline_unscored() <= set(echo.LAGGED_PARTNERS)  # the real config


def test_echo_shares_count_trends_alone_at_each_threshold_and_weight_by_fetches():
    shares = echo.echo_shares(cp_fixture(), thresholds=(0.9,)).set_index("source_id")
    assert shares.loc["twitch", "share"] == 1.0
    assert shares.loc["mastodon", "share"] == 1.0
    assert shares.loc["google_trends", "share"] == 0.0
    everything = cp_fixture().assign(source_id="all")
    weighted = echo.echo_shares(everything, thresholds=(0.9,)).iloc[0]
    assert weighted["share"] == pytest.approx(2 / 4)  # twitch and mastodon
    assert weighted["share_by_fetches"] == pytest.approx((6 + 2) / (3 + 3 + 6 + 2))


def test_since_all_present_starts_when_the_last_source_has_a_list():
    items = pd.DataFrame(
        {
            "source_id": ["bluesky", "bluesky", "x", "x"],
            "fetched_at": [T0, T0 + pd.to_timedelta(10, unit="h"), T0 + pd.to_timedelta(10, unit="h"), T0 + pd.to_timedelta(11, unit="h")],
        }
    )
    assert echo.since_all_present(items)["fetched_at"].min() == T0 + pd.to_timedelta(10, unit="h")
    assert len(echo.since_all_present(items)) == 3


def test_since_all_present_keeps_the_whole_first_run_though_its_lists_differ_by_seconds():
    run = T0 + pd.to_timedelta(10, unit="h")
    items = pd.DataFrame(
        {
            "source_id": ["bluesky", "bluesky", "x"],
            "fetched_at": [T0, run, run + pd.to_timedelta(2, unit="s")],  # x's list came 2 seconds later
        }
    )
    assert echo.since_all_present(items)["source_id"].tolist() == ["bluesky", "x"]


def test_reach_counts_platforms_including_the_trends_own():
    t = table([("x", "a", 0, 1, 1), ("google_trends", "a", 0, 1, 1), ("bluesky", "a", 0, 1, 1), ("twitch", "b", 0, 1, 1)])
    vectors = np.stack([unit(1), unit(1), unit(1), unit(0, 1)])
    r = echo.reach(echo.cross_platform(t, vectors), threshold=0.9)
    assert r.loc["x", "3+"] == 1.0
    assert r.loc["twitch", "1"] == 1.0
    assert list(r.columns) == ["1", "2", "3+"]


def test_overlap_matrix_reads_row_platform_against_column_platform():
    matrix = echo.overlap_matrix(cp_fixture(), threshold=0.9)
    assert matrix.loc["google_trends", "bluesky"] == 1.0
    assert matrix.loc["twitch", "bluesky"] == 0.0
    assert np.isnan(matrix.loc["bluesky", "bluesky"])


def test_kept_trends_line_up_with_their_vectors(tmp_path):
    t = table([("x", "a", 0, 1, 1), ("x", "b", 0, 1, 1), ("x", "c", 0, 1, 1)])
    filtered = pd.DataFrame([{"id": "t0", "kept": True, "index": 1}, {"id": "t1", "kept": False}, {"id": "t2", "kept": True, "index": 0}])
    vectors = np.stack([unit(0, 1), unit(1, 0)])  # row 0 belongs to t2, row 1 to t0
    kept, kept_vectors = echo.kept_trends(t, filtered, vectors)
    assert kept["trend_id"].tolist() == ["t2", "t0"]
    assert kept_vectors[1][0] == pytest.approx(1.0)


def test_embed_input_groups_each_trend_with_the_titles_of_its_first_hour():
    t = table([("mastodon", "#flydubai", 10, 12, 3), ("x", "Astros", 11, 11, 1)])
    items = pd.DataFrame(
        {
            "source_id": ["bluesky", "bluesky", "mastodon", "x"],
            "title": ["Flydubai flight diverts to Saudi Arabia", "Fat Bear Week", "#flydubai", "Astros"],
            "fetched_at": [T0 + pd.to_timedelta(h, unit="h") for h in (10.02, 11.02, 10.01, 11.03)],
        }
    )
    data = echo.embed_input(t, items)
    assert [r["group"] for r in data["rows"]] == ["2026-10-01T22", "2026-10-01T23"]
    assert {g["title"] for g in data["groups"]["2026-10-01T22"]} == {"Flydubai flight diverts to Saudi Arabia", "#flydubai"}
    assert "group" not in echo.embed_input(t)["rows"][0]


def test_load_vectors_reads_the_embed_script_output(tmp_path):
    out = tmp_path / "v"
    (tmp_path / "v.json").write_text('{"model": "m", "dtype": "q8", "dimensions": 384, "rows": [{"id": "t0", "kept": true, "index": 0}]}')
    unit(1).astype("<f4").tofile(tmp_path / "v.f32")
    rows, vectors = echo.load_vectors(out)
    assert rows.loc[0, "id"] == "t0"
    assert vectors.shape == (1, 384)


def test_trends_carry_the_latest_stored_match_text():
    rows = [
        {"run_id": 1, "source_id": "google_trends", "region": "us", "rank": 1, "title": "lito", "url": "u1", "fetched_at": T0, "match_text": None},
        {"run_id": 2, "source_id": "google_trends", "region": "us", "rank": 2, "title": "lito", "url": "u2",
         "fetched_at": T0 + pd.to_timedelta(1, unit="h"), "match_text": ["Lito Sousa dies", "Fans mourn"]},
        {"run_id": 3, "source_id": "google_trends", "region": "us", "rank": 3, "title": "lito", "url": "u3",
         "fetched_at": T0 + pd.to_timedelta(2, unit="h"), "match_text": []},
        {"run_id": 1, "source_id": "x", "region": "us", "rank": 1, "title": "Lito", "url": "x", "fetched_at": T0, "match_text": None},
    ]
    t = echo.trends(pd.DataFrame(rows)).set_index("source_id")
    assert t.loc["google_trends", "match_text"] == ["Lito Sousa dies", "Fans mourn"]  # an empty later list doesn't erase it
    assert t.loc["x", "match_text"] is None
    without = echo.trends(pd.DataFrame(rows).drop(columns="match_text"))
    assert without["match_text"].isna().all()  # lists from before the column was stored


def test_embed_input_sends_match_text_with_rows_and_groups_unless_told_not_to():
    t = table([("google_trends", "lito", 0, 1, 2), ("x", "Lito", 0, 0, 1)]).assign(match_text=[["Lito Sousa dies"], None])
    items = pd.DataFrame(
        {
            "source_id": ["google_trends", "x"], "title": ["lito", "Lito"],
            "fetched_at": [T0, T0], "match_text": [["Lito Sousa dies"], None],
        }
    )
    data = echo.embed_input(t, items)
    assert data["rows"][0]["matchText"] == ["Lito Sousa dies"] and "matchText" not in data["rows"][1]
    group = {g["source"]: g for g in data["groups"]["2026-10-01T12"]}
    assert group["google_trends"]["matchText"] == ["Lito Sousa dies"] and "matchText" not in group["x"]
    titles_only = echo.embed_input(t, items, use_text=False)
    assert all("matchText" not in row for row in titles_only["rows"])
    assert all("matchText" not in g for g in titles_only["groups"]["2026-10-01T12"])
