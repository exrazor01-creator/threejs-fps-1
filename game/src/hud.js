// The HUD and the menus, redesigned: health, armour, ammo, money, timer,
// round score with a history of pips, bots alive, objective banner,
// killfeed, hitmarker, damage direction, the buy menu and the start/round/
// match overlays. New since the last build:
//  - round pips under the score: one dot per round played, amber for a
//    round the defender held, red for one the Drifters took;
//  - a fuse bar under the timer while a charge is planted, draining with
//    the fuse so the defuse window reads at a glance;
//  - a reload bar under the ammunition, filling as the reload finishes.
// The HUD reads state and writes text; it never simulates anything. All
// element lookups happen once here, so a missing element fails loudly at
// boot instead of mid-round.
import { WEAPONS, GRENADES } from './weapons.js';

function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing hud element #${id}`);
  return node;
}

export function createHud(callbacks) {
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const ammoWrap = el('ammo');
  const weaponName = el('weapon-name');
  const reloadWrap = el('reload-wrap');
  const reloadFill = el('reload-fill');
  const healthValue = el('health-value');
  const healthWrap = el('health-wrap');
  const healthBar = el('health-fill');
  const armorValue = el('armor-value');
  const moneyValue = el('money-value');
  const timerValue = el('timer-value');
  const fuseWrap = el('fuse-wrap');
  const fuseFill = el('fuse-fill');
  const scoreValue = el('score-value');
  const botsValue = el('bots-value');
  const objectiveValue = el('objective-value');
  const killfeed = el('killfeed');
  const hitmarker = el('hitmarker');
  const crosshair = el('crosshair');
  const damageArc = el('damage-arc');
  const vignette = el('vignette');
  const banner = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const progressWrap = el('progress-wrap');
  const progressLabel = el('progress-label');
  const progressFill = el('progress-fill');
  const grenadeValue = el('grenade-value');
  const overlay = el('overlay');
  const buyPanel = el('buy');
  const buyItems = el('buy-items');
  const buyMoney = el('buy-money');
  const matchPanel = el('match');
  const matchTitle = el('match-title');
  const matchSub = el('match-sub');
  const roundScore = el('round-score');
  const roundPips = el('round-pips');

  let hitTimer = 0;
  let damageTimer = 0;

  function fmtTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // The buy menu is built once from the weapon and grenade tables.
  const items = [];
  for (const def of Object.values(WEAPONS)) {
    if (def.id === 'tide9') continue;
    items.push({ id: def.id, kind: 'weapon', name: def.name, detail: `${def.kind} · ${def.damage} dmg`, price: def.price });
  }
  items.push({ id: 'he', kind: 'grenade', name: GRENADES.he.name, detail: 'Blast · 95 dmg', price: GRENADES.he.price });
  items.push({ id: 'smoke', kind: 'grenade', name: GRENADES.smoke.name, detail: 'Blocks sight · 18s', price: GRENADES.smoke.price });
  items.push({ id: 'kevlar', kind: 'gear', name: 'Kevlar Vest', detail: 'Halves bullet damage', price: 650 });
  items.push({ id: 'kit', kind: 'gear', name: 'Defuse Kit', detail: 'Defuse in half the time', price: 400 });
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buy-item';
    button.dataset.id = item.id;
    button.innerHTML = `<span class="buy-name">${item.name}</span><span class="buy-detail">${item.detail}</span><span class="buy-price">$${item.price}</span>`;
    button.addEventListener('click', () => callbacks.onBuy(item.id));
    buyItems.appendChild(button);
  }

  el('play').addEventListener('click', callbacks.onPlay);
  el('buy-deploy').addEventListener('click', callbacks.onDeploy);
  el('match-restart').addEventListener('click', callbacks.onRestart);

  return {
    setAmmo(mag, reserve, reloading) {
      ammoMag.textContent = mag;
      ammoReserve.textContent = `/ ${reserve}`;
      ammoWrap.classList.toggle('empty', mag === 0);
      ammoWrap.classList.toggle('reloading', reloading);
      if (!reloading) reloadWrap.classList.add('hidden');
    },
    setWeapon(name, kind) {
      weaponName.textContent = `${name} · ${kind}`;
    },
    // fraction 0..1 while a reload runs, null when it is not.
    setReload(fraction) {
      if (fraction == null) {
        reloadWrap.classList.add('hidden');
        return;
      }
      reloadWrap.classList.remove('hidden');
      reloadFill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    },
    setHealth(health, armor) {
      healthValue.textContent = Math.max(0, Math.ceil(health));
      healthBar.style.width = `${Math.max(0, health)}%`;
      healthBar.classList.toggle('low', health <= 30);
      healthWrap.classList.toggle('critical', health <= 30);
      armorValue.textContent = armor > 0 ? `Kevlar ${Math.ceil(armor)}` : '';
    },
    setMoney(money) {
      moneyValue.textContent = `$${money}`;
      buyMoney.textContent = `$${money}`;
    },
    setTimer(seconds) {
      timerValue.textContent = fmtTime(seconds);
      timerValue.classList.toggle('urgent', seconds <= 10);
    },
    // Fuse bar under the timer: seconds left of the total, null to hide.
    setFuse(seconds, total) {
      if (seconds == null) {
        fuseWrap.classList.add('hidden');
        return;
      }
      fuseWrap.classList.remove('hidden');
      fuseFill.style.width = `${Math.round(Math.max(0, seconds / total) * 100)}%`;
      fuseFill.classList.toggle('urgent', seconds <= 10);
    },
    setScore(playerRounds, botRounds, round) {
      scoreValue.innerHTML = `DEF <b>${playerRounds}</b> — <b>${botRounds}</b> DRF`;
      roundScore.textContent = `Round ${round} / 9 · first to 5`;
    },
    // One pip per round played: 'player' amber, 'bots' red.
    setRoundHistory(results) {
      while (roundPips.firstChild) roundPips.removeChild(roundPips.firstChild);
      for (const result of results) {
        const pip = document.createElement('span');
        pip.className = `pip ${result}`;
        roundPips.appendChild(pip);
      }
    },
    setBotsAlive(alive, total) {
      botsValue.textContent = `Drifters ${alive}/${total}`;
    },
    setObjective(text) {
      objectiveValue.textContent = text;
    },
    setGrenades(he, smoke) {
      grenadeValue.textContent = `HE ${he} · Fog ${smoke}`;
    },
    showHitmarker(kill) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', kill);
      hitTimer = kill ? 0.35 : 0.15;
    },
    showDamage(angleDeg) {
      damageArc.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
      damageArc.classList.add('on');
      vignette.classList.add('on');
      damageTimer = 0.6;
    },
    clearDamage() {
      damageTimer = 0;
      damageArc.classList.remove('on');
      vignette.classList.remove('on');
    },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--spread', `${px}px`);
    },
    killfeedAdd(text) {
      const line = document.createElement('div');
      line.className = 'killfeed-line';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      window.setTimeout(() => line.remove(), 6000);
    },
    showBanner(title, sub, ms = 2600) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub;
      banner.classList.remove('hidden');
      window.clearTimeout(banner._t);
      banner._t = window.setTimeout(() => banner.classList.add('hidden'), ms);
    },
    hideBanner() {
      banner.classList.add('hidden');
    },
    setProgress(label, fraction) {
      if (fraction == null) {
        progressWrap.classList.add('hidden');
        return;
      }
      progressWrap.classList.remove('hidden');
      progressLabel.textContent = label;
      progressFill.style.width = `${Math.round(fraction * 100)}%`;
    },
    showMenu() {
      overlay.hidden = false;
      buyPanel.hidden = true;
      matchPanel.hidden = true;
    },
    showBuy(canAfford) {
      overlay.hidden = true;
      matchPanel.hidden = true;
      buyPanel.hidden = false;
      for (const button of buyItems.children) {
        const item = items.find((i) => i.id === button.dataset.id);
        button.disabled = !canAfford(item);
      }
    },
    hideBuy() {
      buyPanel.hidden = true;
    },
    showMatch(title, sub) {
      matchTitle.textContent = title;
      matchSub.textContent = sub;
      matchPanel.hidden = false;
      overlay.hidden = true;
      buyPanel.hidden = true;
    },
    hideAll() {
      overlay.hidden = true;
      buyPanel.hidden = true;
      matchPanel.hidden = true;
      banner.classList.add('hidden');
      progressWrap.classList.add('hidden');
      fuseWrap.classList.add('hidden');
      reloadWrap.classList.add('hidden');
    },
    update(dt) {
      if (hitTimer > 0) {
        hitTimer -= dt;
        if (hitTimer <= 0) hitmarker.classList.remove('on', 'kill');
      }
      if (damageTimer > 0) {
        damageTimer -= dt;
        if (damageTimer <= 0) {
          damageArc.classList.remove('on');
          vignette.classList.remove('on');
        }
      }
    },
  };
}
