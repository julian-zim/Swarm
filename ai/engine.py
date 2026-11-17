"""Python port of the rules in game.js, used for fast training. It must behave exactly like the JS engine:
ai/tests/test_parity.py replays games recorded from game.js and compares the full state after every action.

Actions are tuples:
  ('summon', h, mode, tr) ('set', h) ('switch', f) ('flip', f, pos) ('extra', i) ('battle',)
  ('attack', a, d) (d None = direct attack) ('respond', i) (i None = no trap) ('end',)
"""
import random
from itertools import combinations

START_LP = 8000
DECK_SIZE = 20
HAND_SIZE = 5
FIELD_SIZE = 5
TRAP_ZONES = 3
REGEN = 2000
MAX_HAND_SLOTS = 12
FACE_DOWN_GUESS = 1500
WEIGHTS = {'normal': 12, 'tribute1': 4, 'tribute2': 2, 'trap': 8}


class Card:
    __slots__ = ('name', 'type', 'atk', 'def_', 'trap', 'weight')

    def __init__(self, name, type_, atk=0, def_=0, trap=None):
        self.name, self.type, self.atk, self.def_, self.trap = name, type_, atk, def_, trap
        if type_ == 'trap':
            self.weight = WEIGHTS['trap']
        else:
            need = tributes_needed(self)
            self.weight = WEIGHTS['normal'] if need == 0 else WEIGHTS['tribute1'] if need == 1 else WEIGHTS['tribute2']


def tributes_needed(card):
    return 2 if card.atk > 3000 else 1 if card.atk >= 2000 else 0


MONSTERS = [Card(n, 'monster', a, d) for n, a, d in [
    ('Sprite', 500, 500), ('Moss Turtle', 500, 2000), ('Ember Imp', 1000, 500), ('Frost Wolf', 1600, 1200),
    ('Storm Hawk', 1800, 1000), ('Cave Troll', 2000, 1000), ('Iron Golem', 1400, 2600), ('Dark Knight', 2400, 1800),
    ('Thunder Drake', 2800, 1500), ('Void Wyrm', 3200, 1800), ('Sun Titan', 3500, 2500), ('Stone Sentinel', 800, 3000)]]
TRAPS = [Card('Block Attack', 'trap', trap='block'), Card('Guardian Shield', 'trap', trap='protect'), Card('Reinforcements', 'trap', trap='extra')]
POOL = MONSTERS + TRAPS
BY_NAME = {c.name: c for c in POOL}
POOL_WEIGHTS = [c.weight for c in POOL]


class Monster:
    __slots__ = ('name', 'pos', 'face_down', 'atk', 'def_', 'base_atk', 'base_def', 'summoned_turn', 'attacked', 'switched', 'protected')

    def __init__(self, name, pos, face_down, atk, def_, base_atk, base_def, summoned_turn, attacked=False, switched=False, protected=False):
        self.name, self.pos, self.face_down, self.atk, self.def_ = name, pos, face_down, atk, def_
        self.base_atk, self.base_def, self.summoned_turn = base_atk, base_def, summoned_turn
        self.attacked, self.switched, self.protected = attacked, switched, protected


class Trap:
    __slots__ = ('kind', 'set_turn')

    def __init__(self, kind, set_turn):
        self.kind, self.set_turn = kind, set_turn


class Player:
    __slots__ = ('lp', 'deck', 'hand', 'field', 'traps', 'trap_used_turn', 'graveyard')

    def __init__(self):
        self.lp = START_LP
        self.deck, self.hand, self.field, self.traps = [], [], [], []
        self.trap_used_turn = 0
        self.graveyard = 0


class Pending:
    __slots__ = ('att', 't_idx', 'options')

    def __init__(self, att, t_idx, options):
        self.att, self.t_idx, self.options = att, t_idx, options


class State:
    __slots__ = ('players', 'turn', 'turn_no', 'phase', 'summons_left', 'pending', 'winner', 'confirm_attacks_on')

    def __init__(self, confirm_attacks_on=None):
        self.players = [Player(), Player()]
        self.turn = 0
        self.turn_no = 0
        self.phase = 'main'
        self.summons_left = 0
        self.pending = None
        self.winner = None
        self.confirm_attacks_on = confirm_attacks_on

    def cur(self):
        return self.players[self.turn]

    def opp(self):
        return self.players[1 - self.turn]


