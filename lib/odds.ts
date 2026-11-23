// lib/odds.ts — token-odds logistic regression.
//
// The question this file answers, in v7 ("radar-8"): for a protocol with
// no token yet, how likely is DefiLlama to have a ticker RECORDED for it?
// The target is y = 1 when a ticker is recorded (gecko_id or symbol is
// set), y = 0 when no token is recorded at all. That is a record of
// visibility, not a forecast that a token will trade — the README says so
// plainly, and the board's implied values must never be compared with the
// traded-token target of the earlier entry.
//
// The regression itself is written from scratch, standard library only:
// full-batch gradient descent, a ridge penalty on every weight except the
// bias, a sigmoid whose input is clamped so it can never overflow.
// Nothing is hardcoded: every level, mean, scale and weight is fitted
// at run time. Groups are kept only when they lower the Brier score in
// BOTH held-out tests — ten-fold cross-validation and a chronological
// walk-forward — against the groups kept so far.

export interface OddsRow {
  slug: string;
  listedAt: string | null;
  ageYears: number | null;
  lnTvl: number;
  growthRaw: number | null;
  lnChains: number;
  family: string;
  category: string;
  y: number;
}

export type OddsTermKept = "kept" | "tested, not kept" | "baseline";

export interface OddsTermEvidence {
  name: string;
  brier: number;
  wfBrier: number;
  kept: OddsTermKept;
}

export interface OddsEvidence {
  n: number;
  baseRate: number;
  baselineBrier: number;
  baselineWfBrier: number;
  finalBrier: number;
  finalWfBrier: number;
  walkForwardCorrect: number;
  terms: OddsTermEvidence[];
}

export const ODDS_GROUPS = [
  "age",
  "lntvl",
  "growth",
  "family",
  "category",
  "lnch",
] as const;

export type OddsGroup = (typeof ODDS_GROUPS)[number];

const GROUP_LABELS: Record<OddsGroup, string> = {
  age: "age (years listed)",
  lntvl: "ln(TVL)",
  growth: "7-day TVL growth",
  family: "family (ridge 16, raw dummies)",
  category: "category (ridge 16, raw dummies)",
  lnch: "chain count (ln)",
};

interface OddsStats {
  meanAge: number;
  meanGrowth: number;
  catLevels: string[];
  famLevels: string[];
  means: number[];
  sds: number[];
}

interface OddsModel {
  groups: OddsGroup[];
  stats: OddsStats;
  weights: number[];
  baseRate: number;
}

/** Sigmoid with its input clamped to [-30, 30] first. */
function sigmoid(z: number): number {
  const clamped = z < -30 ? -30 : z > 30 ? 30 : z;
  return 1 / (1 + Math.exp(-clamped));
}

/**
 * Raw design columns for one row, walking the groups in order. Family
 * and category contribute one raw 0/1 dummy per level; numeric columns
 * are standardised downstream, the dummies are not.
 */
function rawColumns(
  row: OddsRow,
  groups: OddsGroup[],
  stats: OddsStats,
): number[] {
  const cols: number[] = [];
  for (const group of groups) {
    if (group === "age") {
      cols.push(row.ageYears ?? stats.meanAge);
    } else if (group === "lntvl") {
      cols.push(row.lnTvl);
    } else if (group === "growth") {
      const g = row.growthRaw ?? stats.meanGrowth;
      cols.push(g < -0.9 ? -0.9 : g > 3 ? 3 : g);
    } else if (group === "lnch") {
      cols.push(row.lnChains);
    } else if (group === "family") {
      for (const level of stats.famLevels) {
        cols.push(row.family === level ? 1 : 0);
      }
    } else if (group === "category") {
      for (const level of stats.catLevels) {
        cols.push(row.category === level ? 1 : 0);
      }
    }
  }
  return cols;
}

