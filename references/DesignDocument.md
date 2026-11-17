# Design Document

This document collects the decisions from interviews.

## 2026-10-29 - Browser card game (Yu-Gi-Oh style)

### Spec
**Goal:** A single-page browser card game, Yu-Gi-Oh style. You play a human-vs-AI duel with 20-card decks of monsters and traps. Monsters attack each other, and attacks drain points.

**Requirements**
1. Plain HTML, CSS and JS in one folder, with no build step and no dependencies. It opens by double-clicking `index.html`.
2. Each player has 8000 LP. Each deck is 20 random cards from a pool of about 10 monsters and 3 trap types, with duplicates allowed. Monsters have a name, base ATK and base DEF (500-3000) and emoji art. Traps have a name, an effect text and emoji art.
3. Each player starts with 5 cards in hand and draws 1 at the start of their turn. The first player skips the first draw. A player who cannot draw loses.
4. Each turn a player may summon at most 1 monster from hand. The player picks ATK or DEF position when summoning. The field holds at most 5 monsters. A monster can switch position once per turn. A monster cannot attack on the turn it is summoned.
5. Each monster in ATK position can attack once per turn. A target is a monster or, if the opponent's field is empty, the opponent's LP directly.
6. *(Superseded by 2026-10-29 - Combat, confirm and position changes, change 1: the drain and comparison now always use DEF.)* Combat: A = attacker's current ATK, T = target's current points (its ATK if in ATK position, its DEF if in DEF position). The attack drains A from T, with a floor of 0. The attacker never loses points.
   - Target in ATK position: A<T: target survives with T-A, attacker destroyed, attacker's player loses T-A LP. A=T: both destroyed, no LP loss. A>T: target destroyed, its player loses A-T LP.
   - Target in DEF position: A<T: target survives with T-A, attacker survives, attacker's player loses T-A LP. A=T: target survives at 0 DEF, no LP loss. A>T: target destroyed, no LP loss.
   - A drained target in ATK position at 0 or below is destroyed. A drained target in DEF position is destroyed only below 0.
7. At the end of each turn, all monsters on both fields that are in DEF position regain 2000 DEF, capped at base DEF. Monsters in ATK position do not regenerate.
8. Traps: 3 trap zones per player. A trap is set face-down (hidden from the opponent) and does not use up the turn's summon. Any number can be set per turn while zones are free. A trap can be activated from the next turn after it was set, at most one per turn, and is discarded after use. Types:
   - Block Attack: activates when the opponent declares an attack, cancels that attack.
   - Protect: activates when your monster is attacked, that monster cannot be destroyed, drained or cause LP loss in that battle, until end of turn.
   - Extra Summon: activates during your own turn, lets you summon one extra monster from hand that turn.
9. A player wins when the opponent's LP reaches 0 or the opponent cannot draw. The game shows the board, hand, LP, deck counts, a log and a restart button.
10. The AI summons its strongest card each turn and attacks only when A > T. It uses DEF position for weak cards. It sets traps whenever it has one and a free zone. It activates Block Attack against any attack that would hurt it, Protect when its monster would die, and Extra Summon whenever it has a spare monster in hand.

**Out of scope:** spells, deck building, online play, hot-seat mode, sound, other trap effects.

**Decisions and defaults chosen by the assistant:** only ATK-position monsters can attack; 5-monster field limit; one position switch per turn; no attacking on the summon turn; 3 trap types, about 4-6 traps per deck; traps activate only on a legal trigger and the human gets an activate/decline prompt; AI behaviour as in requirement 10.

**Acceptance criteria:** Node tests with hand-made cases for combat (all rows of the table, drain to exactly 0 in both positions), regeneration (DEF cap, no ATK regen), traps (block, protect, extra summon, 3-zone limit, no activation on the set turn), including a negative control. A many-game AI-vs-AI simulation checks that games end and that counts stay consistent. A browser load checks that the page renders without console errors.

