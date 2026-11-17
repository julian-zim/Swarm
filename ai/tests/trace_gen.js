// Runs inside the browser (see test_parity.py) after game.js and ai.js were loaded. Records games for the Python replay.
function runTraces(nWrapper, nHeuristic, seedBase) {
  const G = Game;
  const T = TrainedAI;
  const out = { wrapper: [], heuristic: [] };
  const confirms = [null, 0, 1];

  // Random legal moves through the model's action space (tribute selection included). Records observations and masks.
  for (let g = 0; g < nWrapper; g++) {
    const rng = G.mulberry32(seedBase + 5000 + g);
    const confirm = confirms[g % 3];
    const s = G.newGame(G.mulberry32(seedBase + g), ['A', 'B'], { confirmAttacksOn: confirm });
    const game = { confirm, init: G.snapshot(s), steps: [] };
    let sel = null;
    for (let n = 0; n < 900 && s.winner === null; n++) {
      const me = T.actingPlayer(s);
      const mask = T.maskFor(s, sel);
      const legal = [];
      mask.forEach((v, i) => { if (v) legal.push(i); });
      const rec = { me, mask: legal };
      if (n % 4 === 0) rec.obs = T.encodeObs(s, me, sel);
      if (!sel && !s.pending) rec.heur = G.aiPlan(s);
      if (!sel && s.pending) rec.heurResp = G.aiRespond(s);
      const idx = legal[Math.floor(rng() * legal.length)];
      rec.idx = idx;
      const r = T.toAction(s, idx, sel);
      sel = r.sel;
      if (r.act) {
        const res = G.applyAction(s, r.act);
        rec.act = r.act;
        rec.ok = res.ok === true;
        rec.snap = G.snapshot(s);
      }
      game.steps.push(rec);
    }
    game.winner = s.winner;
    out.wrapper.push(game);
  }

  // Whole games played by the JS heuristic CPU (both seats), recording each engine action.
  for (let g = 0; g < nHeuristic; g++) {
    const confirm = confirms[g % 3];
    const s = G.newGame(G.mulberry32(seedBase + 90000 + g), ['A', 'B'], { confirmAttacksOn: confirm });
    const game = { confirm, init: G.snapshot(s), steps: [] };
    for (let n = 0; n < 900 && s.winner === null; n++) {
      const act = s.pending ? { t: 'respond', i: G.aiRespond(s) } : G.aiPlan(s);
      const res = G.applyAction(s, act);
      game.steps.push({ act, ok: res.ok === true, snap: G.snapshot(s) });
    }
    game.winner = s.winner;
    out.heuristic.push(game);
  }

  // Deck odds and card pool, to compare with the Python port.
  out.pool = G.POOL.map((c) => ({ name: c.name, type: c.type, atk: c.atk || 0, def: c.def || 0, trap: c.trap || null, weight: G.cardWeight(c) }));
  return out;
}
