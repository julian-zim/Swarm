"""PPO with action masking and self-play. Run: .venv/bin/python -m ai.train --minutes 30 --name run1

Learner: tanh MLP 252 -> 256 -> 256 with a policy head (107 actions, illegal ones masked) and a value head.
Opponents: the heuristic CPU (50% of games) and earlier checkpoints of the network (the rest). Both seats are trained.
Reward: +1 win, -1 loss, 0 draw, at the end of the game only. Rollouts run on CPU in 24 worker processes, updates on the GPU.
"""
import argparse
import json
import math
import time
from concurrent.futures import ProcessPoolExecutor
from multiprocessing import get_context
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.distributions import Categorical

from . import space as S
from .env import play_games
from .vec import VecEnv

RUNS = Path(__file__).resolve().parent / 'runs'
HIDDEN = 256


class Net(nn.Module):
    def __init__(self, hidden=HIDDEN):
        super().__init__()
        self.l1 = nn.Linear(S.OBS_SIZE, hidden)
        self.l2 = nn.Linear(hidden, hidden)
        self.pi = nn.Linear(hidden, S.N_ACTIONS)
        self.v = nn.Linear(hidden, 1)
        for layer, gain in ((self.l1, math.sqrt(2)), (self.l2, math.sqrt(2)), (self.pi, 0.01), (self.v, 1.0)):
            nn.init.orthogonal_(layer.weight, gain)
            nn.init.zeros_(layer.bias)

    def forward(self, x, mask=None):
        h = torch.tanh(self.l2(torch.tanh(self.l1(x))))
        logits = self.pi(h)
        if mask is not None:
            logits = logits.masked_fill(~mask, -1e9)
        return logits, self.v(h).squeeze(-1)

    def weights(self):
        """Weights as numpy arrays in [in][out] layout (y = x @ w + b), the format of model.json."""
        t = lambda lin: (lin.weight.detach().cpu().numpy().T.copy(), lin.bias.detach().cpu().numpy().copy())
        w1, b1 = t(self.l1)
        w2, b2 = t(self.l2)
        wp, bp = t(self.pi)
        wv, bv = t(self.v)
        return {'w1': w1, 'b1': b1, 'w2': w2, 'b2': b2, 'wp': wp, 'bp': bp, 'wv': wv, 'bv': bv}


def compute_gae(rewards, values, dones, last_value, gamma, lam):
    """rewards, values, dones: arrays (T, N). dones[t] = the episode ended with step t. Returns advantages and returns."""
    T = rewards.shape[0]
    adv = np.zeros_like(rewards)
    last = 0.0
    for t in reversed(range(T)):
        next_value = last_value if t == T - 1 else values[t + 1]
        nonterminal = 1.0 - dones[t]
        delta = rewards[t] + gamma * next_value * nonterminal - values[t]
        last = delta + gamma * lam * nonterminal * last
        adv[t] = last
    return adv, adv + values


def _eval_chunk(args):
    weights, opponent, seeds, seats = args
    return play_games(weights, opponent, seeds, seats)


def evaluate(pool, weights, opponent, n_games, seed0, workers=12):
    """Greedy network vs opponent over n_games with fixed seeds, half in each seat. Returns (wins, losses, draws)."""
    seeds = [seed0 + i for i in range(n_games)]
    seats = [i % 2 for i in range(n_games)]
    chunks = [(weights, opponent, seeds[k::workers], seats[k::workers]) for k in range(workers)]
    res = list(pool.map(_eval_chunk, chunks))
    return tuple(int(sum(r[i] for r in res)) for i in range(3))