/** Per-column metadata aligned with the raw columns. */
function columnInfo(
  groups: OddsGroup[],
  stats: OddsStats,
): { raw: boolean[]; penalty: number[] } {
  const raw: boolean[] = [];
  const penalty: number[] = [];
  for (const group of groups) {
    if (group === "family") {
      for (let i = 0; i < stats.famLevels.length; i++) {
        raw.push(true);
        penalty.push(16);
      }
    } else if (group === "category") {
      for (let i = 0; i < stats.catLevels.length; i++) {
        raw.push(true);
        penalty.push(16);
      }
    } else {
      raw.push(false);
      penalty.push(1);
    }
  }
  return { raw, penalty };
}

/** Fit-time statistics: imputation means, dummy levels, column scales. */
function fitStats(rows: OddsRow[], groups: OddsGroup[]): OddsStats {
  let ageSum = 0;
  let ageCount = 0;
  let growthSum = 0;
  let growthCount = 0;
  const famCounts = new Map<string, number>();
  const catSet = new Set<string>();
  for (const row of rows) {
    if (row.ageYears !== null) {
      ageSum += row.ageYears;
      ageCount += 1;
    }
    if (row.growthRaw !== null) {
      growthSum += row.growthRaw;
      growthCount += 1;
    }
    famCounts.set(row.family, (famCounts.get(row.family) ?? 0) + 1);
    catSet.add(row.category);
  }
  const famLevels = Array.from(famCounts.entries())
    .filter(([, count]) => count >= 2)
    .map(([family]) => family)
    .sort();
  const catLevels = Array.from(catSet).sort();
  const stats: OddsStats = {
    meanAge: ageCount > 0 ? ageSum / ageCount : 0,
    meanGrowth: growthCount > 0 ? growthSum / growthCount : 0,
    catLevels,
    famLevels,
    means: [],
    sds: [],
  };
  const rawMatrix = rows.map((row) => rawColumns(row, groups, stats));
  const d = rows.length === 0 ? 0 : rawMatrix[0]!.length;
  const info = columnInfo(groups, stats);
  for (let j = 0; j < d; j++) {
    let mean = 0;
    for (let i = 0; i < rawMatrix.length; i++) mean += rawMatrix[i]![j]!;
    mean /= rawMatrix.length;
    let variance = 0;
    for (let i = 0; i < rawMatrix.length; i++) {
      variance += (rawMatrix[i]![j]! - mean) * (rawMatrix[i]![j]! - mean);
    }
    variance /= rawMatrix.length;
    let sd = variance > 1e-12 ? Math.sqrt(variance) : 1;
    let m = mean;
    if (info.raw[j]) {
      m = 0;
      sd = 1;
    }
    stats.means.push(m);
    stats.sds.push(sd);
  }
  return stats;
}

/** Standardised design matrix for a set of rows under fitted stats. */
function designMatrix(
  rows: OddsRow[],
  groups: OddsGroup[],
  stats: OddsStats,
): number[][] {
  return rows.map((row) => {
    const raw = rawColumns(row, groups, stats);
    return raw.map((value, j) => (value - stats.means[j]!) / stats.sds[j]!);
  });
}

/**
 * Full-batch gradient descent for logistic regression. The bias is
 * unpenalised; every other weight carries its column's ridge penalty.
 * Stops early when the largest weight step drops below 1e-9.
 */
function fitLogistic(
  x: number[][],
  y: number[],
  penalties: number[],
): number[] {
  const n = x.length;
  const d = n === 0 ? 0 : x[0]!.length;
  const w: number[] = new Array(d + 1).fill(0);
  const lr = 0.15;
  for (let iter = 0; iter < 1000; iter++) {
    const grad: number[] = new Array(d + 1).fill(0);
    for (let i = 0; i < n; i++) {
      let z = w[0]!;
      for (let j = 0; j < d; j++) z += w[j + 1]! * x[i]![j]!;
      const err = sigmoid(z) - y[i]!;
      grad[0]! += err;
      for (let j = 0; j < d; j++) grad[j + 1]! += err * x[i]![j]!;
    }
    let maxStep = 0;
    for (let j = 0; j <= d; j++) {
      const penalty = j === 0 ? 0 : (penalties[j - 1]! * w[j]!) / n;
      const step = lr * (grad[j]! / n + penalty);
      w[j]! -= step;
      const abs = step < 0 ? -step : step;
      if (abs > maxStep) maxStep = abs;
    }
    if (maxStep < 1e-9) break;
  }
  return w;
}

