import json

import pytest

from topnews import llm


def server(reply):
    """A fake LM Studio: `reply(prompt)` gives the answer's text; records each request."""
    calls = []

    def post(url, body):
        calls.append((url, body))
        return {"choices": [{"message": {"content": reply(body["messages"][0]["content"])}}]}

    post.calls = calls
    return post


def test_parse_json_finds_the_json_in_an_answer():
    assert llm.parse_json('```json\n[{"id": 1}]\n```') == [{"id": 1}]
    assert llm.parse_json('Here you go: {"a": 2} hope it helps') == {"a": 2}
    with pytest.raises(ValueError):
        llm.parse_json("no idea")


def test_ask_json_starts_the_answer_without_thinking_and_caches(tmp_path):
    post = server(lambda prompt: '[{"id": 1, "same": true}]')
    assert llm.ask_json("q", post, tmp_path) == [{"id": 1, "same": True}]
    assert llm.ask_json("q", post, tmp_path) == [{"id": 1, "same": True}]
    assert len(post.calls) == 1  # the second answer came from the cache
    url, body = post.calls[0]
    assert url.endswith("/chat/completions")
    assert body["messages"][-1] == {"role": "assistant", "content": llm.NO_THINKING}
    assert body["temperature"] == 0


def test_ask_json_retries_once_then_gives_up(tmp_path):
    answers = iter(["oops", '{"ok": true}'])
    assert llm.ask_json("q", server(lambda p: next(answers)), tmp_path) == {"ok": True}
    with pytest.raises(ValueError):
        llm.ask_json("other", server(lambda p: "still no json"), tmp_path)


def test_judge_pairs_batches_and_keeps_missing_answers_unknown(tmp_path):
    def reply(prompt):
        ids = [int(line.split(":")[0]) for line in prompt.splitlines() if line[:1].isdigit()]
        return json.dumps([{"id": i, "same": i % 2 == 0, "confidence": "high"} for i in ids if i != 3])

    pairs = [{"id": i, "a": f"a{i}", "b": f"b{i}"} for i in range(4)]
    out = llm.judge_pairs(pairs, server(reply), tmp_path, batch=2)
    assert [o["same"] for o in out] == [True, False, True, None]  # 3 wasn't answered


def test_categorize_passes_context_and_keeps_categories_to_the_list(tmp_path):
    seen = []

    def reply(prompt):
        seen.append(prompt)
        return '[{"id": "a", "category": "sports", "news": true}, {"id": "b", "category": "astrology", "news": false}]'

    out = llm.categorize([{"id": "a", "title": "Astros", "context": "Astros win"}, {"id": "b", "title": "x"}], server(reply), tmp_path)
    assert out == [{"id": "a", "category": "sports", "news": True}, {"id": "b", "category": "other", "news": False}]
    assert "a: Astros | Astros win" in seen[0]
