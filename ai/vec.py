"""Environments in parallel worker processes (numpy only, no torch). The learner talks to them through pipes."""
import multiprocessing as mp

import numpy as np

from .env import Env
from . import space as S


def _worker(conn, seed):
    env = Env(seed)
    obs, mask = env.reset()
    while True:
        cmd, data = conn.recv()
        if cmd == 'reset':
            obs, mask = env.reset()
            conn.send((obs.astype(np.float32), mask))
        elif cmd == 'step':
            obs, mask, reward, done = env.step(data)
            info = None
            if done:
                info = (env.opp_kind, reward)
                obs, mask = env.reset()
            conn.send((obs.astype(np.float32), mask, reward, done, info))
        elif cmd == 'add_opponent':
            env.add_opponent(data)
        elif cmd == 'close':
            break


class VecEnv:
    def __init__(self, n, seed=0):
        ctx = mp.get_context('spawn')
        self.n = n
        self.conns, self.procs = [], []
        for i in range(n):
            parent, child = ctx.Pipe()
            p = ctx.Process(target=_worker, args=(child, seed * 1000 + i), daemon=True)
            p.start()
            self.conns.append(parent)
            self.procs.append(p)

    def reset(self):
        for c in self.conns:
            c.send(('reset', None))
        res = [c.recv() for c in self.conns]
        return np.stack([r[0] for r in res]), np.stack([r[1] for r in res])

    def step(self, actions):
        for c, a in zip(self.conns, actions):
            c.send(('step', int(a)))
        res = [c.recv() for c in self.conns]
        obs = np.stack([r[0] for r in res])
        mask = np.stack([r[1] for r in res])
        rewards = np.array([r[2] for r in res], dtype=np.float32)
        dones = np.array([r[3] for r in res], dtype=np.float32)
        return obs, mask, rewards, dones, [r[4] for r in res]

    def add_opponent(self, weights):
        for c in self.conns:
            c.send(('add_opponent', weights))

    def close(self):
        for c in self.conns:
            try:
                c.send(('close', None))
            except Exception:
                pass
        for p in self.procs:
            p.join(timeout=2)