/** Fit the odds model for one group set. */
export function fitOdds(
  rows: OddsRow[],
  groups: OddsGroup[],
  baseRate: number,
): OddsModel {
  const stats = fitStats(rows, groups);
  const x = designMatrix(rows, groups, stats);
  const weights = fitLogistic(
    x,
    rows.map((r) => r.y),
    columnInfo(groups, stats).penalty,
  );
  return { groups, stats, weights, baseRate };
}

/** Predict a ticker-recorded probability for one row, clipped to [0.02, 0.98]. */
export function predictOdds(model: OddsModel, row: OddsRow): number {
  const raw = rawColumns(row, model.groups, model.stats);
  const x = raw.map((value, j) => (value - model.stats.means[j]!) / model.stats.sds[j]!);
  let z = model.weights[0]!;
  for (let j = 0; j < x.length; j++) z += model.weights[j + 1]! * x[j]!;
  const p = sigmoid(z);
  return p < 0.02 ? 0.02 : p > 0.98 ? 0.98 : p;
}

/** Mean squared error between predicted probabilities and actual 0/1s. */
export function brierScore(predicted: number[], actual: number[]): number {
  if (predicted.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < predicted.length; i++) {
    const diff = predicted[i]! - actual[i]!;
    sum += diff * diff;
  }
  return sum / predicted.length;
}

/**
 * Three expanding chronological folds over rows already sorted by
 * (listedAt, slug): fold k trains on blocks 0..k and tests block k+1.
 */
export function expandingFolds<T>(sortedRows: T[]): { train: T[]; test: T[] }[] {
  const n = sortedRows.length;
  const chunks = 4;
  const base = Math.floor(n / chunks);
  const extra = n - base * chunks;
  const blocks: T[][] = [];
  let at = 0;
  for (let b = 0; b < chunks; b++) {
    const size = b < extra ? base + 1 : base;
    blocks.push(sortedRows.slice(at, at + size));
    at += size;
  }
  const folds: { train: T[]; test: T[] }[] = [];
  for (let k = 0; k < 3; k++) {
    const train: T[] = [];
    for (let b = 0; b <= k; b++) train.push(...blocks[b]!);
    folds.push({ train, test: blocks[k + 1]! });
  }
  return folds;
}

/**
 * Ten-fold Brier: folds are every tenth row in slug order. The indexOf
 * lookup puts each test prediction back in its own slot; slugs are
 * unique, so the slot is the row's own.
 */
export function tenFoldBrier(rows: OddsRow[], groups: OddsGroup[]): number {
  const ordered = rows.slice().sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const predicted: number[] = new Array(ordered.length).fill(0);
  for (let fold = 0; fold < 10; fold++) {
    const train = ordered.filter((_, i) => i % 10 !== fold);
    const test = ordered.filter((_, i) => i % 10 === fold);
    if (test.length === 0) continue;
    let trainSum = 0;
    for (const r of train) trainSum += r.y;
    const baseRate = train.length > 0 ? trainSum / train.length : 0;
    const model = fitOdds(train, groups, baseRate);
    for (const row of test) {
      predicted[ordered.indexOf(row)] = predictOdds(model, row);
    }
  }
  return brierScore(predicted, ordered.map((r) => r.y));
}

/**
 * Walk-forward Brier over the dated rows, in listing order, plus the
 * share of test rows the model calls right against the overall base rate.
 */
