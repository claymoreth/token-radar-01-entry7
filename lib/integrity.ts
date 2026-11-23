// lib/integrity.ts — checksum and ledger counts.
//
// Proves the board on screen is the board that was computed: a reader
// (or the dashboard itself, in the browser) can recompute the checksum
// from the ranked rows and compare it with the one the run wrote.
//
// Note the two fnv1a functions in this entry are deliberately different:
// the one in lib/range.ts hashes UTF-16 code units and returns a number
// (it seeds the PRNG); this one hashes UTF-8 bytes and returns an
// 8-digit lowercase hex string (it checksums the board). Keep both.

export interface IntegrityRow {
  slug: string;
  rank: number;
  impliedValueUsd: number;
  watchlist?: boolean;
}

export interface IntegritySnapshot {
  protocols: unknown[];
  watchlist: string[];
}

export interface Integrity {
  checksum: string;
  totalImplied: number;
  watchlistCovered: number;
  watchlistTotal: number;
  ledgerTotal: number;
  rows: number;
}

/** 32-bit FNV-1a over the UTF-8 bytes, as 8 lowercase hex digits.
 * Check values: fnv1a("") is "811c9dc5", fnv1a("a") is "e40c292c". */
export function fnv1a(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash = hash ^ bytes[i]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The exact string the checksum is taken over: one line per row,
 * "slug|rank|impliedValueUsd" with JavaScript's default number form,
 * rows in rank order, lines joined with "\n" and no trailing newline.
 */
export function checksumInput(rows: IntegrityRow[]): string {
  const ordered = rows.slice().sort((a, b) => a.rank - b.rank);
  return ordered
    .map((r) => `${r.slug}|${r.rank}|${r.impliedValueUsd}`)
    .join("\n");
}

/** The integrity record for a finished board. */
export function buildIntegrity(
  rows: IntegrityRow[],
  snapshot: IntegritySnapshot,
): Integrity {
  const watchlist = new Set(snapshot.watchlist);
  let covered = 0;
  let total = 0;
  for (const row of rows) {
    if (watchlist.has(row.slug)) covered += 1;
    total += row.impliedValueUsd;
  }
  return {
    checksum: fnv1a(checksumInput(rows)),
    totalImplied: Math.round(total * 100) / 100,
    watchlistCovered: covered,
    watchlistTotal: snapshot.watchlist.length,
    ledgerTotal: snapshot.protocols.length,
    rows: rows.length,
  };
}