def new_game(rng=None, confirm_attacks_on=None):
    """A fresh game with random decks (drawn with the pool weights), like newGame in game.js."""
    rng = rng or random
    s = State(confirm_attacks_on)
    for p in s.players:
        p.deck = rng.choices(POOL, weights=POOL_WEIGHTS, k=DECK_SIZE)
        rng.shuffle(p.deck)
        for _ in range(HAND_SIZE):
            p.hand.append(p.deck.pop())
    start_turn(s)
    return s


def from_snapshot(snap, confirm_attacks_on=None):
    """Rebuilds a state from the output of snapshot() in game.js."""
    s = State(confirm_attacks_on)
    s.turn, s.turn_no, s.phase, s.summons_left, s.winner = snap['turn'], snap['turnNo'], snap['phase'], snap['summonsLeft'], snap['winner']
    for p, sp in zip(s.players, snap['players']):
        p.lp, p.trap_used_turn, p.graveyard = sp['lp'], sp['trapUsedTurn'], sp['graveyard']
        p.deck = [BY_NAME[n] for n in sp['deck']]
        p.hand = [BY_NAME[n] for n in sp['hand']]
        p.field = [Monster(m['name'], m['pos'], m['faceDown'], m['atk'], m['def'], m['baseAtk'], m['baseDef'], m['summonedTurn'], m['attacked'], m['switched'], m['protected']) for m in sp['field']]
        p.traps = [Trap(t['trap'], t['setTurn']) for t in sp['traps']]
    if snap['pending']:
        pd = snap['pending']
        s.pending = Pending(s.cur().field[pd['att']], pd['tIdx'], list(pd['options']))
    return s


def snapshot(s):
    """The same plain-data form as snapshot() in game.js."""
    def mon(m):
        return {'name': m.name, 'pos': m.pos, 'faceDown': m.face_down, 'atk': m.atk, 'def': m.def_, 'baseAtk': m.base_atk, 'baseDef': m.base_def,
                'summonedTurn': m.summoned_turn, 'attacked': m.attacked, 'switched': m.switched, 'protected': m.protected}
    return {
        'turn': s.turn, 'turnNo': s.turn_no, 'phase': s.phase, 'summonsLeft': s.summons_left, 'winner': s.winner,
        'pending': None if not s.pending else {'att': s.cur().field.index(s.pending.att), 'tIdx': s.pending.t_idx, 'options': list(s.pending.options)},
        'players': [{'lp': p.lp, 'deck': [c.name for c in p.deck], 'hand': [c.name for c in p.hand], 'field': [mon(m) for m in p.field],
                     'traps': [{'trap': t.kind, 'setTurn': t.set_turn} for t in p.traps], 'trapUsedTurn': p.trap_used_turn, 'graveyard': p.graveyard}
                    for p in s.players],
    }


def set_winner(s, idx):
    if s.winner is None:
        s.winner = idx


def check_lp(s):
    for i in (0, 1):
        p = s.players[i]
        if p.lp <= 0:
            p.lp = 0
            set_winner(s, 1 - i)


def start_turn(s):
    s.turn_no += 1
    s.phase = 'main'
    s.summons_left = 1
    p = s.cur()
    for m in p.field:
        m.attacked = False
        m.switched = False
    if s.turn_no > 1:
        if not p.deck:
            set_winner(s, 1 - s.turn)
            return
        p.hand.append(p.deck.pop())


FAIL = (False, False)
OK = (True, False)


def _guard(s):
    return s.winner is not None or s.pending is not None


def _main_guard(s):
    return _guard(s) or s.phase != 'main'


def remove_monster(player, m):
    player.field = [x for x in player.field if x is not m]
    player.graveyard += 1


def summon(s, h, mode, tributes):
    if _main_guard(s):
        return FAIL
    p = s.cur()
    if h < 0 or h >= len(p.hand) or p.hand[h].type != 'monster':
        return FAIL
    card = p.hand[h]
    if mode not in ('atk', 'def', 'set') or s.summons_left <= 0:
        return FAIL
    need = tributes_needed(card)
    if len(set(tributes)) != len(tributes) or len(tributes) != need or any(i < 0 or i >= len(p.field) for i in tributes):
        return FAIL
    if len(p.field) - need >= FIELD_SIZE:
        return FAIL
    tributed = [p.field[i] for i in tributes]
    del p.hand[h]
    for m in tributed:
        remove_monster(p, m)
    p.field.append(Monster(card.name, 'atk' if mode == 'atk' else 'def', mode == 'set', card.atk, card.def_, card.atk, card.def_, s.turn_no))
    s.summons_left -= 1
    return OK


