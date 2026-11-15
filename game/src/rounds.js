// Rounds, economy and the spark-charge objective for JADE PASS.
// createRounds(bus, rng) -> { state, startMatch, startRound, endRound, step, buy, canBuy,
//   onKill, onPlantStart, onPlantProgress, onPlantDone, onDefuseStart, onDefuseProgress,
//   onDefuseDone, onPlayerDeath, selectCarrier }
//
// BUS CONTRACT: bus is { emit(type, data) }. Events emitted:
//   { type: 'roundEnd', reason, winner }   winner: 'attack' | 'defend'
//   { type: 'kill', killer, victim, weapon, headshot }
//   { type: 'plant', site }  /  { type: 'defuse', site }  /  { type: 'radio', text }
// main.js passes bus.emit through to hud.killfeed / hud.radio / hud.showBanner.
//
// MATCH: first to 7, max 12 rounds, sides swap at round 7 (half-time; the player defends
// after the swap). Phases: buy 12 s, live 100 s, end 5 s banner.
// ECONOMY: start $800; kill +$300; round win +$3250; round loss +$1900; plant +$300
// (team); defuse +$300. Prices: weapons from weapon.js WEAPONS, armour $650, helm $350,
// kit $400, thunder $300, mist $300, dawn $200.
// LOADOUT: bought weapons persist across rounds while the player stays alive at round
// end; on death (onPlayerDeath) the loadout resets to koi + the $800 money floor.
// PLANT: the charge is free and auto-carried by one random alive attacker each round
// (selectCarrier, called from startRound). Hold E near a site for 4 s -> planted, 40 s
// fuse -> detonation wins the round for the attackers. Defenders hold E at the planted
// site for 5 s (2.5 s with the defuse kit) -> defused, defenders win.
// WIN REASONS: 'elimination', 'charge detonated', 'charge defused', 'time' (defenders
// win on timeout if nothing is planted).
//
// step(dt, ctx) ctx shape:
//   { attackersAlive, defendersAlive,                       // live head counts
//     planting: { active: bool, site: 'A'|'B' } | null,    // player or bot carrier channel
//     defusing: { active: bool, site: 'A'|'B', kit: bool } | null }
// main.js builds this ctx each step from player input + bot states.
import { WEAPONS } from './weapon.js';

const BUY_TIME = 12;
const LIVE_TIME = 100;
const END_TIME = 5;
const WIN_ROUNDS = 7;
const MAX_ROUNDS = 12;
const SWAP_ROUND = 7;
const PLANT_TIME = 4;
const FUSE_TIME = 40;
const DEFUSE_TIME = 5;
const DEFUSE_TIME_KIT = 2.5;

const PRICES = {
  armour: 650,
  helm: 350,
  kit: 400,
  thunder: 300,
  mist: 300,
  dawn: 200,
};

function freshLoadout() {
  return {
    weapon: 'koi',
    armour: 0,
    helm: false,
    kit: false,
    grenades: { thunder: 0, mist: 0, dawn: 0 },
  };
}