**Open risks:** ATK in ATK position never regenerates, so ATK monsters weaken permanently. Possible stalemates or slow games, to be checked by simulation.

### Questions and answers
1. **Who plays the second player?**
   Options: Computer AI (Recommended); Hot-seat; Both modes
   Answer: Computer AI (Recommended)
2. **What are the win conditions and the stakes of an attack?**
   Options: Life points + drain overflow (Recommended); Monster destruction only; Life points, direct damage only when field is empty
   Answer: "The differnece between attackers ATK points and targets points (atk or def, depending on position) are subtracted from the target player if the target monster has less and is in atk position. If the attacker has less, the difference is subtracted from the attacker player. Only if the target is also in ATK position, the attacker is then destroyed. But if the target is weaker, its destroyed in both cases."
3. **Which points does an attack drain, and what is the relationship between the two monsters' points?**
   Options: Defender's current points, no counter (Recommended); Same, but attacker also loses ATK; Attacker's attack uses up its own ATK
   Answer: "Defensers current points, no counter. But the attacker player takes damage if his monster is weaker (the attacking monster never does)"
4. **Regeneration: +2000 at end of turn, up to what cap, and for whom?**
   Options: Cap at base value, both players' monsters each turn end (Recommended); Cap at base, all monsters regenerate at every turn end; No cap
   Answer: "Cap at base value, both player's monsters each turn end. But ONLY for monsters in Def position."
5. **Combat restatement: ties and drain handling.**
   Options: A>T: LP hit only if ATK pos (Recommended); Same, but drain never destroys on its own; A>T: LP hit in both positions
   Answer: A>T: LP hit only if ATK pos (Recommended)
6. **Regeneration conflict (both positions vs only DEF).**
   Options: Both positions regen their own stat (Recommended); Only DEF-position monsters regenerate
   Answer: Only DEF-position monsters regenerate
7. **Turn flow and starting state.**
   Options: Hand 5, draw 1 per turn, 8000 LP (Recommended); Hand 5, draw 1, summoned monsters can attack immediately; Let me specify
   Answer: Hand 5, draw 1 per turn, 8000 LP (Recommended)
8. **Cards and deck building.**
   Options: Fixed pool of ~10 monsters, random 20-card decks (Recommended); Same, but both start with the same fixed deck; Include a few spell/effect cards
   Answer: Fixed pool of ~10 monsters, random 20-card decks (Recommended)
9. **Spec confirmation (first)**: the user wanted to clarify. Free text: "Almost all is correct, but i want a change regarding the draining destruction: if a monster is in atk position and drained to 0, it dies. If its in def position and drained to 0, it survives. In def, it only dies if drained BELOW 0."
10. **Spec confirmation (second)**
    Options: Correct, go ahead; Correct, but don't implement yet; Needs changes
    Answer: Needs changes. Free text: "One last feature: I want a watered down version of trap cards. They work like in normal yugioh, and they have effects like "block an attack" or "protect a monster for that turn" or "summon an extra monster". Thats all."
11. **How do traps enter the game and the deck?**
    Options: Traps are part of the 20 cards (Recommended); 20 monsters plus a separate trap deck; Fixed mix, e.g. 15 monsters and 5 traps
    Answer: Traps are part of the 20 cards (Recommended)
12. **Trap setting and activation.**
    Options: Set face-down, max 3, activate from next turn (Recommended); Same, but can be activated the turn it is set; Max 5 trap zones
    Answer: Set face-down, max 3, activate from next turn (Recommended)
13. **Trap effects and triggers.**
    Options: Three traps with clear triggers (Recommended); Same, but Protect lasts the whole turn; I want to adjust the effects
    Answer: Three traps with clear triggers (Recommended)
14. **How should the AI use traps?**
    Options: Simple heuristics (Recommended); Random activation chance
    Answer: Simple heuristics (Recommended)
15. **Final spec confirmation.**
    Options: Correct, go ahead; Correct, but don't implement yet; Needs changes
    Answer: Correct, go ahead

