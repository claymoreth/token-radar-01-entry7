// lib/model.ts — value model, board builder, odds training rows.
//
// The board answers: if a protocol with no token issued one tomorrow,
// what would it be worth?
//
//   implied value = TVL × fitted multiple × token odds
//
// The multiple is fitted from the snapshot's own priced protocols; the
// odds come from lib/odds.ts; the intervals from lib/range.ts. In this
// entry ("radar-8") the odds are the chance DefiLlama has a ticker
// RECORDED for the protocol — a record of visibility, not a forecast
// that the token will trade. The README states that trade-off plainly.
//
// The value model keeps a term only when it lowers the held-out miss in
// BOTH out-of-sample tests — leave-one-out and a chronological
// walk-forward — against the terms kept so far. A shuffled-growth
// control term is tested last and never added, whatever it scores.
// (v7 note: the odds target changed, the value model did not — it still
// trains on the same 128 priced protocols, and the category term is
// still decided by the same two tests, not by hand.)

import {
  fitOddsWithEvidence,
  predictOdds,
  type OddsRow,
} from "./odds.ts";
import {
  coverageFraction,
  fnv1a,
  intervalBounds,
  mulberry32,
  quantile,
  residualQuantiles,
  type ResidualQuantiles,
} from "./range.ts";
import { PARENT_PRODUCTS, parentScale } from "./parent.ts";

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Factors {
  multiple: number;
  size: number;
  category: number;
}

export interface FarmPlanStep {
  n: number;
  title: string;
  text: string;
  cost: string;
  time: string;
}

export interface PeerRow {
  name: string;
  category: string;
  tvl: number;
  mcap: number;
  ratio: number;
  heldOut: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvlUsd: number;
  change7d: number | null;
  ageDays: number | null;
  watchlist: boolean;
  rank: number;
  impliedValueUsd: number;
  valueIfLaunches: number;
  tokenOdds: number;
  p25: number;
  p75: number;
  p10: number;
  p90: number;
  bootstrapLow: number;
  bootstrapHigh: number;
  bootstrapRankLow: number;
  bootstrapRankHigh: number;
  factors: Factors;
  verdict: string;
  netFees: number;
  netPerHour: number;
  dropUsd: number;
  feesUsd: number;
  handsOnHours: number;
  depositUsd: number;
  dropShare: number;
  horizonWeeks: number;
  farmSteps: string[];
  farmPlan: FarmPlanStep[];
  exitRule: string;
  peers: PeerRow[];
  parentFactor?: number;
  parentName?: string;
}

export interface ValueTermEvidence {
  name: string;
  loo: number;
  wf: number;
  kept: "kept" | "tested, not kept" | "baseline" | "must not help";
}

export interface OddsTermEvidence {
  name: string;
  brier: number;
  wfBrier: number;
  kept: "kept" | "tested, not kept" | "baseline";
}

export interface Evidence {
  value: {
    n: number;
    baselineLoo: number;
    baselineWf: number;
    finalLoo: number;
    finalWf: number;
    terms: ValueTermEvidence[];
  };
  odds: {
    n: number;
    baseRate: number;
    baselineBrier: number;
    baselineWfBrier: number;
    finalBrier: number;
    finalWfBrier: number;
    walkForwardCorrect: number;
    terms: OddsTermEvidence[];
  };
  range: {
    rows: { label: string; stated: number; loo: number; wf: number }[];
    note: string;
  };
}

export interface Board {
  model: string;
  as_of: string;
  rows: BoardRow[];
  multiples: { category: string; multiple: number; n: number }[];
  globalMultiple: number;
  liveCount: number;
  evidence: Evidence;
}

/** Median of a copy, sorted ascending. Empty gives 0. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Whole days between a listing date and the snapshot date, or null when
 * the listing date is unknown or unparseable. Never negative.
 */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(listedAt + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - start) / 86400000));
}

/**
 * The protocol family: the first word of the name, lowercased. "Aave V2"
 * and "Aave V3" are one family; "Aavegotchi" is another.
 */
export function familyOf(name: string, slug: string): string {
  const trimmed = name.trim();
  const first = trimmed === "" ? slug : trimmed.split(/\s+/)[0]!;
  return first.toLowerCase();
}

const EXCLUDED_CATEGORIES = new Set([
  "CEX",
  "Liquid Staking",
  "Bridge",
  "Canonical Bridge",
  "Liquid Restaking",
  "Restaked BTC",
]);

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

