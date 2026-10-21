# Poker Board Analyzer

A static website for poker math. It deals a board and counts how many hole-card combos fall into each hand group.

## Running it

There's no build step. Open `index.html` in a browser, or serve the folder (for example `python3 -m http.server`). It also works on GitHub Pages.

## Features

- **Board dealing:** *New flop* deals 3 random cards and clears the turn and river. *New turn* / *New river* deal one card each. *Clear* on the turn removes the turn and the river (flop only). *Clear* on the river removes just the river (flop + turn).
- **Flop textures:** the *Suits* (monotone, two-tone, rainbow) and *Pairing* (unpaired, paired, trips) options control what *New flop* deals. Combinations that can't exist, such as a monotone paired flop, are greyed out.
- **Choosing specific cards:** click any card slot on the board to pick that card from a deck view. Cards already on the board are greyed out, and the picker also offers *Random card* and *Remove card*. You can also type a whole board (`As Kd 7c`, `askd7c2h` and `A♠ K♦ 7♣` all work; tens can be typed as `T` or `10`, so `Td` and `10d` are the same card) and press *Set*.
- **Combo counts:** every hole-card combo that doesn't collide with the board is classified: 1,176 on the flop, 1,128 on the turn, 1,081 on the river. Each group shows its combo count and its share of the total.
- **Highlighting:** tick any group to color it on the 13×13 hand grid, and pick its color with the swatch. Each cell fills from the bottom in proportion to how many of its live combos are in each highlighted group. Click a cell to list its combos and their groups. Your choices are saved in the browser.

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

If a combo is in more than one highlighted group, it takes the color of the first one in the list. Tick *Draws take priority* to put draws ahead of made hands.

## Project layout

- `index.html`, `css/styles.css`: the page
- `js/poker.js`: cards, hand evaluator, classifier, range analysis (no DOM; also loads in Node)
- `js/app.js`: UI
- `tests/`: unit tests, run with `npm test` (Node 18+)