### Implementation notes (assistant decisions, not asked)
- Guardian Shield (Protect): "cannot cause LP loss" is read as a full shield. The protected monster takes no drain, is not destroyed, its owner loses no LP, and the attacker takes no damage from that battle. It lasts for every attack on that monster until the end of the turn (Block Attack cancels only one attack).
- A blocked attack still uses up the attacker's attack for the turn.
- The human player is named "Player" in the log.
- Files: `game.js` (rules and AI, no DOM), `ui.js`, `index.html`, `style.css`, `test.js` (rules tests and an AI-vs-AI simulation, written for Node; run in headless Firefox because Node is not installed).

## 2026-10-29 - Combat, confirm and position changes

### Spec
1. **Attacks always drain DEF.** A is compared with the target's DEF in both positions (T = target DEF), and DEF is the stat that is drained. ATK is never drained. The position-dependent consequences stay as in the earlier table: target in ATK position: destroyed when DEF drops to 0 or below, its player loses A-T LP if A>T, the attacker is destroyed if A<=T, the attacker's player loses T-A LP if A<T. Target in DEF position: destroyed only when DEF drops below 0, no LP loss for its player, the attacker survives, the attacker's player loses T-A LP if A<T.
2. Every CPU action (summon, set trap, attack, ending its turn) is shown in the action bar and waits for the human to press **Confirm** (or Enter) before the next one happens. When the human has a usable trap, the trap prompt is shown first and the outcome then waits for Confirm.
3. A monster that attacked cannot change position for the rest of the turn.
4. A monster cannot change position on the turn it was summoned.
5. Regeneration is unchanged: only DEF-position monsters regain 2000 DEF, capped at base DEF.

**Acceptance:** rules tests for the new combat table (ATK target keeps its ATK, measured by DEF, negative control), the switch restrictions (with negative control), the AI simulation, and a browser run in which the CPU never acts without a Confirm.

### Questions and answers
1. **Change 1: what does the attack compare against, and when is the target destroyed?**
   Options: Compare as before, drain DEF only (Recommended); Compare as before, destroy only when DEF is drained; Compare A with the target's DEF always
   Answer: Compare A with the target's DEF always
2. **Should only DEF-position monsters regenerate now that DEF is always drained?**
   Options: Keep: only DEF-position monsters regenerate (Recommended); All monsters regenerate DEF
   Answer: Keep: only DEF-position monsters regenerate (Recommended)

### Implementation notes (assistant decisions, not asked)
- "All consequences follow the DEF comparison" was read as: only T changes. The ATK/DEF-position rules for LP loss and attacker destruction stay as before.
- The CPU AI retreats a non-attacking ATK monster (not summoned this turn) to DEF position when its DEF is below half its base, so it can regenerate. It never switches back.
- Changes 3 and 4 also apply to the CPU, so its retreat rule respects them.

## 2026-10-29 - Tributes and face-down defence