/** True when the name marks a version, a wrapped/staked variant, or an exchange arm. */
export function isExcludedName(p: Protocol): boolean {
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return true;
  }
  return false;
}

/** True when DefiLlama records no token at all for the protocol. */
export function isNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** A board candidate: no token, a rankable category, an unexcluded name. */
export function isBoardCandidate(p: Protocol): boolean {
  return (
    isNoToken(p) &&
    (p.category === null || !EXCLUDED_CATEGORIES.has(p.category)) &&
    !isExcludedName(p)
  );
}

/** Excluded from odds training: an out-of-scope category or name. */
export function isOddsExcluded(p: Protocol): boolean {
  return (
    (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) ||
    isExcludedName(p)
  );
}

// ---------------------------------------------------------------------------
// Value model internals
// ---------------------------------------------------------------------------

interface ModelRow {
  slug: string;
  listedAt: string | null;
  ageYears: number | null;
  lnTvl: number;
  growthRaw: number | null;
  growthShuffled: number | null;
  lnChains: number;
  family: string;
  category: string;
  y: number | null;
}

type FeatureKey = "lnTvl" | "growth" | "growthShuffled" | "age" | "lnChains";

type Stage =
  | { kind: "const"; name: string }
  | { kind: "ols"; key: FeatureKey; name: string }
  | { kind: "group"; key: "family" | "category"; lambda: number; name: string };

interface FitStats {
  meanGrowth: number;
  meanAge: number;
}

interface FittedStage {
  stage: Stage;
  intercept: number;
  slope: number;
  effects: Map<string, number>;
}

interface ValueModel {
  stages: FittedStage[];
  stats: FitStats;
}

function fitStatsOf(train: ModelRow[]): FitStats {
  let growthSum = 0;
  let growthCount = 0;
  let ageSum = 0;
  let ageCount = 0;
  for (const row of train) {
    if (row.growthRaw !== null) {
      growthSum += row.growthRaw;
      growthCount += 1;
    }
    if (row.ageYears !== null) {
      ageSum += row.ageYears;
      ageCount += 1;
    }
  }
  return {
    meanGrowth: growthCount > 0 ? growthSum / growthCount : 0,
    meanAge: ageCount > 0 ? ageSum / ageCount : 0,
  };
}

/** One feature value, with missing growth/age filled from the train means. */
function featureValue(row: ModelRow, key: FeatureKey, stats: FitStats): number {
  if (key === "lnTvl") return row.lnTvl;
  if (key === "growth") {
    const g = row.growthRaw ?? stats.meanGrowth;
    return g < -0.9 ? -0.9 : g > 3 ? 3 : g;
  }
  if (key === "growthShuffled") {
    const g = row.growthShuffled ?? stats.meanGrowth;
    return g < -0.9 ? -0.9 : g > 3 ? 3 : g;
  }
  if (key === "age") return row.ageYears ?? stats.meanAge;
  return row.lnChains;
}

/**
 * Fit stages in order, each on the residuals of the ones before it. A
 * const stage takes the median; an OLS stage takes one least-squares
 * slope; a group stage takes shrunk group means (lambda
 * pseudo-observations of zero pull small groups toward no effect).
 */
