"""Helpers for the parity tests: run game.js in headless Firefox and replay its recorded games in the Python port."""
import json
import os
from pathlib import Path

import numpy as np

from .. import engine as E
from .. import heuristic as H
from .. import space as S

ROOT = Path(__file__).resolve().parents[2]
FIREFOX = os.environ.get('FIREFOX_BIN', '/snap/firefox/current/usr/lib/firefox/firefox')
GECKODRIVER = os.environ.get('GECKODRIVER', '/snap/bin/geckodriver')


def run_in_browser(script_body, timeout=600):
    """Runs JavaScript (a function body that returns a string) in headless Firefox and returns the string."""
    from selenium import webdriver
    from selenium.webdriver.firefox.options import Options
    from selenium.webdriver.firefox.service import Service

    o = Options()
    o.add_argument('-headless')
    o.binary_location = FIREFOX
    d = webdriver.Firefox(options=o, service=Service(GECKODRIVER))
    try:
        d.set_script_timeout(timeout)
        return d.execute_script(script_body)
    finally:
        d.quit()


def browser_sources():
    return (ROOT / 'game.js').read_text() + '\n' + (ROOT / 'ai.js').read_text() + '\n'


def generate_traces(n_wrapper=60, n_heuristic=100, seed=1):
    body = browser_sources() + (ROOT / 'ai' / 'tests' / 'trace_gen.js').read_text()
    body += f'\nreturn JSON.stringify(runTraces({n_wrapper}, {n_heuristic}, {seed}));'
    return json.loads(run_in_browser(body))


def first_diff(a, b, path=''):
    """The path of the first difference between two plain-data structures, or None."""
    if type(a) != type(b):
        return f'{path}: {a!r} != {b!r}'
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                return f'{path}.{k}: missing on one side'
            d = first_diff(a[k], b[k], f'{path}.{k}')
            if d:
                return d
        return None
    if isinstance(a, list):
        if len(a) != len(b):
            return f'{path}: length {len(a)} != {len(b)}'
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_diff(x, y, f'{path}[{i}]')
            if d:
                return d
        return None
    return None if a == b else f'{path}: {a!r} != {b!r}'


def replay_wrapper_game(game):
    """Replays a game played through the action space. Returns None if everything matched, else a description."""
    s = E.from_snapshot(game['init'], game['confirm'])
    sel = None
    for n, rec in enumerate(game['steps']):
        where = f'step {n}'
        me = S.acting_player(s)
        if me != rec['me']:
            return f'{where}: acting player {me} != {rec["me"]}'
        mask = [int(i) for i in np.nonzero(S.mask_for(s, sel))[0]]
        if mask != rec['mask']:
            return f'{where}: legal action mask differs: python {mask} vs js {rec["mask"]}'
        if 'obs' in rec:
            obs = S.encode_obs(s, me, sel)
            bad = np.nonzero(~np.isclose(obs, np.array(rec['obs']), rtol=0, atol=1e-12))[0]
            if len(bad):
                return f'{where}: observation differs at features {bad[:5].tolist()}: python {obs[bad[:3]].tolist()} vs js {[rec["obs"][i] for i in bad[:3]]}'
        if 'heur' in rec and E.act_key(H.ai_plan(s)) != E.act_key(E.act_from_json(rec['heur'])):
            return f'{where}: heuristic action differs: python {H.ai_plan(s)} vs js {rec["heur"]}'
        if 'heurResp' in rec and H.ai_respond(s) != rec['heurResp']:
            return f'{where}: heuristic trap response differs: python {H.ai_respond(s)} vs js {rec["heurResp"]}'
        sel, act = S.to_action(s, rec['idx'], sel)
        if act is None:
            if 'act' in rec:
                return f'{where}: python continued a selection but js executed an action'
            continue
        if E.act_key(act) != E.act_key(E.act_from_json(rec['act'])):
            return f'{where}: action differs: python {act} vs js {rec["act"]}'
        ok, _ = E.apply_action(s, act)
        if ok != rec['ok']:
            return f'{where}: action accepted by python={ok}, by js={rec["ok"]} ({act})'
        d = first_diff(E.snapshot(s), rec['snap'])
        if d:
            return f'{where} after {act}: state differs at {d}'
    if s.winner != game['winner']:
        return f'winner {s.winner} != {game["winner"]}'
    return None


def replay_heuristic_game(game):
    s = E.from_snapshot(game['init'], game['confirm'])
    for n, rec in enumerate(game['steps']):
        where = f'step {n}'
        act = ('respond', H.ai_respond(s)) if s.pending else H.ai_plan(s)
        if E.act_key(act) != E.act_key(E.act_from_json(rec['act'])):
            return f'{where}: heuristic decision differs: python {act} vs js {rec["act"]}'
        ok, _ = E.apply_action(s, act)
        if ok != rec['ok']:
            return f'{where}: action accepted by python={ok}, by js={rec["ok"]} ({act})'
        d = first_diff(E.snapshot(s), rec['snap'])
        if d:
            return f'{where} after {act}: state differs at {d}'
    if s.winner != game['winner']:
        return f'winner {s.winner} != {game["winner"]}'
    return None


def replay_all(traces):
    """Returns a list of (kind, game index, problem) for every game that did not match."""
    problems = []
    for i, g in enumerate(traces['wrapper']):
        p = replay_wrapper_game(g)
        if p:
            problems.append(('wrapper', i, p))
    for i, g in enumerate(traces['heuristic']):
        p = replay_heuristic_game(g)
        if p:
            problems.append(('heuristic', i, p))
    return problems


def pool_problems(traces):
    js = {c['name']: c for c in traces['pool']}
    problems = []
    if set(js) != set(E.BY_NAME):
        problems.append(f'card names differ: {sorted(set(js) ^ set(E.BY_NAME))}')
    for name, c in E.BY_NAME.items():
        j = js.get(name)
        if j and (j['type'], j['atk'], j['def'], j['trap'], j['weight']) != (c.type, c.atk, c.def_, c.trap, c.weight):
            problems.append(f'card {name} differs: js {j}, python {(c.type, c.atk, c.def_, c.trap, c.weight)}')
    return problems