### Spec
1. **Tributes.** A monster with 2000 or more ATK (up to and including 3000) needs 1 tribute. A monster with more than 3000 ATK needs 2 tributes. Tributes are the player's own monsters on the field, in any position (face-up or face-down, attacked or not, summoned this turn or not). They are destroyed and go to the graveyard. A tribute summon uses the turn's summon (or an extra summon from Reinforcements). It works on a full field, since the tributes free space. The new monster cannot attack on the turn it is summoned.
2. **Pool.** Two new monsters are added: Void Wyrm (3200 ATK / 1800 DEF) and Sun Titan (3500 ATK / 2500 DEF), both needing 2 tributes. The existing monsters at 2000+ ATK (Cave Troll 2000, Dark Knight 2400, Thunder Drake 2800) need 1 tribute. The pool is 12 monsters and 3 trap types.
3. **Face-down DEF position.** A monster can be set face-down in DEF position instead of summoned face-up. Setting is a summon (uses the turn's summon, needs tributes if strong).
4. A face-down monster is flipped face-up in DEF position when it is attacked, or when its values (ATK, DEF) are read or changed. The engine has `reveal()` for future effects such as point-modifying traps, which must call it first.
5. The owner can flip a face-down monster face-up into ATK or face-up DEF. This counts as the once-per-turn position change, so it is not possible on the turn the monster was set or after another position change that turn. Face-up monsters can never be turned face-down.
6. A face-down monster is shown to the opponent as a card back. The owner sees its values with a FACE-DOWN tag. The log never names a face-down monster before it is revealed.
7. The CPU does not read face-down values. It guesses a DEF of 1500 for a face-down target and attacks only with more ATK than that. It sets monsters with DEF > ATK face-down. It tributes the weakest monsters only when the new monster's ATK+DEF is at least 1500 above the tributes' combined ATK+DEF.

**Acceptance:** rule tests for the tribute thresholds and counts, field-full tribute summons, refused invalid tributes (no state change), face-down set/flip/attack rules, log neutrality, CPU not reading face-down values, CPU tribute choice (with negative controls), and the AI simulation. A browser run covers tribute selection, setting face-down, flipping and attacking a face-down monster.

### Questions and answers
1. **No monster has more than 3000 ATK. How should the two-tribute rule be handled?**
   Options: Add 2 new strong monsters (Recommended); Add 1 new monster (3500 ATK); Don't change the pool
   Answer: Add 2 new strong monsters (Recommended)
2. **How does tributing work in detail?**
   Options: Uses the turn's summon; any own monster (Recommended); Same, but face-down monsters can't be tributed; Tribute is an extra action
   Answer: Uses the turn's summon; any own monster (Recommended)
3. **How is a face-down monster set and flipped by the player?**
   Options: Set = a summon; flip is a position change to ATK or face-up DEF (Recommended); Flip is free and does not count as the position change; Flip only by being attacked or read
   Answer: Set = a summon; flip is a position change to ATK or face-up DEF (Recommended)
4. **What do the players see, and how does the CPU deal with a face-down monster?**
   Options: Opponent sees a card back; CPU may not look at it (Recommended); CPU never attacks face-down monsters; CPU can see everything
   Answer: Opponent sees a card back; CPU may not look at it (Recommended)

### Implementation notes (assistant decisions, not asked)
- A face-down monster is flipped when the attack is declared on it, so it is flipped even if the attack is then cancelled by Block Attack.
- Summon modes are `'atk'`, `'def'` (face-up) and `'set'` (face-down). Tributes are passed as field indices. A refused summon changes nothing.
- The UI picks tributes by clicking your own monsters after choosing the summon button.
- With 12 monsters and 3 traps in the pool, a deck holds about 4 traps on average.
- The CPU always sets monsters it would put in DEF position face-down.

## 2026-10-29 - Battle phase

### Spec
1. A turn has a **main phase** and an optional **battle phase**. Every turn starts in the main phase. The player may enter the battle phase at any time during the main phase, or skip it and just end the turn.
2. Monsters can attack only in the battle phase, each monster at most once (the existing rules for who may attack still apply: ATK position, face-up, not summoned this turn).
3. Summoning, tributing, setting monsters or traps, position changes and flips, and activating Reinforcements are main phase actions. In the battle phase none of them is possible. Only attacks, the defender's response traps (Block Attack, Guardian Shield) and ending the turn are.
4. The battle phase is one-way: there is no second main phase and no way back. The turn ends after the battle phase (the player ends the turn when done attacking).
5. The CPU plays its main phase actions, then enters the battle phase only if some monster has an attack worth making, then attacks. Entering the battle phase is a separate CPU action that needs a Confirm. If the CPU has no worthwhile attack it skips the battle phase.
6. The UI shows the phase in the header. A "Battle Phase" button appears in the main phase. In the battle phase, selecting a monster offers only the attack buttons, and hand cards and traps cannot be selected.

**Acceptance:** rule tests (attack refused in the main phase and the monster is not used up, every main-phase action refused in the battle phase with no state change, entering the battle phase twice refused, turn can end from either phase, defender traps work in battle, CPU enters the battle phase only with a good attack, negative controls), the AI simulation, and a browser run.

### Questions and answers
1. **What happens after the battle phase?**
   Options: Turn ends after the battle phase (Recommended); Second main phase after battle
   Answer: Turn ends after the battle phase (Recommended)
2. **Which actions are allowed in the battle phase, and can it be skipped?**
   Options: Attacks and defensive traps only; skipping allowed (Recommended); Reinforcements may be activated in battle too; Must attack once battle phase is entered
   Answer: Attacks and defensive traps only; skipping allowed (Recommended)
3. **How should the CPU's battle phase appear?**
   Options: Confirm for entering the battle phase too (Recommended); No confirm for the phase change
   Answer: Confirm for entering the battle phase too (Recommended)

### Implementation notes (assistant decisions, not asked)
- The earlier rule "a monster that attacked cannot change position this turn" still exists in the engine, but it can no longer be reached in play, since attacks happen in the battle phase where position changes are not allowed.
- Leaving the battle phase early means ending the turn.
- The CPU's retreat to DEF position (low DEF, no worthwhile attack) happens in the main phase, before it decides to enter the battle phase.

## 2026-10-29 - Confirm button placement

### Spec
1. The CPU **Confirm** button is not in the action bar any more. It sits in its own box in the bottom-right corner of the screen (top of the screen on narrow layouts), where no other control ever appears, so it never shares a position with End turn or Battle Phase.
2. After the CPU's last confirm (it ends its turn and the human's turn starts), all clicks on the page are ignored for 0.8 seconds, so spam-clicking Confirm cannot trigger anything of the human's own turn.
3. Enter still confirms. While the CPU is playing, the action bar just shows "CPU is playing…".

