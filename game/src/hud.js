// The DOM HUD for JADE PASS. It never touches the simulation: main.js pushes numbers
// in (health, ammo, money, timer, minimap dots) and reads the play / buy callbacks out.
// Every element is looked up exactly once, at creation, and cached in `el` — the per-frame
// setters only write textContent / style.width / classList, and never create DOM nodes.
// Killfeed and radio lines are the only nodes created after boot, and only on events,
// never per frame. The minimap is a 2D canvas redrawn from a hand-mapped static layout
// of the Jade Pass map (see MAP below); world coords are scaled into the 180x180 canvas.

const COPY = {
  start: {
    title: 'JADE PASS',
    copy: 'A mountain shrine pass in the bamboo mist. 5v5 plant and defuse — carry the spark to Shrine A or River B, or hold the line.',
    action: 'Click to play',
  },
  paused: {
    title: 'JADE PASS',
    copy: 'Paused. Click to resume — the round is waiting.',
    action: 'Click to resume',
  },
  end: {
    title: 'Match over',
    copy: 'The pass is decided.',
    action: 'Play again',
  },
};

// Hand-mapped Jade Pass layout, world coords (x east, z south, y up; bounds x ±22, z ±18).
// Walls are line segments [x1, z1, x2, z2]; sites are circles with a letter. This is a
// sketch of the map, not a render of it — it only has to read at a glance mid-fight.
const MAP = {
  minX: -22, maxX: 22, minZ: -18, maxZ: 18,
  walls: [
    [-22, -18, 22, -18], [22, -18, 22, 18], [22, 18, -22, 18], [-22, 18, -22, -18], // bounds
    [-17, -14, -9, -14], [-9, -14, -9, -8], // Site A terrace / shrine hut
    [9, -14, 17, -14], [17, -14, 17, -8], // Site B riverside huts
    [-2, -3, 2, -3], [2, -3, 2, 3], [2, 3, -2, 3], [-2, 3, -2, -3], // Lantern Court
    [-3, -8, 3, -8], // underpass arch line (crouch shortcut, mid-north)
    [6, -9, 6, -13], [20, -9, 20, -13], // river banks at Site B
    [-19, -6, -19, 6], [19, -6, 19, 6], // A-long / B-long lane walls
    [-22, 10, -20, 10], [-16, 10, -2, 10], [2, 10, 16, 10], [20, 10, 22, 10], // spawn wall (gates at -20..-16, -2..2, 16..20)
  ],
  sites: [
    { x: -13, z: -11, letter: 'A' },
    { x: 13, z: -11, letter: 'B' },
  ],
};

