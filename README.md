# Poker Board Analyzer

A static website for poker math. It deals a board and counts how many starting hands fall into each hand group, for **no-limit hold'em**, **pot-limit Omaha**, **PLO hi-lo (8 or better)**, **5-card PLO** and **Big O** (5-card PLO hi-lo). Pick the game with the tabs at the top.

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

## Equity calculator

Switch to **Equity** (top right) to compare 2–6 players on the current board. Clear the board for preflop.

- **Hands:** type each player's hand (`As Kd`, or 4/5 cards for Omaha games), press *Random*, or leave it blank so that player gets a fresh random hand on every runout. Dealing board cards in this view never uses cards a player holds.
- **Exact or simulated:**
  - When every hand is known and the work is small enough, every possible runout is checked, for example hold'em preflop heads-up (1,712,304 runouts) or any flop or turn spot.
  - Otherwise (random hands, or Omaha preflop) it runs a Monte Carlo simulation for up to ~2.5 seconds and shows the margin of error.
- **Results:** equity (your average share of the pot) with win and tie rates. For PLO8 and Big O the pot splits between the best high and the best qualifying low (a high hand scoops when there's no low), and the results show scoop %, *wins high* and *wins low*.
- Results update by themselves when the board changes.

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
- `js/poker.js`: cards, hand evaluators, hold'em and Omaha classifiers, range analysis, equity calculator (no DOM; also loads in Node)
- `js/app.js`: UI
- `tests/`: unit tests, run with `npm test` (Node 18+)
