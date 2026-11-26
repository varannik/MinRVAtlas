# Data quality engine

Checks a project's monitoring data, explains every finding in plain English, and
records a verdict that the same data and the same rule version always reproduce.
It replaces Data Sentinel's data quality checks; Sentinel's V&V, reviewer and
protocol registry stay where they are for now.

Python, standard library only; the optional summary step also has the Anthropic
SDK, from a Lambda layer. It runs as Lambda functions in a Step Functions
run (`infra/lib/quality/quality-stack.ts`), its own stack on Cortex's rails:

- **Data in:** the stream metrics the calculation tree reads. That is the stream
  bucket (`<tenant>/<registry>/<project>/dt=YYYY-MM-DD/observations.csv` and
  `attributes.json`), or a demo project's seeded history in the Atlas bucket.
  Site spreadsheets reach the stream from the web's monitoring data page, through
  the project's approved tag map; each load starts a run on what it wrote.
- **Out:** runs, findings and decisions in the quality table, one partition per
  project. Each finished run is announced on the Cortex event bus as
  `QualityRunCompleted`.
- **Read by:**
  - the web, through the Cortex tenant session (`/api/data-quality/*`);
  - the calculation tree's trend;
  - Ask Cortex, through the gateway tool `quality___findings`.

## What it runs

Checks have a threshold and can block a submission. Detectors advise: a person
confirms or dismisses each one, and only a confirmed one counts against the verdict.

| Kind | Rule | From | What it looks for |
| --- | --- | --- | --- |
| `missing_days` | C01 | Sentinel | whole days with no rows; 3 in a row block |
| `gap` | C01 | Sentinel | a long gap inside a meter's day |
| `bad_readings` | C02 | Sentinel | empty or unreadable readings |
| `metric_gap` | C03 | Sentinel | a daily meter missing on days others report |
| `incomplete_day` | C04 | Sentinel | fewer readings than the meter's cadence gives |
| `flatline`, `stuck_day` | I01 | Sentinel | the same reading for hours, or all day |
| `out_of_range` | I02 | Sentinel | readings the meter cannot physically give |
| `out_of_order` | I03 | Sentinel | timestamps going backwards |
| `reading_spike` | I04 | Sentinel | one reading far from the day's median |
| `duplicates` | U01 | Sentinel | the same timestamp twice (a counted amount counted twice) |
| `meter_agreement` | CON01 | Sentinel | two meters on one quantity disagree (pairs from the tag map) |
| `counter_reset` | TR-01 | new | a totaliser that fell, and what counting from the reset misses |
| `stuck_zero` | ZR-01 | new | a meter that should move reads exactly 0 for days |
| `losses_exceed`, `loss_share` | BL-01, BL-02 | new | losses against the CO₂ delivered that day |
| `fixed_coverage` | LC-01 | new | monitored days no lab result or factor covers |
| `spike` (detector) | CON07 | Sentinel | an unusual day against four weeks and the same weekday |
| `level_shift` (detector) | LS-01 | new | a meter that moved to a new level and stayed |

The Isolation Forest across meters comes later, in a container image (it needs
scikit-learn). Thresholds are the built-in `rules.py` defaults, recorded on every
finding as "not yet approved" until approved values replace them.

## Plain English

Every finding is built in three layers:

1. **Facts.** These are stored as data: tag, window, observed, expected, impact,
   and the rule and its version.
2. **Sentence.** One template per kind in `text.py` gives five parts:
   - what's wrong (the headline);
   - what we saw;
   - why it matters;
   - what to do;
   - how we found it.
3. **Summary.** Optional, for operators (viewers never get it). After the verdict
   is recorded and announced, the `summarise` step (`run_summary.py`) gives Claude
   (EU inference profile) the run's findings, as facts and these sentences, never
   the raw data. Claude groups findings that look like one problem and says what
   to fix first, citing finding ids. Ids the run does not have are dropped. It
   never sets the verdict, and a run whose summary fails is still a finished run.

Templates name the meter the way the site does, give dates in full and times in
site time with UTC, and keep statistics words in "how we found it".

## What reacts to a run

- **Graph.** `QualityRunCompleted` carries each finding's ids and keys, never its
  words. The Cortex graph writer links project → run → finding, and an open
  finding `HOLDS` the journey task its records are filed on (`catalog.py` `task`).
  A dismissed or resolved finding closes the link.
- **Journey.** A ledger block's details show the engine's verdict for its days and
  its open findings. A Monitor task shows the findings that point at it for the
  period in progress.
- **Registry submit.** Data goes to a registry only when the latest run has seen
  the whole period and does not block it (`apps/web/src/lib/quality/gate.ts`).
  A finding that needs a look does not stop it. This replaced the rule that
  Isometric writes needed a green Sentinel DQA run.

## Layout

| File | What it does |
| --- | --- |
| `catalog.py` | the built-in tag map: each metric's name, meter, unit, kind, limits and credit term |
| `rules.py` | thresholds, versioned |
| `data.py` | a dataset: one cell per metric per day, plus dated values |
| `intraday.py` | folds one day's raw readings into cells, and notes problems inside the day |
| `checks.py` | the checks in the table above |
| `detectors.py` | the two detectors |
| `findings.py` | the finding model, fingerprint ids and the verdict |
| `text.py` | the plain-English templates |
| `judge.py` | runs everything for one run, applies decisions, words findings |
| `run_summary.py` | the optional summary: what Claude reads, its schema, and the check of its answer |
| `store.py` | the table layout |
| `handlers.py` | the Lambda steps: plan, fold, judge, summarise, fail |

## Run it

```bash
make quality-test                                      # in infra/: engine and Cortex tool tests
make quality-run QUALITY_PROJECT=fujairah-mineral      # in infra/: a run on AWS now, prints the verdict
```

The web starts a run by itself when a project's data reaches past the last run,
and after every decision, so dismissed days leave the detectors' baselines.