export function fitValueModel(train: ModelRow[], stages: Stage[]): ValueModel {
  const stats = fitStatsOf(train);
  const fitted: FittedStage[] = [];
  let residuals = train.map((r) => r.y as number);
  for (const stage of stages) {
    if (stage.kind === "const") {
      const a = median(residuals);
      fitted.push({ stage, intercept: a, slope: 0, effects: new Map() });
      residuals = residuals.map((r) => r - a);
    } else if (stage.kind === "ols") {
      const xs = train.map((r) => featureValue(r, stage.key, stats));
      let meanX = 0;
      for (const x of xs) meanX += x;
      meanX /= xs.length;
      let meanR = 0;
      for (const r of residuals) meanR += r;
      meanR /= residuals.length;
      let sxx = 0;
      let sxy = 0;
      for (let i = 0; i < xs.length; i++) {
        sxx += (xs[i]! - meanX) * (xs[i]! - meanX);
        sxy += (xs[i]! - meanX) * (residuals[i]! - meanR);
      }
      const slope = sxx > 0 ? sxy / sxx : 0;
      const intercept = meanR - slope * meanX;
      fitted.push({ stage, intercept, slope, effects: new Map() });
      residuals = residuals.map(
        (r, i) => r - (intercept + slope * xs[i]!),
      );
    } else {
      const sums = new Map<string, number>();
      const counts = new Map<string, number>();
      for (let i = 0; i < train.length; i++) {
        const key =
          stage.key === "family" ? train[i]!.family : train[i]!.category;
        sums.set(key, (sums.get(key) ?? 0) + residuals[i]!);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const effects = new Map<string, number>();
      for (const [key, sum] of sums) {
        effects.set(key, sum / ((counts.get(key) ?? 0) + stage.lambda));
      }
      fitted.push({ stage, intercept: 0, slope: 0, effects });
      residuals = residuals.map((r, i) => {
        const key =
          stage.key === "family" ? train[i]!.family : train[i]!.category;
        return r - (effects.get(key) ?? 0);
      });
    }
  }
  return { stages: fitted, stats };
}

/** Predict the log ratio for one row, split into its size and category parts. */
export function predictValue(
  model: ValueModel,
  row: ModelRow,
): { total: number; sizePart: number; categoryPart: number } {
  let total = 0;
  let sizePart = 0;
  let categoryPart = 0;
  for (const fitted of model.stages) {
    const stage = fitted.stage;
    let add = 0;
    if (stage.kind === "const") {
      add = fitted.intercept;
    } else if (stage.kind === "ols") {
      add =
        fitted.intercept +
        fitted.slope * featureValue(row, stage.key, model.stats);
      if (stage.key === "lnTvl") sizePart += add;
    } else {
      const key = stage.key === "family" ? row.family : row.category;
      add = fitted.effects.get(key) ?? 0;
      categoryPart += add;
    }
    total += add;
  }
  return { total, sizePart, categoryPart };
}

/** Miss factor: exp of the median absolute log error. */
export function missFactor(predicted: number[], actual: number[]): number {
  const errors: number[] = [];
  for (let i = 0; i < predicted.length; i++) {
    errors.push(Math.abs(predicted[i]! - actual[i]!));
  }
  return Math.exp(median(errors));
}

/** Leave-one-out predictions: fit on all rows except i, predict row i. */
export function looPredictions(rows: ModelRow[], stages: Stage[]): number[] {
  const preds: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i);
    const model = fitValueModel(train, stages);
    preds.push(predictValue(model, rows[i]!).total);
  }
  return preds;
}

/**
 * Chronological walk-forward predictions over the dated rows: four
 * near-equal blocks in (listedAt, slug) order; fold k trains on blocks
 * 0..k and predicts block k+1.
 */