### Questions and answers
No questions were asked. The request was a small, clear cosmetic change.

### Implementation notes (assistant decisions, not asked)
- The 0.8 s value is a guess at a comfortable length. It only applies after the CPU's turn ends, not between CPU actions, so Confirm itself can be spammed at full speed.
- On narrow screens the box at the top covers part of the CPU's board while it is shown.

## 2026-10-29 - Action bar alignment

### Spec
1. The action bar has two groups. The always-available turn buttons (Battle Phase, End turn) are right-aligned in a group of their own. Card-specific buttons (Summon, Set, Switch, Flip, Attack, Activate, Cancel) and the hint texts are on the left.
2. The right edge of End turn is the same in every state, and the card-specific buttons never move into the right-hand group.

### Questions and answers
No questions were asked. The request was a small, clear cosmetic change.

### Implementation notes (assistant decisions, not asked)
- Cancel counts as card-specific, so it sits on the left next to the hint text.
- The hint text no longer stretches to fill the bar, so the left buttons follow it directly.

## 2026-10-29 - Fewer tribute monsters, attack confirmation

### Spec
1. **Deck odds.** Decks are still 20 cards drawn at random from the pool, but no longer uniformly. Each card type has a weight: normal monster 12, one-tribute monster 4, two-tribute monster 2, trap 8 (`CONFIG.weights`). This gives on average about 13.6 normal monsters, 2.6 tribute monsters and 3.8 traps per deck (before: about 6.7 tribute monsters). Every card in the pool can still be drawn.
2. **Attack confirmation.** Every CPU attack on the human waits for the human before it goes through, even when the human has no usable trap. Without a usable trap, the wait is a Confirm in the corner box that says what attacks what ("CPU's X (ATK n) attacks your Y."), and the outcome is shown after it, with the usual second Confirm. With a usable trap, the existing trap dialog is shown (with "No trap" as the way to let the attack through). Attacks on the CPU resolve immediately.
3. In the engine this is `newGame(rng, names, { confirmAttacksOn: playerIndex })`: an attack on that player always becomes a pending attack, even with no usable trap. By default (tests, simulations) it is off.

