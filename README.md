# Dragon Cube

A Belgian-style skill dice game for the web browser.

## Play

Play online: https://randyvie.github.io/DragonCube/

Or run it locally:



```bash
python3 -m http.server 8765 --directory game
```

Then go to http://localhost:8765.

## How it works

- Pay a stake and receive 12 columns of 3 dice. Choose which of the 4 fields each column goes into.
- 3 equal dice on a row or diagonal is a winning line. Reach 100 points to win a prize from the ladder.
- Every die face (1–7 stars) in a winning line is collected. Collect all 7 to summon the dragon, who grants a wish: 10 free games, Dragon's Treasure (take it or not) or Dragon Wilds.
- The round arrow button runs autoplay (10, 25, 50, 100 or unlimited games).

## Files

- `game/rules.js` – game rules, shared by the game and the simulator
- `game/game.js`, `game/style.css`, `game/index.html` – the browser game
- `game/simulate.js` – balance check: `node game/simulate.js` (target RTP about 93%)

The yellow "TEST · Summon dragon (D)" button is temporary, for testing the bonus.
