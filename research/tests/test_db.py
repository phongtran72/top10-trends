import re

import pandas as pd
import pytest

from topnews import db

READER = "postgresql://research_reader.abc:pw@aws-0-us-east-2.pooler.supabase.com:5432/postgres"


def test_accepts_the_read_only_role():
    assert db.research_url(READER) == "postgresql+psycopg://research_reader.abc:pw@aws-0-us-east-2.pooler.supabase.com:5432/postgres"
    assert db.research_url("postgres://research_reader:pw@localhost/postgres").startswith("postgresql+psycopg://")


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://postgres.abc:pw@aws-0-us-east-2.pooler.supabase.com:5432/postgres",
        "postgresql://someone:pw@localhost/postgres",
        "postgresql://localhost/postgres",
    ],
)
def test_refuses_any_other_role(url):
    with pytest.raises(ValueError, match="must connect as research_reader"):
        db.research_url(url)


def test_needs_a_postgres_url():
    with pytest.raises(RuntimeError, match="RESEARCH_DATABASE_URL is not set"):
        db.research_url("  ")
    with pytest.raises(ValueError, match="postgres:// connection string"):
        db.research_url("https://example.com")


def test_expand_spreads_json_columns():
    df = pd.DataFrame({"topic_id": [1, 2], "ranks": [{"bluesky": 3, "google_trends": 1}, {"bluesky": 7}]})
    wide = db.expand(df, "ranks", "rank_")
    assert list(wide.columns) == ["topic_id", "rank_bluesky", "rank_google_trends"]
    assert wide.loc[0, "rank_google_trends"] == 1
    assert pd.isna(wide.loc[1, "rank_google_trends"])


def test_youtube_is_left_out_by_default():
    assert "youtube" in db.EXCLUDED_BY_DEFAULT


def test_tables_match_the_schema():
    schema = (db.REPO_ROOT / "db" / "schema.ts").read_text(encoding="utf-8")
    assert sorted(db.TABLES) == sorted(re.findall(r'pgTable\(\s*"(\w+)"', schema))
