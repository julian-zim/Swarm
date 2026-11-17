// Browser UI: renders the Game state and turns clicks into engine calls. The CPU is player 1.
(function () {
  const G = Game;
  const HUMAN = 0;
  let game;
  let sel = null; // { t: 'hand' | 'field' | 'trap', i }
  let targeting = false;
  let tributing = null; // { handIdx, mode, need, chosen: [field indices] } while the human picks tributes
  let busy = false; // CPU is playing
  let msg = '';
  let modal = null; // pending attack response from the human: { from } = log index where the CPU action began
  let lockUntil = 0; // board clicks are ignored until then, so spam-clicked Confirms cannot hit the human's own buttons
  let awaiting = null; // CPU action waiting for the human's Confirm: { from, next }, from = first log line of that action
  let logShown = 0;
  let brain = G; // the CPU's decision maker: Game (Simple CPU) or TrainedAI (Trained CPU), fixed when the game starts

  const $ = (id) => document.getElementById(id);
  const human = () => game.players[HUMAN];
  const cpu = () => game.players[1 - HUMAN];
  const myTurn = () => game.winner === null && game.turn === HUMAN && !game.pending && !busy;

  function start() {
    brain = $('opponent').value === 'trained' && window.TrainedAI && TrainedAI.loaded() ? TrainedAI : G;
    game = G.newGame(Math.random, ['Player', 'CPU'], { confirmAttacksOn: HUMAN });
    sel = null;
    targeting = false;
    tributing = null;
    busy = false;
    msg = '';
    modal = null;
    awaiting = null;
    lockUntil = 0;
    $('log').innerHTML = '';
    logShown = 0;
    render();
  }

  function say(r) {
    msg = r.ok ? '' : r.error;
  }

  // ------------------------------------------------------------ rendering

  function infoHtml(p, idx, extra = '') {
    const pct = Math.max(0, (p.lp / G.CONFIG.startLp) * 100);
    const active = game.turn === idx && game.winner === null ? ' active' : '';
    return `<div class="info${active}"><span class="name">${p.name}</span>
      <div class="lp"><b>${p.lp}</b> LP<div class="lpbar"><div style="width:${pct}%"></div></div></div>
      <span class="meta">Deck ${p.deck.length} · Hand ${p.hand.length}</span></div>${extra}`;
  }

  function monsterHtml(m, owner, i) {
    const mine = owner === HUMAN;
    const classes = ['card', 'monster'];
    if (m.pos === 'def') classes.push('defpos');
    if (m.protected) classes.push('protected');
    if (mine && sel && sel.t === 'field' && sel.i === i) classes.push('sel');
    const ready = mine && myTurn() && game.phase === 'battle' && m.pos === 'atk' && !m.attacked && m.summonedTurn < game.turnNo;
    if (ready) classes.push('ready');
    if (mine && myTurn()) classes.push('clickable');
    if (!mine && targeting) classes.push('target');
    const zone = mine ? 'myfield' : 'oppfield';
    if (!mine && m.faceDown) {
      return `<div class="${targeting ? 'card back target' : 'card back'}" data-zone="${zone}" data-i="${i}" title="Face-down monster"><div class="art">🂠</div>Face-down monster</div>`;
    }
    if (mine && tributing) classes.push('clickable', tributing.chosen.includes(i) ? 'sel' : 'tributable');
    const onA = m.pos === 'atk' ? 'on' : '';
    const onD = m.pos === 'def' ? 'on' : '';
    return `<div class="${classes.join(' ')}" data-zone="${zone}" data-i="${i}" title="${m.name}: base ATK ${m.baseAtk} / DEF ${m.baseDef}">
      ${m.protected ? '<span class="badge">PROTECTED</span>' : ''}${m.faceDown ? '<span class="badge down">FACE-DOWN</span>' : ''}
      <div class="nm">${m.name}</div><div class="art">${m.emoji}</div>
      <div class="pos ${m.pos}">${m.pos === 'atk' ? '⚔ ATK' : '🛡 DEF'}</div>
      <div class="stats"><span class="a ${onA}">ATK <b>${m.atk}</b></span><span class="d ${onD}">DEF <b>${m.def}</b></span></div></div>`;
  }

  function fieldHtml(p, owner) {
    let h = '';
    for (let i = 0; i < G.CONFIG.fieldSize; i++) h += p.field[i] ? monsterHtml(p.field[i], owner, i) : '<div class="card empty"></div>';
    return h;
  }

  function trapsHtml(p, owner) {
    let h = '';
    for (let i = 0; i < G.CONFIG.trapZones; i++) {
      const t = p.traps[i];
      if (!t) {
        h += '<div class="card empty"></div>';
      } else if (owner !== HUMAN) {
        h += '<div class="card back">Set trap</div>';
      } else {
        const ready = G.trapReady(game, HUMAN, i);
        const classes = ['card', 'trapcard', 'clickable'];
        if (ready) classes.push('ready');
        else classes.push('spent');
        if (sel && sel.t === 'trap' && sel.i === i) classes.push('sel');
        h += `<div class="${classes.join(' ')}" data-zone="mytrap" data-i="${i}" title="${t.text}">
          <div class="nm">${t.name}</div><div class="art">${t.emoji}</div>
          <div class="txt">${ready ? 'Ready' : t.setTurn === game.turnNo ? 'Set this turn' : 'Used this turn'}</div></div>`;
      }
    }
    return h;
  }

  function handHtml(p) {
    return p.hand
      .map((c, i) => {
        const classes = ['card', c.type === 'monster' ? 'monster' : 'trapcard'];
        if (myTurn()) classes.push('clickable');
        if (sel && sel.t === 'hand' && sel.i === i) classes.push('sel');
        const need = c.type === 'monster' ? G.tributesNeeded(c) : 0;
        const body =
          c.type === 'monster'
            ? `<div class="stats"><span class="a">ATK <b>${c.atk}</b></span><span class="d">DEF <b>${c.def}</b></span></div>`
            : `<div class="txt">${c.text}</div>`;
        return `<div class="${classes.join(' ')}" data-zone="hand" data-i="${i}" title="${c.type === 'trap' ? c.text : c.name}">
          ${need ? `<span class="badge tribute">Tribute ${need}</span>` : ''}
          <div class="nm">${c.name}</div><div class="art">${c.emoji}</div>${body}</div>`;
      })
      .join('');
  }

  function actionsHtml() {
    let h = '';
    if (game.winner !== null) return '<span class="hint">Game over.</span>';
    if (busy || game.turn !== HUMAN) return '<span class="hint">CPU is playing…</span>';
    const p = human();
    if (tributing) {
      h += `<span class="hint">Choose ${tributing.need} monster${tributing.need === 1 ? '' : 's'} of yours to tribute (${tributing.chosen.length}/${tributing.need}).</span><button data-act="cancel">Cancel</button>`;
    } else if (targeting) {
      h += '<span class="hint">Choose a target monster to attack.</span><button data-act="cancel">Cancel</button>';
    } else if (sel && sel.t === 'hand') {
      const c = p.hand[sel.i];
      if (c && c.type === 'monster') {
        const need = G.tributesNeeded(c);
        if (need) h += `<span class="hint">Needs ${need} tribute${need === 1 ? '' : 's'}.</span>`;
        h += '<button data-act="summon-atk">Summon in ATK</button><button data-act="summon-def">Summon in DEF</button><button data-act="summon-set">Set face-down</button>';
      }
      else if (c) h += '<button data-act="set">Set trap face-down</button>';
      h += '<button data-act="cancel">Cancel</button>';
    } else if (sel && sel.t === 'field' && p.field[sel.i]) {
      const m = p.field[sel.i];
      if (game.phase === 'battle' && m.pos === 'atk' && !m.faceDown) h += cpu().field.length ? '<button data-act="attack">Attack…</button>' : '<button data-act="direct">Attack directly</button>';
      if (game.phase === 'main') {
        if (m.faceDown) h += '<button data-act="flip-atk">Flip to ATK</button><button data-act="flip-def">Flip to DEF</button>';
        else h += `<button data-act="switch">Switch to ${m.pos === 'atk' ? 'DEF' : 'ATK'}</button>`;
      }
      h += '<button data-act="cancel">Cancel</button>';
    } else if (sel && sel.t === 'trap' && p.traps[sel.i]) {
      const t = p.traps[sel.i];
      if (t.trap === 'extra') h += `<button data-act="extra"${G.trapReady(game, HUMAN, sel.i) ? '' : ' disabled'}>Activate ${t.name}</button>`;
      else h += `<span class="hint">${t.text} It activates when you are attacked.</span>`;
      h += '<button data-act="cancel">Cancel</button>';
    } else {
      h += game.phase === 'battle'
        ? '<span class="hint">Battle phase: select a monster to attack. Only attacks and defensive traps are possible now.</span>'
        : `<span class="hint">Main phase. Summons left: ${game.summonsLeft}. Select a card to act, or enter the battle phase to attack.</span>`;
    }
    if (msg) h += `<span class="hint err">${msg}</span>`;
    // Card-specific buttons and hints on the left, the always-available turn buttons on the right.
    let global = '';
    if (game.phase === 'main') global += '<button data-act="battle">Battle Phase</button>';
    global += '<button class="primary" data-act="end">End turn</button>';
    return `<div class="ctx">${h}</div><div class="global">${global}</div>`;
  }

  function renderLog() {
    const el = $('log');
    for (; logShown < game.log.length; logShown++) {
      const d = document.createElement('div');
      const line = game.log[logShown];
      if (line.startsWith('---')) d.className = 'turn';
      d.textContent = line;
      el.appendChild(d);
    }
    // The lines of the CPU action that waits for Confirm are highlighted.
    [...el.children].forEach((d, i) => d.classList.toggle('current', !!awaiting && i >= awaiting.from));
    el.scrollTop = el.scrollHeight;
  }

  function modalHtml() {
    if (game.winner !== null) {
      const won = game.winner === HUMAN;
      return `<div class="dialog"><h3>${won ? 'You win!' : 'You lose'}</h3><p>${game.log[game.log.length - 1]}</p>
        <div class="btns"><button class="primary" data-act="restart">Play again</button></div></div>`;
    }
    if (modal) {
      const { att, tIdx, options } = game.pending;
      const t = tIdx === null ? null : human().field[tIdx];
      const r = G.previewBattle(att, t);
      const effects = [];
      if (r.direct) effects.push(`you lose ${r.defLp} LP`);
      else {
        effects.push(r.tDestroyed ? `${t.name} is destroyed` : `${t.name} is drained to ${r.newT}`);
        if (r.defLp) effects.push(`you lose ${r.defLp} LP`);
        if (r.aDestroyed) effects.push(`${att.name} is destroyed`);
        if (r.atkLp) effects.push(`CPU loses ${r.atkLp} LP`);
      }
      const btns = options.map((i) => `<button data-act="trap" data-i="${i}">${human().traps[i].emoji} ${human().traps[i].name}</button>`).join('');
      return `<div class="dialog"><h3>Enemy attack!</h3>
        <p>CPU's ${att.name} (ATK ${att.atk}) attacks ${t ? 'your ' + t.name : 'you directly'}.<br>Without a trap: ${effects.join(', ')}.</p>
        <div class="btns">${btns}<button data-act="decline">No trap</button></div></div>`;
    }
    return '';
  }

  function render() {
    const confirmHtml = awaiting ? '<button class="primary confirm" data-act="confirm">Confirm</button>' : '';
    $('oppInfo').innerHTML = infoHtml(cpu(), 1 - HUMAN, confirmHtml);
    $('myInfo').innerHTML = infoHtml(human(), HUMAN);
    $('oppTraps').innerHTML = trapsHtml(cpu(), 1 - HUMAN);
    $('myTraps').innerHTML = trapsHtml(human(), HUMAN);
    $('oppField').innerHTML = fieldHtml(cpu(), 1 - HUMAN);
    $('myField').innerHTML = fieldHtml(human(), HUMAN);
    $('hand').innerHTML = handHtml(human());
    $('actions').innerHTML = actionsHtml();
    $('turnInfo').textContent = game.winner !== null ? 'Game over' : `Turn ${game.turnNo} · ${game.players[game.turn].name} · ${game.phase === 'battle' ? 'Battle Phase' : 'Main Phase'}`;
    const html = modalHtml();
    $('overlay').innerHTML = html;
    $('overlay').hidden = !html;
    renderLog();
  }

  // ------------------------------------------------------------ CPU turn

  // Every CPU action is shown and waits for the human's Confirm before the next one happens.
  function cpuTurn() {
    busy = true;
    cpuStep();
  }

  function awaitConfirm(from, next) {
    if (game.winner !== null) {
      busy = false;
      render();
      return;
    }
    awaiting = { from, next };
    render();
  }

  function cpuStep() {
    if (game.winner !== null) {
      busy = false;
      render();
      return;
    }
    const from = game.log.length;
    const r = brain === G ? G.aiStep(game) : TrainedAI.step(game);
    if (r.attack && r.attack.pending) {
      if (game.pending.options.length === 0) {
        // No trap to decide about: the attack (already in the log) just waits for the human's Confirm before it goes through.
        awaiting = {
          from,
          next: () => {
            G.respondAttack(game, null);
            awaitConfirm(from, cpuStep);
          },
        };
        render();
        return;
      }
      modal = { from }; // the human owns a usable trap and decides about it
      render();
      return;
    }
    if (r.done) {
      awaiting = {
        from,
        next: () => {
          G.endTurn(game);
          busy = false;
          lockUntil = Date.now() + 800;
          render();
        },
      };
      render();
      return;
    }
    awaitConfirm(from, cpuStep);
  }

  function answerAttack(trapIdx) {
    const from = modal.from;
    G.respondAttack(game, trapIdx);
    modal = null;
    awaitConfirm(from, cpuStep);
  }

  // ------------------------------------------------------------ input

  function doAttack(aIdx, tIdx) {
    const r = G.declareAttack(game, aIdx, tIdx);
    if (r.ok && r.pending) G.respondAttack(game, brain === G ? G.aiRespond(game) : TrainedAI.respond(game)); // the CPU is the defender
    say(r);
    sel = null;
    targeting = false;
    render();
  }

  function act(name, el) {
    if (name === 'restart') return start();
    if (name === 'confirm') {
      const next = awaiting.next;
      awaiting = null;
      return next();
    }
    if (name === 'trap') return answerAttack(Number(el.dataset.i));
    if (name === 'decline') return answerAttack(null);
    if (!myTurn()) return;
    const i = sel ? sel.i : null;
    switch (name) {
      case 'cancel':
        sel = null;
        targeting = false;
        tributing = null;
        msg = '';
        break;
      case 'summon-atk':
      case 'summon-def':
      case 'summon-set': {
        const mode = name.slice('summon-'.length);
        const need = G.tributesNeeded(human().hand[i]);
        if (need === 0) say(G.summon(game, i, mode));
        else if (human().field.length < need) msg = `Needs ${need} tribute${need === 1 ? '' : 's'}, but you only have ${human().field.length} monster${human().field.length === 1 ? '' : 's'}.`;
        else tributing = { handIdx: i, mode, need, chosen: [] };
        sel = null;
        break;
      }
      case 'flip-atk':
      case 'flip-def':
        say(G.flipUp(game, i, name === 'flip-atk' ? 'atk' : 'def'));
        sel = null;
        break;
      case 'battle':
        say(G.enterBattle(game));
        sel = null;
        tributing = null;
        targeting = false;
        break;
      case 'set':
        say(G.setTrap(game, i));
        sel = null;
        break;
      case 'switch':
        say(G.switchPos(game, i));
        sel = null;
        break;
      case 'extra':
        say(G.activateExtraSummon(game, i));
        sel = null;
        break;
      case 'attack':
        targeting = true;
        break;
      case 'direct':
        return doAttack(i, null);
      case 'end':
        msg = '';
        sel = null;
        targeting = false;
        tributing = null;
        G.endTurn(game);
        if (game.winner === null) return cpuTurn();
        break;
    }
    render();
  }

  document.addEventListener('click', (e) => {
    if (Date.now() < lockUntil) return;
    const a = e.target.closest('[data-act]');
    if (a) return act(a.dataset.act, a);
    const z = e.target.closest('[data-zone]');
    if (!z || !myTurn()) return;
    const i = Number(z.dataset.i);
    msg = '';
    if (game.phase === 'battle' && z.dataset.zone !== 'myfield' && z.dataset.zone !== 'oppfield') {
      msg = 'Only attacks and defensive traps are possible in the battle phase.';
      render();
      return;
    }
    if (tributing) {
      if (z.dataset.zone !== 'myfield') return;
      const at = tributing.chosen.indexOf(i);
      if (at >= 0) tributing.chosen.splice(at, 1);
      else tributing.chosen.push(i);
      if (tributing.chosen.length === tributing.need) {
        say(G.summon(game, tributing.handIdx, tributing.mode, tributing.chosen));
        tributing = null;
      }
      render();
      return;
    }
    if (z.dataset.zone === 'oppfield') {
      if (targeting && sel && sel.t === 'field') doAttack(sel.i, i);
      return;
    }
    targeting = false;
    sel = { t: { hand: 'hand', myfield: 'field', mytrap: 'trap' }[z.dataset.zone], i };
    render();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') act('cancel');
    if (e.key === 'Enter' && awaiting) {
      e.preventDefault();
      act('confirm');
    }
  });

  window.__game = () => game; // for debugging and automated checks
  if (!(window.TrainedAI && TrainedAI.loaded())) $('opponent').querySelector('[value=trained]').disabled = true; // no model.js next to the page
  start();
})();