def wilson(wins, n, z=1.96):
    p = wins / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--minutes', type=float, default=30)
    ap.add_argument('--name', default='run')
    ap.add_argument('--envs', type=int, default=24)
    ap.add_argument('--rollout', type=int, default=128)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--eval-every', type=float, default=240, help='seconds between evaluations against the heuristic')
    ap.add_argument('--eval-games', type=int, default=240)
    ap.add_argument('--max-updates', type=int, default=None)
    ap.add_argument('--opponent-every', type=int, default=40, help='updates between new checkpoints entering the opponent pool')
    ap.add_argument('--lr', type=float, default=3e-4)
    ap.add_argument('--ent', type=float, default=0.02)
    ap.add_argument('--gamma', type=float, default=0.997)
    args = ap.parse_args()

    run = RUNS / args.name
    run.mkdir(parents=True, exist_ok=True)
    logf = open(run / 'log.jsonl', 'a')
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    # Worker processes first (they do not use torch or the GPU).
    vec = VecEnv(args.envs, seed=args.seed)
    eval_pool = ProcessPoolExecutor(max_workers=12, mp_context=get_context('spawn'))
    dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    net = Net().to(dev)
    cpu_net = Net()
    cpu_net.load_state_dict({k: v.cpu() for k, v in net.state_dict().items()})
    torch.set_num_threads(2)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr, eps=1e-5)
    vec.add_opponent(net.weights())  # the untrained network is the first opponent in the pool

    T, N = args.rollout, args.envs
    obs, mask = vec.reset()
    budget = args.minutes * 60
    t0 = time.time()
    last_eval = t0
    updates = 0
    env_steps = 0
    episodes = {'heuristic': [], 'net': []}
    best = (-1.0, None)
    gamma, lam = args.gamma, 0.95

    def log(rec):
        rec['t'] = round(time.time() - t0, 1)
        logf.write(json.dumps(rec) + '\n')
        logf.flush()

    def do_eval(final=False):
        w = net.weights()
        wins, losses, draws = evaluate(eval_pool, w, 'heuristic', args.eval_games, 7_000_000)
        lo, hi = wilson(wins, args.eval_games)
        rec = {'eval_vs_heuristic': wins / args.eval_games, 'ci95': [round(lo, 3), round(hi, 3)], 'wins': wins, 'losses': losses, 'draws': draws, 'updates': updates, 'steps': env_steps}
        log(rec)
        print(f'[{time.time() - t0:6.0f}s] EVAL vs heuristic: {wins}/{args.eval_games} = {wins / args.eval_games:.3f} (95% CI {lo:.3f}-{hi:.3f}), updates {updates}', flush=True)
        return wins / args.eval_games

    while time.time() - t0 < budget and (args.max_updates is None or updates < args.max_updates):
        progress = min(1.0, (time.time() - t0) / budget)
        for g in opt.param_groups:
            g['lr'] = args.lr * (1 - 0.9 * progress)
        ent_coef = args.ent * (1 - 0.75 * progress)

        b_obs = np.zeros((T, N, S.OBS_SIZE), np.float32)
        b_mask = np.zeros((T, N, S.N_ACTIONS), bool)
        b_act = np.zeros((T, N), np.int64)
        b_logp = np.zeros((T, N), np.float32)
        b_val = np.zeros((T, N), np.float32)
        b_rew = np.zeros((T, N), np.float32)
        b_done = np.zeros((T, N), np.float32)
        for t in range(T):
            with torch.no_grad():
                logits, val = cpu_net(torch.from_numpy(obs), torch.from_numpy(mask))
                dist = Categorical(logits=logits)
                act = dist.sample()
            b_obs[t], b_mask[t], b_act[t], b_logp[t], b_val[t] = obs, mask, act.numpy(), dist.log_prob(act).numpy(), val.numpy()
            obs, mask, rew, done, infos = vec.step(act.numpy())
            b_rew[t], b_done[t] = rew, done
            for inf in infos:
                if inf:
                    episodes[inf[0]].append(inf[1])
                    del episodes[inf[0]][:-300]
        env_steps += T * N
        with torch.no_grad():
            _, last_val = cpu_net(torch.from_numpy(obs), torch.from_numpy(mask))
        adv, ret = compute_gae(b_rew, b_val, b_done, last_val.numpy(), gamma, lam)

        flat = lambda x: torch.from_numpy(x.reshape(T * N, *x.shape[2:])).to(dev)
        f_obs, f_mask, f_act, f_logp, f_adv, f_ret = flat(b_obs), flat(b_mask), flat(b_act), flat(b_logp), flat(adv.astype(np.float32)), flat(ret.astype(np.float32))
        f_adv = (f_adv - f_adv.mean()) / (f_adv.std() + 1e-8)
        stats = []
        for _ in range(4):
            perm = torch.randperm(T * N, device=dev)
            for i in range(0, T * N, 1024):
                mb = perm[i:i + 1024]
                logits, val = net(f_obs[mb], f_mask[mb])
                dist = Categorical(logits=logits)
                logp = dist.log_prob(f_act[mb])
                ratio = torch.exp(logp - f_logp[mb])
                pg = -torch.min(ratio * f_adv[mb], torch.clamp(ratio, 0.8, 1.2) * f_adv[mb]).mean()
                vl = 0.5 * ((val - f_ret[mb]) ** 2).mean()
                ent = dist.entropy().mean()
                loss = pg + 0.5 * vl - ent_coef * ent
                opt.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(net.parameters(), 0.5)
                opt.step()
                stats.append((pg.item(), vl.item(), ent.item()))
        updates += 1
        cpu_net.load_state_dict({k: v.cpu() for k, v in net.state_dict().items()})

        if updates % args.opponent_every == 0:
            vec.add_opponent(net.weights())

        if updates % 10 == 0:
            m = lambda xs: float(np.mean(xs)) if xs else float('nan')
            s = np.mean(stats, axis=0)
            wr_h = m([r > 0 for r in episodes['heuristic']])
            wr_n = m([r > 0 for r in episodes['net']])
            rec = {'updates': updates, 'steps': env_steps, 'train_win_vs_heuristic': wr_h, 'train_win_vs_selfplay': wr_n, 'pg': float(s[0]), 'vl': float(s[1]), 'entropy': float(s[2]), 'lr': opt.param_groups[0]['lr']}
            log(rec)
            if updates % 50 == 0:
                print(f'[{time.time() - t0:6.0f}s] update {updates:5d} steps {env_steps / 1e6:5.2f}M  train win vs heuristic {wr_h:.2f} vs self-play {wr_n:.2f}  entropy {s[2]:.2f}', flush=True)

        if time.time() - last_eval >= args.eval_every:
            score = do_eval()
            last_eval = time.time()
            if score > best[0]:
                best = (score, updates)
                torch.save({'state_dict': net.state_dict(), 'updates': updates, 'eval_vs_heuristic': score}, run / 'best.pt')
            torch.save({'state_dict': net.state_dict(), 'updates': updates}, run / 'last.pt')

    score = do_eval(final=True)
    if score > best[0]:
        best = (score, updates)
        torch.save({'state_dict': net.state_dict(), 'updates': updates, 'eval_vs_heuristic': score}, run / 'best.pt')
    torch.save({'state_dict': net.state_dict(), 'updates': updates}, run / 'last.pt')
    print(f'done: {updates} updates, {env_steps / 1e6:.1f}M learner decisions in {time.time() - t0:.0f}s; best eval {best[0]:.3f} at update {best[1]}', flush=True)
    vec.close()
    eval_pool.shutdown()


if __name__ == '__main__':
    main()
