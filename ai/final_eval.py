"""Final evaluation: greedy trained network vs the heuristic CPU and vs a random legal player, 1000 games each,
500 per seat, fixed seeds (not used during training or checkpoint evals). Run: .venv/bin/python -m ai.final_eval"""
import json
from concurrent.futures import ProcessPoolExecutor
from multiprocessing import get_context
from pathlib import Path

import numpy as np

from .train import evaluate, wilson

if __name__ == '__main__':
    m = json.load(open(Path(__file__).resolve().parent / 'model.json'))
    w = {k: np.array(m[k]).reshape(m['obsSize'] if k == 'w1' else m['hidden'], -1) if k.startswith('w') else np.array(m[k]) for k in ('w1', 'b1', 'w2', 'b2', 'wp', 'bp')}
    with ProcessPoolExecutor(12, mp_context=get_context('spawn')) as pool:
        for opp in ('heuristic', 'random'):
            wins, losses, draws = evaluate(pool, w, opp, 1000, 20_000_000)
            lo, hi = wilson(wins, 1000)
            print(f'vs {opp}: {wins} wins, {losses} losses, {draws} draws of 1000 -> win rate {wins / 10:.1f}% (95% CI {lo * 100:.1f}-{hi * 100:.1f}%)')
