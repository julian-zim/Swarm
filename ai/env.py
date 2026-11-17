"""Two-player game as a single-agent environment for the learner, with the opponent played inside step().

The learner (seat `me`) decides one action at a time through the action space in space.py. Everything the opponent does
(the heuristic CPU, an earlier checkpoint of the network, or random legal moves) happens inside reset()/step() until the
learner has to decide again. Reward: +1 for a win, -1 for a loss, 0 for a draw (turn cap), given at the end of the game only.
"""
import random

import numpy as np

from . import engine as E
from . import heuristic as H
from . import space as S

TURN_CAP = 120
DECISION_CAP = 3000


class NumpyPolicy:
    """The network (tanh MLP, as in ai.js) evaluated with numpy. weights: dict of arrays w1 b1 w2 b2 wp bp (wv, bv optional)."""

    def __init__(self, w):
        self.w = {k: np.asarray(v, dtype=np.float64) for k, v in w.items()}

    def logits(self, obs):
        w = self.w
        h = np.tanh(obs @ w['w1'] + w['b1'])
        h = np.tanh(h @ w['w2'] + w['b2'])
        return h @ w['wp'] + w['bp']

    def choose(self, obs, mask, rng, greedy=False):
        logits = np.where(mask, self.logits(obs), -np.inf)
        if greedy:
            return int(np.argmax(logits))
        p = np.exp(logits - logits.max())
        c = np.cumsum(p)
        return min(int(np.searchsorted(c, rng.random() * c[-1], side='right')), S.N_ACTIONS - 1)


class Env:
    def __init__(self, seed=0, p_heuristic=0.5):
        self.rng = random.Random(seed)
        self.pool = []  # earlier checkpoints of the network, as NumpyPolicy
        self.p_heuristic = p_heuristic
        self.s = None

    def add_opponent(self, weights, keep=24):
        self.pool.append(NumpyPolicy(weights))
        del self.pool[:-keep]

    def _pick_opponent(self):
        if not self.pool or self.rng.random() < self.p_heuristic:
            return 'heuristic', None
        if self.rng.random() < 0.7:
            return 'net', self.pool[-1 - self.rng.randrange(min(5, len(self.pool)))]
        return 'net', self.rng.choice(self.pool)

    def reset(self, opponent=None, seat=None, seed=None, greedy_opponent=False):
        """Starts a game. opponent: None (mixture) or 'heuristic' / 'random' / a NumpyPolicy. Returns (obs, mask)."""
        self.s = E.new_game(random.Random(seed) if seed is not None else self.rng)
        self.me = self.rng.randrange(2) if seat is None else seat
        if opponent is None:
            self.opp_kind, self.opp_policy = self._pick_opponent()
        elif isinstance(opponent, str):
            self.opp_kind, self.opp_policy = opponent, None
        else:
            self.opp_kind, self.opp_policy = 'net', opponent
        self.greedy_opponent = greedy_opponent
        self.sel = None
        self.opp_sel = None
        self.decisions = 0
        self._advance()
        return self._observe()

    def _observe(self):
        return S.encode_obs(self.s, self.me, self.sel), S.mask_for(self.s, self.sel)

    def finished(self):
        s = self.s
        return s.winner is not None or s.turn_no > TURN_CAP or self.decisions > DECISION_CAP

    def result(self):
        """+1 win, -1 loss, 0 draw for the learner."""
        w = self.s.winner
        return 0.0 if w is None else (1.0 if w == self.me else -1.0)

    def _advance(self):
        s = self.s
        while not self.finished() and S.acting_player(s) != self.me:
            self._opponent_move()
            self.decisions += 1

    def _opponent_move(self):
        s = self.s
        actor = S.acting_player(s)
        if self.opp_kind == 'heuristic':
            act = ('respond', H.ai_respond(s)) if s.pending else H.ai_plan(s)
        else:
            obs, mask = S.encode_obs(s, actor, self.opp_sel), S.mask_for(s, self.opp_sel)
            if self.opp_kind == 'random':
                idx = int(self.rng.choice(np.flatnonzero(mask)))
            else:
                idx = self.opp_policy.choose(obs, mask, self.rng, self.greedy_opponent)
            self.opp_sel, act = S.to_action(s, idx, self.opp_sel)
            if act is None:
                return
        ok, _ = E.apply_action(s, act)
        assert ok, f'illegal opponent action {act}'

    def step(self, idx):
        """The learner's decision. Returns (obs, mask, reward, done); on done, obs/mask belong to no further decision."""
        s = self.s
        self.sel, act = S.to_action(s, idx, self.sel)
        if act is not None:
            ok, _ = E.apply_action(s, act)
            assert ok, f'illegal learner action {act}'
            self.decisions += 1
        self._advance()
        if self.finished():
            return None, None, self.result(), True
        obs, mask = self._observe()
        return obs, mask, 0.0, False


def play_games(weights, opponent, seeds, seats, greedy=True):
    """Plays one game per (seed, seat) with the network as learner (greedy by default) against `opponent`
    ('heuristic', 'random'). Returns (wins, losses, draws)."""
    pol = NumpyPolicy(weights)
    env = Env(seed=12345)
    wins = losses = draws = 0
    for seed, seat in zip(seeds, seats):
        obs, mask = env.reset(opponent=opponent, seat=seat, seed=seed)
        while not env.finished():
            obs, mask, r, done = env.step(pol.choose(obs, mask, env.rng, greedy))
            if done:
                break
        r = env.result()
        wins += r > 0
        losses += r < 0
        draws += r == 0
    return wins, losses, draws
