# Research (phase 5)

Python notebooks for the research questions and forecast models in PLAN.md › Predictions and research. Nothing here runs in production: the site, the pipeline and the Worker stay TypeScript, and a trained model ships to them as a small JSON or ONNX file.

## Set up (once)

1. Python 3.12 or newer.
2. Create the read-only database role and your connection string: SETUP.md §14. The notebooks refuse any other role.
3. From this folder:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate          # macOS or Linux: source .venv/bin/activate
   pip install -r requirements.txt
   pytest                          # quick check; needs no database
   jupyter lab
   ```

## Using the data

```python
from topnews import db

engine = db.engine()                  # reads RESEARCH_DATABASE_URL from ../.env.local
db.table_counts(engine)
snaps = db.snapshots(engine, days=7)  # hourly topic snapshots, ranks and metrics spread into columns
runs = db.fetch_runs(engine, days=7)
items = db.trend_items(engine, days=7)
```

- **Topic snapshots** (`topic_snapshots`) are the main dataset. They're kept permanently, never include YouTube, and each row's `algo_version` says how it was made. Keep an analysis to one version, or compare versions on purpose; rows marked `+replay` were rebuilt from stored lists and have `news_count` 0.
- **Stored lists** (`trend_items`) are kept only 28 days. `db.trend_items` leaves YouTube out unless you pass `include_youtube=True`. Don't save YouTube rows to disk: its policy caps stored data at 30 days.
- **Slow sources:** TikTok's list refreshes only every 2 days and repeats hourly in between, so its hour-to-hour changes aren't signal. X can show `skipped` runs with the reason `daily cap`.

## Rules

- Read only. The role can't write, and every session is also set read-only.
- No secrets in notebooks. Connection details come only from `.env.local`.
- Clear notebook outputs before committing (`jupyter nbconvert --clear-output --inplace notebooks/*.ipynb`), so no data rows end up in the public repository.
- Exports go to `data/`, which git ignores.
- Findings go in `findings/` as short Markdown write-ups. The key numbers also go into PLAN.md.

## Layout

```
research/
  requirements.txt   pinned packages (pandas 2.x because lifelines needs it)
  pyproject.toml     makes topnews/ importable
  topnews/db.py      read-only data access
  notebooks/         one notebook per question, numbered
  findings/          write-ups: rq1-lifecycle.md and so on
  tests/             pytest, no database needed
  data/              local exports (ignored by git)
```
