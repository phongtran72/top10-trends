import json

import pandas as pd
import pytest

from topnews import categories


def test_link_words_keep_the_site_and_the_headline_words():
    assert categories.link_words("https://www.mlb.com/news/phillies-vs-braves-game-2-lineups.html") == "mlb.com: news phillies vs braves game lineups"
    assert categories.link_words("https://example.org/") == "example.org"


def test_context_says_where_and_adds_the_article_for_linked_sources():
    assert categories.context("twitch", "https://www.twitch.tv/search?term=VALORANT") == "Twitch streaming category"
    assert categories.context("google_trends", "https://apnews.com/article/flood-california") == "Google search trend (US); apnews.com: article flood california"


def fake_model(category_by_title):
    calls = []

    def post(url, body):
        prompt = body["messages"][0]["content"]
        calls.append(prompt)
        answers = []
        for line in prompt.splitlines():
            head, _, rest = line.partition(": ")
            if head.isdigit():
                title = rest.split(" | ")[0]
                answers.append({"id": int(head), "category": category_by_title[title], "news": title == "astros"})
        return {"choices": [{"message": {"content": json.dumps(answers)}}]}

    post.calls = calls
    return post


def test_label_asks_only_about_new_trends_and_keeps_them(tmp_path):
    store = tmp_path / "categories.csv"
    trends = pd.DataFrame({"source_id": ["google_trends", "pinterest"], "key": ["astros", "fall nails"],
                           "title": ["astros", "fall nails"], "context": ["Google search trend (US)", "Pinterest"]})
    post = fake_model({"astros": "sports", "fall nails": "lifestyle", "#wipwednesday": "calendar"})
    first = categories.label(trends, store, post, cache_dir=None)
    assert first.set_index("key")["llm_category"].to_dict() == {"astros": "sports", "fall nails": "lifestyle"}
    more = pd.concat([trends, pd.DataFrame({"source_id": ["mastodon"], "key": ["wip wednesday"], "title": ["#wipwednesday"], "context": ["Mastodon"]})])
    second = categories.label(more, store, post, cache_dir=None)
    assert len(post.calls) == 2 and "astros" not in post.calls[1]  # only the new trend was asked about
    assert len(second) == 3 and pd.read_csv(store).shape[0] == 3


def test_final_prefers_a_persons_correction():
    table = pd.DataFrame({"llm_category": ["sports", "meme"], "llm_news": [True, False],
                          "reviewed_category": [pd.NA, "calendar"], "reviewed_news": [pd.NA, "False"]})
    out = categories.final(table)
    assert out["category"].tolist() == ["sports", "calendar"]
    assert out["news"].tolist() == [True, False]


def test_new_drafts_are_unchecked_until_a_check_is_recorded(tmp_path):
    store = tmp_path / "categories.csv"
    trends = pd.DataFrame({"source_id": ["x", "x", "mastodon"], "key": ["crochet", "astros", "wip wednesday"],
                           "title": ["Crochet", "astros", "#wipwednesday"], "context": ["X trend"] * 2 + ["Mastodon hashtag"]})
    post = fake_model({"Crochet": "lifestyle", "astros": "sports", "#wipwednesday": "meme"})
    assert not categories.label(trends, store, post, cache_dir=None)["checked"].any()
    table = categories.mark_checked([0, 2], {0: "sports", 2: "calendar"}, store=store)
    assert table["checked"].tolist() == [True, False, True]
    final = categories.final(categories.read(store))
    assert final["category"].tolist() == ["sports", "sports", "calendar"]
    assert final["news"].tolist()[2] is False  # a calendar moment isn't news


def test_mark_checked_refuses_corrections_it_cant_place(tmp_path):
    store = tmp_path / "categories.csv"
    trends = pd.DataFrame({"source_id": ["x"], "key": ["astros"], "title": ["astros"], "context": ["X trend"]})
    categories.label(trends, store, fake_model({"astros": "sports"}), cache_dir=None)
    with pytest.raises(ValueError):
        categories.mark_checked([0], {1: "sports"}, store=store)  # row 1 isn't among the checked rows
    with pytest.raises(ValueError):
        categories.mark_checked([0], {0: "baseball"}, store=store)  # not one of the categories


def test_a_store_from_before_the_checked_column_reads_as_unchecked(tmp_path):
    store = tmp_path / "categories.csv"
    pd.DataFrame({"source_id": ["x"], "key": ["astros"], "title": ["astros"], "context": ["X trend"], "llm_category": ["sports"],
                  "llm_news": [True], "reviewed_category": [pd.NA], "reviewed_news": [pd.NA]}).to_csv(store, index=False)
    assert categories.read(store)["checked"].tolist() == [False]


def test_context_prefers_the_stored_match_text_to_the_links_words():
    url = "https://onefootball.com/en/news/lito-sousa-dies"
    assert categories.context("google_trends", url, ["Lito Sousa dies", "Fans mourn", "A third"]) == (
        "Google search trend (US); Lito Sousa dies / Fans mourn"
    )
    assert categories.context("google_trends", url, []) == "Google search trend (US); onefootball.com: en news lito sousa dies"
    assert categories.context("bluesky", "https://bsky.app/x", ["A description of the topic"]) == (
        "Bluesky trending topic; A description of the topic"
    )
    assert categories.context("x", None, None) == "X trend"


def test_context_names_the_country_of_a_google_trend():
    assert categories.context("google_trends", None, ["Ashes squad named"], "au") == "Google search trend (Australia); Ashes squad named"
    assert categories.context("google_trends", None, None, "gb") == "Google search trend (UK)"
    assert categories.context("google_trends", None, None, "us") == "Google search trend (US)"
    assert categories.context("x", None, None, "us") == "X trend"  # only Google's feeds are per country here
