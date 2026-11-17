"""Rules parity: the Python port must behave exactly like game.js. Run: .venv/bin/python -m ai.tests.test_parity

game.js plays recorded games in headless Firefox (random legal moves through the model's action space, and whole games of
the JS heuristic CPU). Python replays every action and compares the full game state, the observation vector, the legal
action mask and the heuristic's decision at every step. Then deliberately broken ports must be caught (negative controls).
"""
import sys
import time

from .. import engine as E
from .. import heuristic as H
from . import parity as P


def main():
    n_wrapper, n_heuristic = 100, 100
    t0 = time.time()
    traces = P.generate_traces(n_wrapper, n_heuristic, seed=1)
    steps_w = sum(len(g['steps']) for g in traces['wrapper'])
    steps_h = sum(len(g['steps']) for g in traces['heuristic'])
    obs_n = sum(1 for g in traces['wrapper'] for r in g['steps'] if 'obs' in r)
    print(f'recorded in {time.time() - t0:.0f}s: {n_wrapper} wrapper games ({steps_w} decisions, {obs_n} observations compared), '
          f'{n_heuristic} heuristic games ({steps_h} actions)')
    outcomes = {'wrapper_winners': sorted({g['winner'] for g in traces['wrapper']}, key=str), 'ends_by_lp': sum(1 for g in traces['heuristic'] if g['winner'] is not None)}
    print('game outcomes seen:', outcomes)

    cov = {}
    def count(key):
        cov[key] = cov.get(key, 0) + 1
    for g in traces['wrapper'] + traces['heuristic']:
        for r in g['steps']:
            a = r.get('act')
            if not a:
                continue
            count(a['t'])
            if a['t'] == 'summon' and a['tr']:
                count('summon with tributes')
            if a['t'] == 'summon' and a['mode'] == 'set':
                count('summon face-down')
            if a['t'] == 'respond' and a['i'] is not None:
                count('trap used in response')
            if a['t'] == 'attack' and a['d'] is None:
                count('direct attack')
        for r in g['steps']:
            pass
    print('coverage (actions executed in the recorded games):', dict(sorted(cov.items())))
    must = ['summon', 'set', 'switch', 'flip', 'extra', 'battle', 'attack', 'respond', 'end', 'summon with tributes', 'summon face-down', 'trap used in response', 'direct attack']
    missing = [k for k in must if not cov.get(k)]
    print('every kind of action covered:', not missing, missing or '')

    failures = len(missing)
    pp = P.pool_problems(traces)
    print('card pool and deck weights match:', not pp, pp[:3] if pp else '')
    failures += len(pp)

    problems = P.replay_all(traces)
    print(f'REPLAY: {len(problems)} of {n_wrapper + n_heuristic} games differ')
    for kind, i, p in problems[:5]:
        print('  ', kind, i, p)
    failures += len(problems)

    # Negative controls: a port with a deliberate bug must be detected.
    def broken(label, patch, undo):
        patch()
        try:
            found = len(P.replay_all(traces))
        finally:
            undo()
        ok = found > 0
        print(f'negative control "{label}": {found} games differ -> {"detected" if ok else "NOT DETECTED"}')
        return 0 if ok else 1

    orig_regen, orig_preview, orig_guess = E.REGEN, E.preview_battle, H.FACE_DOWN_GUESS
    failures += broken('DEF regeneration of 1500 instead of 2000', lambda: setattr(E, 'REGEN', 1500), lambda: setattr(E, 'REGEN', orig_regen))

    def buggy_preview(att_atk, t_pos, t_def, direct=False):
        r = orig_preview(att_atk, t_pos, t_def, direct)
        return (r[0] or (not direct and t_pos == 'def' and t_def - att_atk <= 0),) + r[1:]

    def patch_preview():
        E.preview_battle = buggy_preview
        H.preview_battle = buggy_preview

    def undo_preview():
        E.preview_battle = orig_preview
        H.preview_battle = orig_preview

    failures += broken('DEF monster dies when drained to exactly 0', patch_preview, undo_preview)
    failures += broken('heuristic guesses DEF 100 for face-down monsters', lambda: setattr(H, 'FACE_DOWN_GUESS', 100), lambda: setattr(H, 'FACE_DOWN_GUESS', orig_guess))

    print('PARITY', 'PASSED' if failures == 0 else f'FAILED ({failures} problems)')
    return 0 if failures == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
