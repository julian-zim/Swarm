"""Python port of the heuristic CPU in game.js (aiPlan and aiRespond). Parity-tested against the JS version."""
from .engine import FACE_DOWN_GUESS, FIELD_SIZE, TRAP_ZONES, preview_battle, trap_ready, tributes_needed


def ai_respond(s):
    """The defender's trap choice (index into its traps) or None, for the pending attack."""
    pend = s.pending
    options = pend.options
    p = s.players[1 - s.turn]
    t = None if pend.t_idx is None else p.field[pend.t_idx]
    if t is None:
        t_destroyed, _, def_lp, _, _ = preview_battle(pend.att.atk, None, None, direct=True)
        direct = True
    else:
        t_destroyed, _, def_lp, _, _ = preview_battle(pend.att.atk, t.pos, t.def_)
        direct = False
    if not (direct or t_destroyed or def_lp > 0):
        return None

    def find(kind):
        for i in options:
            if p.traps[i].kind == kind:
                return i
        return None

    if t is not None and t_destroyed and find('protect') is not None:
        return find('protect')
    if find('block') is not None:
        return find('block')
    return None


def ai_plan(s):
    """The heuristic CPU's next action for the player whose turn it is. Does not change the state."""
    me, other = s.cur(), s.opp()

    def plan(m):
        if not other.field:
            return (None,)
        best, best_score = None, -1
        for ti, t in enumerate(other.field):
            t_destroyed, a_destroyed, def_lp, atk_lp, _ = preview_battle(m.atk, 'def' if t.face_down else t.pos, FACE_DOWN_GUESS if t.face_down else t.def_)
            if not t_destroyed or a_destroyed or atk_lp:
                continue
            if def_lp + 1 > best_score:
                best_score = def_lp + 1
                best = (ti,)
        return best

    def attackers():
        return [(i, m) for i, m in enumerate(me.field) if m.pos == 'atk' and not m.attacked and m.summoned_turn < s.turn_no]

    if s.phase == 'battle':
        for i, m in attackers():
            p = plan(m)
            if p:
                return ('attack', i, p[0])
        return ('end',)

    for h, c in enumerate(me.hand):
        if c.type == 'trap':
            if len(me.traps) < TRAP_ZONES:
                return ('set', h)
            break

    def best_summon():
        weakest = sorted(((i, m.atk + m.def_) for i, m in enumerate(me.field)), key=lambda x: x[1])
        best = None
        for i, c in enumerate(me.hand):
            if c.type != 'monster':
                continue
            need = tributes_needed(c)
            if need > len(me.field) or len(me.field) - need >= FIELD_SIZE:
                continue
            paid = weakest[:need]
            if need and (c.atk + c.def_) < sum(v for _, v in paid) + 1500:
                continue
            if best is None or max(c.atk, c.def_) > max(best[0].atk, best[0].def_):
                best = (c, i, tuple(x for x, _ in paid))
        return best

    if s.summons_left > 0:
        best = best_summon()
        if best:
            return ('summon', best[1], 'set' if best[0].def_ > best[0].atk else 'atk', best[2])
    if s.summons_left == 0 and best_summon():
        for i, t in enumerate(me.traps):
            if t.kind == 'extra' and trap_ready(s, s.turn, i):
                return ('extra', i)

    for i, m in enumerate(me.field):
        if m.pos == 'atk' and not m.switched and not m.attacked and m.summoned_turn < s.turn_no and m.def_ < m.base_def / 2 and not plan(m):
            return ('switch', i)

    if any(plan(m) for _, m in attackers()):
        return ('battle',)
    return ('end',)