const MAX_KILLFEED = 5;
const MAX_RADIO = 4;

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, '0')}`;
}

export function createHud() {
  // Cached once. If an id is missing the game fails loudly here, at boot, not mid-round.
  const el = {
    health: document.getElementById('health'),
    healthValue: document.getElementById('health-value'),
    healthBar: document.getElementById('health-bar'),
    armourValue: document.getElementById('armour-value'),
    armourBar: document.getElementById('armour-bar'),
    ammo: document.getElementById('ammo'),
    ammoMag: document.getElementById('ammo-mag'),
    ammoReserve: document.getElementById('ammo-reserve'),
    ammoReloading: document.getElementById('ammo-reloading'),
    weaponName: document.getElementById('weapon-name'),
    slots: document.getElementById('slots'),
    money: document.getElementById('money'),
    scoreA: document.getElementById('score-a'),
    scoreB: document.getElementById('score-b'),
    timer: document.getElementById('timer'),
    roundLabel: document.getElementById('round-label'),
    banner: document.getElementById('banner'),
    bannerTitle: document.getElementById('banner-title'),
    bannerSub: document.getElementById('banner-sub'),
    siteBanner: document.getElementById('site-banner'),
    killfeed: document.getElementById('killfeed'),
    radio: document.getElementById('radio'),
    minimap: document.getElementById('minimap'),
    buy: document.getElementById('buy'),
    buyGrid: document.getElementById('buy-grid'),
    buyMoney: document.getElementById('buy-money'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayCopy: document.getElementById('overlay-copy'),
    play: document.getElementById('play'),
    hitmarker: document.getElementById('hitmarker'),
    flash: document.getElementById('flash'),
    chargeChip: document.getElementById('charge-chip'),
    plantBar: document.getElementById('plant-bar'),
    plantLabel: document.getElementById('plant-label'),
    plantFill: document.getElementById('plant-fill'),
    hint: document.getElementById('hint'),
  };
  const minimapCtx = el.minimap.getContext('2d');

  let lastHealth = -1;
  let lastArmour = -1;
  let lastMag = -2;
  let lastReserve = -2;
  let lastWeaponName = '';
  let lastMoney = -1;
  let lastScoreA = -1;
  let lastScoreB = -1;
  let lastTimer = '';
  let lastRound = '';
  let bannerTimer = 0;
  let hitTimer = 0;
  let flashTimer = 0;
  let buyHandler = null;
  // In deterministic ?shot= captures the renderer is slow (software WebGL), so the
  // banner/radio auto-hide timers would fire before the screenshot is taken.
  // Shot mode freezes those timers; the live game is unaffected (shotMode false).
  let shotMode = false;

  function toMapX(x) {
    return ((x - MAP.minX) / (MAP.maxX - MAP.minX)) * el.minimap.width;
  }
  function toMapY(z) {
    return ((z - MAP.minZ) / (MAP.maxZ - MAP.minZ)) * el.minimap.height;
  }

  function drawMinimap(view) {
    const ctx = minimapCtx;
    const w = el.minimap.width;
    const h = el.minimap.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#141a14';
    ctx.fillRect(0, 0, w, h);
    // Walls.
    ctx.strokeStyle = '#9aa894';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [x1, z1, x2, z2] of MAP.walls) {
      ctx.moveTo(toMapX(x1), toMapY(z1));
      ctx.lineTo(toMapX(x2), toMapY(z2));
    }
    ctx.stroke();
    // Sites: vermilion ring + letter.
    ctx.font = 'bold 13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const site of MAP.sites) {
      const cx = toMapX(site.x);
      const cy = toMapY(site.z);
      ctx.strokeStyle = '#d84a2f';
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e8b13a';
      ctx.fillText(site.letter, cx, cy);
    }
    if (!view) return;
    // Friends: teal dots. Enemies: red dots, only when main says they were seen.
    ctx.fillStyle = '#2fa8a0';
    for (const f of view.friends || []) {
      ctx.beginPath();
      ctx.arc(toMapX(f.x), toMapY(f.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#d84a2f';
    for (const e of view.enemies || []) {
      ctx.beginPath();
      ctx.arc(toMapX(e.x), toMapY(e.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow, rotating with yaw. Yaw 0 faces north (-z), so the arrow points up
    // on the map; canvas rotation is -yaw (see derivation in the file comment below).
    const px = toMapX(view.x);
    const py = toMapY(view.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-view.yaw);
    ctx.fillStyle = '#eef2e4';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function pushLine(container, html, max) {
    const line = document.createElement('div');
    line.innerHTML = html;
    container.prepend(line);
    while (container.children.length > max) container.removeChild(container.lastChild);
    return line;
  }

  return {
    setHealth(hp, armour) {
      const h = Math.max(0, Math.round(hp));
      const a = Math.max(0, Math.round(armour || 0));
      if (h === lastHealth && a === lastArmour) return;
      lastHealth = h;
      lastArmour = a;
      el.healthValue.textContent = String(h);
      el.healthBar.style.width = `${h}%`;
      el.health.classList.toggle('low', h <= 30 && h > 0);
      el.armourValue.textContent = String(a);
      el.armourBar.style.width = `${Math.min(100, a)}%`;
    },

    setAmmo(mag, reserve, name, reloading = false) {
      if (mag === lastMag && reserve === lastReserve && name === lastWeaponName) {
        el.ammoReloading.hidden = !reloading;
        return;
      }
      lastMag = mag;
      lastReserve = reserve;
      lastWeaponName = name || '';
      el.weaponName.textContent = name || '';
      if (mag < 0) {
        // Melee (TANTO): no magazine to show.
        el.ammoMag.textContent = '—';
        el.ammoReserve.textContent = '';
        el.ammo.classList.remove('empty');
      } else {
        el.ammoMag.textContent = String(mag);
        el.ammoReserve.textContent = reserve < 0 ? '' : `/ ${reserve}`;
        el.ammo.classList.toggle('empty', mag === 0);
      }
      el.ammoReloading.hidden = !reloading;
    },

    setMoney(n) {
      const v = Math.floor(n);
      if (v === lastMoney) return;
      lastMoney = v;
      el.money.textContent = `$${v}`;
    },

    setScore(a, b) {
      if (a === lastScoreA && b === lastScoreB) return;
      lastScoreA = a;
      lastScoreB = b;
      el.scoreA.textContent = String(a);
      el.scoreB.textContent = String(b);
    },

    setTimer(seconds, phase) {
      const text = `${formatTime(seconds)}${phase ? ` · ${phase.toUpperCase()}` : ''}`;
      if (text === lastTimer) return;
      lastTimer = text;
      el.timer.textContent = text;
    },

    setRound(n, max) {
      const text = `ROUND ${n} / ${max}`;
      if (text === lastRound) return;
      lastRound = text;
      el.roundLabel.textContent = text;
    },

    showBanner(title, sub, holdMs = 2600) {
      el.bannerTitle.textContent = title;
      el.bannerSub.textContent = sub || '';
      el.banner.hidden = false;
      clearTimeout(bannerTimer);
      if (!shotMode) bannerTimer = setTimeout(() => { el.banner.hidden = true; }, holdMs);
    },

    showBuyMenu(items, money, onBuy) {
      buyHandler = onBuy;
      el.buyMoney.textContent = `$${Math.floor(money)} — buy phase`;
      el.buyGrid.textContent = '';
      for (const item of items) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'buy-card';
        card.disabled = item.price > money;
        const name = document.createElement('div');
        name.className = 'buy-name';
        name.textContent = item.name;
        const kind = document.createElement('div');
        kind.className = 'buy-kind';
        kind.textContent = item.detail || item.kind || '';
        const price = document.createElement('div');
        price.className = 'buy-price';
        price.textContent = `$${item.price}`;
        card.append(name, kind, price);
        card.addEventListener('click', () => {
          if (buyHandler) buyHandler(item.id);
        });
        el.buyGrid.appendChild(card);
      }
      el.buy.hidden = false;
    },

    hideBuyMenu() {
      buyHandler = null;
      el.buy.hidden = true;
    },

    killfeed(line) {
      pushLine(el.killfeed, line, MAX_KILLFEED);
    },

    radio(line) {
      const node = pushLine(el.radio, line, MAX_RADIO);
      if (!shotMode) setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 8000);
    },

    // Deterministic ?shot= captures: freeze banner/radio auto-hide timers so the
    // slow software renderer cannot outrun them before the screenshot is taken.
    setShotMode(v) {
      shotMode = !!v;
    },

    // view: { x, z, yaw, friends: [{x, z}], enemies: [{x, z}] } — enemies only
    // contains bots main.js knows were seen recently; unseen enemies stay hidden.
    setMinimap(view) {
      drawMinimap(view);
    },

    showOverlay(kind, data = {}) {
      const text = COPY[kind] || COPY.start;
      let title = text.title;
      let copy = text.copy;
      if (kind === 'end') {
        const winner = data.winner ? data.winner.toUpperCase() : '';
        title = data.winner ? `${winner} TAKES THE PASS` : text.title;
        copy = `${text.copy} Final score — MONSOON ${data.scoreA ?? 0} : ${data.scoreB ?? 0} JADE WATCH.`
          + (data.reason ? ` ${data.reason}.` : '');
      }
      el.overlayTitle.textContent = title;
      el.overlayCopy.textContent = copy;
      el.play.textContent = text.action;
      el.overlay.hidden = false;
      el.play.focus();
    },

    hideOverlay() {
      el.overlay.hidden = true;
    },

    hitMarker(kill, holdMs = 120) {
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('kill', Boolean(kill));
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        el.hitmarker.classList.remove('on', 'kill');
      }, holdMs);
    },

    // White-out from a dawn (flash) grenade. Strength 0..1; fades back on its own.
    flashBlind(strength) {
      const s = Math.max(0, Math.min(1, strength));
      clearTimeout(flashTimer);
      el.flash.style.transition = 'none';
      el.flash.style.opacity = String(s);
      // Force the style flush so the fade transition below actually animates.
      void el.flash.offsetWidth;
      el.flash.style.transition = '';
      flashTimer = setTimeout(() => { el.flash.style.opacity = '0'; }, 60);
    },

    setChargeChip(has) {
      el.chargeChip.hidden = !has;
    },

    // p: 0..1 progress, or null to hide the bar. label names the channel.
    setPlantProgress(p, label) {
      if (p === null || p === undefined) {
        el.plantBar.hidden = true;
        return;
      }
      el.plantBar.hidden = false;
      if (label) el.plantLabel.textContent = label;
      el.plantFill.style.width = `${Math.max(0, Math.min(1, p)) * 100}%`;
    },

    setSiteBanner(text) {
      if (!text) {
        el.siteBanner.hidden = true;
        return;
      }
      el.siteBanner.textContent = text;
      el.siteBanner.hidden = false;
    },

    onPlay(handler) {
      el.play.addEventListener('click', handler);
    },

    // Extra (not in the spec API): highlight the active slot 1-6 and set the
    // one-line context hint under the crosshair (e.g. "Hold E to plant").
    setSlots(activeSlot) {
      for (const span of el.slots.children) {
        span.classList.toggle('active', span.dataset.slot === String(activeSlot));
      }
    },
    setHint(text) {
      if (el.hint.textContent !== text) el.hint.textContent = text || '';
    },
  };
}