### Questions and answers
No questions were asked. The weights and the exact confirm wording are my choices.

### Implementation notes (assistant decisions, not asked)
- The weights were chosen to keep about 4 traps per deck (as before) and bring tribute monsters down to about 13% of a deck. They are one config line to tune.
- The attack confirm shows only the declaration, not the predicted outcome, because the outcome is shown right after in the usual confirm. With a trap the dialog still shows the predicted outcome, since there a decision depends on it.
- So an attack costs two Confirms (the attack, then its outcome). The first one can be dropped easily if that is too many.

## 2026-10-29 - Confirm button moved to the CPU bar

### Spec
1. The CPU **Confirm** button sits at the right end of the bar with the CPU's life points and info. It is still away from every control of the human's own turn, so spam-clicking it stays safe, and the 0.8 s click lock after the CPU hands the turn back stays.
2. The description of what the CPU did is a bubble directly under that bar, at its right end. It takes no clicks and does not move the layout.
3. The old separate Confirm box in the corner of the screen is removed.

### Questions and answers
No questions were asked. The request was a small, clear cosmetic change.

### Implementation notes (assistant decisions, not asked)
- The player bars used to be a bar inside a bar (the container and the box inside it both had the `info` class), which made the CPU box shrink to its content. The outer class was removed, so both bars now have one border and span the full width.
- The bubble covers the CPU's trap row while it is shown.

## 2026-10-29 - LP bars reverted, Confirm stays in the CPU bar

### Spec
1. The bar layout is back to how it was before the Confirm move: each player bar is a full-width container with a smaller info box inside it (name, LP, deck and hand counts). The LP bars are short again.
2. The Confirm button stays at the right end of the CPU's full-width bar, outside the smaller info box, with the description bubble under it. This replaces the note in the previous section about removing the outer `info` class.

### Questions and answers
No questions were asked. The request was a small, clear cosmetic change.

### Implementation notes (assistant decisions, not asked)
- The Confirm button is now a sibling of the info box inside the outer bar (pushed to the right with `margin-left: auto`), instead of a part of the box.

## 2026-10-29 - No text under the Confirm button; everything in the log

### Spec
1. The description bubble under the Confirm button is removed. The Confirm button stays at the right end of the CPU bar.
2. Everything the CPU does is traceable in the log. The log lines of the CPU action that waits for Confirm are highlighted (gold bar at the left), so you can see what you are confirming.
3. For this, two things are now logged that were not before:
   - An attack is logged when it is declared (before any trap response or confirmation): "X (ATK n) attacks Y (POS position, DEF n)." / "attacks <player> directly." / "attacks a face-down monster." (the log still does not name a face-down monster before it is flipped). The resolution no longer repeats the attack line; it logs the outcome (drain, destruction, LP loss, "<player> takes n damage." for direct attacks).
   - "CPU ends its turn." is logged when the CPU has nothing left to do, before the human confirms the turn change.

### Questions and answers
No questions were asked. The request was a clear design change.

### Implementation notes (assistant decisions, not asked)
- The highlight (a CSS class on the current log lines) is an addition of mine so the log can replace the text under the button.
- On narrow screens the log is below the board, so you may have to scroll to see it while confirming.

## 2026-10-29 - Reinforcement-learning CPU

### Spec
**Goal:** Train a reinforcement-learning model that plays the card game better than the current heuristic CPU, learning mainly from whether it won. It becomes a selectable "Trained CPU" opponent in the browser.

