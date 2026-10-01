import json

import pandas as pd

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