def set_trap(s, h):
    if _main_guard(s):
        return FAIL
    p = s.cur()
    if h < 0 or h >= len(p.hand) or p.hand[h].type != 'trap' or len(p.traps) >= TRAP_ZONES:
        return FAIL
    card = p.hand.pop(h)
    p.traps.append(Trap(card.trap, s.turn_no))
    return OK


def switch_pos(s, f):
    if _main_guard(s):
        return FAIL
    p = s.cur()
    if f < 0 or f >= len(p.field):
        return FAIL
    m = p.field[f]
    if m.face_down or m.switched or m.summoned_turn == s.turn_no or m.attacked:
        return FAIL
    m.pos = 'def' if m.pos == 'atk' else 'atk'
    m.switched = True
    return OK


def reveal(m):
    m.face_down = False


def flip_up(s, f, pos):
    if _main_guard(s):
        return FAIL
    p = s.cur()
    if f < 0 or f >= len(p.field):
        return FAIL
    m = p.field[f]
    if not m.face_down or pos not in ('atk', 'def') or m.switched or m.summoned_turn == s.turn_no:
        return FAIL
    m.face_down = False
    m.pos = pos
    m.switched = True
    return OK


def trap_ready(s, p_idx, t_idx):
    p = s.players[p_idx]
    if t_idx < 0 or t_idx >= len(p.traps):
        return False
    return s.turn_no > p.traps[t_idx].set_turn and p.trap_used_turn != s.turn_no


def use_trap(s, p_idx, t_idx):
    p = s.players[p_idx]
    t = p.traps.pop(t_idx)
    p.trap_used_turn = s.turn_no
    p.graveyard += 1
    return t


def activate_extra_summon(s, i):
    if _main_guard(s):
        return FAIL
    p = s.cur()
    if i < 0 or i >= len(p.traps) or p.traps[i].kind != 'extra' or not trap_ready(s, s.turn, i):
        return FAIL
    use_trap(s, s.turn, i)
    s.summons_left += 1
    return OK


def enter_battle(s):
    if _main_guard(s):
        return FAIL
    s.phase = 'battle'
    return OK


def preview_battle(att_atk, t_pos, t_def, direct=False):
    """Returns (t_destroyed, a_destroyed, def_lp, atk_lp, new_t) like previewBattle in game.js. t_pos/t_def describe the target."""
    if direct:
        return (False, False, att_atk, 0, None)
    in_atk = t_pos == 'atk'
    raw = t_def - att_atk
    return (raw <= 0 if in_atk else raw < 0, in_atk and att_atk <= t_def, att_atk - t_def if in_atk and att_atk > t_def else 0,
            t_def - att_atk if att_atk < t_def else 0, max(0, raw))


def resolve_battle(s, att, t_idx):
    me, other = s.cur(), s.opp()
    if t_idx is None:
        other.lp -= att.atk
        check_lp(s)
        return
    t = other.field[t_idx]
    if t.protected:
        return
    t_destroyed, a_destroyed, def_lp, atk_lp, new_t = preview_battle(att.atk, t.pos, t.def_)
    t.def_ = new_t
    if t_destroyed:
        remove_monster(other, t)
    if a_destroyed:
        remove_monster(me, att)
    if def_lp:
        other.lp -= def_lp
    if atk_lp:
        me.lp -= atk_lp
    check_lp(s)


def declare_attack(s, a, d):
    """Returns (ok, pending)."""
    if _guard(s) or s.phase != 'battle':
        return FAIL
    me, other = s.cur(), s.opp()
    if a < 0 or a >= len(me.field):
        return FAIL
    att = me.field[a]
    if att.pos != 'atk' or att.attacked or att.summoned_turn >= s.turn_no:
        return FAIL
    if d is None:
        if other.field:
            return FAIL
    elif d < 0 or d >= len(other.field):
        return FAIL
    att.attacked = True
    if d is not None and other.field[d].face_down:
        reveal(other.field[d])
    def_idx = 1 - s.turn
    options = []
    for i, t in enumerate(other.traps):
        if not trap_ready(s, def_idx, i):
            continue
        if t.kind == 'block' or (t.kind == 'protect' and d is not None):
            options.append(i)
    if not options and s.confirm_attacks_on != def_idx:
        resolve_battle(s, att, d)
        return OK
    s.pending = Pending(att, d, options)
    return (True, True)


