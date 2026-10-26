# Poker Board Analyzer

A static website for poker math. It deals a board and counts how many starting hands fall into each hand group, for **no-limit hold'em**, **pot-limit Omaha**, **PLO hi-lo (8 or better)**, **5-card PLO**, **Big O** (5-card PLO hi-lo), the draw games **2-7 single draw** and **2-7 triple draw**, and the stud games **seven-card stud**, **stud hi-lo (8 or better)** and **razz**. Pick the game with the tabs at the top.

## Running it

There's no build step. Open `index.html` in a browser, or serve the folder (for example `python3 -m http.server`). It also works on GitHub Pages.

## Features

- **Board dealing:** *New flop* deals 3 random cards and clears the turn and river. *New turn* / *New river* deal one card each. *Clear* on the turn removes the turn and the river (flop only). *Clear* on the river removes just the river (flop + turn).
- **Flop textures:** the *Suits* (monotone, two-tone, rainbow) and *Pairing* (unpaired, paired, trips) options control what *New flop* deals. Combinations that can't exist, such as a monotone paired flop, are greyed out.
- **Choosing specific cards:** click any card slot on the board to pick that card from a deck view. Cards already on the board are greyed out, and the picker also offers *Random card* and *Remove card*. You can also type a whole board (`As Kd 7c`, `askd7c2h` and `A♠ K♦ 7♣` all work; tens can be typed as `T` or `10`, so `Td` and `10d` are the same card) and press *Set*.
- **Combo counts:** every hole-card combo that doesn't collide with the board is classified: 1,176 on the flop, 1,128 on the turn, 1,081 on the river. Each group shows its combo count and its share of the total.
- **Highlighting:** tick any group to color it on the 13×13 hand grid, and pick its color with the swatch. Each cell fills from the bottom in proportion to how many of its live combos are in each highlighted group. Click a cell to list its combos and their groups. Your choices are saved in the browser.

## Games

- **No-limit hold'em:** 2 hole cards, and your best five cards can use any number of them. Shown on the 13×13 grid.
- **Pot-limit Omaha:** 4 hole cards, and every hand must use **exactly two** hole cards and three board cards. So a single suited card is never a flush draw, and four to a straight on the board plus one hole card isn't a straight. There are too many hands for a grid (211,876 on the flop), so you get:
  - a **distribution bar** of the highlighted groups
  - a **Check a hand** box (type 4 cards to see their groups, best high hand and low)
  - **example hands**: a random sample from any group
- **5-card PLO:** like PLO but with 5 hole cards, still using exactly two. There are about 1.9 million hands on the flop; counting them takes roughly half a second, and the page shows "Counting…" meanwhile.
- **Big O:** 5-card PLO played hi-lo, with the same low groups as PLO8.
- **PLO hi-lo (8 or better):** Omaha rules, plus a low group. A low uses five different cards 8 or lower (aces low), again with exactly two hole cards. The groups are *Nut low* (the best low possible on the board), *Any made low* and *Low draw* (the next card can make a low).

Omaha draws add **Wrap (9+ straight outs)**. *Open-ended* means 5–8 outs and *Gutshot* means 1–4. Outs are counted as unseen cards, so your own cards reduce them. Made-hand groups work like hold'em, applied to the best two-card pair from your four cards.

## 2-7 single draw and triple draw

Picking **2-7 SD** or **2-7 TD** swaps the board views for a **Draw** view (Tells and Math stay available). In 2-7 lowball the lowest hand wins, aces are high (A-2-3-4-5 is just ace-high), and straights and flushes count against you. The best hand is 7-5-4-3-2 of mixed suits.

- **Your hand:** type five cards or deal a random hand. It names the hand (e.g. *8-6 low*, *Pair of nines*), then ranks all 32 ways to draw by the chance of finishing with a 7, 8, 9 or 10 low or better. Tap cards to choose your own discards and compare with the best option.
  - Single draw is exact (every possible draw from the 47 unseen cards).
  - Triple draw is simulated (4,000 runs per option, all options facing the same shuffles). After the first draw it stands pat once it reaches the target, otherwise it keeps one card of each rank at or below the target.