**Requirements**
1. **Python rules port.** `ai/engine.py` re-implements the rules of `game.js`: the card pool and deck odds, summons and tributes, face-down monsters, the main and battle phases, the three traps, regeneration, and the win conditions.
2. **Rules parity test.** `game.js` runs in headless Firefox and records seeded games, including the decks, with random legal actions. Python replays the same actions and the test compares the full game state after every action. About 200 games must match exactly, and a deliberately broken port must fail the test.
3. **Heuristic port.** The heuristic CPU (`aiStep` and `aiRespond`) is ported to Python as the baseline opponent and measuring stick. It is parity-tested against the JS version: the same states must give the same decisions.
4. **Action space.** The model takes one decision at a time, with illegal moves masked out. The decisions are: summon (hand card and mode: ATK, DEF or face-down), with tributes chosen one by one; set trap; switch or flip a monster; activate Reinforcements; enter the battle phase; attack (attacker plus target or direct); end turn; trap response (Block Attack, Guardian Shield or none).
5. **Observation, fair information only.** The model sees its own full state and the opponent's public state: face-up monsters, the count of face-down monsters and set traps, hand and deck sizes, and LP. It never sees the opponent's hand, face-down values or deck order. The state also covers phase, summons left, ready traps and any pending attack.
6. **Training.** PPO with action masking and a small MLP, using parallel self-play on 12 cores and the RTX 2070. Opponents are its own earlier checkpoints plus the heuristic CPU, and it trains in both seats. Reward is +1 for a win and -1 for a loss, with no shaping. A game that reaches the turn cap is a draw (0).
7. **Run budget.** Training runs in the background for about 30 minutes, with regular checkpoints, a JSONL log, and a periodic evaluation against the heuristic.
8. **Export and browser inference.** Weights are exported to `ai/model.json`, and `ai.js` runs the forward pass and the same observation encoding in the browser. A parity test requires the same logits (within 1e-4) and the same chosen action as Python on the same states.
9. **UI.** A selector in the header offers "Simple CPU" and "Trained CPU", applied at the next new game. The Trained CPU plays greedily, one decision per CPU step, through the existing Confirm flow, the attack confirmation and the trap dialog, and can never make an illegal move.
10. **Engine additions.** `game.js` gets a `legalActions(state)` helper and a state snapshot function for the parity tests. The rules themselves don't change.
11. **Python environment (clarified by the user).** All Python packages for this work (PyTorch with CUDA, numpy, test tooling) are installed into a new `.venv` inside the project directory. The existing environments found on the machine (`coai`, `hgc`, etc.) are not used.

**Out of scope:** any rule changes, recurrent or transformer models, training in the browser, difficulty levels, learning from human games, and any remote service.

**Decisions and defaults (mine unless stated)**
- User choices: the Python port; self-play mixed with the heuristic CPU; the model making all decisions; a selectable Trained CPU; win/loss reward only; a 65% win target against the heuristic; a 30-minute training run; a new project-local `.venv`.
- PPO with a 2x256 MLP; code in `ai/` (`engine.py`, `heuristic.py`, `train.py`, export, tests); greedy action choice at runtime; a turn cap of about 120 turns; the Trained CPU is the default opponent only if the 65% target is met, otherwise the Simple CPU stays default.
- The 30 minutes covers training only, not the port, the parity tests or the evaluation.

**Acceptance criteria:** all existing rules tests still pass, and the rules parity test passes with its negative control. Heuristic parity and model-inference parity pass. A final evaluation of 1000 games against the heuristic CPU, 500 per seat with fixed seeds, reports the win rate with a 95% confidence interval. Against a random-legal-move player the model should win more than 90% as a sanity check. In headless Firefox the Trained CPU plays full games with no illegal moves, hangs or JS errors, and the page works with the selector. Report honestly whether 65% was reached and, if not, the best result and what limited it.

**Open risks:** 30 minutes may not reach 65%; sparse win/loss reward over about 25-turn games is a hard signal. Any later rule change means updating the Python port, passing the parity test again and retraining. The heuristic's face-down guess (DEF 1500) may be easy to exploit without making it a strong player.

### Questions and answers
1. **How should training get access to the game rules?**
   Options: Python port of the engine, parity-tested (Recommended); Train in JavaScript only (single rules code); You install Node.js, then drive the JS engine from Python
   Answer: Python port of the engine, parity-tested (Recommended)
