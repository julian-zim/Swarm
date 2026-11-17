"""Model inference parity: ai.js (browser) and numpy must give the same logits (1e-4) and the same greedy action.
Run: .venv/bin/python -m ai.tests.test_model_parity
The browser plays games where the trained network (seat A) faces random legal moves (seat B); at each decision of the
network it records the observation, the legal mask, the logits and the chosen index. numpy recomputes logits and choice
from ai/model.json. Observation encoding itself is covered by test_parity.
"""
import json
import sys

import numpy as np

from . import parity as P
from ..env import NumpyPolicy

JS = r'''
const G = Game, T = TrainedAI;
T.load(MODEL);
const out = [];
for (let g = 0; g < N; g++) {
  const rng = G.mulberry32(900 + g);
  const s = G.newGame(G.mulberry32(300 + g), ['A', 'B'], { confirmAttacksOn: null });
  let sel = null;
  for (let n = 0; n < 700 && s.winner === null; n++) {
    const me = T.actingPlayer(s);
    const mask = T.maskFor(s, sel);
    let idx;
    if (me === g % 2) {
      const obs = T.encodeObs(s, me, sel);
      const { logits } = T.forward(obs);
      idx = T.choose(s, sel);
      out.push({ obs, mask, logits, idx });
    } else {
      const legal = []; mask.forEach((v, i) => { if (v) legal.push(i); });
      idx = legal[Math.floor(rng() * legal.length)];
    }
    const r = T.toAction(s, idx, sel);
    sel = r.sel;
    if (r.act) { const res = G.applyAction(s, r.act); if (!res.ok) throw new Error('illegal ' + JSON.stringify(r.act)); }
  }
}
return JSON.stringify(out);
'''


def main():
    model = json.load(open(P.ROOT / 'ai' / 'model.json'))
    body = P.browser_sources() + f'const MODEL = {json.dumps(model)}; const N = 40;\n' + JS
    recs = json.loads(P.run_in_browser(body))
    pol = NumpyPolicy({k: np.array(model[k]).reshape(model['obsSize'] if k == 'w1' else model['hidden'], -1) if k.startswith('w') else np.array(model[k]) for k in ('w1', 'b1', 'w2', 'b2', 'wp', 'bp')})

    def check(policy):
        worst, bad_choice = 0.0, 0
        for r in recs:
            lg = policy.logits(np.array(r['obs']))
            worst = max(worst, float(np.abs(lg - np.array(r['logits'])).max()))
            mask = np.array(r['mask'], bool)
            if int(np.argmax(np.where(mask, lg, -np.inf))) != r['idx']:
                bad_choice += 1
        return worst, bad_choice

    worst, bad = check(pol)
    print(f'{len(recs)} decisions: max |logit diff| {worst:.2e}, different greedy action: {bad}')
    ok = worst < 1e-4 and bad == 0 and len(recs) > 500
    # negative control: a perturbed network must be flagged
    w = {k: v.copy() for k, v in pol.w.items()}
    w['wp'][3, 5] += 0.01
    worst_n, bad_n = check(NumpyPolicy(w))
    print(f'negative control (one weight +0.01): max diff {worst_n:.2e}, different actions {bad_n}')
    ok = ok and worst_n >= 1e-4
    print('MODEL PARITY PASSED' if ok else 'MODEL PARITY FAILED')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
