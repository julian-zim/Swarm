// Card duel engine: pure game rules and a simple AI. No DOM access, so it runs in the browser and in Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Game = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // weights: relative odds of drawing each kind of card into a deck. Tribute monsters are rare because they are hard to play.
  const CONFIG = { startLp: 8000, deckSize: 20, handSize: 5, fieldSize: 5, trapZones: 3, regen: 2000, weights: { normal: 12, tribute1: 4, tribute2: 2, trap: 8 } };

  const MONSTERS = [
    { name: 'Sprite', emoji: '🧚', atk: 500, def: 500 },
    { name: 'Moss Turtle', emoji: '🐢', atk: 500, def: 2000 },
    { name: 'Ember Imp', emoji: '😈', atk: 1000, def: 500 },
    { name: 'Frost Wolf', emoji: '🐺', atk: 1600, def: 1200 },
    { name: 'Storm Hawk', emoji: '🦅', atk: 1800, def: 1000 },
    { name: 'Cave Troll', emoji: '👹', atk: 2000, def: 1000 },
    { name: 'Iron Golem', emoji: '🤖', atk: 1400, def: 2600 },
    { name: 'Dark Knight', emoji: '🛡️', atk: 2400, def: 1800 },
    { name: 'Thunder Drake', emoji: '🐉', atk: 2800, def: 1500 },
    { name: 'Void Wyrm', emoji: '🐲', atk: 3200, def: 1800 },
    { name: 'Sun Titan', emoji: '🌞', atk: 3500, def: 2500 },
    { name: 'Stone Sentinel', emoji: '🗿', atk: 800, def: 3000 },
  ].map((m) => ({ ...m, type: 'monster' }));

  const TRAPS = [
    { trap: 'block', name: 'Block Attack', emoji: '🚫', text: "When the opponent declares an attack: cancel that attack." },
    { trap: 'protect', name: 'Guardian Shield', emoji: '🔰', text: 'When your monster is attacked: it cannot be destroyed, drained or cause LP loss until the end of the turn.' },
    { trap: 'extra', name: 'Reinforcements', emoji: '📯', text: 'On your turn: you may summon one extra monster this turn.' },
  ].map((t) => ({ ...t, type: 'trap' }));

  const POOL = [...MONSTERS, ...TRAPS];
  const FACE_DOWN_GUESS = 1500;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeCard(state, def) {
    return { ...def, id: state.nextId++ };
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function makePlayer(name) {
    return { name, lp: CONFIG.startLp, deck: [], hand: [], field: [], traps: [], trapUsedTurn: 0, graveyard: 0 };
  }

  const cur = (s) => s.players[s.turn];
  const opp = (s) => s.players[1 - s.turn];
  const fail = (error) => ({ ok: false, error });
  const OK = { ok: true };

  function log(state, msg) {
    state.log.push(msg);
  }

  function cardWeight(card) {
    if (card.type === 'trap') return CONFIG.weights.trap;
    const need = tributesNeeded(card);
    return need === 0 ? CONFIG.weights.normal : need === 1 ? CONFIG.weights.tribute1 : CONFIG.weights.tribute2;
  }

  function drawFromPool(rng) {
    const total = POOL.reduce((n, c) => n + cardWeight(c), 0);
    let r = rng() * total;
    for (const c of POOL) {
      r -= cardWeight(c);
      if (r < 0) return c;
    }
    return POOL[POOL.length - 1];
  }

  // opts.confirmAttacksOn: index of a player whose incoming attacks always wait for a response, even without a usable trap.
  function newGame(rng = Math.random, names = ['You', 'CPU'], opts = {}) {
    const state = { players: [makePlayer(names[0]), makePlayer(names[1])], turn: 0, turnNo: 0, phase: 'main', summonsLeft: 0, pending: null, winner: null, log: [], nextId: 1, confirmAttacksOn: opts.confirmAttacksOn ?? null };
    for (const p of state.players) {
      for (let i = 0; i < CONFIG.deckSize; i++) p.deck.push(makeCard(state, drawFromPool(rng)));
      shuffle(p.deck, rng);
      for (let i = 0; i < CONFIG.handSize; i++) p.hand.push(p.deck.pop());
    }
    startTurn(state);
    return state;
  }

  function setWinner(state, idx, why) {
    if (state.winner !== null) return;
    state.winner = idx;
    log(state, `${state.players[idx].name} wins: ${why}`);
  }

  function checkLp(state) {
    for (let i = 0; i < 2; i++) {
      const p = state.players[i];
      if (p.lp <= 0) {
        p.lp = 0;
        setWinner(state, 1 - i, `${p.name} has no life points left.`);
      }
    }
  }

  function startTurn(state) {
    state.turnNo++;
    state.phase = 'main';
    state.summonsLeft = 1;
    const p = cur(state);
    for (const m of p.field) {
      m.attacked = false;
      m.switched = false;
    }
    log(state, `--- Turn ${state.turnNo}: ${p.name} ---`);
    if (state.turnNo > 1) {
      if (p.deck.length === 0) {
        log(state, `${p.name} cannot draw.`);
        setWinner(state, 1 - state.turn, `${p.name} has no cards left to draw.`);
        return;
      }
      p.hand.push(p.deck.pop());
    }
  }

  function guard(state) {
    if (state.winner !== null) return fail('The game is over.');
    if (state.pending) return fail('Respond to the pending attack first.');
    return null;
  }

  // Monsters with 2000+ ATK need one tribute, more than 3000 ATK need two.
  function tributesNeeded(card) {
    return card.atk > 3000 ? 2 : card.atk >= 2000 ? 1 : 0;
  }

  // mode: 'atk', 'def' (face-up DEF) or 'set' (face-down DEF). tributes: indices into the player's own field.
  // Summoning, setting, position changes and Reinforcements are main phase actions.
  function mainGuard(state) {
    const g = guard(state);
    if (g) return g;
    if (state.phase !== 'main') return fail('Not possible in the battle phase.');
    return null;
  }

  // The battle phase is one-way: after it only attacks and defensive traps are possible, then the turn ends.
  function enterBattle(state) {
    const g = mainGuard(state);
    if (g) return g;
    state.phase = 'battle';
    log(state, `${cur(state).name} enters the battle phase.`);
    return OK;
  }

  function summon(state, handIdx, mode, tributes = []) {
    const g = mainGuard(state);
    if (g) return g;
    const p = cur(state);
    const card = p.hand[handIdx];
    if (!card || card.type !== 'monster') return fail('Not a monster card.');
    if (mode !== 'atk' && mode !== 'def' && mode !== 'set') return fail('Invalid position.');
    if (state.summonsLeft <= 0) return fail('No summon left this turn.');
    const need = tributesNeeded(card);
    if (new Set(tributes).size !== tributes.length || tributes.length !== need || tributes.some((i) => !p.field[i])) {
      return fail(`${card.name} needs ${need} tribute${need === 1 ? '' : 's'}.`);
    }
    if (p.field.length - need >= CONFIG.fieldSize) return fail('Your field is full.');
    const tributed = tributes.map((i) => p.field[i]);
    p.hand.splice(handIdx, 1);
    for (const m of tributed) {
      removeMonster(state, p, m);
      log(state, `${p.name} tributes ${m.faceDown ? 'a face-down monster' : m.name}.`);
    }
    const faceDown = mode === 'set';
    p.field.push({ id: card.id, name: card.name, emoji: card.emoji, baseAtk: card.atk, baseDef: card.def, atk: card.atk, def: card.def, pos: mode === 'atk' ? 'atk' : 'def', faceDown, summonedTurn: state.turnNo, attacked: false, switched: false, protected: false });
    state.summonsLeft--;
    log(state, faceDown ? `${p.name} sets a monster face-down.` : `${p.name} summons ${card.name} in ${mode.toUpperCase()} position.`);
    return OK;
  }

  function setTrap(state, handIdx) {
    const g = mainGuard(state);
    if (g) return g;
    const p = cur(state);
    const card = p.hand[handIdx];
    if (!card || card.type !== 'trap') return fail('Not a trap card.');
    if (p.traps.length >= CONFIG.trapZones) return fail('All trap zones are full.');
    p.hand.splice(handIdx, 1);
    p.traps.push({ ...card, setTurn: state.turnNo });
    log(state, `${p.name} sets a trap face-down.`);
    return OK;
  }

  function switchPos(state, fieldIdx) {
    const g = mainGuard(state);
    if (g) return g;
    const m = cur(state).field[fieldIdx];
    if (!m) return fail('No such monster.');
    if (m.faceDown) return fail('Flip a face-down monster instead.');
    if (m.switched) return fail('Already switched position this turn.');
    if (m.summonedTurn === state.turnNo) return fail('A monster cannot change position on the turn it was summoned.');
    if (m.attacked) return fail('A monster that attacked cannot change position this turn.');
    m.pos = m.pos === 'atk' ? 'def' : 'atk';
    m.switched = true;
    log(state, `${cur(state).name} switches ${m.name} to ${m.pos.toUpperCase()} position.`);
    return OK;
  }

  // Turns a face-down monster face-up. Anything that reads or changes a face-down monster's values must call this first.
  function reveal(state, m) {
    if (!m.faceDown) return;
    m.faceDown = false;
    log(state, `${m.name} is flipped face-up in DEF position (ATK ${m.atk}, DEF ${m.def}).`);
  }

  // The owner turns a face-down monster face-up, into ATK or face-up DEF. Counts as the once-per-turn position change.
  function flipUp(state, fieldIdx, pos) {
    const g = mainGuard(state);
    if (g) return g;
    const m = cur(state).field[fieldIdx];
    if (!m) return fail('No such monster.');
    if (!m.faceDown) return fail('Only face-down monsters can be flipped. Face-up monsters never go face-down.');
    if (pos !== 'atk' && pos !== 'def') return fail('Invalid position.');
    if (m.switched) return fail('Already changed position this turn.');
    if (m.summonedTurn === state.turnNo) return fail('A monster cannot change position on the turn it was set.');
    m.faceDown = false;
    m.pos = pos;
    m.switched = true;
    log(state, `${cur(state).name} flips ${m.name} face-up in ${pos.toUpperCase()} position.`);
    return OK;
  }

  // A trap is ready from the turn after it was set, and a player may activate one per turn.
  function trapReady(state, pIdx, trapIdx) {
    const p = state.players[pIdx];
    const t = p.traps[trapIdx];
    return !!t && state.turnNo > t.setTurn && p.trapUsedTurn !== state.turnNo;
  }

  function useTrap(state, pIdx, trapIdx) {
    const p = state.players[pIdx];
    const [t] = p.traps.splice(trapIdx, 1);
    p.trapUsedTurn = state.turnNo;
    p.graveyard++;
    log(state, `${p.name} activates ${t.name}!`);
    return t;
  }

  function activateExtraSummon(state, trapIdx) {
    const g = mainGuard(state);
    if (g) return g;
    const t = cur(state).traps[trapIdx];
    if (!t || t.trap !== 'extra') return fail('Not a Reinforcements trap.');
    if (!trapReady(state, state.turn, trapIdx)) return fail('This trap cannot be activated yet.');
    useTrap(state, state.turn, trapIdx);
    state.summonsLeft++;
    return OK;
  }

  // What a battle would do. t is the target monster, or null for a direct attack.
  // The attack is always measured against, and drains, the target's DEF, whatever its position.
  function previewBattle(att, t) {
    const A = att.atk;
    if (!t) return { direct: true, A, defLp: A, atkLp: 0, tDestroyed: false, aDestroyed: false, newT: null };
    const inAtk = t.pos === 'atk';
    const T = t.def;
    const raw = T - A;
    return {
      direct: false,
      A,
      T,
      newT: Math.max(0, raw),
      tDestroyed: inAtk ? raw <= 0 : raw < 0,
      aDestroyed: inAtk && A <= T,
      defLp: inAtk && A > T ? A - T : 0,
      atkLp: A < T ? T - A : 0,
    };
  }

  function removeMonster(state, player, m) {
    player.field = player.field.filter((x) => x !== m);
    player.graveyard++;
  }

  function resolveBattle(state, att, tIdx) {
    const me = cur(state);
    const other = opp(state);
    if (tIdx === null) {
      other.lp -= att.atk;
      log(state, `${other.name} takes ${att.atk} damage.`);
      checkLp(state);
      return;
    }
    const t = other.field[tIdx];
    if (t.protected) {
      log(state, `${t.name} is protected. Nothing happens.`);
      return;
    }
    const r = previewBattle(att, t);
    t.def = r.newT;
    if (r.tDestroyed) {
      removeMonster(state, other, t);
      log(state, `${t.name} is destroyed.`);
    } else {
      log(state, `${t.name}'s DEF is drained to ${r.newT}.`);
    }
    if (r.aDestroyed) {
      removeMonster(state, me, att);
      log(state, `${att.name} is destroyed.`);
    }
    if (r.defLp) {
      other.lp -= r.defLp;
      log(state, `${other.name} loses ${r.defLp} LP.`);
    }
    if (r.atkLp) {
      me.lp -= r.atkLp;
      log(state, `${me.name} loses ${r.atkLp} LP.`);
    }
    checkLp(state);
  }

  // tIdx: index into the opponent's field, or null for a direct attack (only with an empty field).
  function declareAttack(state, aIdx, tIdx) {
    const g = guard(state);
    if (g) return g;
    if (state.phase !== 'battle') return fail('Enter the battle phase to attack.');
    const me = cur(state);
    const other = opp(state);
    const att = me.field[aIdx];
    if (!att) return fail('No such monster.');
    if (att.pos !== 'atk') return fail('Only monsters in ATK position can attack.');
    if (att.attacked) return fail('This monster already attacked this turn.');
    if (att.summonedTurn >= state.turnNo) return fail('A monster cannot attack on the turn it was summoned.');
    if (tIdx === null) {
      if (other.field.length > 0) return fail('The opponent still has monsters.');
    } else if (!other.field[tIdx]) {
      return fail('No such target.');
    }
    att.attacked = true;
    // The declaration is logged now, before any trap response or confirmation, and the log never names a face-down monster before it is flipped.
    if (tIdx === null) {
      log(state, `${att.name} (ATK ${att.atk}) attacks ${other.name} directly.`);
    } else {
      const t = other.field[tIdx];
      if (t.faceDown) {
        log(state, `${att.name} (ATK ${att.atk}) attacks a face-down monster.`);
        reveal(state, t);
      } else {
        log(state, `${att.name} (ATK ${att.atk}) attacks ${t.name} (${t.pos.toUpperCase()} position, DEF ${t.def}).`);
      }
    }
    const defIdx = 1 - state.turn;
    const options = [];
    other.traps.forEach((t, i) => {
      if (!trapReady(state, defIdx, i)) return;
      if (t.trap === 'block' || (t.trap === 'protect' && tIdx !== null)) options.push(i);
    });
    if (options.length === 0 && state.confirmAttacksOn !== defIdx) {
      resolveBattle(state, att, tIdx);
      return { ok: true, pending: false };
    }
    state.pending = { att, tIdx, options };
    return { ok: true, pending: true };
  }

  // trapIdx: index into the defender's traps, or null to decline.
  function respondAttack(state, trapIdx) {
    const p = state.pending;
    if (!p) return fail('No pending attack.');
    if (trapIdx !== null && !p.options.includes(trapIdx)) return fail('That trap cannot be used now.');
    state.pending = null;
    if (trapIdx === null) {
      resolveBattle(state, p.att, p.tIdx);
      return OK;
    }
    const defIdx = 1 - state.turn;
    const t = useTrap(state, defIdx, trapIdx);
    if (t.trap === 'block') {
      log(state, `The attack of ${p.att.name} is cancelled.`);
    } else {
      state.players[defIdx].field[p.tIdx].protected = true;
      resolveBattle(state, p.att, p.tIdx);
    }
    return OK;
  }

  function endTurn(state) {
    const g = guard(state);
    if (g) return g;
    for (const pl of state.players) {
      for (const m of pl.field) {
        m.protected = false;
        if (m.pos === 'def') m.def = Math.min(m.baseDef, m.def + CONFIG.regen);
      }
    }
    state.turn = 1 - state.turn;
    startTurn(state);
    return OK;
  }

  // ---------------------------------------------------------------- actions
  // A uniform way to describe everything a player can do, used by the AI and by learned models:
  //   { t: 'summon', h, mode, tr } { t: 'set', h } { t: 'switch', f } { t: 'flip', f, pos } { t: 'extra', i }
  //   { t: 'battle' } { t: 'attack', a, d } (d null = direct attack) { t: 'respond', i } (i null = no trap) { t: 'end' }
  // h hand index, f field index, i trap index, a attacker index, d target index, tr tribute field indices.
  const MAX_HAND_SLOTS = 12; // legalActions only offers hand cards in the first 12 slots

  function applyAction(state, act) {
    switch (act.t) {
      case 'summon': return summon(state, act.h, act.mode, act.tr || []);
      case 'set': return setTrap(state, act.h);
      case 'switch': return switchPos(state, act.f);
      case 'flip': return flipUp(state, act.f, act.pos);
      case 'extra': return activateExtraSummon(state, act.i);
      case 'battle': return enterBattle(state);
      case 'attack': return declareAttack(state, act.a, act.d);
      case 'respond': return respondAttack(state, act.i);
      case 'end': return endTurn(state);
    }
    return fail('Unknown action.');
  }

  function combinations(n, k) {
    const out = [];
    const rec = (start, picked) => {
      if (picked.length === k) {
        out.push(picked.slice());
        return;
      }
      for (let i = start; i < n; i++) {
        picked.push(i);
        rec(i + 1, picked);
        picked.pop();
      }
    };
    rec(0, []);
    return out;
  }

  // Every action the deciding player may take now. The decider is the defender while an attack is pending, otherwise the
  // player whose turn it is. Each listed action is accepted by applyAction.
  function legalActions(state) {
    if (state.winner !== null) return [];
    if (state.pending) {
      const acts = state.pending.options.map((i) => ({ t: 'respond', i }));
      acts.push({ t: 'respond', i: null });
      return acts;
    }
    const me = cur(state);
    const other = opp(state);
    const out = [];
    if (state.phase === 'main') {
      me.hand.forEach((c, h) => {
        if (h >= MAX_HAND_SLOTS) return;
        if (c.type === 'trap') {
          if (me.traps.length < CONFIG.trapZones) out.push({ t: 'set', h });
        } else if (state.summonsLeft > 0) {
          const need = tributesNeeded(c);
          if (need > me.field.length || me.field.length - need >= CONFIG.fieldSize) return;
          for (const mode of ['atk', 'def', 'set']) for (const tr of combinations(me.field.length, need)) out.push({ t: 'summon', h, mode, tr });
        }
      });
      me.field.forEach((m, f) => {
        if (m.switched || m.summonedTurn === state.turnNo) return;
        if (m.faceDown) {
          out.push({ t: 'flip', f, pos: 'atk' });
          out.push({ t: 'flip', f, pos: 'def' });
        } else if (!m.attacked) {
          out.push({ t: 'switch', f });
        }
      });
      me.traps.forEach((t, i) => {
        if (t.trap === 'extra' && trapReady(state, state.turn, i)) out.push({ t: 'extra', i });
      });
      out.push({ t: 'battle' });
    } else {
      me.field.forEach((m, a) => {
        if (m.pos !== 'atk' || m.attacked || m.summonedTurn >= state.turnNo) return;
        if (other.field.length === 0) out.push({ t: 'attack', a, d: null });
        else other.field.forEach((_, d) => out.push({ t: 'attack', a, d }));
      });
    }
    out.push({ t: 'end' });
    return out;
  }

  // The complete game state as plain data (no card ids, no log). Used to compare two implementations of the rules.
  function snapshot(state) {
    const mon = (m) => ({ name: m.name, pos: m.pos, faceDown: !!m.faceDown, atk: m.atk, def: m.def, baseAtk: m.baseAtk, baseDef: m.baseDef, summonedTurn: m.summonedTurn, attacked: m.attacked, switched: m.switched, protected: m.protected });
    return {
      turn: state.turn,
      turnNo: state.turnNo,
      phase: state.phase,
      summonsLeft: state.summonsLeft,
      winner: state.winner,
      pending: state.pending ? { att: cur(state).field.indexOf(state.pending.att), tIdx: state.pending.tIdx, options: state.pending.options.slice() } : null,
      players: state.players.map((p) => ({
        lp: p.lp,
        deck: p.deck.map((c) => c.name),
        hand: p.hand.map((c) => c.name),
        field: p.field.map(mon),
        traps: p.traps.map((t) => ({ trap: t.trap, setTurn: t.setTurn })),
        trapUsedTurn: p.trapUsedTurn,
        graveyard: p.graveyard,
      })),
    };
  }

  // ---------------------------------------------------------------- AI

  function aiRespond(state) {
    const { att, tIdx, options } = state.pending;
    const defIdx = 1 - state.turn;
    const p = state.players[defIdx];
    const t = tIdx === null ? null : p.field[tIdx];
    const r = previewBattle(att, t);
    const hurt = r.direct || r.tDestroyed || r.defLp > 0;
    if (!hurt) return null;
    const find = (kind) => options.find((i) => p.traps[i].trap === kind);
    if (t && r.tDestroyed && find('protect') !== undefined) return find('protect');
    if (find('block') !== undefined) return find('block');
    return null;
  }

  // The heuristic CPU's next action for the player whose turn it is. It does not change the state.
  function aiPlan(state) {
    const me = cur(state);
    const other = opp(state);

    // The best attack for a monster, or null. A face-down target's values are unknown to the CPU,
    // which only guesses a DEF of 1500 for it.
    const plan = (m) => {
      if (other.field.length === 0) return { tIdx: null };
      let best = null;
      let bestScore = -1;
      other.field.forEach((t, ti) => {
        const r = previewBattle(m, t.faceDown ? { pos: 'def', def: FACE_DOWN_GUESS } : t);
        if (!r.tDestroyed || r.aDestroyed || r.atkLp) return;
        if (r.defLp + 1 > bestScore) {
          bestScore = r.defLp + 1;
          best = { tIdx: ti };
        }
      });
      return best;
    };
    const attackers = () => me.field.map((m, i) => ({ m, i })).filter(({ m }) => m.pos === 'atk' && !m.attacked && m.summonedTurn < state.turnNo);

    if (state.phase === 'battle') {
      for (const { m, i } of attackers()) {
        const p = plan(m);
        if (p) return { t: 'attack', a: i, d: p.tIdx };
      }
      return { t: 'end' };
    }

    const trapCard = me.hand.findIndex((c) => c.type === 'trap');
    if (trapCard >= 0 && me.traps.length < CONFIG.trapZones) return { t: 'set', h: trapCard };

    // The best monster it can afford. Tributes are the weakest own monsters, and only worth it for a clear upgrade.
    const value = (c) => c.atk + c.def;
    const bestSummon = () => {
      const weakest = me.field.map((m, i) => ({ i, v: m.atk + m.def })).sort((x, y) => x.v - y.v);
      let best = null;
      me.hand.forEach((c, i) => {
        if (c.type !== 'monster') return;
        const need = tributesNeeded(c);
        if (need > me.field.length || me.field.length - need >= CONFIG.fieldSize) return;
        const paid = weakest.slice(0, need);
        if (need && value(c) < paid.reduce((n, x) => n + x.v, 0) + 1500) return;
        if (!best || Math.max(c.atk, c.def) > Math.max(best.c.atk, best.c.def)) best = { c, i, tributes: paid.map((x) => x.i) };
      });
      return best;
    };
    if (state.summonsLeft > 0) {
      const best = bestSummon();
      if (best) return { t: 'summon', h: best.i, mode: best.c.def > best.c.atk ? 'set' : 'atk', tr: best.tributes };
    }
    if (state.summonsLeft === 0 && bestSummon()) {
      const ti = me.traps.findIndex((t, i) => t.trap === 'extra' && trapReady(state, state.turn, i));
      if (ti >= 0) return { t: 'extra', i: ti };
    }

    // Attackers with little DEF left and nothing worth attacking retreat to DEF position to regenerate.
    for (let i = 0; i < me.field.length; i++) {
      const m = me.field[i];
      if (m.pos === 'atk' && !m.switched && !m.attacked && m.summonedTurn < state.turnNo && m.def < m.baseDef / 2 && !plan(m)) return { t: 'switch', f: i };
    }

    // Enter the battle phase only if some monster has an attack worth making.
    if (attackers().some(({ m }) => plan(m))) return { t: 'battle' };
    return { t: 'end' };
  }

  // Performs one AI action for the player whose turn it is. Returns { done: true } when it has nothing left to do.
  function aiStep(state) {
    if (state.winner !== null) return { done: true };
    const act = aiPlan(state);
    if (act.t === 'end') {
      log(state, `${cur(state).name} ends its turn.`);
      return { done: true };
    }
    const res = applyAction(state, act);
    return act.t === 'attack' ? { done: false, attack: res } : { done: false };
  }

  // Plays a whole AI turn (both sides AI if it is the other's trap response too), then ends the turn.
  function autoPlayTurn(state) {
    for (let guardN = 0; guardN < 200 && state.winner === null; guardN++) {
      const r = aiStep(state);
      if (r.attack && r.attack.pending) respondAttack(state, aiRespond(state));
      if (r.done) break;
    }
    if (state.winner === null) endTurn(state);
  }

  return { CONFIG, MONSTERS, TRAPS, POOL, mulberry32, newGame, summon, setTrap, cardWeight, enterBattle, switchPos, flipUp, reveal, tributesNeeded, activateExtraSummon, declareAttack, respondAttack, endTurn, previewBattle, trapReady, aiPlan, aiStep, aiRespond, autoPlayTurn, applyAction, legalActions, snapshot, MAX_HAND_SLOTS };
});