- **Starting draws:** a chart of every 1-, 2- and 3-card draw from deuce to ten (e.g. *7-2 drawing three*) with its chances at each target. It's precomputed by `tools/build-draw-charts.js` (exact for single draw, 20,000 seeded runs for triple draw).
- **Strategy notes:** hand ranking, aces high, deuces and sevens, smoothness, straight danger, counting draws, snowing, plus single-draw and triple-draw specifics.

## Stud, stud 8 and razz

Picking **Stud**, **Stud 8** or **Razz** swaps the board views for a **Stud** view:

- **Your hand:** enter your cards (3 on third street, up to all 7) plus any dead cards you've seen. You get exact odds of how the hand finishes by seventh street, counting every way the remaining cards can come:
  - stud: each high hand or better
  - razz: each low or better
  - stud 8: qualifying lows plus the high chances

  Three-card starts are named (e.g. *Split pair of kings*, *Three to a straight flush*, *Three to a wheel*).
- **Equity:** 2–6 players with whatever cards you know for each (your hole cards, their up cards) plus dead cards. Missing cards are dealt so everyone ends with seven: exact when there aren't too many deals, otherwise simulated. Stud 8 splits high and low (no qualifying low means the high scoops) and shows scoop / high / low rates.
- **Starting hands:** every unpaired three-card start from ace to ten for razz and stud 8, and the main kinds of stud start (rolled up, pairs, three-flush, three-straight…). Exact, precomputed by `tools/build-stud-charts.js`.
- **Strategy notes:** the deal, live cards, reading boards, and notes for each game.

## Equity calculator

Switch to **Equity** (top right) to compare 2–6 players on the current board. Clear the board for preflop.

