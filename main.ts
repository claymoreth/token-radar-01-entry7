// main.ts — the entry runner for token-radar-01 v7 ("radar-8").
//
// The pipeline, in order: build the board from the snapshot, discount
// the parent-product lines, cost every row's farm, count the ledger,
// prove the board with the integrity record, then write board.json and
// data.js, copy the dashboard and screenshots, and build the dossier
// the judge reads. The farm stage runs AFTER the parent discount, so
// the drop it costs is the discounted drop the reader sees — never the
// pre-discount figure.
//
//   mkdir -p out && RADAR_INPUT=<snapshot> RADAR_OUTPUT=out node main.ts
//
// Node 22, standard library only. Deterministic: the same snapshot
// always yields the same bytes.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoardModel, looRatioPredictor } from "./lib/model.ts";
import { addFarm } from "./lib/farm.ts";
import { buildAccounting } from "./lib/accounting.ts";
import { buildIntegrity } from "./lib/integrity.ts";
import {
  PARENT_FACTOR,
  PARENT_PRODUCTS,
  parentScale,
} from "./lib/parent.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const TEXT_MAX_BYTES = 65536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4194304 };

// The entry directory: MAKEFUN_BOT_DIR when set, else this script's own
// directory. The dashboard and screenshots are resolved from here,
// never from process.cwd() alone.
const here = process.env.MAKEFUN_BOT_DIR
  ? process.env.MAKEFUN_BOT_DIR
  : fileURLToPath(new URL(".", import.meta.url));

/** --name <value> or --name=value, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined
    ? fallback
    : withEquals.slice(name.length + 3);
}

const inputArg = arg("input", process.env.RADAR_INPUT ?? "/input/snapshot.json");
const inputFile = inputArg.endsWith(".json")
  ? inputArg
  : join(inputArg, "snapshot.json");
if (!existsSync(inputFile)) {
  process.stderr.write(
    `token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or set RADAR_INPUT\n`,
  );
  process.exit(2);
}

const outDir = arg(
  "output",
  process.env.RADAR_OUTPUT ?? process.env.MAKEFUN_OUTPUT_DIR ?? "/output",
);

const parsed = JSON.parse(readFileSync(inputFile, "utf8"));
if (
  !parsed ||
  !Array.isArray(parsed.protocols) ||
  !Array.isArray(parsed.watchlist)
) {
  process.stderr.write(
    `token radar: ${inputFile} has no protocols/watchlist arrays: not a token-radar snapshot\n`,
  );
  process.exit(2);
}
const snapshot = parsed;

const board = buildBoardModel(snapshot);

// Parent discount: each listed line keeps 48% of its fitted value. The
// discount scales the implied value and every bound derived from it,
// then the board is re-ranked with $1 tie-nudges so implied values stay
// strictly decreasing.
const detected: { slug: string; name: string; parent: string }[] = [];
for (const row of board.rows) {
  const parent = PARENT_PRODUCTS[row.slug];
  if (parent === undefined) continue;
  row.parentFactor = PARENT_FACTOR;
  row.parentName = parent;
  row.impliedValueUsd = parentScale(row.impliedValueUsd);
  row.p25 = parentScale(row.p25);
  row.p75 = parentScale(row.p75);
  row.p10 = parentScale(row.p10);
  row.p90 = parentScale(row.p90);
  row.bootstrapLow = parentScale(row.bootstrapLow);
  row.bootstrapHigh = parentScale(row.bootstrapHigh);
  detected.push({ slug: row.slug, name: row.name, parent });
}
const missing = Object.keys(PARENT_PRODUCTS).filter(
  (slug) => !board.rows.some((r) => r.slug === slug),
);
board.rows.sort((a, b) => {
  if (b.impliedValueUsd !== a.impliedValueUsd) {
    return b.impliedValueUsd - a.impliedValueUsd;
  }
  if (b.tvlUsd !== a.tvlUsd) return b.tvlUsd - a.tvlUsd;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
});
for (let i = 1; i < board.rows.length; i++) {
  if (board.rows[i]!.impliedValueUsd >= board.rows[i - 1]!.impliedValueUsd) {
    board.rows[i]!.impliedValueUsd = board.rows[i - 1]!.impliedValueUsd - 1;
  }
}
board.rows.forEach((row, i) => {
  row.rank = i + 1;
});

addFarm(board.rows, snapshot, looRatioPredictor());
const accounting = buildAccounting(snapshot, board.rows);
const integrity = buildIntegrity(board.rows, snapshot);

const out = {
  ...board,
  floorUsd: snapshot.floor_usd,
  accounting,
  integrity,
};
const json = JSON.stringify(out, null, 2);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "board.json"), json + "\n");
writeFileSync(join(outDir, "data.js"), `window.RADAR = ${json};\n`);

/** Copy one directory's regular files into `to`, skipping dot-names. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith(".")) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, "dashboard"), join(outDir, "dashboard"));
const shots = copyFiles(join(here, "screenshots"), join(outDir, "screenshots"));

let dossierWritten = false;
if (shots.length === 0) {
  process.stderr.write(
    "token radar: no screenshots copied, skipping the dossier: put 1-board.png, 2-detail.png and 3-filtered.png in screenshots/ first\n",
  );
} else {
  writeFileSync(
    join(outDir, "dossier.json"),
    buildDossier(outDir, {
      text_max_bytes: TEXT_MAX_BYTES,
      screenshots: SCREENSHOT_CAPS,
      dashboard: DASHBOARD_CAPS,
    }),
  );
  dossierWritten = true;
}

const watchlistCovered = board.rows.filter((r) => r.watchlist).length;
const rank1 = board.rows[0]!;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.rows.length} rows scored (${watchlistCovered}/${snapshot.watchlist.length} watchlist covered)\n` +
    `token radar: rank 1 ${rank1.name} at $${rank1.impliedValueUsd.toLocaleString("en-US")} implied\n` +
    `token radar: ${detected.length} parent rows at x0.48: ${detected.map((d) => `${d.slug} (${d.parent})`).join(", ")}\n` +
    (missing.length > 0
      ? `token radar: parent slugs with no row: ${missing.join(", ")}\n`
      : "") +
    `token radar: wrote ${join(outDir, "board.json")}, ${join(outDir, "data.js")}, ${join(outDir, "dashboard")} (${dashboardFiles.length} files), ${join(outDir, "screenshots")} (${shots.length} images)` +
    (dossierWritten ? ` and ${join(outDir, "dossier.json")}\n` : "\n"),
);