export function wfPredictions(
  dated: ModelRow[],
  stages: Stage[],
): { predicted: number[]; actual: number[] } {
  const sorted = dated.slice().sort((a, b) => {
    if (a.listedAt! < b.listedAt!) return -1;
    if (a.listedAt! > b.listedAt!) return 1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const n = sorted.length;
  const base = Math.floor(n / 4);
  const extra = n - base * 4;
  const blocks: ModelRow[][] = [];
  let at = 0;
  for (let b = 0; b < 4; b++) {
    const size = b < extra ? base + 1 : base;
    blocks.push(sorted.slice(at, at + size));
    at += size;
  }
  const predicted: number[] = [];
  const actual: number[] = [];
  for (let k = 0; k < 3; k++) {
    const train: ModelRow[] = [];
    for (let b = 0; b <= k; b++) train.push(...blocks[b]!);
    const model = fitValueModel(train, stages);
    for (const row of blocks[k + 1]!) {
      predicted.push(predictValue(model, row).total);
      actual.push(row.y as number);
    }
  }
  return { predicted, actual };
}

/** The value-model stages in test order, control last. */
export const VALUE_STAGE_DEFS: Stage[] = [
  { kind: "const", name: "flat median multiple" },
  { kind: "ols", key: "lnTvl", name: "size curve ln(TVL)" },
  { kind: "group", key: "family", lambda: 8, name: "family effect (ridge)" },
  {
    kind: "group",
    key: "category",
    lambda: 64,
    name: "category effect (ridge 64)",
  },
  { kind: "ols", key: "growth", name: "7-day TVL growth" },
  { kind: "ols", key: "age", name: "age (years listed)" },
  { kind: "ols", key: "lnChains", name: "chain count (ln)" },
];

export const VALUE_CONTROL_STAGE: Stage = {
  kind: "ols",
  key: "growthShuffled",
  name: "CONTROL shuffled growth",
};

/**
 * Sequential term selection over the value rows: a stage is kept only
 * when it lowers the miss in BOTH tests against the stages kept so far.
 * Returns the kept stages, the baseline and final scores, and the term
 * evidence table. Exported so the category-term experiment in the
 * build notes can run the same selection on a different training set.
 */
export function selectValueStages(
  valueRows: ModelRow[],
  datedRows: ModelRow[],
): {
  keptStages: Stage[];
  baseline: { loo: number; wf: number };
  current: { loo: number; wf: number };
  terms: ValueTermEvidence[];
} {
  const actuals = valueRows.map((r) => r.y as number);
  const evaluate = (stages: Stage[]): { loo: number; wf: number } => {
    const looPreds = looPredictions(valueRows, stages);
    const wf = wfPredictions(datedRows, stages);
    return {
      loo: missFactor(looPreds, actuals),
      wf: missFactor(wf.predicted, wf.actual),
    };
  };
  const keptStages: Stage[] = [VALUE_STAGE_DEFS[0]!];
  const current = evaluate(keptStages);
  const baseline = { ...current };
  const terms: ValueTermEvidence[] = [
    {
      name: "flat median multiple",
      loo: current.loo,
      wf: current.wf,
      kept: "baseline",
    },
  ];
  for (const stage of VALUE_STAGE_DEFS.slice(1)) {
    const candidate = [...keptStages, stage];
    const score = evaluate(candidate);
    const helps = score.loo < current.loo && score.wf < current.wf;
    terms.push({
      name: stage.name,
      loo: score.loo,
      wf: score.wf,
      kept: helps ? "kept" : "tested, not kept",
    });
    if (helps) {
      keptStages.push(stage);
      current.loo = score.loo;
      current.wf = score.wf;
    }
  }
  const controlScore = evaluate([...keptStages, VALUE_CONTROL_STAGE]);
  terms.push({
    name: "CONTROL shuffled growth",
    loo: controlScore.loo,
    wf: controlScore.wf,
    kept: "must not help",
  });
  return { keptStages, baseline, current, terms };
}

/** One value-model row for a protocol, with a chosen shuffled growth. */
export function buildModelRow(
  p: Protocol,
  shuffledGrowth: number | null,
  asOf: string,
): ModelRow {
  const age = ageDays(asOf, p.listed_at);
  return {
    slug: p.slug,
    listedAt: p.listed_at,
    ageYears: age === null ? null : age / 365.25,
    lnTvl: Math.log(p.tvl_usd / 1e8),
    growthRaw: p.change_7d,
    growthShuffled: shuffledGrowth,
    lnChains: Math.log(Math.max(1, p.chains.length)),
    family: familyOf(p.name, p.slug),
    category: p.category ?? "Uncategorized",
    y:
      p.mcap_usd !== null && p.tvl_usd > 0
        ? Math.log(p.mcap_usd / p.tvl_usd)
        : null,
  };
}

// The leave-one-out ratio lookup, set by buildBoardModel (step 7) and
// read by the farm stage through looRatioPredictor().
let looRatioBySlug = new Map<string, number>();

/**
 * A predictor closing over a snapshot of the LOO ratio map: for a priced
 * peer it returns the model's leave-one-out prediction over the peer's
 * actual cap/TVL ratio (1.00 means the model priced the peer exactly).
 * Unpriced peers, or peers the model never saw, return 1.
 */
export function looRatioPredictor(): (peer: Protocol) => number {
  const snapshot = new Map(looRatioBySlug);
  return (peer: Protocol): number => {
    const actual =
      peer.mcap_usd !== null && peer.tvl_usd > 0
        ? peer.mcap_usd / peer.tvl_usd
        : 0;
    const predicted = snapshot.get(peer.slug);
    if (actual <= 0 || predicted === undefined) return 1;
    return predicted / actual;
  };
}

// ---------------------------------------------------------------------------
// The main pipeline
// ---------------------------------------------------------------------------

interface Draft {
  protocol: Protocol;
  boardFeature: ModelRow;
  oddsFeature: OddsRow;
  implied: number;
  valueIfLaunches: number;
  odds: number;
  fittedMultiple: number;
  sizeFactor: number;
  categoryFactor: number;
  bootLow: number;
  bootHigh: number;
  bootRankLow: number;
  bootRankHigh: number;
}

export function buildBoardModel(snapshot: Snapshot): Board {
  // Step 1 — seed from the snapshot date and the slug list, in order.
  const seed = fnv1a(
    snapshot.as_of + "|" + snapshot.protocols.map((p) => p.slug).join(","),
  );

  // Step 2 — priced protocols: a positive cap on a positive TVL.
  const allRatios: number[] = [];
  const ratiosByCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.tvl_usd > 0) {
      const ratio = p.mcap_usd / p.tvl_usd;
      if (ratio > 0) {
        allRatios.push(ratio);
        const key = p.category ?? "Uncategorized";
        const list = ratiosByCategory.get(key) ?? [];
        list.push(ratio);
        ratiosByCategory.set(key, list);
      }
    }
  }
  const globalMultiple = median(allRatios);

  // Step 3 — category multiples, by count descending then name ascending.
  const multiples = Array.from(ratiosByCategory.entries())
    .map(([category, ratios]) => ({ category, ratios }))
    .sort((a, b) => {
      if (b.ratios.length !== a.ratios.length) {
        return b.ratios.length - a.ratios.length;
      }
      return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
    })
    .map(({ category, ratios }) => ({
      category,
      multiple:
        ratios.length >= 3
          ? Math.min(1, Math.max(0.05, median(ratios)))
          : globalMultiple,
      n: ratios.length,
    }));

  // Step 4 — value-model rows. Priced protocols in slug order, with the
  // growth column shuffled by a seeded Fisher–Yates for the control test.
  const orderedPriced = snapshot.protocols
    .filter(
      (p) =>
        p.mcap_usd !== null && p.tvl_usd > 0 && p.mcap_usd / p.tvl_usd > 0,
    )
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const shuffleRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const perm: number[] = [];
  for (let i = 0; i < orderedPriced.length; i++) perm.push(i);
  for (let i = perm.length - 1; i >= 1; i--) {
    const j = Math.floor(shuffleRng() * (i + 1));
    const tmp = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = tmp;
  }
  const valueRows = orderedPriced.map((p, i) =>
    buildModelRow(p, orderedPriced[perm[i]!]!.change_7d, snapshot.as_of),
  );
  const datedRows = valueRows.filter((r) => r.listedAt !== null);
  const actuals = valueRows.map((r) => r.y as number);

  // Step 5 — sequential term selection (both tests must improve).
  const { keptStages, baseline, current, terms: valueTerms } =
    selectValueStages(valueRows, datedRows);

  // Step 6 — final fit and held-out residuals.
  const finalValueModel = fitValueModel(valueRows, keptStages);
  const finalLooPreds = looPredictions(valueRows, keptStages);
  const looResiduals = actuals.map((y, i) => y - finalLooPreds[i]!);
  const finalWf = wfPredictions(datedRows, keptStages);
  const wfResiduals = finalWf.actual.map(
    (y, i) => y - finalWf.predicted[i]!,
  );
  const looQuantiles = residualQuantiles(looResiduals);
  const wfQuantiles = residualQuantiles(wfResiduals);

  // Step 7 — LOO ratio lookup for the farm stage's peer table.
  looRatioBySlug = new Map(
    valueRows.map((row, i) => [row.slug, Math.exp(finalLooPreds[i]!)] as [string, number]),
  );

  // Step 8 — interval honesty, in ratio space.
  const looActualRatios = actuals.map((y) => Math.exp(y));
  const looPredRatios = finalLooPreds.map((p) => Math.exp(p));
  const looCover50 = coverageFraction(
    looActualRatios,
    looPredRatios.map((p) => p * Math.exp(looQuantiles.q25)),
    looPredRatios.map((p) => p * Math.exp(looQuantiles.q75)),
  );
  const looCover80 = coverageFraction(
    looActualRatios,
    looPredRatios.map((p) => p * Math.exp(looQuantiles.q10)),
    looPredRatios.map((p) => p * Math.exp(looQuantiles.q90)),
  );
  const wfActualRatios = finalWf.actual.map((y) => Math.exp(y));
  const wfPredRatios = finalWf.predicted.map((p) => Math.exp(p));
  const wfCover50 = coverageFraction(
    wfActualRatios,
    wfPredRatios.map((p) => p * Math.exp(wfQuantiles.q25)),
    wfPredRatios.map((p) => p * Math.exp(wfQuantiles.q75)),
  );
  const wfCover80 = coverageFraction(
    wfActualRatios,
    wfPredRatios.map((p) => p * Math.exp(wfQuantiles.q10)),
    wfPredRatios.map((p) => p * Math.exp(wfQuantiles.q90)),
  );

  // Step 9 — odds training rows. v7 target: y = 1 when a ticker is
  // RECORDED (gecko_id or symbol set), y = 0 when no token is recorded
  // at all. The middle class is no longer excluded — it is y = 1.
  const oddsRows: OddsRow[] = [];
  for (const p of snapshot.protocols) {
    if (isOddsExcluded(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    oddsRows.push({
      slug: p.slug,
      listedAt: p.listed_at,
      ageYears: age === null ? null : age / 365.25,
      lnTvl: Math.log(p.tvl_usd / 1e8),
      growthRaw: p.change_7d,
      lnChains: Math.log(Math.max(1, p.chains.length)),
      family: familyOf(p.name, p.slug),
      category: p.category ?? "Uncategorized",
      y: p.gecko_id !== null || p.symbol !== null ? 1 : 0,
    });
  }
  const { model: oddsModel, evidence: oddsEvidence } =
    fitOddsWithEvidence(oddsRows);

  // Step 10 — board drafts.
  const watchlist = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter(isBoardCandidate);
  const drafts: Draft[] = [];
  for (const protocol of candidates) {
    const boardFeature = buildModelRow(protocol, null, snapshot.as_of);
    const oddsFeature: OddsRow = {
      slug: boardFeature.slug,
      listedAt: boardFeature.listedAt,
      ageYears: boardFeature.ageYears,
      lnTvl: boardFeature.lnTvl,
      growthRaw: boardFeature.growthRaw,
      lnChains: boardFeature.lnChains,
      family: boardFeature.family,
      category: boardFeature.category,
      y: 0,
    };
    const pred = predictValue(finalValueModel, boardFeature);
    const fittedMultiple = Math.exp(pred.total);
    const odds = predictOdds(oddsModel, oddsFeature);
    const valueIfLaunches = Math.max(
      1,
      Math.round(protocol.tvl_usd * fittedMultiple),
    );
    const implied = Math.max(
      1,
      Math.round(protocol.tvl_usd * fittedMultiple * odds),
    );
    drafts.push({
      protocol,
      boardFeature,
      oddsFeature,
      implied,
      valueIfLaunches,
      odds,
      fittedMultiple,
      sizeFactor: Math.exp(pred.sizePart),
      categoryFactor: Math.exp(pred.categoryPart),
      bootLow: 0,
      bootHigh: 0,
      bootRankLow: 0,
      bootRankHigh: 0,
    });
  }

  // Step 11 — bootstrap: 200 refits, P5–P95 of refit values and ranks.
  // Odds are held fixed; the parent discount is applied inside the
  // refits, so the ranges are measured on the discounted board.
  const bootRng = mulberry32(seed);
  const bootCount = 200;
  const bootImplied: number[][] = drafts.map(() => []);
  const bootRanks: number[][] = drafts.map(() => []);
  for (let b = 0; b < bootCount; b++) {
    const resample: ModelRow[] = [];
    for (let i = 0; i < valueRows.length; i++) {
      resample.push(valueRows[Math.floor(bootRng() * valueRows.length)]!);
    }
    const bootModel = fitValueModel(resample, keptStages);
    const bootValues = drafts.map((draft) =>
      Math.max(
        1,
        Math.round(
          draft.protocol.tvl_usd *
            Math.exp(predictValue(bootModel, draft.boardFeature).total) *
            draft.odds,
        ),
      ),
    );
    for (let i = 0; i < drafts.length; i++) bootImplied[i]!.push(bootValues[i]!);
    const rankedValues = bootValues.map((v, i) =>
      PARENT_PRODUCTS[drafts[i]!.protocol.slug] !== undefined
        ? parentScale(v)
        : v,
    );
    const order = drafts
      .map((_, i) => i)
      .sort((a, b) => {
        if (rankedValues[b]! !== rankedValues[a]!) {
          return rankedValues[b]! - rankedValues[a]!;
        }
        if (drafts[b]!.protocol.tvl_usd !== drafts[a]!.protocol.tvl_usd) {
          return drafts[b]!.protocol.tvl_usd - drafts[a]!.protocol.tvl_usd;
        }
        return drafts[a]!.protocol.slug < drafts[b]!.protocol.slug
          ? -1
          : drafts[a]!.protocol.slug > drafts[b]!.protocol.slug
            ? 1
            : 0;
      });
    order.forEach((draftIndex, place) => {
      bootRanks[draftIndex]!.push(place + 1);
    });
  }
  for (let i = 0; i < drafts.length; i++) {
    const sortedValues = bootImplied[i]!.slice().sort((a, b) => a - b);
    const sortedRanks = bootRanks[i]!.slice().sort((a, b) => a - b);
    drafts[i]!.bootLow = quantile(sortedValues, 0.05);
    drafts[i]!.bootHigh = quantile(sortedValues, 0.95);
    drafts[i]!.bootRankLow = Math.round(quantile(sortedRanks, 0.05));
    drafts[i]!.bootRankHigh = Math.round(quantile(sortedRanks, 0.95));
  }

  // Step 12 — rank, nudging any tie down by $1 so implied values are
  // strictly decreasing.
  drafts.sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    if (b.protocol.tvl_usd !== a.protocol.tvl_usd) {
      return b.protocol.tvl_usd - a.protocol.tvl_usd;
    }
    return a.protocol.slug < b.protocol.slug
      ? -1
      : a.protocol.slug > b.protocol.slug
        ? 1
        : 0;
  });
  for (let i = 1; i < drafts.length; i++) {
    if (drafts[i]!.implied >= drafts[i - 1]!.implied) {
      drafts[i]!.implied = drafts[i - 1]!.implied - 1;
    }
  }

  // Step 13 — rows, in the exact field order the board is written in.
  const rows: BoardRow[] = drafts.map((draft, i) => {
    const p = draft.protocol;
    const bounds = intervalBounds(draft.implied, looQuantiles);
    const placeholder = (n: number): string =>
      `Placeholder langkah farm ${n} dari 6 — subagent farm mengganti teks ini dengan langkah nyata sebelum submit.`;
    return {
      slug: p.slug,
      name: p.name,
      category: p.category ?? "Uncategorized",
      chains: p.chains,
      tvlUsd: p.tvl_usd,
      change7d: p.change_7d,
      ageDays: ageDays(snapshot.as_of, p.listed_at),
      watchlist: watchlist.has(p.slug),
      rank: i + 1,
      impliedValueUsd: draft.implied,
      valueIfLaunches: draft.valueIfLaunches,
      tokenOdds: draft.odds,
      p25: bounds.p25,
      p75: bounds.p75,
      p10: bounds.p10,
      p90: bounds.p90,
      bootstrapLow: Math.max(1, Math.round(Math.min(draft.bootLow, draft.implied))),
      bootstrapHigh: Math.max(1, Math.round(Math.max(draft.bootHigh, draft.implied))),
      bootstrapRankLow: draft.bootRankLow,
      bootstrapRankHigh: draft.bootRankHigh,
      factors: {
        multiple: draft.fittedMultiple,
        size: draft.sizeFactor,
        category: draft.categoryFactor,
      },
      verdict: "MARGINAL",
      netFees: 0,
      netPerHour: 0,
      dropUsd: 0,
      feesUsd: 0,
      handsOnHours: 0,
      depositUsd: 0,
      dropShare: 0,
      horizonWeeks: 0,
      farmSteps: [
        placeholder(1),
        placeholder(2),
        placeholder(3),
        placeholder(4),
        placeholder(5),
        placeholder(6),
      ],
      farmPlan: [],
      exitRule: "",
      peers: [],
    };
  });

  // Step 14 — evidence and return.
  const evidence: Evidence = {
    value: {
      n: valueRows.length,
      baselineLoo: baseline.loo,
      baselineWf: baseline.wf,
      finalLoo: current.loo,
      finalWf: current.wf,
      terms: valueTerms,
    },
    odds: oddsEvidence,
    range: {
      rows: [
        { label: "P25–P75", stated: 0.5, loo: looCover50, wf: wfCover50 },
        { label: "P10–P90", stated: 0.8, loo: looCover80, wf: wfCover80 },
      ],
      note: "Intervals are the implied value shifted by the quantiles of the value model's own held-out log residuals (LOO residuals for the board bounds). Coverage is the share of priced protocols whose real cap fell inside the interval: LOO over all priced rows, walk-forward over the dated rows with a walk-forward prediction.",
    },
  };
  return {
    model: "radar-8",
    as_of: snapshot.as_of,
    rows,
    multiples,
    globalMultiple,
    liveCount: valueRows.length,
    evidence,
  };
}
