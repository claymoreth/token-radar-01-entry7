# Launch Radar — radar-8

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/claymoreth/token-radar-01-entry7/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/claymoreth/token-radar-01-entry7/reward.svg)](https://make.fun/bounty/token-radar-01)

Pre-token protocols, valued from their own record — not from hype. An entry for
[make.fun's token-radar-01 bounty](https://make.fun/bounty/token-radar-01): 198
pre-token protocols ranked by implied value, each with a costed farm verdict
and a ten-step farm plan, on one static dashboard.

## How the board is made

The board answers one question: if a protocol with no token issued one
tomorrow, what would it be worth? The answer is fitted from the snapshot's
own priced protocols, never from a hardcoded name or number:

**implied value = TVL × fitted multiple × listing probability**

- **Fitted multiple.** A log-ratio model: the target is ln(mcap / TVL) over
  the 128 priced protocols. Terms are added one at a time and kept only when
  they lower the held-out miss in **both** out-of-sample tests —
  leave-one-out and a chronological walk-forward. Only the size curve
  ln(TVL) survived: final LOO miss 3.40, walk-forward 2.89, against a flat
  baseline of 5.07 / 5.29. A shuffled-growth control term is tested and
  never kept. The category effect was tested and fails both tests
  (LOO 3.51, walk-forward 2.97 against 3.40 / 2.89), so the model stays
  size-only. One variant was tried and dropped: fitting without the 20
  parent-product lines changes nothing at all, because none of those lines
  is among the 128 priced protocols — the training set is identical, so
  the standard fit stands. The family effect is a lesson in why the
  two-test rule matters: it leaves the held-out scores bit-identical,
  because 127 distinct families cover 128 priced rows, so a held-out
  row's family is almost never in its training fold — it can only help
  in-sample, never out of sample.
- **Listing probability.** A logistic regression on whether DefiLlama has
  a ticker RECORDED for the protocol — gecko_id or symbol set — against no
  token recorded at all. Call it what it is: the chance a ticker exists
  in the record, **not** the chance the token trades, and **not** the
  chance it launches. That is the v7 change, and it changes what the
  numbers mean. Training covers n = 442 protocols at a 55.2% base rate
  (244 recorded, 198 not), and five groups survive both tests — age,
  ln(TVL), 7-day growth, family and category (chain count tested, not
  kept). Final Brier 0.197 ten-fold, 0.259 walk-forward, against a
  base-rate baseline of 0.247 / 0.331; 63% of walk-forward calls right.
  Two honest consequences. First, the walk-forward score is far weaker
  than the traded-token target's (0.259 vs 0.135) and barely beats its own
  baseline — a recorded ticker is a noisier thing to predict than a
  traded token. Second, the higher base rate (55.2% vs 31.7%) inflates
  every implied value, so this board's $994.4M total **cannot be
  compared** with the earlier entry's $517.0M: the rise is the target
  changing, not the protocols getting more valuable. And "recorded" is a
  low bar — it includes failed launches, illiquid placeholders and points
  systems that never reach price discovery — so the board can over-rank
  zombie protocols that are recorded but never trade. Implied value here
  prices the chance a ticker exists, not exit liquidity.
- **No look-ahead in the walk-forward.** The chronological folds split on
  `listed_at`, and every feature is a snapshot value — age, ln(TVL),
  7-day growth, chain count — never a value from after the listing date.
  The model never trains on the future it is tested on.
- **Ranges.** Every row shows P25–P75 and P10–P90 from the quantiles of
  the value model's own held-out log residuals — and the dashboard shows
  whether those bands held out of sample: P25–P75 caught 50% (LOO) and
  49% (walk-forward) against a stated 50%; P10–P90 caught 80% and 79%
  against a stated 80%. Each row also carries a bootstrap rank range
  (P5–P95 of its rank across 200 refits, parent discount applied inside
  the refits): rank 1 Steakhouse sits at 1–1, Veda at 2–2, USDD at 3–3.
- **Costed farm verdicts.** Each row's plan is sized at 0.02% of its TVL
  (clamped to $100–$10,000), the modelled drop is 7% of implied value,
  fees are the plan's on-chain transactions at the mid-point gas price of
  its main chain, and time is the hands-on minutes of the ten steps.
  FARM clears both a 12-week T-bill on the same deposit and $25/hour for
  the farmer's time; MARGINAL clears neither fully but still nets above
  zero; SKIP loses money to gas. On this snapshot **2 rows clear both
  bars** — the board is 2 FARM, 148 MARGINAL and 48 SKIP. The two are
  marginfi Lending at $28.70/hour (net $98.14 on a $5,542.60 deposit; it
  clears its $51.16 T-bill bar) and Exponent Yield Exchange at $26.08/hour
  (net $89.18 on a $9,035.43 deposit; it clears its $83.40 T-bill bar).
  The near-miss is Lofty at $26.76/hour: it clears the hourly bar but its
  net of $91.52 falls $0.79 short of the $92.31 T-bill on its $10,000
  deposit, so it stays MARGINAL. The detail view shows the benchmarks
  (T-bill, drop if a token launches, the drop share and listing
  probability above which fees are covered, the quantified exit TVL)
  and a net grid by drop share × deposit.
- **Parent products.** A row whose slug is on the fixed list of 20
  parent-product lines (ported verbatim from the v4 entry, `lib/parent.ts`
  `PARENT_PRODUCTS`) keeps 48% of its fitted value and is marked
  off-list ("Off-List · Parent ×0.48"). Matching is by exact slug,
  case-sensitive — no substring or name matching. Twenty rows are caught
  on this snapshot, including Polymarket International (rank #16 at
  $13.4M after the discount; $29.3M if it launches, listing probability
  95.4%), Sentora Curator, Defi Saver Asset Management and Circle Gateway.
  The label shown is the v4 description of the line (e.g. "Polymarket
  international arm"), not a parent name.
- **Protocol accounting.** All 758 protocols land in exactly one bucket
  (40 watchlist, 138 early below the $50M floor, 20 off-list, 128 priced
  comparables, 288 token-recorded without a usable cap, 43 bridges, 41
  liquid staking, 42 exchanges, 18 versioned/wrapped), so the buckets
  always add up to the ledger total. The dashboard recomputes six
  integrity checks in the browser from the data file itself, including
  an FNV-1a checksum of the ranked rows (1943ddc4). Nearest priced peers
  carry a genuinely held-out figure: the leave-one-out model prediction
  over the peer's actual cap/TVL ratio — 1.00 means the model priced the
  peer exactly.

## The dashboard

A six-card strip above the board summarises the model from its own
evidence (out-of-sample miss, range honesty, listing-probability Brier,
terms that survived, farm counts, watchlist coverage). The board itself
has verdict and tier tabs, search, category and chain filters, sorting,
CSV and JSON export, and a detail drawer per protocol. The drop-share
slider runs 1–14% in 0.5% steps (default 7%) and the horizon slider 4–52
weeks in 1-week steps (default 12 weeks); both are display-only scenario
controls — moving them updates the scenario line and nothing else, and
the verdicts stay costed on each row's own plan. Ages show in years once
a protocol is a year old (1.5 yr), in days before that (45 d).

## Run it locally

Node 22 or later, standard library only — no install step.

```sh
mkdir -p out
RADAR_INPUT=<path to snapshot.json> RADAR_OUTPUT=out node main.ts
```

`--input <snapshot.json|directory>` overrides `RADAR_INPUT`;
`--output <dir>` overrides `RADAR_OUTPUT` (default `/output`,
`MAKEFUN_OUTPUT_DIR` outside the grader's container). The run writes
`out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/`
and `out/dossier.json` (the dossier needs the three screenshots in
`screenshots/` first: `1-board.png`, `2-detail.png`, `3-filtered.png`).
The run is deterministic: the same snapshot always yields the same bytes
(board.json md5 b5732e4dfd2959100bb2254949347873 across runs).

## Layout

- `main.ts` — the entry runner: model → parent discount → farm →
  accounting → integrity → board.json / data.js / dossier.json.
- `lib/model.ts` — the fitted value model, listing probability and intervals.
- `lib/odds.ts` — the listing-probability logistic regression.
- `lib/range.ts` — residual quantiles, coverage and the seeded PRNG.
- `lib/farm.ts` — farm economics, the ten-step plan, peers.
- `lib/accounting.ts` — the 758-protocol ledger buckets.
- `lib/integrity.ts` — the FNV-1a checksum and ledger counts.
- `lib/parent.ts` — the 20 parent-product lines and the ×0.48 factor,
  shared by the runner and the bootstrap rank range.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`);
  it reads `../data.js`, makes no network request.
- `vendor/makefun-board.ts` — make.fun's dashboard-dossier library.