export function createRounds(bus, rng) {
  // rng is optional; when given it picks the carrier. main.js passes its seeded rng.
  // (The spec's createRounds(bus) takes only the bus; the extra arg is a pure addition.)
  const pick = rng || (() => 0.5);

  const state = {
    phase: 'buy',
    round: 1,
    scoreA: 0, // attack-team rounds won (MONSOON while attacking, JADE WATCH after swap)
    scoreB: 0, // defend-team rounds won
    timer: BUY_TIME,
    money: 800,
    side: 'attack', // the PLAYER's side this half
    playerTeam: 'attack',
    plant: { state: 'none', site: null, t: 0, defuseT: 0, carrier: null },
    winner: null,
    loadout: freshLoadout(),
    started: false,
  };

  function emit(type, data) {
    if (bus && typeof bus.emit === 'function') bus.emit(type, data || {});
    else if (typeof bus === 'function') bus(type, data || {});
  }

  function startMatch() {
    state.round = 1;
    state.scoreA = 0;
    state.scoreB = 0;
    state.money = 800;
    state.side = 'attack';
    state.playerTeam = 'attack';
    state.winner = null;
    state.loadout = freshLoadout();
    state.started = true;
    startRound();
  }

  function startRound() {
    state.phase = 'buy';
    state.timer = BUY_TIME;
    state.plant = { state: 'none', site: null, t: 0, defuseT: 0, carrier: null };
    if (state.round === SWAP_ROUND) {
      state.side = 'defend';
      state.playerTeam = 'defend';
      emit('radio', { text: 'Half-time — sides swap. We defend the pass now.' });
    }
  }

  // attackers: array of carrier candidates, each { id, isPlayer, name, alive }.
  // Returns the chosen carrier object (or null); state.plant.carrier is its id.
  function selectCarrier(attackers) {
    const alive = (attackers || []).filter((a) => a.alive !== false);
    if (alive.length === 0) {
      state.plant.carrier = null;
      return null;
    }
    const chosen = alive[Math.floor(pick() * alive.length)];
    state.plant.carrier = chosen.id;
    return chosen;
  }

  function award(amount) {
    state.money += amount;
  }

  function endRound(reason) {
    if (state.phase === 'end' || state.phase === 'over') return;
    let winner;
    if (reason === 'charge detonated' || reason === 'elimination-attack') winner = 'attack';
    else if (reason === 'charge defused' || reason === 'time' || reason === 'elimination-defend') winner = 'defend';
    else winner = reason === 'elimination' ? null : 'defend';
    // Plain 'elimination' without a side is resolved by the caller via endRound with
    // the sided reason; fall back to the team with more players alive is handled by main.
    if (winner === null) winner = 'attack';
    if (winner === 'attack') state.scoreA += 1;
    else state.scoreB += 1;
    const playerWon = winner === state.playerTeam;
    award(playerWon ? 3250 : 1900);
    state.phase = 'end';
    state.timer = END_TIME;
    state.winner = winner;
    emit('roundEnd', { reason, winner });
  }

  function nextRound() {
    if (state.scoreA >= WIN_ROUNDS || state.scoreB >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.phase = 'over';
      state.winner = state.scoreA > state.scoreB ? 'attack' : 'defend';
      emit('roundEnd', { reason: 'match', winner: state.winner });
      return;
    }
    state.round += 1;
    startRound();
  }

  function step(dt, ctx) {
    if (state.phase === 'over') return;
    state.timer -= dt;
    if (state.phase === 'buy') {
      if (state.timer <= 0) {
        state.phase = 'live';
        state.timer = LIVE_TIME;
      }
      return;
    }
    if (state.phase === 'end') {
      if (state.timer <= 0) nextRound();
      return;
    }
    // Live phase.
    if (ctx) {
      // Plant channel (player holding E, or the bot carrier).
      if (ctx.planting && ctx.planting.active && state.plant.state === 'none') {
        state.plant.state = 'planting';
        state.plant.site = ctx.planting.site;
        state.plant.t += dt;
        if (state.plant.t >= PLANT_TIME) onPlantDone(ctx.planting.site);
      } else if (state.plant.state === 'planting' && !(ctx.planting && ctx.planting.active)) {
        state.plant.state = 'none';
        state.plant.t = 0;
        state.plant.site = null;
      }
      // Defuse channel (defuseT is separate from the fuse countdown in plant.t).
      if (ctx.defusing && ctx.defusing.active && state.plant.state === 'planted') {
        const total = ctx.defusing.kit ? DEFUSE_TIME_KIT : DEFUSE_TIME;
        state.plant.defuseT += dt;
        if (state.plant.defuseT >= total) onDefuseDone(state.plant.site);
      } else if (state.plant.state === 'planted') {
        state.plant.defuseT = 0;
      }
      // Elimination.
      if (ctx.attackersAlive === 0 && ctx.defendersAlive > 0) {
        endRound('elimination-defend');
        return;
      }
      if (ctx.defendersAlive === 0 && ctx.attackersAlive > 0) {
        endRound('elimination-attack');
        return;
      }
    }
    // Fuse countdown.
    if (state.plant.state === 'planted') {
      state.plant.t -= dt;
      if (state.plant.t <= 0) {
        state.plant.state = 'exploded';
        endRound('charge detonated');
        return;
      }
    }
    if (state.timer <= 0) {
      // Timeout: defenders win unless the charge is planted (fuse decides then).
      if (state.plant.state === 'planted') {
        // Keep the round live on the fuse; the timer display just holds at 0.
        state.timer = 0;
      } else {
        endRound('time');
      }
    }
  }

  function canBuy() {
    return state.phase === 'buy';
  }

  function priceOf(itemId) {
    if (WEAPONS[itemId]) return WEAPONS[itemId].price;
    return PRICES[itemId];
  }

  function buy(itemId) {
    if (!canBuy()) return { ok: false, reason: 'not buy phase' };
    const price = priceOf(itemId);
    if (price === undefined) return { ok: false, reason: 'unknown item' };
    if (state.money < price) return { ok: false, reason: 'not enough money' };
    state.money -= price;
    if (WEAPONS[itemId]) {
      state.loadout.weapon = itemId;
    } else if (itemId === 'armour') {
      state.loadout.armour = 100;
    } else if (itemId === 'helm') {
      state.loadout.helm = true;
    } else if (itemId === 'kit') {
      state.loadout.kit = true;
    } else if (itemId === 'thunder' || itemId === 'mist' || itemId === 'dawn') {
      state.loadout.grenades[itemId] += 1;
    }
    return { ok: true, item: itemId, price };
  }

  // killerTeam / victimTeam are 'attack' | 'defend'. killerIsPlayer / victimIsPlayer
  // are optional booleans; the +$300 kill reward lands on the player's money only
  // when the killer is the player. headshot is reported to the killfeed.
  function onKill(killerTeam, victimTeam, headshot, killerIsPlayer, killerName, victimName, weaponId) {
    if (killerIsPlayer) award(300);
    emit('kill', {
      killer: killerName || killerTeam,
      victim: victimName || victimTeam,
      weapon: weaponId || '',
      headshot: !!headshot,
    });
  }

  function onPlantStart(site, carrier) {
    if (state.plant.state !== 'none') return;
    state.plant.state = 'planting';
    state.plant.site = site;
    state.plant.t = 0;
    if (carrier) state.plant.carrier = carrier;
  }

  function onPlantProgress(dt) {
    if (state.plant.state !== 'planting') return false;
    state.plant.t += dt;
    if (state.plant.t >= PLANT_TIME) {
      onPlantDone(state.plant.site);
      return true;
    }
    return false;
  }

  function onPlantDone(site) {
    if (state.plant.state === 'planted') return; // idempotent: bot + rounds may both complete
    state.plant.state = 'planted';
    state.plant.site = site;
    state.plant.t = FUSE_TIME;
    award(300); // plant bonus to the attacking team (player's money when attacking)
    emit('plant', { site });
    emit('radio', { text: `Spark planted on Site ${site} — 40 seconds on the fuse` });
  }

  // Validates a defuse channel is open (the charge is planted). Progress is driven
  // through step()'s ctx.defusing or onDefuseProgress; no separate plant state.
  function onDefuseStart(site) {
    if (state.plant.state !== 'planted') return;
    state.plant.defuseT = 0;
  }

  // Direct driver for a defuse channel (used when the caller, not step(), owns the
  // per-frame progress, e.g. a bot defuse). Returns true when the defuse completes.
  function onDefuseProgress(dt, kit) {
    if (state.plant.state !== 'planted') return false;
    const total = kit ? DEFUSE_TIME_KIT : DEFUSE_TIME;
    state.plant.defuseT += dt;
    if (state.plant.defuseT >= total) {
      onDefuseDone(state.plant.site);
      return true;
    }
    return false;
  }

  function onDefuseDone(site) {
    if (state.plant.state === 'defused') return; // idempotent
    state.plant.state = 'defused';
    state.plant.site = site;
    award(300); // defuse bonus
    emit('defuse', { site });
    emit('radio', { text: `Charge defused on Site ${site} — the pass holds` });
    endRound('charge defused');
  }

  // Called by main when the player dies: loadout resets to koi, money floors at $800.
  function onPlayerDeath() {
    state.loadout = freshLoadout();
    if (state.money < 800) state.money = 800;
  }

  return {
    state,
    startMatch,
    startRound,
    endRound,
    step,
    buy,
    canBuy,
    onKill,
    onPlantStart,
    onPlantProgress,
    onPlantDone,
    onDefuseStart,
    onDefuseProgress,
    onDefuseDone,
    onPlayerDeath,
    selectCarrier,
    priceOf,
  };
}