export function walkForwardBrier(
  rows: OddsRow[],
  groups: OddsGroup[],
): { brier: number; correct: number; n: number; predicted: number[]; actual: number[] } {
  const dated = rows
    .filter((r) => r.listedAt !== null)
    .sort((a, b) => {
      if (a.listedAt! < b.listedAt!) return -1;
      if (a.listedAt! > b.listedAt!) return 1;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  const predicted: number[] = [];
  const actual: number[] = [];
  for (const fold of expandingFolds(dated)) {
    let trainSum = 0;
    for (const r of fold.train) trainSum += r.y;
    const baseRate = fold.train.length > 0 ? trainSum / fold.train.length : 0;
    const model = fitOdds(fold.train, groups, baseRate);
    for (const row of fold.test) {
      predicted.push(predictOdds(model, row));
      actual.push(row.y);
    }
  }
  let allSum = 0;
  for (const r of rows) allSum += r.y;
  const baseRate = rows.length > 0 ? allSum / rows.length : 0;
  let right = 0;
  for (let i = 0; i < predicted.length; i++) {
    if ((predicted[i]! > baseRate ? 1 : 0) === actual[i]) right += 1;
  }
  return {
    brier: brierScore(predicted, actual),
    correct: actual.length === 0 ? 0 : right / actual.length,
    n: actual.length,
    predicted,
    actual,
  };
}

/** Walk-forward Brier of the intercept-only model: each fold predicts its own train base rate. */
export function baselineWalkForwardBrier(rows: OddsRow[]): number {
  const dated = rows
    .filter((r) => r.listedAt !== null)
    .sort((a, b) => {
      if (a.listedAt! < b.listedAt!) return -1;
      if (a.listedAt! > b.listedAt!) return 1;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  const predicted: number[] = [];
  const actual: number[] = [];
  for (const fold of expandingFolds(dated)) {
    let trainSum = 0;
    for (const r of fold.train) trainSum += r.y;
    const rate = fold.train.length > 0 ? trainSum / fold.train.length : 0;
    for (const row of fold.test) {
      predicted.push(rate);
      actual.push(row.y);
    }
  }
  return brierScore(predicted, actual);
}

/**
 * Sequential selection: try each group in ODDS_GROUPS order, keep it
 * only when it lowers the Brier score in BOTH held-out tests against the
 * groups kept so far. A group that helps one test and hurts the other is
 * reported "tested, not kept" and never used.
 */
export function fitOddsWithEvidence(
  rows: OddsRow[],
): { model: OddsModel; evidence: OddsEvidence } {
  let baseSum = 0;
  for (const r of rows) baseSum += r.y;
  const baseRate = rows.length > 0 ? baseSum / rows.length : 0;
  const baselineBrier = brierScore(
    rows.map(() => baseRate),
    rows.map((r) => r.y),
  );
  const baselineWfBrier = baselineWalkForwardBrier(rows);
  const terms: OddsTermEvidence[] = [
    {
      name: "intercept-only (base rate)",
      brier: baselineBrier,
      wfBrier: baselineWfBrier,
      kept: "baseline",
    },
  ];
  let kept: OddsGroup[] = [];
  let bestBrier = baselineBrier;
  let bestWfBrier = baselineWfBrier;
  let finalBrier = baselineBrier;
  let finalWfBrier = baselineWfBrier;
  let finalCorrect = 0;
  for (const group of ODDS_GROUPS) {
    const candidate: OddsGroup[] = [...kept, group];
    const brier = tenFoldBrier(rows, candidate);
    const wf = walkForwardBrier(rows, candidate);
    const helps = brier < bestBrier && wf.brier < bestWfBrier;
    terms.push({
      name: GROUP_LABELS[group],
      brier,
      wfBrier: wf.brier,
      kept: helps ? "kept" : "tested, not kept",
    });
    if (helps) {
      kept = candidate;
      bestBrier = brier;
      bestWfBrier = wf.brier;
      finalBrier = brier;
      finalWfBrier = wf.brier;
      finalCorrect = wf.correct;
    }
  }
  if (kept.length === 0) {
    finalCorrect = walkForwardBrier(rows, []).correct;
  }
  const model = fitOdds(rows, kept, baseRate);
  const evidence: OddsEvidence = {
    n: rows.length,
    baseRate,
    baselineBrier,
    baselineWfBrier,
    finalBrier,
    finalWfBrier,
    walkForwardCorrect: finalCorrect,
    terms,
  };
  return { model, evidence };
}
