// The trained CPU: observation encoding, action space and a small neural network that runs in the browser.
// ai/space.py implements the same encoding for training; ai/tests/test_parity.py checks both give identical results.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'));
  else root.TrainedAI = factory(root.Game);
})(typeof self !== 'undefined' ? self : this, function (G) {
  const HAND = G.MAX_HAND_SLOTS; // 12 hand slots
  const FIELD = G.CONFIG.fieldSize; // 5 monster slots
  const ZONES = G.CONFIG.trapZones; // 3 trap zones

  // Flat action space. Summoning a monster that needs tributes is a sequence: SUMMON, then TRIBUTE for each tribute.
  const SUMMON = 0; // + hand * 3 + mode (atk, def, set)
  const TRIBUTE = SUMMON + HAND * 3; // + field slot
  const SET = TRIBUTE + FIELD; // + hand
  const SWITCH = SET + HAND; // + field
  const FLIP = SWITCH + FIELD; // + field * 2 + (atk, def)
  const EXTRA = FLIP + FIELD * 2; // + trap zone
  const BATTLE = EXTRA + ZONES;
  const ATTACK = BATTLE + 1; // + attacker * (FIELD + 1) + target (FIELD = direct)
  const RESPOND = ATTACK + FIELD * (FIELD + 1); // + trap zone
  const DECLINE = RESPOND + ZONES;
  const END = DECLINE + 1;
  const N_ACTIONS = END + 1; // 107
  const MODES = ['atk', 'def', 'set'];

  const ATK_SCALE = 3500;
  const DEF_SCALE = 3000;
  const LP_SCALE = 8000;
  const OBS_SIZE = 22 + 22 + HAND * 9 + FIELD * 11 + ZONES * 5 + FIELD * 6; // 252

  const actingPlayer = (state) => (state.pending ? 1 - state.turn : state.turn);

  // What the deciding player may see: everything of its own, and only the public part of the opponent.
  // sel: null, or the tribute selection in progress { h, mode, need, chosen }.
  function encodeObs(state, me, sel) {
    const mine = state.players[me];
    const theirs = state.players[1 - me];
    const o = [];
    const pend = state.pending;
    const pendTarget = pend && pend.tIdx !== null ? mine.field[pend.tIdx] : null;
    o.push(
      state.phase === 'main' ? 1 : 0,
      state.phase === 'battle' ? 1 : 0,
      state.turnNo / 60,
      state.summonsLeft / 2,
      mine.lp / LP_SCALE,
      theirs.lp / LP_SCALE,
      mine.deck.length / 20,
      theirs.deck.length / 20,
      mine.hand.length / HAND,
      theirs.hand.length / HAND,
      mine.graveyard / 20,
      theirs.graveyard / 20,
      state.turn === me ? 1 : 0,
      pend ? 1 : 0,
      pend ? pend.att.atk / ATK_SCALE : 0,
      pend && pend.tIdx === null ? 1 : 0,
      pendTarget ? pendTarget.def / DEF_SCALE : 0,
      pendTarget && pendTarget.pos === 'atk' ? 1 : 0,
      mine.trapUsedTurn === state.turnNo ? 1 : 0,
      theirs.traps.length / ZONES,
      mine.traps.length / ZONES,
      me === 0 ? 1 : 0,
    );
    o.push(sel ? 1 : 0, sel ? (sel.need - sel.chosen.length) / 2 : 0);
    for (let f = 0; f < FIELD; f++) o.push(sel && sel.chosen.includes(f) ? 1 : 0);
    for (let h = 0; h < HAND; h++) o.push(sel && sel.h === h ? 1 : 0);
    for (const m of MODES) o.push(sel && sel.mode === m ? 1 : 0);

    for (let h = 0; h < HAND; h++) {
      const c = mine.hand[h];
      if (!c) {
        o.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
        continue;
      }
      const monster = c.type === 'monster';
      const need = monster ? G.tributesNeeded(c) : 0;
      o.push(1, monster ? 1 : 0, monster ? c.atk / ATK_SCALE : 0, monster ? c.def / DEF_SCALE : 0, need === 1 ? 1 : 0, need === 2 ? 1 : 0, c.trap === 'block' ? 1 : 0, c.trap === 'protect' ? 1 : 0, c.trap === 'extra' ? 1 : 0);
    }
    for (let f = 0; f < FIELD; f++) {
      const m = mine.field[f];
      if (!m) {
        o.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        continue;
      }
      o.push(1, m.pos === 'atk' ? 1 : 0, m.faceDown ? 1 : 0, m.atk / ATK_SCALE, m.def / DEF_SCALE, m.baseDef / DEF_SCALE, m.attacked ? 1 : 0, m.switched ? 1 : 0, m.summonedTurn === state.turnNo ? 1 : 0, m.protected ? 1 : 0, m.pos === 'atk' && !m.attacked && m.summonedTurn < state.turnNo ? 1 : 0);
    }
    for (let i = 0; i < ZONES; i++) {
      const t = mine.traps[i];
      if (!t) {
        o.push(0, 0, 0, 0, 0);
        continue;
      }
      o.push(1, t.trap === 'block' ? 1 : 0, t.trap === 'protect' ? 1 : 0, t.trap === 'extra' ? 1 : 0, G.trapReady(state, me, i) ? 1 : 0);
    }
    for (let f = 0; f < FIELD; f++) {
      const m = theirs.field[f];
      if (!m) {
        o.push(0, 0, 0, 0, 0, 0);
        continue;
      }
      // The values of a face-down monster are hidden.
      o.push(1, m.faceDown ? 1 : 0, m.pos === 'atk' ? 1 : 0, m.faceDown ? 0 : m.atk / ATK_SCALE, m.faceDown ? 0 : m.def / DEF_SCALE, m.protected ? 1 : 0);
    }
    return o;
  }

  function indexOf(act) {
    switch (act.t) {
      case 'summon': return SUMMON + act.h * 3 + MODES.indexOf(act.mode);
      case 'set': return SET + act.h;
      case 'switch': return SWITCH + act.f;
      case 'flip': return FLIP + act.f * 2 + (act.pos === 'atk' ? 0 : 1);
      case 'extra': return EXTRA + act.i;
      case 'battle': return BATTLE;
      case 'attack': return ATTACK + act.a * (FIELD + 1) + (act.d === null ? FIELD : act.d);
      case 'respond': return act.i === null ? DECLINE : RESPOND + act.i;
      default: return END;
    }
  }

  // The legal action indices for the deciding player (a 0/1 array of length N_ACTIONS).
  function maskFor(state, sel) {
    const mask = new Array(N_ACTIONS).fill(0);
    if (sel) {
      const me = state.players[actingPlayer(state)];
      for (let f = 0; f < me.field.length; f++) if (!sel.chosen.includes(f)) mask[TRIBUTE + f] = 1;
      return mask;
    }
    for (const act of G.legalActions(state)) mask[indexOf(act)] = 1;
    return mask;
  }

  // Turns an action index into either a continued tribute selection ({ sel }) or an engine action ({ act }).
  function toAction(state, idx, sel) {
    const mine = state.players[actingPlayer(state)];
    if (idx >= TRIBUTE && idx < SET) {
      const chosen = [...sel.chosen, idx - TRIBUTE];
      if (chosen.length < sel.need) return { sel: { ...sel, chosen }, act: null };
      return { sel: null, act: { t: 'summon', h: sel.h, mode: sel.mode, tr: chosen } };
    }
    if (idx < TRIBUTE) {
      const h = Math.floor(idx / 3);
      const mode = MODES[idx % 3];
      const need = G.tributesNeeded(mine.hand[h]);
      if (need > 0) return { sel: { h, mode, need, chosen: [] }, act: null };
      return { sel: null, act: { t: 'summon', h, mode, tr: [] } };
    }
    if (idx < SWITCH) return { sel: null, act: { t: 'set', h: idx - SET } };
    if (idx < FLIP) return { sel: null, act: { t: 'switch', f: idx - SWITCH } };
    if (idx < EXTRA) return { sel: null, act: { t: 'flip', f: Math.floor((idx - FLIP) / 2), pos: (idx - FLIP) % 2 === 0 ? 'atk' : 'def' } };
    if (idx < BATTLE) return { sel: null, act: { t: 'extra', i: idx - EXTRA } };
    if (idx === BATTLE) return { sel: null, act: { t: 'battle' } };
    if (idx < RESPOND) {
      const k = idx - ATTACK;
      const d = k % (FIELD + 1);
      return { sel: null, act: { t: 'attack', a: Math.floor(k / (FIELD + 1)), d: d === FIELD ? null : d } };
    }
    if (idx < DECLINE) return { sel: null, act: { t: 'respond', i: idx - RESPOND } };
    if (idx === DECLINE) return { sel: null, act: { t: 'respond', i: null } };
    return { sel: null, act: { t: 'end' } };
  }

  // ---------------------------------------------------------------- the network

  let model = null;

  // m: { obsSize, nActions, hidden, w1, b1, w2, b2, wp, bp, wv, bv } with weights as flat row-major [in][out] arrays.
  function load(m) {
    if (m.obsSize !== OBS_SIZE || m.nActions !== N_ACTIONS) throw new Error('The model does not match this version of the game.');
    model = m;
  }

  const loaded = () => model !== null;

  function dense(x, w, b, nIn, nOut, act) {
    const y = new Array(nOut);
    for (let o = 0; o < nOut; o++) y[o] = b[o];
    for (let i = 0; i < nIn; i++) {
      const xi = x[i];
      if (xi === 0) continue;
      const base = i * nOut;
      for (let o = 0; o < nOut; o++) y[o] += xi * w[base + o];
    }
    return act ? y.map(Math.tanh) : y;
  }

  function forward(obs) {
    const hd = model.hidden;
    const h1 = dense(obs, model.w1, model.b1, OBS_SIZE, hd, true);
    const h2 = dense(h1, model.w2, model.b2, hd, hd, true);
    return { logits: dense(h2, model.wp, model.bp, hd, N_ACTIONS, false), value: dense(h2, model.wv, model.bv, hd, 1, false)[0] };
  }

  // The legal action with the highest score (ties: the lowest index).
  function choose(state, sel) {
    const me = actingPlayer(state);
    const mask = maskFor(state, sel);
    const { logits } = forward(encodeObs(state, me, sel));
    let best = -1;
    for (let i = 0; i < N_ACTIONS; i++) if (mask[i] && (best < 0 || logits[i] > logits[best])) best = i;
    return best;
  }

  // Plays one decision of the player whose turn it is, like Game.aiStep: { done: true } once it ends its turn.
  function step(state) {
    if (state.winner !== null) return { done: true };
    let sel = null;
    for (let n = 0; n < 8; n++) {
      const r = toAction(state, choose(state, sel), sel);
      sel = r.sel;
      if (!r.act) continue; // a tribute choice, nothing happens in the game yet
      if (r.act.t === 'end') {
        state.log.push(`${state.players[state.turn].name} ends its turn.`);
        return { done: true };
      }
      const res = G.applyAction(state, r.act);
      if (!res.ok) throw new Error(`The trained CPU chose an illegal action: ${JSON.stringify(r.act)} (${res.error})`);
      return r.act.t === 'attack' ? { done: false, attack: res } : { done: false };
    }
    throw new Error('The trained CPU did not finish a decision.');
  }

  // The defender's trap choice for the pending attack (an index into its traps, or null), like Game.aiRespond.
  function respond(state) {
    const act = toAction(state, choose(state, null), null).act;
    if (act.t !== 'respond') throw new Error('The trained CPU chose an illegal response.');
    return act.i;
  }

  return { N_ACTIONS, OBS_SIZE, SUMMON, TRIBUTE, SET, SWITCH, FLIP, EXTRA, BATTLE, ATTACK, RESPOND, DECLINE, END, actingPlayer, encodeObs, maskFor, toAction, indexOf, load, loaded, forward, choose, step, respond };
});