2. **Who does the model train against?**
   Options: Self-play, plus the old heuristic CPU as a mix (Recommended); Only against the heuristic CPU; Pure self-play
   Answer: Self-play, plus the old heuristic CPU as a mix (Recommended)
3. **Which CPU decisions should the model make?**
   Options: All of them (Recommended); Only the main strategic ones; Only attack and trap decisions
   Answer: All of them (Recommended)
4. **How does the trained model show up in the game?**
   Options: Selectable: Simple CPU or Trained CPU (Recommended); Replace the heuristic CPU; Training only for now
   Answer: Selectable: Simple CPU or Trained CPU (Recommended)
5. **Reward: should win/loss be the only criterion?**
   Options: Win/loss only: +1 win, -1 loss (Recommended); Win/loss plus small shaping that fades out; Win/loss plus a small step penalty
   Answer: Win/loss only: +1 win, -1 loss (Recommended)
6. **What counts as 'trained well enough' to stop and report?**
   Options: Beats the heuristic CPU at 65%+ over 1000 games (Recommended); Beats the heuristic CPU at 80%+; Just clearly better than 50%
   Answer: Beats the heuristic CPU at 65%+ over 1000 games (Recommended)
7. **How much time may training take on this machine?**
   Options: About 2 hours of training, in the background (Recommended); About 30 minutes (a quick first model); Overnight, 6+ hours
   Answer: About 30 minutes (a quick first model)
8. **Is the spec correct and complete?** (first attempt)
   Options: Correct, go ahead; Correct, but don't implement yet; Needs changes
   Answer: The user wanted to clarify. Free text: "All correct, but I want to clarify that i want you to install the necessary packages into a new .venv environment, saved in the project directory. Dont use the other envs you found, like coai etc." Treated as "Correct, go ahead" with this clarification added as requirement 11.

### Implementation notes and results (Reinforcement-learning CPU)
- Code in `ai/`: `engine.py` (Python port of the rules), `heuristic.py` (port of the Simple CPU), `space.py` (107 actions, 252-value observation, masks; tribute choice is a sub-selection step), `env.py`/`vec.py` (self-play environment, 24 spawn workers), `train.py` (PPO, masked, tanh MLP 252-256-256), `export.py`, `final_eval.py`, `tests/`. Browser side: `ai.js` (same encoding and forward pass) and `ai/model.js` (+ `ai/model.json`, same weights; the .js form loads from file://). `game.js` got `legalActions`, `applyAction`, `snapshot`, and the heuristic was split into a pure `aiPlan` (behaviour unchanged, same simulation statistics).
- Hand is capped at 12 slots for the action space (`MAX_HAND_SLOTS`). Packages live in the project's own `.venv` (torch with CUDA, numpy, selenium); no other environment was used.
- Training: one 30-minute run (`ai/runs/run1`, 7608 updates, 23.4M decisions). The CPU was only ~35% busy because the single main process (rollout inference) is the bottleneck; the GPU only does the updates. The final network (`last.pt`, equal to the best checkpoint) is the one exported.
- Verification: rules parity 200 games, 0 differ (3 negative controls detected); model parity: max logit difference 2e-14 over 1545 decisions, identical greedy action (negative control detected); 636 JS tests pass; Trained CPU played full games through the UI in headless Firefox (3 games, wins by the CPU, no JS errors), used its trap when attacked, and the trap dialog/Confirm flow works with it as attacker; the selector switches between `TrainedAI.step` and `Game.aiStep` (verified with call counters).
- Final evaluation (1000 games each, 500 per seat, fixed seeds 20,000,000+, not used in training): vs Simple CPU 910 wins / 90 losses (91.0%, 95% CI 89.1-92.6%), target 65% met; vs random legal player 998/1000 (99.8%).
- Because the 65% target was met, "Trained CPU" is the default selection; the choice is applied when a new game starts.
- Question: the model file path. Decision: `ai/model.js` is referenced from `index.html` (a `<script>` so it works when the page is opened from disk).
