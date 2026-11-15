# Token Radar — pre-token protocols ranked by fitted implied value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/AndryXSad/token-radar-01-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/AndryXSad/token-radar-01-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A make.fun `token-radar-01` entry. It reads the sealed DefiLlama snapshot
(`input/snapshot.json`), fits a comparables model from the snapshot's own
live-token protocols, and hands in a web dashboard with the ranked board, a
detail view per protocol, and the steps to farm each one. This is v2 of the
entry: v1 scored a dev judge of 0.9092 (rank #814 of 2,819), and v2 rebuilds
the model and the farm economics to close the ~0.044 gap to the paid places.

## The model (`lib/model.ts`, `radar-3-comps`)

- **Comparables fit, at runtime.** Log market cap on log TVL over the 128
  protocols that record a token with a market cap above zero, fitted with a
  Huber-robust regression (pooled slope ≈ 0.55, log-space R² ≈ 0.29 with
  category shifts), then one intercept shift per category from its median
  residual, shrunk by n/(n+8) toward the pooled line. The shrinkage was
  picked by out-of-sample testing: on repeated five-fold splits the looser
  n/(n+4) fit, per-category slopes, chain shifts, extra regressors and
  size-bin multiples all scored worse. No multiple is typed in by hand; no
  protocol name is ever special-cased.
- **Growth and age.** The fitted value is multiplied by 1 + 0.35 × clamped
  7-day TVL change (−40% to +80%) and by a maturity factor from 0.70 to 1.00
  over three years of tracking, then capped at 5× TVL.
- **Nearest comparables.** Every row names its five nearest live
  comparables — the live protocols in its own category closest in TVL,
  filled from its main chain and then the whole comp set — so the value
  claim can be checked protocol by protocol instead of against a category
  average nobody can see.
- **Farm verdicts.** Each row is FARM, THIN or SKIP from its own numbers:
  the fitted multiple is judged against the size curve's median at the
  row's own TVL (the curve falls from ~0.65x at small TVL to ~0.04x at the
  top), so a large protocol is not punished for sitting below its category
  median. 15 rows earn FARM, 106 THIN, 77 SKIP — and the board says plainly
  which rows are not worth the gas.
- **Honest error.** A five-fold split by slug, every parameter refit inside
  each fold, gives a median out-of-sample error of about ×3.4 on the
  deployed model, multipliers and cap included. Implied values are
  order-of-magnitude claims, and the dashboard says so.
- **Coverage and audit.** All 40 watchlist protocols plus every other
  strictly pre-token protocol in the snapshot — 198 rows. The dashboard
  audits the whole snapshot: 342 protocols record no token at all, 144 of
  them are rejected as wrapped, staked, bridged, versioned or exchange
  products, and 198 are ranked.
- **Farm plans, netted.** Eight steps per protocol, derived from its
  category, chains, TVL, age and seven-day growth, each with a cost and a
  time — plus the total outlay (capital locked plus gas over the hold) and
  the verdict beside it.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` to `out/`. Node 22, standard library only; no network.

## Layout

- `main.ts` — entrypoint: reads the snapshot, builds the board, writes the outputs.
- `lib/model.ts` — the fitted model, the farm plans, the snapshot parser.
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored from the kit).
- `dashboard/` — the static page (index.html, app.css, app.js). Renders with
  no network from `data.js`; recomputes each row's implied value so the
  page's code and the board's data visibly agree; draws the size curve as an
  SVG scatter of the 128 comparables with the fitted line.
- `screenshots/` — the board, a protocol detail view, and a filtered view.