- **Hands:** type each player's hand (`As Kd`, or 4/5 cards for Omaha games), press *Random*, or leave it blank so that player gets a fresh random hand on every runout. Dealing board cards in this view never uses cards a player holds.
- **Ranges (hold'em):** type a range instead of a hand, mixing any of these forms:
  - pairs: `JJ+`, `22-55`
  - suited or offsuit: `ATo+`, `A7s+`, `A5s-A2s`, `KQo`
  - both suits: `AJ+`, `KQ`
  - connector runs: `T9s-65s`
  - exact combos: `AsKs`
  - `any`

  The line under the box shows the combo count, and how many are left after the board and other players' cards remove some. **Grid** opens a 13×13 picker (click or drag across hands, with quick-add buttons for pairs, suited aces, broadways and suited connectors) that writes the range back in short form. Every valid deal is equally likely: results are exact when small enough (often on the turn or river), otherwise simulated.
- **Exact or simulated:**
  - When every hand is known and the work is small enough, every possible runout is checked, for example hold'em preflop heads-up (1,712,304 runouts) or any flop or turn spot.
  - Otherwise (random hands, or Omaha preflop) it runs a Monte Carlo simulation for up to ~2.5 seconds and shows the margin of error.
- **Results:** equity (your average share of the pot) with win and tie rates. For PLO8 and Big O the pot splits between the best high and the best qualifying low (a high hand scoops when there's no low), and the results show scoop %, *wins high* and *wins low*.
- Results update by themselves when the board changes.

## Runout tree

Switch to **Runouts** to see how the next cards could change the board, with the exact chance of each.

- **Branches:** on a flop, each branch groups the turn cards that change the board the same way. Labels describe the board, e.g.:
  - flush: *Goes two-tone (new flush draw)* on a rainbow flop, *Second flush draw (2 of another suit)* on a two-tone flop, *Flush possible (3 of a suit)*, *Four-flush (4 of a suit)*
  - straight: *Straight now possible*, *Four to a straight (one-card straight)*
  - pairing: *Pairs the board*, *Second pair* / *Trips* / *Full house on board*
  - other: *Overcard (new high card)*, *Low now possible* (PLO8 / Big O), or *Blank (no change)*

  A card that does two things at once gets both labels joined with "+", so the branches always add up to 100%. Hover a label, or open **What the labels mean** under the tree, for a one-line explanation of each.
- **River level:** open a turn branch to see the river branches that follow it, with the chance given that turn and the overall chance.
- **Single-change totals:** the line at the top gives each change's total chance on its own (e.g. *Pairs the board 18.4%*).
- **Dealing from the tree:** click any card in a branch to deal it. On the turn, the tree shows the river cards.
- **Preflop:** with an empty board it shows how often each flop texture comes up (e.g. monotone 5.2%, paired 16.9%).

Chances are counted from the cards not on the board; players' hole cards aren't removed.

## Tells

Switch to **Tells** for a guide to live-poker body language. These are clues, not proof.

- **How to use tells:** baseline first, look for clusters, trust involuntary signals over acted ones, confirm at showdown, and use tells as a tiebreaker.
- **Freeze, flight, fight… or comfort:** what each stress response looks like at the table and what it usually suggests.
- **Baseline checklist:** what to watch while a player isn't in a hand.
- **Strength vs weakness:** each tell has what it looks like, why it works, when it misleads, and a 1–3 reliability rating. Filter by eyes, face, hands and chips, body, voice, or timing and acting.
- **Player notebook:** add players, write baseline notes, and log each tell when a showdown reveals whether they were strong or weak. After three or more sightings, a tell that matched the same way at least 75% of the time is marked reliable for that player. Saved in this browser only.

The guide draws on Mike Caro's *Book of Poker Tells*, Joe Navarro's *Read 'Em and Reap*, Zachary Elwood's *Reading Poker Tells*, and Slepian et al. (2013), who found arm movements revealed hand strength better than faces.

## Poker math

Switch to **Math** for notes, live calculators and charts:

- **Pot odds & break-even equity:**
  - calculator: pot and bet in; pot odds, equity needed to call, folds a bluff needs, and minimum defense frequency out
  - chart and table of what each bet size (25%–200% pot) asks of both players
  - exact outs-to-equity table (1–20 outs) next to the rule of 2 and 4
- **Stack-to-pot ratio:** SPR calculator with what each SPR range means for stacking off, plus typical SPRs for common 100bb cash-game spots.
- **Stack size in big blinds and M:** enter stack, blinds, ante (or big-blind ante) and players to get big blinds, M, effective M, and the matching Harrington zone and big-blind strategy band.
- **Geometric bet sizing:** the same-fraction-every-street sizing that gets stacks in by the river. Calculator gives the fraction and a street-by-street plan, with a chart and table by SPR.

## Flop runout cheat sheet (PDF)

[`docs/flop-runout-cheatsheet.pdf`](docs/flop-runout-cheatsheet.pdf) is a printable sheet (one section per page) of generic turn and river odds for each flop type, made for memorizing. It covers:

- **Flop frequencies:** how often each flop type comes.
- **Flush runouts:** rainbow, two-tone and monotone flops.
- **Pairing runouts:** unpaired, paired and trips flops.
- **Straight runouts:** grouped by how connected the flop is, plus a counting rule for two connecting cards.
- **Summary:** a one-line table per flop type, plus memory tips.

Every number is an exact count over all 22,100 flops (49 turn cards and 1,176 turn + river pairs each). Rebuild it with `node tools/build-runout-pdf.js` (needs Playwright with Chromium).

## Hand groups

**Made hands:** every combo is in exactly one of these. Straight flush, quads, full house, flush and straight come from the best 5-card hand. Weaker hands are judged only by what the hole cards add:

| Group | Meaning |
| --- | --- |
| Set | Pocket pair matching a board card |
| Trips | One hole card matching a paired board card |
| Two pair | Both hole cards pair different board cards |
| Overpair | Pocket pair above every board card |
| Top pair | A hole card pairs the highest board rank |
| Pocket pair below top card | Pocket pair below the highest board card |
| Middle pair | A hole card pairs the second-highest board rank |
| Weak pair | A hole card pairs a lower board rank |
| Ace high / No made hand | Nothing paired |

A board pair doesn't count toward your hand: on K‑K‑7, holding 7‑x is a *middle pair*, not "two pair".

**Draws:** a combo can have any number of these, and they only exist on the flop and turn. The hole cards must contribute to the draw.

| Group | Meaning |
| --- | --- |
| Flush draw / Nut flush draw | Four to a flush; "nut" means you hold the highest missing card of the suit |
| Open-ended / double gutshot | Two or more card ranks complete a straight (8 outs) |
| Gutshot | Exactly one card rank completes a straight |
| Combo draw | Flush draw plus a straight draw |
| Two overcards | Unpaired, with both hole cards above the board |
| Backdoor flush draw | Flop only: three to a flush |

If a hand is in more than one highlighted group, it takes the color of the first one in the list. *Color first* chooses which section (made hands, draws or lows) goes first.

## Project layout

- `index.html`, `css/styles.css`: the page
- `js/poker.js`: cards, hand evaluators, hold'em and Omaha classifiers, range analysis, equity calculator, runout tree (no DOM; also loads in Node)
- `js/tells.js`: tells guide content and the player notebook
- `js/mathnotes.js`: poker math notes, calculators and charts
- `js/lowball.js`: 2-7 lowball evaluator, drawing odds and simulation
- `js/drawcharts.js`: precomputed starting-draw odds (generated by `tools/build-draw-charts.js`)
- `js/drawgame.js`: the 2-7 Draw view
- `js/stud.js`: stud, stud 8 and razz evaluators, hand odds and equity
- `js/studcharts.js`: precomputed stud starting-hand odds (generated by `tools/build-stud-charts.js`)
- `js/studgame.js`: the Stud view
- `js/app.js`: UI
- `tools/`: scripts that build the precomputed charts and the runout PDF
- `docs/`: the flop runout cheat sheet (PDF and HTML)
- `tests/`: unit tests, run with `npm test` (Node 18+)

## Copyright and license

Copyright (c) 2026 NerdyGuy109. All rights reserved. No permission is granted to copy, modify, host or redistribute this project or any part of it without written permission. See [LICENSE](LICENSE).

## Hosting privately with Cloudflare

The site is plain static files (no build step), so it can be hosted on Cloudflare Pages and put behind Cloudflare Access so only invited people can open it. Cloudflare's menus change from time to time, so see [Cloudflare Pages](https://developers.cloudflare.com/pages/) and [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/) if a step looks different.

1. **Make the GitHub repository private** (Settings → General → Change visibility).
2. **Create the Pages project:** in the Cloudflare dashboard, open **Workers & Pages → Create → Pages → Connect to Git**, and pick this repository and the branch `claude/poker-hand-evaluator-etjd7k`.
   - **Framework preset:** None.
   - **Build command:** leave empty.
   - **Build output directory:** `/`.

   Deploy, and Cloudflare gives the site an address like `your-project.pages.dev`. It redeploys automatically on every push.
3. **Restrict access:** open **Zero Trust → Access → Applications → Add an application → Self-hosted**.
   - **Domain:** enter the `.pages.dev` address. Add `*.your-project.pages.dev` as well so preview deployments are protected too.
   - **Policy:** an **Allow** policy whose rule is **Emails** with the addresses you want to let in. For login, choose **One-time PIN**.
4. **Test the link in a private browser window:** it should ask for an email and send a code, and only listed emails should get in.

To add or remove people later, edit the email list in that Access policy.

