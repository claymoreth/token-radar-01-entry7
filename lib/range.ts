// lib/range.ts — seeded PRNG, quantiles, intervals, coverage.
//
// Small helpers with no state of their own. The only randomness in the
// whole entry lives here: mulberry32, seeded by the caller. Everything
// else in this file is pure arithmetic over arrays the caller passes in.
// No unseeded randomness anywhere: every random draw comes from a
// seeded stream, so the same snapshot always yields the same board.

export interface ResidualQuantiles {
  q10: number;
  q25: number;
  q75: number;
  q90: number;
}

/** 32-bit FNV-1a over the string's UTF-16 code units. Returns a number. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = hash ^ text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a tiny seeded PRNG returning numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = t ^ (t + Math.imul(t ^ (t >>> 7), t | 61));
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Linear-interpolation quantile of a pre-sorted ascending array.
 * q is in [0, 1]. Empty array gives 0, a single element gives itself.
 */
export function quantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0]!;
  const pos = q * (sortedValues.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedValues[lo]!;
  return sortedValues[lo]! + (sortedValues[hi]! - sortedValues[lo]!) * (pos - lo);
}

/** The four residual quantiles the board's intervals are built from. */
export function residualQuantiles(residuals: number[]): ResidualQuantiles {
  const sorted = residuals.slice().sort((a, b) => a - b);
  return {
    q10: quantile(sorted, 0.1),
    q25: quantile(sorted, 0.25),
    q75: quantile(sorted, 0.75),
    q90: quantile(sorted, 0.9),
  };
}

/**
 * Interval bounds for one implied value, shifting it by the residual
 * quantiles. Every bound is at least $1 and a whole dollar.
 */
export function intervalBounds(
  impliedValueUsd: number,
  q: ResidualQuantiles,
): { p25: number; p75: number; p10: number; p90: number } {
  return {
    p25: Math.max(1, Math.round(impliedValueUsd * Math.exp(q.q25))),
    p75: Math.max(1, Math.round(impliedValueUsd * Math.exp(q.q75))),
    p10: Math.max(1, Math.round(impliedValueUsd * Math.exp(q.q10))),
    p90: Math.max(1, Math.round(impliedValueUsd * Math.exp(q.q90))),
  };
}

/**
 * Share of actual values that fall inside the matching [lower, upper]
 * bounds, inclusive on both ends. Empty input gives 0.
 */
export function coverageFraction(
  actual: number[],
  lower: number[],
  upper: number[],
): number {
  if (actual.length === 0) return 0;
  let inside = 0;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i]! >= lower[i]! && actual[i]! <= upper[i]!) inside += 1;
  }
  return inside / actual.length;
}