def respond_attack(s, i):
    p = s.pending
    if p is None:
        return FAIL
    if i is not None and i not in p.options:
        return FAIL
    s.pending = None
    if i is None:
        resolve_battle(s, p.att, p.t_idx)
        return OK
    def_idx = 1 - s.turn
    t = use_trap(s, def_idx, i)
    if t.kind != 'block':
        s.players[def_idx].field[p.t_idx].protected = True
        resolve_battle(s, p.att, p.t_idx)
    return OK


def end_turn(s):
    if _guard(s):
        return FAIL
    for pl in s.players:
        for m in pl.field:
            m.protected = False
            if m.pos == 'def':
                m.def_ = min(m.base_def, m.def_ + REGEN)
    s.turn = 1 - s.turn
    start_turn(s)
    return OK


def apply_action(s, act):
    """Returns (ok, pending)."""
    t = act[0]
    if t == 'summon':
        return summon(s, act[1], act[2], act[3])
    if t == 'set':
        return set_trap(s, act[1])
    if t == 'switch':
        return switch_pos(s, act[1])
    if t == 'flip':
        return flip_up(s, act[1], act[2])
    if t == 'extra':
        return activate_extra_summon(s, act[1])
    if t == 'battle':
        return enter_battle(s)
    if t == 'attack':
        return declare_attack(s, act[1], act[2])
    if t == 'respond':
        return respond_attack(s, act[1])
    if t == 'end':
        return end_turn(s)
    return FAIL


def acting_player(s):
    """The decider: the defender while an attack is pending, otherwise the player whose turn it is."""
    return 1 - s.turn if s.pending else s.turn


def legal_actions(s):
    """Every action the deciding player may take now (same set as legalActions in game.js)."""
    if s.winner is not None:
        return []
    if s.pending:
        acts = [('respond', i) for i in s.pending.options]
        acts.append(('respond', None))
        return acts
    me, other = s.cur(), s.opp()
    out = []
    nf = len(me.field)
    if s.phase == 'main':
        for h, c in enumerate(me.hand):
            if h >= MAX_HAND_SLOTS:
                break
            if c.type == 'trap':
                if len(me.traps) < TRAP_ZONES:
                    out.append(('set', h))
            elif s.summons_left > 0:
                need = tributes_needed(c)
                if need > nf or nf - need >= FIELD_SIZE:
                    continue
                for mode in ('atk', 'def', 'set'):
                    for tr in combinations(range(nf), need):
                        out.append(('summon', h, mode, tr))
        for f, m in enumerate(me.field):
            if m.switched or m.summoned_turn == s.turn_no:
                continue
            if m.face_down:
                out.append(('flip', f, 'atk'))
                out.append(('flip', f, 'def'))
            elif not m.attacked:
                out.append(('switch', f))
        for i, t in enumerate(me.traps):
            if t.kind == 'extra' and trap_ready(s, s.turn, i):
                out.append(('extra', i))
        out.append(('battle',))
    else:
        for a, m in enumerate(me.field):
            if m.pos != 'atk' or m.attacked or m.summoned_turn >= s.turn_no:
                continue
            if not other.field:
                out.append(('attack', a, None))
            else:
                for d in range(len(other.field)):
                    out.append(('attack', a, d))
    out.append(('end',))
    return out


def act_from_json(d):
    """Converts an action object from game.js ({t: ...}) into a tuple."""
    t = d['t']
    if t == 'summon':
        return ('summon', d['h'], d['mode'], tuple(d['tr']))
    if t == 'set':
        return ('set', d['h'])
    if t == 'switch':
        return ('switch', d['f'])
    if t == 'flip':
        return ('flip', d['f'], d['pos'])
    if t == 'extra':
        return ('extra', d['i'])
    if t == 'battle':
        return ('battle',)
    if t == 'attack':
        return ('attack', d['a'], d['d'])
    if t == 'respond':
        return ('respond', d['i'])
    return ('end',)


def act_key(act):
    """A canonical, order-independent form of an action, for comparing action sets."""
    if act[0] == 'summon':
        return ('summon', act[1], act[2], tuple(sorted(act[3])))
    return tuple(act)
