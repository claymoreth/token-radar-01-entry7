// lib/accounting.ts — the 758-protocol ledger buckets.
//
// Every protocol lands in exactly one bucket, so the buckets always add
// up to the ledger total. A protocol is tested top to bottom and takes
// the FIRST bucket it matches. The floor label is derived from the
// snapshot's own floor_usd, never hardcoded.

export interface AccountingProtocol {
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

export interface AccountingSnapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: AccountingProtocol[];
  watchlist: string[];
}

export interface AccountingGroup {
  key: string;
  label: string;
  count: number;
}

export interface Accounting {
  total: number;
  groups: AccountingGroup[];
  ranked: number;
  watchlist: number;
}

const BRIDGE_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Cross Chain Bridge",
]);

const LIQUID_STAKING_CATEGORIES = new Set([
  "Liquid Staking",
  "Liquid Restaking",
]);

/** The bucket definitions, in the order protocols are tested against them. */
function groupDefinitions(floorUsd: number): { key: string; label: string }[] {
  const floorLabel =
    floorUsd >= 1e6 ? "$" + floorUsd / 1e6 + "M" : "$" + floorUsd;
  return [
    { key: "ranked-watchlist", label: "Ranked — on the 40-name watchlist" },
    {
      key: "ranked-early-below-floor",
      label: `Ranked — early, pre-token, below the ${floorLabel} floor`,
    },
    {
      key: "ranked-off-list",
      label: "Ranked — pre-token, off the watchlist and above the floor",
    },
    {
      key: "token-trades-priced-comp",
      label: "Priced token — trades, used as a comparable",
    },
    {
      key: "token-recorded-no-usable-cap",
      label: "Token recorded, but no usable market cap",
    },
    { key: "out-bridge", label: "Out — bridge" },
    { key: "out-liquid-staking", label: "Out — liquid staking / restaking" },
    { key: "out-exchange", label: "Out — centralised exchange" },
    {
      key: "out-versioned-or-wrapped",
      label:
        "Out — versioned/wrapped variant, or unranked pre-token with no recorded token",
    },
  ];
}

/**
 * Classify one protocol. First match wins; the order is the definition
 * order above, so a ranked protocol is never also counted as a priced
 * comparable, and a priced token is never also counted as out-of-scope.
 * A protocol with no token recorded at all and no ranked row falls
 * through to the last bucket only when it is not a bridge, a liquid
 * staking protocol, or an exchange.
 */
function classify(
  p: AccountingProtocol,
  ranked: Set<string>,
  watchlist: Set<string>,
  floorUsd: number,
): string {
  if (ranked.has(p.slug) && watchlist.has(p.slug)) return "ranked-watchlist";
  if (ranked.has(p.slug) && p.tvl_usd < floorUsd && p.mcap_usd === null) {
    return "ranked-early-below-floor";
  }
  if (ranked.has(p.slug)) return "ranked-off-list";
  if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
    return "token-trades-priced-comp";
  }
  if (p.symbol !== null || p.gecko_id !== null) {
    return "token-recorded-no-usable-cap";
  }
  if (p.category !== null && BRIDGE_CATEGORIES.has(p.category)) {
    return "out-bridge";
  }
  if (p.category !== null && LIQUID_STAKING_CATEGORIES.has(p.category)) {
    return "out-liquid-staking";
  }
  if (p.category === "CEX") return "out-exchange";
  return "out-versioned-or-wrapped";
}

/** Count every protocol in the snapshot into exactly one bucket. */
export function buildAccounting(
  snapshot: AccountingSnapshot,
  rows: { slug: string }[],
): Accounting {
  const ranked = new Set(rows.map((r) => r.slug));
  const watchlist = new Set(snapshot.watchlist);
  const defs = groupDefinitions(snapshot.floor_usd);
  const counts = new Map<string, number>();
  for (const def of defs) counts.set(def.key, 0);
  for (const p of snapshot.protocols) {
    const key = classify(p, ranked, watchlist, snapshot.floor_usd);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    total: snapshot.protocols.length,
    groups: defs.map((def) => ({
      key: def.key,
      label: def.label,
      count: counts.get(def.key) ?? 0,
    })),
    ranked: rows.length,
    watchlist: snapshot.watchlist.length,
  };
}
