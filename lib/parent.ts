// lib/parent.ts — the 20 parent-product lines and the ×0.48 factor.
//
// A parent product's line is one arm of a larger protocol, not a protocol
// of its own, so it keeps 48% of its fitted value. The list is a fixed
// data table carried over from the v4 entry; each value is the v4
// description of the line, not a parent name. Matching is by exact slug,
// case-sensitive — no substring or name matching, ever. The runner and
// the bootstrap rank range share this one table, so the discount the
// reader sees is the discount the ranges were measured on.

export const PARENT_FACTOR = 0.48;

export const PARENT_PRODUCTS: Record<string, string> = {
  "arcus-perps": "Arcus perps desk",
  "avant-avusd": "Avant avUSD stablecoin",
  "azverse-perps": "AZverse perps desk",
  "bitfi-basis": "BitFi basis-trading product",
  "cian-yield-layer": "CIAN yield product",
  "circle-gateway": "Circle cross-chain product",
  "defi-saver-asset-management": "DeFi Saver asset-management product",
  "extended-perps": "Extended perps desk",
  "figure-markets-exchange": "Figure Markets exchange arm",
  "figure-markets-prime": "Figure Markets prime arm",
  "ipor-fusion": "IPOR Fusion vault product",
  "loopscale-lending": "Loopscale lending product",
  "mellow-core": "Mellow core vault product",
  "nado-spot": "Nado spot product",
  "polymarket-international": "Polymarket international arm",
  "sentora-curator": "Sentora curator product",
  "solv-strategies": "Solv strategy product",
  "stellar-defi-hub": "Stellar DeFi hub product",
  "theo-network-thusd": "Theo Network thUSD stablecoin",
  "usdcx": "Circle USDCx wrapped product",
};

/** Scale a dollar value by the parent factor, at least $1, whole dollars. */
export function parentScale(v: number): number {
  return Math.max(1, Math.round(v * PARENT_FACTOR));
}
