"""A local language model for research labeling: Qwen3.5-9B in LM Studio, on this PC's GPU.

Research only: the site and the pipeline never call it. It drafts labels that
a person checks: whether two trends are the same story (to measure and tune
topic matching) and what kind of topic a trend is (RQ1's categories, RQ4's
news). Nothing leaves the PC.

Setup: LM Studio with qwen/qwen3.5-9b. `load()` starts its local server and
loads the model onto the GPU (6.1 GB of 8, unloaded after 10 idle minutes).
Qwen3.5 thinks at length before answering by default; starting its answer
with an empty thinking block makes it answer directly, so every request does.
Answers are cached under the gitignored research/data/llm/, keyed by model
and prompt, and requests use temperature 0, so a re-run asks nothing twice.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import urllib.request
from collections.abc import Callable
from pathlib import Path

from .db import REPO_ROOT

BASE_URL = os.environ.get("LOCAL_LLM_URL", "http://localhost:7272/v1")
MODEL_KEY = "qwen/qwen3.5-9b"
IDENTIFIER = "qwen-labeler"
LMS = Path(os.environ.get("USERPROFILE", "~")).expanduser() / ".lmstudio" / "bin" / "lms.exe"
CACHE_DIR = REPO_ROOT / "research" / "data" / "llm"
NO_THINKING = "<think>\n\n</think>\n\n"
CATEGORIES = ("sports", "politics", "entertainment", "tech", "gaming", "business", "science", "health", "weather",
              "incident", "lifestyle", "calendar", "meme", "other")

Post = Callable[[str, dict], dict]


def load(ttl_seconds: int = 600, context: int = 4096) -> None:
    """Start LM Studio's local server and load the model onto the GPU (once; it unloads after `ttl_seconds`
    idle)."""
    subprocess.run([str(LMS), "server", "start"], check=True, capture_output=True)
    loaded = subprocess.run([str(LMS), "ps"], capture_output=True, text=True).stdout
    if IDENTIFIER not in loaded:
        subprocess.run(
            [str(LMS), "load", MODEL_KEY, "--gpu", "max", "-c", str(context), "--ttl", str(ttl_seconds),
             "--identifier", IDENTIFIER, "-y"],
            check=True, capture_output=True,
        )


def post_json(url: str, body: dict) -> dict:
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=600) as response:
        return json.loads(response.read())


def parse_json(text: str):
    """The JSON in a model's answer, without code fences or text around it."""
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start = min((i for i in (text.find("["), text.find("{")) if i >= 0), default=-1)
    end = max(text.rfind("]"), text.rfind("}"))
    if start < 0 or end < start:
        raise ValueError("no JSON in the answer")
    return json.loads(text[start : end + 1])


def ask_json(prompt: str, post: Post = post_json, cache_dir: Path | None = CACHE_DIR, max_tokens: int = 3000):
    """The model's JSON answer to `prompt`, cached. Retries once if the answer isn't valid JSON."""
    key = hashlib.sha256(f"{IDENTIFIER}\n{prompt}".encode()).hexdigest()[:24]
    path = cache_dir / f"{key}.json" if cache_dir else None
    if path and path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    body = {
        "model": IDENTIFIER,
        "messages": [{"role": "user", "content": prompt}, {"role": "assistant", "content": NO_THINKING}],
        "temperature": 0,
        "max_tokens": max_tokens,
    }
    error: Exception | None = None
    for _ in range(2):
        answer = post(f"{BASE_URL}/chat/completions", body)
        try:
            data = parse_json(answer["choices"][0]["message"]["content"])
            break
        except (ValueError, KeyError) as exc:
            error = exc
    else:
        raise ValueError(f"no valid JSON after two tries: {error}")
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")
    return data


PAIRS_PROMPT = """You are checking a trend tracker's matches. Each line has two trending items from different \
platforms, seen within a day of each other (2026-09-30). Decide whether they are about the SAME story or subject: \
the same event, person, team, product or occasion. Related but different (two different players, two different \
bills, an old game and its sequel) is NOT the same. Answer with JSON only: a list of objects \
{{"id": <id>, "same": true or false, "confidence": "high" or "low"}}.

{lines}"""


def judge_pairs(pairs: list[dict], post: Post = post_json, cache_dir: Path | None = CACHE_DIR, batch: int = 15) -> list[dict]:
    """For pairs {"id", "a", "b"} (two trend titles), the model's {"id", "same", "confidence"}."""
    out = []
    for i in range(0, len(pairs), batch):
        chunk = pairs[i : i + batch]
        lines = "\n".join(f'{p["id"]}: "{p["a"]}" | "{p["b"]}"' for p in chunk)
        answers = {a["id"]: a for a in ask_json(PAIRS_PROMPT.format(lines=lines), post, cache_dir) if "id" in a}
        for p in chunk:
            a = answers.get(p["id"], {})
            out.append({"id": p["id"], "same": a.get("same"), "confidence": a.get("confidence")})
    return out


CATEGORY_PROMPT = """Classify each trending topic from late September 2026. Categories: {categories}.
- politics: government, elections, courts, policy, wars and international affairs;
- incident: crime, accidents, disasters, fires, crashes, flight diversions;
- lifestyle: food, fashion, beauty, home, travel, crafts;
- calendar: a recurring day, week, season or observance (#WIPWednesday, national coffee day, first day of fall);
- meme: a joke, challenge, game or prompt that people post along with;
- gaming: video games and streaming categories; entertainment: film, TV, music, celebrities.
Also say whether it is driven by a news event (something that just happened or was just announced). Each line gives \
where it trended, and sometimes the site and words of the article it linked to, after "|". Answer with JSON only: a \
list of objects {{"id": <id>, "category": <category>, "news": true or false}}.

{lines}"""


def categorize(topics: list[dict], post: Post = post_json, cache_dir: Path | None = CACHE_DIR, batch: int = 15) -> list[dict]:
    """For topics {"id", "title", "context"?}, the model's {"id", "category", "news"}; unknown categories
    become "other"."""
    out = []
    for i in range(0, len(topics), batch):
        chunk = topics[i : i + batch]
        lines = "\n".join(f'{t["id"]}: {t["title"]}' + (f' | {t["context"]}' if t.get("context") else "") for t in chunk)
        prompt = CATEGORY_PROMPT.format(categories=", ".join(CATEGORIES), lines=lines)
        answers = {a["id"]: a for a in ask_json(prompt, post, cache_dir) if "id" in a}
        for t in chunk:
            a = answers.get(t["id"], {})
            category = a.get("category") if a.get("category") in CATEGORIES else "other"
            out.append({"id": t["id"], "category": category, "news": a.get("news")})
    return out
