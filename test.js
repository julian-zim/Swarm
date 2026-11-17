// Run with: node test.js
const G = require('./game.js');
let passed = 0;
let failed = 0;

function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else {
    failed++;
    console.log(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Fresh game at turn 2 (player 1 = CPU is the active one is not needed: we use player 0 as attacker at turn 3).
function setup() {
  const s = G.newGame(G.mulberry32(1));
  s.players.forEach((p) => {
    p.hand = [];
    p.field = [];
    p.traps = [];
  });
  s.turnNo = 5; // far past any setTurn / summon turn used below
  s.turn = 0;
  return s;
}
// Attacks are only possible in the battle phase, so most tests enter it first.
function atk(s, ...a) {
  if (s.phase === 'main') G.enterBattle(s);
  return G.declareAttack(s, ...a);
}
let nid = 1000;
function mon(atk, def, pos, extra = {}) {
  return { id: nid++, name: `M${atk}/${def}`, emoji: 'x', baseAtk: atk, baseDef: def, atk, def, pos, summonedTurn: 1, attacked: false, switched: false, protected: false, ...extra };
}
function trap(kind, setTurn = 1) {
  return { id: nid++, type: 'trap', trap: kind, name: kind, emoji: 'x', text: '', setTurn };
}

// Battle table. Attacker A=1500 against a target with T DEF in the given position (an ATK-position target has ATK 700).
function battle(A, T, pos) {
  const s = setup();
  s.players[0].field = [mon(A, 100, 'atk')];
  s.players[1].field = [pos === 'atk' ? mon(700, T, 'atk') : mon(100, T, 'def')];
  const r = atk(s, 0, 0);
  const tgt = s.players[1].field[0];
  return {
    r,
    tAlive: !!tgt,
    tPts: tgt ? tgt.def : null,
    tAtk: tgt ? tgt.atk : null,
    aAlive: s.players[0].field.length === 1,
    lp0: s.players[0].lp,
    lp1: s.players[1].lp,
  };
}
const LP = 8000;
let b;
b = battle(1500, 1000, 'atk');
eq([b.tAlive, b.aAlive, b.lp1, b.lp0], [false, true, LP - 500, LP], 'ATK target, A>T: destroyed, LP hit A-T');
b = battle(1500, 2000, 'atk');
eq([b.tAlive, b.tPts, b.aAlive, b.lp1, b.lp0], [true, 500, false, LP, LP - 500], 'ATK target, A<T: target drained, attacker destroyed, attacker LP hit');
b = battle(1500, 1500, 'atk');
eq([b.tAlive, b.aAlive, b.lp1, b.lp0], [false, false, LP, LP], 'ATK target, A=T: both destroyed, no LP loss');
b = battle(1500, 1000, 'def');
eq([b.tAlive, b.aAlive, b.lp1, b.lp0], [false, true, LP, LP], 'DEF target, A>T: destroyed, no LP loss');
b = battle(1500, 2000, 'def');
eq([b.tAlive, b.tPts, b.aAlive, b.lp1, b.lp0], [true, 500, true, LP, LP - 500], 'DEF target, A<T: drained, attacker survives, attacker LP hit');
b = battle(1500, 1500, 'def');
eq([b.tAlive, b.tPts, b.aAlive, b.lp1, b.lp0], [true, 0, true, LP, LP], 'DEF target drained to exactly 0 survives');
b = battle(1501, 1500, 'atk');
eq(b.tAlive, false, 'ATK target drained to near 0 is destroyed');
b = battle(1500, 1499, 'def');
eq([b.tAlive], [false], 'DEF target drained below 0 dies');

// Attacks always drain DEF and never ATK, in both positions
b = battle(1500, 2000, 'atk');
eq([b.tAtk, b.tPts], [700, 500], 'ATK-position target keeps its ATK, DEF is drained');
b = battle(1500, 2000, 'def');
eq([b.tAtk, b.tPts], [100, 500], 'DEF-position target: DEF is drained, ATK untouched');
b = battle(2500, 2000, 'atk');
eq(b.tAlive, false, 'ATK-position target is measured by its DEF (2500 > 2000), not its ATK (700)');
b = battle(1000, 800, 'atk');
eq([b.tAlive, b.lp1], [false, LP - 200], 'LP overflow is A minus the target DEF');
// negative control: comparing with ATK (700) instead of DEF (2000) would have destroyed this target
b = battle(1000, 2000, 'atk');
eq(b.tAlive, true, 'negative control: A=1000 beats its ATK 700 but not its DEF 2000, so it survives');

// Direct attack rules
{
  const s = setup();
  s.players[0].field = [mon(1200, 100, 'atk')];
  eq(atk(s, 0, null).ok, true, 'direct attack on empty field');
  eq(s.players[1].lp, LP - 1200, 'direct attack damage');
  const s2 = setup();
  s2.players[0].field = [mon(1200, 100, 'atk')];
  s2.players[1].field = [mon(100, 100, 'def')];
  eq(atk(s2, 0, null).ok, false, 'direct attack with monsters present is refused');
}

// Attack legality
{
  const s = setup();
  s.players[0].field = [mon(1500, 100, 'def')];
  eq(atk(s, 0, null).ok, false, 'DEF monster cannot attack');
  const s2 = setup();
  s2.players[0].field = [mon(1500, 100, 'atk', { summonedTurn: 5 })];
  eq(atk(s2, 0, null).ok, false, 'no attack on summon turn');
  const s3 = setup();
  s3.players[0].field = [mon(1500, 100, 'atk')];
  eq([atk(s3, 0, null).ok, atk(s3, 0, null).ok], [true, false], 'one attack per turn per monster');
}

// Win by LP
{
  const s = setup();
  s.players[1].lp = 1000;
  s.players[0].field = [mon(1200, 100, 'atk')];
  atk(s, 0, null);
  eq([s.players[1].lp, s.winner], [0, 0], 'LP 0 ends the game with the right winner');
}

// Summon / set / switch limits
{
  const s = setup();
  s.summonsLeft = 1;
  s.players[0].hand = [{ ...G.MONSTERS[0], id: 1 }, { ...G.MONSTERS[1], id: 2 }, ...Array(4).fill(0).map((_, i) => ({ ...G.TRAPS[0], id: 10 + i }))];
  eq(G.summon(s, 0, 'atk').ok, true, 'first summon ok');
  eq(G.summon(s, 0, 'atk').ok, false, 'second summon refused');
  eq([1, 2, 3].map(() => G.setTrap(s, 1).ok), [true, true, true], 'three traps can be set (summon not consumed)');
  eq(G.setTrap(s, 1).ok, false, 'fourth trap refused (3 zones)');
  eq(G.switchPos(s, 0).ok, false, 'cannot switch the turn the monster was summoned');
}
{
  const s = setup();
  s.players[0].field = [mon(1500, 1000, 'atk'), mon(1500, 1000, 'atk', { attacked: true }), mon(1500, 1000, 'atk', { summonedTurn: 5 })];
  eq([G.switchPos(s, 0).ok, G.switchPos(s, 0).ok], [true, false], 'one position switch per turn');
  eq(G.switchPos(s, 1).ok, false, 'a monster that attacked cannot switch position');
  eq(G.switchPos(s, 2).ok, false, 'summoned this turn: cannot switch (monster 3)');
  const s2 = setup(); // negative control: an old monster that did not attack can switch
  s2.players[0].field = [mon(1500, 1000, 'atk')];
  eq(G.switchPos(s2, 0).ok, true, 'negative control: older, non-attacking monster can switch');
  const s3 = setup(); // switching first, then attacking from DEF is impossible, switching back is not allowed either
  s3.players[0].field = [mon(1500, 1000, 'def')];
  G.switchPos(s3, 0);
  eq(atk(s3, 0, null).ok, true, 'after switching to ATK the monster can attack');
}

// Regeneration: only DEF-position monsters, capped at base, both sides
{
  const s = setup();
  s.players[0].field = [mon(1500, 3000, 'def', { def: 500 }), mon(1500, 3000, 'atk', { atk: 100 })];
  s.players[1].field = [mon(1500, 3000, 'def', { def: 2000 }), mon(1500, 3000, 'def', { def: 2999 })];
  G.endTurn(s);
  eq(s.players[0].field.map((m) => [m.atk, m.def]), [[1500, 2500], [100, 3000]], 'DEF +2000, ATK-position monster does not regen');
  eq(s.players[1].field.map((m) => m.def), [3000, 3000], 'opponent DEF monsters regen too, capped at base');
  // negative control: a monster in ATK position must NOT regain ATK
  eq(s.players[0].field[1].atk === 2100, false, 'negative control: ATK would be 2100 if wrongly regenerated');
}

// Traps
{
  const s = setup();
  s.players[0].field = [mon(1500, 100, 'atk')];
  s.players[1].field = [mon(1000, 100, 'atk')];
  s.players[1].traps = [trap('block')];
  const r = atk(s, 0, 0);
  eq([r.pending, s.pending.options], [true, [0]], 'defender with ready block trap gets to respond');
  eq(atk(s, 0, 0).ok, false, 'no actions while an attack is pending');
  G.respondAttack(s, 0);
  eq([s.players[1].field.length, s.players[1].lp, s.players[0].field.length, s.players[1].traps.length], [1, LP, 1, 0], 'Block cancels the attack and the trap is spent');
  eq(s.players[0].field[0].attacked, true, 'a blocked attack still uses up the attacker');
}
{
  const s = setup(); // negative control: declining resolves the battle normally
  s.players[0].field = [mon(1500, 100, 'atk')];
  s.players[1].field = [mon(1000, 100, 'atk')];
  s.players[1].traps = [trap('block')];
  atk(s, 0, 0);
  G.respondAttack(s, null);
  eq([s.players[1].field.length, s.players[1].lp, s.players[1].traps.length], [0, LP - 1400, 1], 'declined trap: battle resolves, trap stays');
}
{
  const s = setup();
  s.players[0].field = [mon(1500, 100, 'atk'), mon(1800, 100, 'atk')];
  s.players[1].field = [mon(1000, 100, 'atk')];
  s.players[1].traps = [trap('protect')];
  atk(s, 0, 0);
  G.respondAttack(s, 0);
  const t = s.players[1].field[0];
  eq([s.players[1].field.length, t.def, s.players[1].lp, s.players[0].lp, s.players[0].field.length], [1, 100, LP, LP, 2], 'Protect: no drain, no destruction, no LP loss');
  atk(s, 1, 0);
  eq([s.players[1].field.length, s.players[1].field[0].def, s.players[1].lp], [1, 100, LP], 'Protect lasts for the whole turn');
  G.endTurn(s);
  eq(s.players[1].field[0].protected, false, 'Protect ends with the turn');
}
{
  const s = setup();
  s.players[0].field = [mon(1500, 100, 'atk')];
  s.players[1].traps = [trap('protect')];
  eq(atk(s, 0, null).pending, false, 'Protect is not offered against a direct attack');
}
{
  const s = setup();
  s.players[0].field = [mon(1500, 100, 'atk')];
  s.players[1].field = [mon(1000, 100, 'atk')];
  s.players[1].traps = [trap('block', 5)]; // set this very turn number
  eq(atk(s, 0, 0).pending, false, 'trap cannot be activated on the turn it was set');
}
{
  const s = setup();
  s.players[0].field = [mon(1500, 100, 'atk'), mon(1500, 100, 'atk')];
  s.players[1].field = [mon(1000, 100, 'atk'), mon(1000, 100, 'atk')];
  s.players[1].traps = [trap('block'), trap('block')];
  atk(s, 0, 0);
  G.respondAttack(s, 0);
  eq(atk(s, 1, 1).pending, false, 'only one trap activation per turn');
}
{
  const s = setup();
  s.summonsLeft = 1;
  s.players[0].hand = [{ ...G.MONSTERS[0], id: 1 }, { ...G.MONSTERS[1], id: 2 }];
  s.players[0].traps = [trap('extra')];
  G.summon(s, 0, 'atk');
  eq(G.summon(s, 0, 'atk').ok, false, 'second summon refused before Reinforcements');
  eq(G.activateExtraSummon(s, 0).ok, true, 'Reinforcements activates on own turn');
  eq(G.summon(s, 0, 'def').ok, true, 'extra summon works');
  eq(G.summon(s, 0, 'def').ok, false, 'only one extra summon');
}

// Runs AI steps until an attack happens or the AI is done.
function aiUntilAttack(s) {
  for (let i = 0; i < 20; i++) {
    const r = G.aiStep(s);
    if (r.attack || r.done) return r;
  }
  return null;
}

// Battle phase
{
  const s = setup();
  s.players[0].field = [mon(1500, 100, 'atk')];
  s.players[0].hand = [{ ...G.MONSTERS[0], id: 1 }, { ...G.TRAPS[0], id: 2 }, { ...G.TRAPS[2], id: 3 }];
  s.players[0].traps = [trap('extra')];
  s.summonsLeft = 1;
  eq(s.phase, 'main', 'a turn starts in the main phase');
  eq(G.declareAttack(s, 0, null).ok, false, 'attacking in the main phase is refused');
  eq(s.players[0].field[0].attacked, false, 'a refused attack does not use up the monster');
  eq(G.enterBattle(s).ok, true, 'entering the battle phase works');
  eq(s.phase, 'battle', 'phase is battle');
  eq(G.enterBattle(s).ok, false, 'the battle phase cannot be entered twice');
  const before = JSON.stringify([s.players[0].hand.length, s.players[0].field.length, s.players[0].traps.length, s.summonsLeft]);
  eq(G.summon(s, 0, 'atk').ok, false, 'no summon in the battle phase');
  eq(G.setTrap(s, 1).ok, false, 'no trap setting in the battle phase');
  eq(G.switchPos(s, 0).ok, false, 'no position change in the battle phase');
  eq(G.activateExtraSummon(s, 0).ok, false, 'Reinforcements cannot be activated in the battle phase');
  eq(JSON.stringify([s.players[0].hand.length, s.players[0].field.length, s.players[0].traps.length, s.summonsLeft]), before, 'refused actions change nothing');
  eq(G.declareAttack(s, 0, null).ok, true, 'attacking works in the battle phase');
  eq(G.endTurn(s).ok, true, 'ending the turn from the battle phase works');
  eq([s.phase, s.turn], ['main', 1], 'the next turn starts in the main phase');
}
{
  const s = setup(); // flip is a main phase action too
  s.players[0].field = [mon(800, 900, 'def', { faceDown: true })];
  G.enterBattle(s);
  eq(G.flipUp(s, 0, 'atk').ok, false, 'no flip in the battle phase');
}
{
  const s = setup(); // negative control: the same actions work in the main phase
  s.players[0].hand = [{ ...G.MONSTERS[0], id: 1 }];
  s.summonsLeft = 1;
  eq(G.summon(s, 0, 'atk').ok, true, 'negative control: summon works in the main phase');
}
{
  const s = setup(); // the defender's traps still work in the battle phase, and the battle phase can be skipped
  s.players[0].field = [mon(1500, 100, 'atk')];
  s.players[1].field = [mon(1000, 100, 'atk')];
  s.players[1].traps = [trap('block')];
  G.enterBattle(s);
  eq(G.declareAttack(s, 0, 0).pending, true, 'defender can respond with a trap during the battle phase');
  const s2 = setup();
  eq(G.endTurn(s2).ok, true, 'the battle phase can be skipped');
}
{
  // CPU: enters the battle phase only when it has a worthwhile attack
  const s = setup();
  s.turn = 1;
  s.summonsLeft = 0;
  s.players[1].hand = [];
  s.players[1].field = [mon(2000, 100, 'atk')];
  s.players[0].field = [mon(100, 500, 'def')];
  const r = aiUntilAttack(s);
  eq([s.phase, !!(r && r.attack && r.attack.ok), s.log.filter((l) => l.includes('enters the battle phase')).length], ['battle', true, 1], 'CPU enters the battle phase and attacks');
  const s2 = setup(); // negative control: nothing worth attacking, so no battle phase
  s2.turn = 1;
  s2.summonsLeft = 0;
  s2.players[1].hand = [];
  s2.players[1].field = [mon(500, 100, 'atk')];
  s2.players[0].field = [mon(100, 3000, 'def')];
  const r2 = aiUntilAttack(s2);
  eq([s2.phase, r2 && r2.done, s2.log.some((l) => l.includes('battle phase'))], ['main', true, false], 'CPU skips the battle phase when it has no good attack');
}

// Deck composition: tribute monsters are rare, and every card type is still reachable
{
  const isTribute = (c) => c.type === 'monster' && G.tributesNeeded(c) > 0;
  const stats = (draw) => {
    const rng = G.mulberry32(99);
    let trib = 0;
    let traps = 0;
    let normal = 0;
    const seen = new Set();
    const decks = 2000;
    for (let d = 0; d < decks; d++) {
      for (let i = 0; i < G.CONFIG.deckSize; i++) {
        const c = draw(rng);
        seen.add(c.name);
        if (c.type === 'trap') traps++;
        else if (isTribute(c)) trib++;
        else normal++;
      }
    }
    return { trib: trib / decks, traps: traps / decks, normal: normal / decks, seen: seen.size };
  };
  const real = stats((rng) => {
    const s = G.newGame(() => rng());
    return s.players[0].deck.length ? s.players[0].deck[0] : null;
  });
  console.log(`deck composition (avg per 20-card deck): normal monsters ${real.normal.toFixed(1)}, tribute monsters ${real.trib.toFixed(1)}, traps ${real.traps.toFixed(1)}`);
  eq(real.trib >= 1.5 && real.trib <= 3.2, true, `average tribute monsters per deck is low (${real.trib.toFixed(2)})`);
  eq(real.traps >= 3.4 && real.traps <= 4.6, true, `average traps per deck stays about 4 (${real.traps.toFixed(2)})`);
  eq(real.normal >= 12, true, `most of the deck is directly playable (${real.normal.toFixed(1)} normal monsters)`);
  eq(real.seen, G.POOL.length, 'every card in the pool can still be drawn');
  // negative control: a uniform draw over the pool gives far more tribute monsters
  const uniform = stats((rng) => G.POOL[Math.floor(rng() * G.POOL.length)]);
  eq(uniform.trib > 3.2, true, `negative control: uniform drawing would give ${uniform.trib.toFixed(1)} tribute monsters per deck`);
  eq(G.POOL.filter((c) => c.type === 'monster' && G.tributesNeeded(c) === 2).every((c) => G.cardWeight(c) < G.cardWeight(G.MONSTERS[0])), true, 'two-tribute monsters are rarer than normal ones');
}

// Attacks that the defender always has to confirm (the human's side in the UI), even without a usable trap
{
  const s = G.newGame(G.mulberry32(3), ['Player', 'CPU'], { confirmAttacksOn: 0 });
  const prep = (defender) => {
    s.players.forEach((p) => { p.hand = []; p.field = []; p.traps = []; p.lp = LP; });
    s.turnNo = 5; s.phase = 'main'; s.pending = null; s.winner = null;
    s.turn = 1 - defender;
    s.players[1 - defender].field = [mon(1500, 100, 'atk')];
    s.players[defender].field = [mon(1000, 100, 'atk')];
  };
  prep(0);
  G.enterBattle(s);
  const r = G.declareAttack(s, 0, 0);
  eq([r.ok, r.pending, s.pending.options], [true, true, []], 'attack on a confirming defender waits, even with no usable trap');
  eq([s.players[0].field.length, s.players[0].lp, s.players[1].field[0].attacked], [1, LP, true], 'nothing is resolved before the confirmation');
  eq(G.endTurn(s).ok, false, 'the turn cannot be ended while the attack is pending');
  G.respondAttack(s, null);
  eq([s.players[0].field.length, s.players[0].lp, s.pending], [0, LP - 1400, null], 'confirming resolves the attack normally');
  prep(1); // negative control: the other side is not asked
  G.enterBattle(s);
  eq(G.declareAttack(s, 0, 0).pending, false, 'negative control: attacks on a non-confirming defender resolve immediately');
  prep(0); // a usable trap is still offered together with the confirmation
  s.players[0].traps = [trap('block')];
  G.enterBattle(s);
  eq(G.declareAttack(s, 0, 0).pending && s.pending.options.length, 1, 'usable traps are still offered');
  prep(0); // direct attacks wait too
  s.players[0].field = [];
  G.enterBattle(s);
  eq([G.declareAttack(s, 0, null).pending, s.players[0].lp], [true, LP], 'direct attacks wait as well and do not hit before confirmation');
  G.respondAttack(s, null);
  eq(s.players[0].lp, LP - 1500, 'direct attack goes through after confirmation');
}

// Everything the CPU does is traceable in the log, and the attack is logged when it is declared
{
  const s = G.newGame(G.mulberry32(3), ['Player', 'CPU'], { confirmAttacksOn: 0 });
  s.players.forEach((p) => { p.hand = []; p.field = []; p.traps = []; });
  s.turnNo = 5; s.turn = 1; s.phase = 'main';
  s.players[1].field = [mon(1500, 100, 'atk', { name: 'Wolf' })];
  s.players[0].field = [mon(1000, 100, 'atk', { name: 'Imp' })];
  G.enterBattle(s);
  G.declareAttack(s, 0, 0);
  const declared = s.log.filter((l) => l.includes('Wolf (ATK 1500) attacks Imp'));
  eq([declared.length, s.players[0].lp], [1, LP], 'the attack is in the log before it is confirmed, and nothing has happened yet');
  G.respondAttack(s, null);
  eq(s.log.filter((l) => l.includes('attacks')).length, 1, 'the attack is logged exactly once (not again on resolution)');
  eq(s.log.some((l) => l.includes('Imp is destroyed')) && s.log.some((l) => l.includes('Player loses 1400 LP')), true, 'the outcome follows in the log');
  const s2 = G.newGame(G.mulberry32(3), ['Player', 'CPU']); // direct attack
  s2.players.forEach((p) => { p.hand = []; p.field = []; p.traps = []; });
  s2.turnNo = 5; s2.turn = 0; s2.phase = 'main';
  s2.players[0].field = [mon(1500, 100, 'atk', { name: 'Wolf' })];
  G.enterBattle(s2);
  G.declareAttack(s2, 0, null);
  eq(s2.log.filter((l) => l.includes('Wolf (ATK 1500) attacks CPU directly.')).length, 1, 'direct attack declaration is logged');
  eq(s2.log.some((l) => l.includes('CPU takes 1500 damage.')), true, 'direct attack damage is logged');
  const s3 = setup(); // face-down target: declaration does not name it, the flip does
  s3.players[0].field = [mon(1500, 100, 'atk', { name: 'Wolf' })];
  s3.players[1].field = [mon(900, 2000, 'def', { faceDown: true, name: 'SecretName' })];
  atk(s3, 0, 0);
  const decl = s3.log.find((l) => l.includes('Wolf (ATK 1500) attacks'));
  eq([decl.includes('SecretName'), decl.includes('face-down')], [false, true], 'declaration against a face-down monster does not leak its name');
  eq(s3.log.some((l) => l.includes('SecretName is flipped face-up')), true, 'the flip then reveals it in the log');
}
{
  const s = setup(); // the CPU's end of turn is logged when it decides to end, before the turn actually ends
  s.turn = 1; s.summonsLeft = 0; s.players[1].hand = []; s.players[1].field = [];
  const r = aiUntilAttack(s);
  eq([r.done, s.log[s.log.length - 1], s.turn], [true, 'CPU ends its turn.', 1], 'CPU logs that it ends its turn, before the turn changes');
  G.endTurn(s);
  eq(s.turn, 0, 'the turn then passes');
}

// Tributes
const byName = (n) => ({ ...G.MONSTERS.find((m) => m.name === n), id: nid++ });
eq([1999, 2000, 3000, 3001, 3500].map((atk) => G.tributesNeeded({ atk })), [0, 1, 1, 2, 2], 'tribute thresholds (2000+ one, above 3000 two)');
eq(G.MONSTERS.filter((m) => m.atk > 3000).length >= 1, true, 'pool contains monsters that need two tributes');
{
  const s = setup();
  s.summonsLeft = 1;
  s.players[0].hand = [byName('Cave Troll'), byName('Sun Titan')];
  s.players[0].field = [mon(500, 500, 'atk'), mon(600, 600, 'def')];
  eq(G.summon(s, 0, 'atk', []).ok, false, '2000 ATK monster without tribute is refused');
  eq(G.summon(s, 0, 'atk', [0, 1]).ok, false, 'too many tributes are refused');
  eq(G.summon(s, 0, 'atk', [5]).ok, false, 'tribute must be an existing own monster');
  eq(s.summonsLeft, 1, 'refused summons do not use up the summon');
  eq(G.summon(s, 0, 'atk', [0]).ok, true, 'one tribute summons a 2000 ATK monster');
  eq([s.players[0].field.map((m) => m.name), s.players[0].graveyard], [['M600/600', 'Cave Troll'], 1], 'tribute leaves the field and is counted in the graveyard');
  eq(s.summonsLeft, 0, 'a tribute summon uses the turn summon');
}
{
  const s = setup();
  s.summonsLeft = 1;
  s.players[0].hand = [byName('Sun Titan')];
  s.players[0].field = [mon(500, 500, 'atk'), mon(600, 600, 'atk'), mon(700, 700, 'atk')];
  eq(G.summon(s, 0, 'atk', [0]).ok, false, '3500 ATK monster with one tribute is refused');
  eq(G.summon(s, 0, 'atk', [1, 1]).ok, false, 'the same monster cannot be tributed twice');
  eq(G.summon(s, 0, 'atk', [0, 2]).ok, true, 'two tributes summon a 3500 ATK monster');
  eq(s.players[0].field.map((m) => m.name), ['M600/600', 'Sun Titan'], 'the right monsters were tributed');
}
{
  const s = setup(); // full field: a tribute summon frees space, a normal summon does not
  s.summonsLeft = 1;
  s.players[0].hand = [byName('Cave Troll'), byName('Sprite')];
  s.players[0].field = Array(5).fill(0).map(() => mon(500, 500, 'atk'));
  eq(G.summon(s, 1, 'atk', []).ok, false, 'full field: normal summon refused');
  eq(G.summon(s, 0, 'atk', [0]).ok, true, 'full field: tribute summon works');
  eq(s.players[0].field.length, 5, 'field still holds 5');
}

// Face-down defence
{
  const s = setup();
  s.summonsLeft = 1;
  s.players[0].hand = [byName('Moss Turtle')];
  G.summon(s, 0, 'set');
  const m = s.players[0].field[0];
  eq([m.faceDown, m.pos], [true, 'def'], 'set monster is face-down DEF');
  eq(s.log.some((l) => l.includes('Moss Turtle')), false, 'log does not leak the name of a face-down monster');
  eq(G.flipUp(s, 0, 'atk').ok, false, 'cannot flip on the turn it was set');
  eq(atk(s, 0, null).ok, false, 'face-down monster cannot attack');
}
{
  const s = setup();
  s.players[0].field = [mon(800, 900, 'def', { faceDown: true }), mon(800, 900, 'def', { faceDown: true }), mon(800, 900, 'atk')];
  eq(G.switchPos(s, 0).ok, false, 'switchPos refuses face-down monsters');
  eq(G.flipUp(s, 2, 'atk').ok, false, 'a face-up monster can never go face-down or be flipped');
  eq([G.flipUp(s, 0, 'atk').ok, s.players[0].field[0].faceDown, s.players[0].field[0].pos], [true, false, 'atk'], 'owner flips to ATK');
  eq(G.flipUp(s, 1, 'def').ok, true, 'owner flips to face-up DEF');
  eq([s.players[0].field[1].faceDown, s.players[0].field[1].pos], [false, 'def'], 'flipped to face-up DEF');
  const s2 = setup(); // flip counts as the once-per-turn position change
  s2.players[0].field = [mon(800, 900, 'def', { faceDown: true })];
  G.flipUp(s2, 0, 'def');
  eq(G.switchPos(s2, 0).ok, false, 'no second position change after a flip');
}
{
  const s = setup(); // attacking a face-down monster flips it, then the battle uses its DEF
  s.players[0].field = [mon(1500, 100, 'atk')];
  const hidden = mon(900, 1000, 'def', { faceDown: true, name: 'Hidden' });
  s.players[1].field = [hidden];
  atk(s, 0, 0);
  eq(hidden.faceDown, false, 'attacked face-down monster is flipped face-up');
  eq(s.players[1].field.length, 0, 'flipped monster with DEF 1000 is destroyed by A=1500');
  eq(s.log.some((l) => l.includes('flipped face-up')), true, 'flip is logged');
}
{
  const s = setup(); // flipped monster survives with drained DEF when stronger
  s.players[0].field = [mon(1500, 100, 'atk')];
  s.players[1].field = [mon(900, 2000, 'def', { faceDown: true, name: 'Hidden' })];
  atk(s, 0, 0);
  const t = s.players[1].field[0];
  eq([t.faceDown, t.def, s.players[0].lp], [false, 500, LP - 500], 'flipped DEF monster drained, attacker player takes the difference');
}
{
  const s = setup(); // a cancelled attack still reveals the target (it was attacked)
  s.players[0].field = [mon(1500, 100, 'atk')];
  s.players[1].field = [mon(900, 2000, 'def', { faceDown: true })];
  s.players[1].traps = [trap('block')];
  atk(s, 0, 0);
  G.respondAttack(s, 0);
  eq(s.players[1].field[0].faceDown, false, 'attacked monster is flipped even if the attack is blocked');
}
{
  // CPU does not read face-down values: with ATK 1400 it must not attack a face-down monster (guess DEF 1500),
  // and with ATK 1600 it does, even though the real DEF is 3000 (it cannot know).
  for (const [cpuAtk, expectAttack] of [[1400, false], [1600, true]]) {
    const s = setup();
    s.turn = 1;
    s.players[1].field = [mon(cpuAtk, 100, 'atk')];
    s.players[0].field = [mon(100, 3000, 'def', { faceDown: true })];
    s.summonsLeft = 0;
    s.players[1].hand = [];
    const r = aiUntilAttack(s);
    eq(!!(r && r.attack && r.attack.ok), expectAttack, `CPU ATK ${cpuAtk} vs face-down monster: attacks=${expectAttack}`);
  }
}
{
  // CPU tributes only for a clear upgrade
  const s = setup();
  s.turn = 1;
  s.summonsLeft = 1;
  s.players[1].hand = [byName('Dark Knight')];
  s.players[1].field = [mon(500, 500, 'atk')];
  G.aiStep(s);
  eq(s.players[1].field.map((m) => m.name), ['Dark Knight'], 'CPU tributes a weak monster for Dark Knight');
  const s2 = setup(); // negative control: not worth tributing a strong monster for a weaker upgrade
  s2.turn = 1;
  s2.summonsLeft = 1;
  s2.players[1].hand = [byName('Cave Troll')];
  s2.players[1].field = [mon(2400, 1800, 'atk')];
  G.aiStep(s2);
  eq(s2.players[1].field.map((m) => m.name), ['M2400/1800'], 'negative control: CPU keeps its strong monster instead of tributing it');
}

// Actions: legalActions must list exactly the actions the engine accepts
{
  const key = (act) => JSON.stringify({ ...act, tr: act.tr ? [...act.tr].sort() : undefined });
  const candidates = (s) => {
    const me = s.players[s.turn];
    const out = [];
    const subsets = (n, k) => (k === 0 ? [[]] : k === 1 ? [...Array(n).keys()].map((i) => [i]) : [...Array(n).keys()].flatMap((i) => [...Array(n).keys()].filter((j) => j > i).map((j) => [i, j])));
    for (let h = 0; h < G.MAX_HAND_SLOTS; h++) {
      for (const mode of ['atk', 'def', 'set']) for (let k = 0; k <= 2; k++) for (const tr of subsets(me.field.length, k)) out.push({ t: 'summon', h, mode, tr });
      out.push({ t: 'set', h });
    }
    for (let f = 0; f < 6; f++) {
      out.push({ t: 'switch', f }, { t: 'flip', f, pos: 'atk' }, { t: 'flip', f, pos: 'def' });
      for (let d = -1; d < 6; d++) out.push({ t: 'attack', a: f, d: d < 0 ? null : d });
    }
    for (let i = 0; i < 4; i++) out.push({ t: 'extra', i });
    out.push({ t: 'battle' }, { t: 'end' });
    return out;
  };
  let checked = 0;
  let wrong = 0;
  let notAccepted = 0;
  let heurIllegal = 0;
  let heurChecked = 0;
  let steps = 0;
  const kinds = new Set();
  for (let seed = 1; seed <= 14; seed++) {
    const rng = G.mulberry32(seed * 7);
    const s = G.newGame(G.mulberry32(seed));
    for (let n = 0; n < 1500 && s.winner === null; n++) {
      const legal = G.legalActions(s);
      const legalKeys = new Set(legal.map(key));
      if (!s.pending) {
        const plan = G.aiPlan(s);
        heurChecked++;
        if (!legalKeys.has(key(plan))) heurIllegal++;
        if (n % 3 === 0) {
          for (const c of candidates(s)) {
            const ok = G.applyAction(JSON.parse(JSON.stringify(s)), c).ok === true;
            checked++;
            if (ok !== legalKeys.has(key(c))) wrong++;
          }
        }
      }
      // more 'end' when idle so games finish; random legal move otherwise
      const pick = legal[Math.floor(rng() * legal.length)];
      const res = G.applyAction(s, pick);
      kinds.add(pick.t);
      steps++;
      if (!res.ok) notAccepted++;
    }
  }
  eq([wrong, notAccepted], [0, 0], `legalActions agrees with the engine on ${checked} candidate actions over ${steps} random-play steps`);
  eq(heurIllegal, 0, `the heuristic only ever picks legal actions (${heurChecked} decisions checked)`);
  eq(['summon', 'set', 'switch', 'flip', 'extra', 'battle', 'attack', 'respond', 'end'].filter((k) => !kinds.has(k)), [], 'random play exercised every action kind');
  console.log(`legalActions check: ${checked} candidates, ${steps} steps`);
}
{
  const s = G.newGame(G.mulberry32(11));
  const before = JSON.stringify(G.snapshot(s));
  G.aiPlan(s);
  eq(JSON.stringify(G.snapshot(s)), before, 'aiPlan does not change the state');
  const snap = G.snapshot(s);
  eq([snap.players[0].deck.length, snap.players[0].hand.length, snap.phase, snap.turnNo, snap.winner, snap.pending], [15, 5, 'main', 1, null, null], 'snapshot has the expected shape');
  eq(G.legalActions({ ...s, winner: 0 }), [], 'no legal actions after the game is over');
}

// Deck setup
{
  const s = G.newGame(G.mulberry32(7));
  eq([s.players[0].deck.length + s.players[0].hand.length, s.players[0].hand.length], [20, 5], 'deck of 20, hand of 5 (first player skips first draw)');
  eq(s.players[1].deck.length + s.players[1].hand.length, 20, 'second deck has 20 cards');
  G.endTurn(s);
  eq(s.players[1].hand.length, 6, 'second player draws on their first turn');
}
{
  const s = setup();
  s.players[1].deck = [];
  G.endTurn(s);
  eq(s.winner, 0, 'player who cannot draw loses');
}

// AI vs AI simulation: games end, counts stay consistent
{
  let turns = 0;
  const ends = { lp: 0, deck: 0 };
  let trapsUsed = 0;
  let tributes = 0;
  let sets = 0;
  let flips = 0;
  let battles = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const s = G.newGame(G.mulberry32(seed));
    let n = 0;
    while (s.winner === null && n < 200) {
      G.autoPlayTurn(s);
      n++;
      for (const p of s.players) {
        const total = p.deck.length + p.hand.length + p.field.length + p.traps.length + p.graveyard;
        if (total !== 20) {
          eq(total, 20, `card conservation seed ${seed}`);
          break;
        }
        if (p.field.length > 5 || p.traps.length > 3 || p.lp < 0) eq('bad', 'ok', `limits seed ${seed}`);
        for (const m of p.field) if (m.atk < 0 || m.def < 0 || m.def > m.baseDef || m.atk > m.baseAtk) eq('bad', 'ok', `stat range seed ${seed}`);
      }
    }
    eq(s.winner !== null, true, `game ${seed} ends`);
    turns += s.turnNo;
    if (s.players.some((p) => p.lp === 0)) ends.lp++;
    else ends.deck++;
    trapsUsed += s.log.filter((l) => l.includes('activates')).length;
    tributes += s.log.filter((l) => l.includes(' tributes ')).length;
    sets += s.log.filter((l) => l.includes('sets a monster face-down')).length;
    flips += s.log.filter((l) => l.includes('flipped face-up')).length;
    battles += s.log.filter((l) => l.includes('enters the battle phase')).length;
  }
  console.log(`AI sim: 500 games, avg ${(turns / 500).toFixed(1)} turns, ended by LP ${ends.lp}, by empty deck ${ends.deck}, trap activations ${trapsUsed}, tributes ${tributes}, face-down sets ${sets}, flips ${flips}, battle phases ${battles}`);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
