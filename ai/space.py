"""Observation encoding, action space and legality mask. Mirrors ai.js exactly (checked by ai/tests/test_parity.py)."""
import numpy as np

from .engine import FIELD_SIZE, MAX_HAND_SLOTS, TRAP_ZONES, legal_actions, tributes_needed, trap_ready

HAND, FIELD, ZONES = MAX_HAND_SLOTS, FIELD_SIZE, TRAP_ZONES

SUMMON = 0
TRIBUTE = SUMMON + HAND * 3
SET = TRIBUTE + FIELD
SWITCH = SET + HAND
FLIP = SWITCH + FIELD
EXTRA = FLIP + FIELD * 2
BATTLE = EXTRA + ZONES
ATTACK = BATTLE + 1
RESPOND = ATTACK + FIELD * (FIELD + 1)
DECLINE = RESPOND + ZONES
END = DECLINE + 1
N_ACTIONS = END + 1  # 107
MODES = ('atk', 'def', 'set')

ATK_SCALE, DEF_SCALE, LP_SCALE = 3500, 3000, 8000
OBS_SIZE = 22 + 22 + HAND * 9 + FIELD * 11 + ZONES * 5 + FIELD * 6  # 252


class Selection:
    """A tribute selection in progress (the model picks tributes one at a time)."""
    __slots__ = ('h', 'mode', 'need', 'chosen')

    def __init__(self, h, mode, need, chosen):
        self.h, self.mode, self.need, self.chosen = h, mode, need, chosen


def acting_player(s):
    return 1 - s.turn if s.pending else s.turn


def encode_obs(s, me, sel):
    mine, theirs = s.players[me], s.players[1 - me]
    pend = s.pending
    pend_target = mine.field[pend.t_idx] if pend and pend.t_idx is not None else None
    o = [
        1 if s.phase == 'main' else 0, 1 if s.phase == 'battle' else 0, s.turn_no / 60, s.summons_left / 2,
        mine.lp / LP_SCALE, theirs.lp / LP_SCALE, len(mine.deck) / 20, len(theirs.deck) / 20,
        len(mine.hand) / HAND, len(theirs.hand) / HAND, mine.graveyard / 20, theirs.graveyard / 20,
        1 if s.turn == me else 0, 1 if pend else 0, pend.att.atk / ATK_SCALE if pend else 0,
        1 if pend and pend.t_idx is None else 0, pend_target.def_ / DEF_SCALE if pend_target else 0,
        1 if pend_target and pend_target.pos == 'atk' else 0, 1 if mine.trap_used_turn == s.turn_no else 0,
        len(theirs.traps) / ZONES, len(mine.traps) / ZONES, 1 if me == 0 else 0,
    ]
    o.append(1 if sel else 0)
    o.append((sel.need - len(sel.chosen)) / 2 if sel else 0)
    for f in range(FIELD):
        o.append(1 if sel and f in sel.chosen else 0)
    for h in range(HAND):
        o.append(1 if sel and sel.h == h else 0)
    for m in MODES:
        o.append(1 if sel and sel.mode == m else 0)

    for h in range(HAND):
        if h >= len(mine.hand):
            o.extend((0,) * 9)
            continue
        c = mine.hand[h]
        monster = c.type == 'monster'
        need = tributes_needed(c) if monster else 0
        o.extend((1, 1 if monster else 0, c.atk / ATK_SCALE if monster else 0, c.def_ / DEF_SCALE if monster else 0,
                  1 if need == 1 else 0, 1 if need == 2 else 0, 1 if c.trap == 'block' else 0, 1 if c.trap == 'protect' else 0, 1 if c.trap == 'extra' else 0))
    for f in range(FIELD):
        if f >= len(mine.field):
            o.extend((0,) * 11)
            continue
        m = mine.field[f]
        o.extend((1, 1 if m.pos == 'atk' else 0, 1 if m.face_down else 0, m.atk / ATK_SCALE, m.def_ / DEF_SCALE, m.base_def / DEF_SCALE,
                  1 if m.attacked else 0, 1 if m.switched else 0, 1 if m.summoned_turn == s.turn_no else 0, 1 if m.protected else 0,
                  1 if m.pos == 'atk' and not m.attacked and m.summoned_turn < s.turn_no else 0))
    for i in range(ZONES):
        if i >= len(mine.traps):
            o.extend((0,) * 5)
            continue
        t = mine.traps[i]
        o.extend((1, 1 if t.kind == 'block' else 0, 1 if t.kind == 'protect' else 0, 1 if t.kind == 'extra' else 0, 1 if trap_ready(s, me, i) else 0))
    for f in range(FIELD):
        if f >= len(theirs.field):
            o.extend((0,) * 6)
            continue
        m = theirs.field[f]
        o.extend((1, 1 if m.face_down else 0, 1 if m.pos == 'atk' else 0, 0 if m.face_down else m.atk / ATK_SCALE,
                  0 if m.face_down else m.def_ / DEF_SCALE, 1 if m.protected else 0))
    return np.array(o, dtype=np.float64)


def index_of(act):
    t = act[0]
    if t == 'summon':
        return SUMMON + act[1] * 3 + MODES.index(act[2])
    if t == 'set':
        return SET + act[1]
    if t == 'switch':
        return SWITCH + act[1]
    if t == 'flip':
        return FLIP + act[1] * 2 + (0 if act[2] == 'atk' else 1)
    if t == 'extra':
        return EXTRA + act[1]
    if t == 'battle':
        return BATTLE
    if t == 'attack':
        return ATTACK + act[1] * (FIELD + 1) + (FIELD if act[2] is None else act[2])
    if t == 'respond':
        return DECLINE if act[1] is None else RESPOND + act[1]
    return END


def mask_for(s, sel):
    mask = np.zeros(N_ACTIONS, dtype=bool)
    if sel:
        me = s.players[acting_player(s)]
        for f in range(len(me.field)):
            if f not in sel.chosen:
                mask[TRIBUTE + f] = True
        return mask
    for act in legal_actions(s):
        mask[index_of(act)] = True
    return mask


def to_action(s, idx, sel):
    """Returns (new_sel, action): either a continued tribute selection (action None) or an engine action."""
    mine = s.players[acting_player(s)]
    if TRIBUTE <= idx < SET:
        chosen = list(sel.chosen) + [idx - TRIBUTE]
        if len(chosen) < sel.need:
            return Selection(sel.h, sel.mode, sel.need, chosen), None
        return None, ('summon', sel.h, sel.mode, tuple(chosen))
    if idx < TRIBUTE:
        h, mode = idx // 3, MODES[idx % 3]
        need = tributes_needed(mine.hand[h])
        if need > 0:
            return Selection(h, mode, need, []), None
        return None, ('summon', h, mode, ())
    if idx < SWITCH:
        return None, ('set', idx - SET)
    if idx < FLIP:
        return None, ('switch', idx - SWITCH)
    if idx < EXTRA:
        return None, ('flip', (idx - FLIP) // 2, 'atk' if (idx - FLIP) % 2 == 0 else 'def')
    if idx < BATTLE:
        return None, ('extra', idx - EXTRA)
    if idx == BATTLE:
        return None, ('battle',)
    if idx < RESPOND:
        k = idx - ATTACK
        d = k % (FIELD + 1)
        return None, ('attack', k // (FIELD + 1), None if d == FIELD else d)
    if idx < DECLINE:
        return None, ('respond', idx - RESPOND)
    if idx == DECLINE:
        return None, ('respond', None)
    return None, ('end',)
