// Tidebreak boot and the one loop: a fixed 60 Hz simulation feeding a render
// at the display's rate. The match is a state machine (menu -> buy -> live
// -> roundEnd -> buy ... -> matchEnd) and every system — player, weapons,
// bots, grenades, plant/defuse, economy — reads and writes the one state
// object in state.js. ?shot=start|buy|play|plant with &seed=N stages a
// deterministic frame for a capture, renders it twice, then freezes it and
// sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer, updatePlayer, eyePosition, eyeForward, isMoving } from './player.js';
import {
  WEAPONS, GRENADES, createWeaponState, currentSpread, damageAt,
  canFire, consumeShot, startReload, updateReload, recoverWeapon,
  createGrenades, throwGrenade, updateGrenades,
} from './weapons.js';
import { createBots, startRound, updateBots, killBot, reassignPlanter } from './bots.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createState, resetRoundState } from './state.js';
import { hasLineOfSight } from './physics.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 20, 55);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const state = createState();
const player = createPlayer(world.colliders);
const weapon = createWeaponState();
const grens = createGrenades();
const bots = createBots(scene, world);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

// The viewmodel: a small gun in the camera's lower right, with a kick on
// every shot and a sway while moving.
const viewmodel = new THREE.Group();
const vmBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, 0.13, 0.45),
  new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.4 }),
);
const vmBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8),
  new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.4, metalness: 0.6 }),
);
vmBarrel.rotation.x = Math.PI / 2;
vmBarrel.position.set(0, 0.02, -0.38);
viewmodel.add(vmBody);
viewmodel.add(vmBarrel);
viewmodel.position.set(0.3, -0.28, -0.6);
viewmodel.scale.setScalar(0.75);
camera.add(viewmodel);

let elapsed = 0;
let frozen = false;
let menuAngle = 0;
let lastShotAt = 0;
let lastShotPos = new THREE.Vector3();
let beepAcc = 0;
let deathTimer = 0;
let roundEndTimer = 0;
let vmKick = 0;

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _up2 = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _toBot = new THREE.Vector3();
const _chargePos = new THREE.Vector3();
// Edge detection for one-shot keys (grenades): a held key must throw once.
let lastKeys = new Set();
function pressed(code) {
  return input.state.keys.has(code) && !lastKeys.has(code);
}

function onLockChange(locked) {
  if (!locked && state.phase === 'live' && !shot) {
    hud.showBanner('Click to resume', 'Pointer unlocked — click the yard to look around again');
  }
}

const hud = createHud({
  onPlay() {
    audio.unlock();
    startMatch();
  },
  onBuy(id) {
    buyItem(id);
  },
  onDeploy() {
    if (state.phase === 'buy') startLiveRound();
  },
  onRestart() {
    startMatch();
  },
});

function aliveBots() {
  return bots.filter((b) => b.alive);
}

function startMatch() {
  state.phase = 'buy';
  state.round = 1;
  state.playerRounds = 0;
  state.botRounds = 0;
  state.money = 800;
  state.kills = 0;
  state.deaths = 0;
  state.matchWinner = null;
  state.hasKit = false;
  state.kevlar = false;
  state.lossStreak = 0;
  state.roundHistory = [];
  state.grenades.he = 0;
  state.grenades.smoke = 0;
  weapon.owned = new Set(['tide9']);
  weapon.current = 'tide9';
  for (const id of Object.keys(WEAPONS)) {
    weapon.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  }
  player.state.health = 100;
  player.state.armor = 0;
  player.state.alive = true;
  player.state.position.copy(world.defenderSpawn.position);
  player.state.yaw = world.defenderSpawn.yaw;
  player.state.pitch = 0;
  startBuyPhase();
}

function startBuyPhase() {
  resetRoundState(state);
  state.phase = 'buy';
  state.timer = state.buyTime;
  player.state.position.copy(world.defenderSpawn.position);
  player.state.yaw = world.defenderSpawn.yaw;
  player.state.pitch = 0;
  player.state.health = 100;
  player.state.velocity.set(0, 0, 0);
  player.state.alive = true;
  effects.hideCharge();
  for (const bot of bots) {
    bot.mesh.group.visible = false;
    bot.alive = false;
  }
  input.exitLock();
  hud.hideAll();
  hud.showBuy(canAfford);
  hud.setMoney(state.money);
  hud.setTimer(state.timer);
  hud.setScore(state.playerRounds, state.botRounds, state.round);
  hud.setObjective(state.round === 1 ? 'Buy up — the Drifters push at dawn' : 'Buy up for the next push');
  refreshHud();
}

function canAfford(item) {
  if (item.kind === 'weapon') return !weapon.owned.has(item.id) && state.money >= item.price;
  if (item.kind === 'grenade') return state.money >= item.price;
  if (item.id === 'kevlar') return !state.kevlar && state.money >= item.price;
  if (item.id === 'kit') return !state.hasKit && state.money >= item.price;
  return false;
}

function buyItem(id) {
  if (state.phase !== 'buy') return;
  const def = WEAPONS[id];
  if (def) {
    if (weapon.owned.has(id) || state.money < def.price) return;
    state.money -= def.price;
    weapon.owned.add(id);
    weapon.ammo[id] = { mag: def.mag, reserve: def.reserve };
    weapon.current = id;
    weapon.reloading = false;
    audio.buy();
    hud.setMoney(state.money);
    hud.showBuy(canAfford);
    refreshHud();
    return;
  }
  const gren = GRENADES[id];
  if (gren) {
    if (state.money < gren.price) return;
    state.money -= gren.price;
    state.grenades[id] += 1;
    audio.buy();
    hud.setMoney(state.money);
    hud.showBuy(canAfford);
    refreshHud();
    return;
  }
  if (id === 'kevlar' && !state.kevlar && state.money >= 650) {
    state.money -= 650;
    state.kevlar = true;
    player.state.armor = 100;
    audio.buy();
    hud.setMoney(state.money);
    hud.showBuy(canAfford);
    refreshHud();
    return;
  }
  if (id === 'kit' && !state.hasKit && state.money >= 400) {
    state.money -= 400;
    state.hasKit = true;
    audio.buy();
    hud.setMoney(state.money);
    hud.showBuy(canAfford);
    refreshHud();
  }
}

function startLiveRound() {
  state.phase = 'live';
  state.timer = state.roundTime;
  hud.hideAll();
  hud.setObjective('Hold the yard — stop the plant');
  input.requestLock();
  startRound(bots, world, random);
  refreshHud();
}

function endRound(winner, reason) {
  if (state.phase !== 'live') return;
  state.phase = 'roundEnd';
  state.winner = winner;
  state.roundReason = reason;
  state.roundHistory.push(winner);
  roundEndTimer = 3.5;
  if (winner === 'player') {
    state.playerRounds += 1;
    state.lossStreak = 0;
    state.money += 3000;
    audio.roundWin();
    hud.showBanner('Round held', `${reason} · +$3,000`, 3400);
  } else {
    state.botRounds += 1;
    // Loss bonus grows with consecutive lost rounds, like the economy of
    // the games this one is styled after: $1,400, then $1,900, $2,400,
    // capped at $2,900, so a losing run can still buy back in.
    state.lossStreak += 1;
    const bonus = 1400 + 500 * Math.min(state.lossStreak - 1, 3);
    state.money += bonus;
    audio.roundLose();
    const bonusNote = state.lossStreak > 1 ? ` (loss bonus ×${state.lossStreak})` : '';
    hud.showBanner('Round lost', `${reason} · +$${bonus.toLocaleString('en-US')}${bonusNote}`, 3400);
  }
  hud.setScore(state.playerRounds, state.botRounds, state.round);
  hud.setRoundHistory(state.roundHistory);
  hud.setMoney(state.money);
  hud.setProgress(null, null);
  hud.setFuse(null);
  input.exitLock();
}

function endMatch() {
  state.phase = 'matchEnd';
  const won = state.playerRounds > state.botRounds;
  state.matchWinner = won ? 'player' : 'bots';
  hud.showMatch(
    won ? 'Saltworks held' : 'The yard is lost',
    `Final score ${state.playerRounds} — ${state.botRounds} · ${state.kills} Drifters dropped · ${state.deaths} ${state.deaths === 1 ? 'death' : 'deaths'}`,
  );
  input.exitLock();
}

function damagePlayer(amount, fromPos) {
  const s = player.state;
  if (!s.alive || state.phase !== 'live') return;
  let remaining = amount;
  if (s.armor > 0) {
    const absorbed = Math.min(s.armor, remaining * 0.5);
    s.armor -= absorbed;
    remaining -= absorbed;
  }
  s.health -= remaining;
  audio.hurt();
  // Damage direction: the angle of the shooter relative to where we face.
  const dx = fromPos.x - s.position.x;
  const dz = fromPos.z - s.position.z;
  const worldAngle = Math.atan2(dx, dz);
  const rel = worldAngle - s.yaw;
  hud.showDamage((rel * 180) / Math.PI);
  refreshHud();
  if (s.health <= 0) {
    s.health = 0;
    s.alive = false;
    state.deaths += 1;
    deathTimer = 1.2;
  }
}

function damageBot(bot, amount, part, attackerName) {
  if (!bot.alive) return;
  bot.health -= amount;
  hud.showHitmarker(false);
  audio.hit();
  if (bot.health <= 0) {
    killBot(bot, attackerName);
    state.kills += 1;
    state.roundKills += 1;
    state.money += 300;
    hud.showHitmarker(true);
    hud.killfeedAdd(`You ▸ ${bot.name}`);
    hud.setMoney(state.money);
    audio.kill();
    if (bot.role === 'planter' && !state.plantDone) {
      const next = reassignPlanter(bots, world);
      if (next) hud.killfeedAdd(`${next.name} picks up the charge`);
    }
    refreshHud();
  }
}

// One pellet from the player's current weapon.
function firePellet(def, spreadRad) {
  eyePosition(player, _eye);
  eyeForward(player, weapon.recoilPitch, weapon.recoilYaw, _dir);
  // Random point in a disc of radius spreadRad around the aim direction.
  const a = Math.random() * Math.PI * 2;
  const r = spreadRad * Math.sqrt(Math.random());
  _right.crossVectors(_dir, _up).normalize();
  _up2.crossVectors(_right, _dir).normalize();
  _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up2, Math.sin(a) * r).normalize();

  _muzzle.copy(_eye).addScaledVector(_dir, 0.6);
  _muzzle.y -= 0.12;
  _muzzle.x += Math.cos(player.state.yaw) * 0.18;

  raycaster.set(_eye, _dir);
  const targets = world.shootables.slice();
  for (const bot of bots) {
    if (bot.alive) targets.push(bot.mesh.body, bot.mesh.head);
  }
  const hits = raycaster.intersectObjects(targets, false);
  let end = null;
  if (hits.length > 0) {
    const hit = hits[0];
    end = hit.point;
    const bot = hit.object.userData.bot;
    if (bot && bot.alive) {
      const dist = hit.distance;
      const part = hit.object.userData.part;
      const mult = part === 'head' ? def.headMult : 1;
      damageBot(bot, damageAt(def, dist) * mult, part, 'You');
    } else {
      effects.spawnSparks(hit.point, hit.face ? hit.face.normal : _up);
    }
  } else {
    end = _eye.clone().addScaledVector(_dir, def.range);
  }
  effects.spawnTracer(_muzzle, end);
  return end;
}

function playerShoot(now) {
  const def = WEAPONS[weapon.current];
  if (!canFire(weapon, def, now)) {
    if (weapon.ammo[def.id].mag <= 0 && !weapon.reloading) {
      if (startReload(weapon, def, now)) audio.reload();
      else audio.dryFire();
    }
    return;
  }
  const moving = isMoving(player);
  const spread = currentSpread(def, weapon, moving, player.state.crouched, !player.state.onGround, now);
  consumeShot(weapon, def, now);
  for (let i = 0; i < def.pellets; i++) firePellet(def, spread);
  effects.muzzle(camera);
  audio.shot(def.kind);
  lastShotAt = now;
  lastShotPos.copy(player.state.position);
  vmKick = Math.min(0.09, vmKick + 0.035);
  hud.setCrosshairSpread(4 + weapon.bloom * 500);
  refreshHud();
}

function throwPlayerGrenade(type) {
  if (state.phase !== 'live' || !player.state.alive) return;
  if (state.grenades[type] <= 0) return;
  state.grenades[type] -= 1;
  eyePosition(player, _eye);
  eyeForward(player, weapon.recoilPitch, weapon.recoilYaw, _dir);
  throwGrenade(grens, type, _eye, _dir, elapsed);
  refreshHud();
}

function drainGrenadeEvents() {
  for (const event of grens.events) {
    if (event.type === 'detonate-he') {
      effects.explosion(event.pos);
      audio.explosion();
      const def = GRENADES.he;
      for (const bot of bots) {
        if (!bot.alive) continue;
        _toBot.copy(bot.position);
        _toBot.y += 1;
        const dist = _toBot.distanceTo(event.pos);
        if (dist > def.radius) continue;
        const eye = new THREE.Vector3(event.pos.x, event.pos.y + 0.4, event.pos.z);
        if (!hasLineOfSight(eye, _toBot, world.colliders, null)) continue;
        damageBot(bot, def.maxDamage * (1 - (dist / def.radius) * 0.7), 'body', 'You');
      }
      const pd = player.state.position.distanceTo(event.pos);
      if (pd < def.radius && player.state.alive) {
        damagePlayer(def.maxDamage * 0.45 * (1 - (pd / def.radius) * 0.6), event.pos);
      }
    } else if (event.type === 'detonate-smoke') {
      effects.spawnSmoke(event.pos);
    }
  }
  grens.events.length = 0;
}

function drainBotEvents(events) {
  for (const event of events) {
    if (event.type === 'bot-shot') {
      effects.spawnTracer(event.from, event.to);
      audio.enemyShot();
      if (event.hit) damagePlayer(event.damage, event.from);
    } else if (event.type === 'plant-progress') {
      hud.setProgress(`Drifter planting at ${world.sites[event.bot.site].name}…`, event.value);
    } else if (event.type === 'planted') {
      state.plantDone = true;
      state.plantSite = event.site;
      state.fuseLeft = state.fuseTime;
      const site = world.sites[event.site];
      _chargePos.copy(site.center);
      effects.showCharge(_chargePos);
      audio.plantDone();
      hud.setProgress(null, null);
      hud.showBanner('Charge planted', `${site.name} — defuse it before the fuse runs out`, 3200);
      hud.setObjective(`Defuse the charge at ${site.name}`);
    }
  }
  events.length = 0;
}

function updateDefuse(dt) {
  if (!state.plantDone) return;
  const site = world.sites[state.plantSite];
  const dist = player.state.position.distanceTo(site.center);
  const want = player.state.alive && dist < 1.8 && input.state.keys.has('KeyE');
  if (want) {
    state.defusing = true;
    const rate = state.hasKit ? 1 / 2.5 : 1 / 5;
    state.defuseProgress += dt * rate;
    hud.setProgress(state.hasKit ? 'Defusing (kit)…' : 'Defusing…', state.defuseProgress);
    if (state.defuseProgress >= 1) {
      state.money += 300;
      hud.setMoney(state.money);
      endRound('player', 'Charge defused');
    }
  } else {
    state.defusing = false;
    state.defuseProgress = Math.max(0, state.defuseProgress - dt * 0.4);
    if (state.plantDone) hud.setProgress(null, null);
  }
}

function updateFuse(dt) {
  if (!state.plantDone) return;
  state.fuseLeft -= dt;
  beepAcc += dt;
  const interval = state.fuseLeft < 10 ? 0.45 : 1;
  if (beepAcc >= interval) {
    beepAcc = 0;
    audio.beep(state.fuseLeft < 10);
  }
  effects.blinkCharge(Math.floor(elapsed * 2) % 2 === 0);
  hud.setTimer(state.fuseLeft);
  if (state.fuseLeft <= 0) {
    effects.explosion(_chargePos);
    audio.explosion();
    effects.hideCharge();
    endRound('bots', 'The charge blew the yard');
  }
}

function refreshHud() {
  const def = WEAPONS[weapon.current];
  const ammo = weapon.ammo[def.id];
  hud.setAmmo(ammo.mag, ammo.reserve, weapon.reloading);
  hud.setWeapon(def.name, def.kind);
  hud.setHealth(player.state.health, player.state.armor);
  hud.setMoney(state.money);
  hud.setScore(state.playerRounds, state.botRounds, state.round);
  hud.setRoundHistory(state.roundHistory);
  // During the buy phase the Drifters have not deployed yet: show the full
  // squad coming, not the zero the sim counts while they are hidden.
  hud.setBotsAlive(state.phase === 'buy' ? bots.length : aliveBots().length, bots.length);
  hud.setGrenades(state.grenades.he, state.grenades.smoke);
}

function step(dt) {
  elapsed += dt;

  if (state.phase === 'menu') {
    menuAngle += dt * 0.05;
    return;
  }

  if (state.phase === 'buy') {
    state.timer -= dt;
    hud.setTimer(state.timer);
    if (state.timer <= 0) startLiveRound();
    return;
  }

  if (state.phase === 'roundEnd') {
    roundEndTimer -= dt;
    if (roundEndTimer <= 0) {
      if (state.playerRounds >= state.winRounds || state.botRounds >= state.winRounds || state.round >= state.maxRounds) {
        endMatch();
      } else {
        state.round += 1;
        startBuyPhase();
      }
    }
    return;
  }

  if (state.phase !== 'live') return;

  // Live round.
  state.timer -= dt;
  hud.setTimer(state.plantDone ? state.fuseLeft : state.timer);
  hud.setFuse(state.plantDone ? state.fuseLeft : null, state.fuseTime);

  // Player.
  updatePlayer(player, input, dt);
  const keys = input.state.keys;
  if (keys.has('KeyR')) {
    const def = WEAPONS[weapon.current];
    if (startReload(weapon, def, elapsed)) audio.reload();
  }
  for (let i = 1; i <= 6; i++) {
    if (keys.has(`Digit${i}`)) {
      const id = Object.keys(WEAPONS)[i - 1];
      if (weapon.owned.has(id) && weapon.current !== id) {
        weapon.current = id;
        weapon.reloading = false;
        weapon.burstLeft = 0;
        refreshHud();
      }
    }
  }
  if (pressed('Digit7')) throwPlayerGrenade('he');
  if (pressed('Digit8')) throwPlayerGrenade('smoke');
  const reloadDef = WEAPONS[weapon.current];
  if (updateReload(weapon, reloadDef, elapsed)) hud.setReload(null);
  else if (weapon.reloading) {
    hud.setReload(1 - (weapon.reloadEnd - elapsed) / reloadDef.reloadTime);
  }
  if (input.state.firing && player.state.alive) playerShoot(elapsed);
  // Recoil and bloom settle; a still, crouched shooter recovers fastest.
  recoverWeapon(weapon, dt, isMoving(player), player.state.crouched);

  // Grenades.
  updateGrenades(grens, dt, world.colliders);
  drainGrenadeEvents();

  // Bots.
  const botEvents = [];
  updateBots(bots, dt, {
    now: elapsed,
    playerPos: player.state.position,
    playerAlive: player.state.alive,
    playerMoving: isMoving(player),
    playerCrouched: player.state.crouched,
    colliders: world.colliders,
    smokeClouds: effects.smokeClouds(),
    roundTimeLeft: state.timer,
    plantDone: state.plantDone,
    plantSite: state.plantSite,
    sites: world.sites,
    routes: world.routes,
    lastShotAt,
    lastShotPos,
    events: botEvents,
  });
  drainBotEvents(botEvents);

  // Plant / defuse / fuse.
  updateDefuse(dt);
  updateFuse(dt);

  // Round end by elimination or by the clock.
  if (!player.state.alive && deathTimer > 0) {
    deathTimer -= dt;
    if (deathTimer <= 0) endRound('bots', 'The defender is down');
  } else if (aliveBots().length === 0) {
    endRound('player', 'All four Drifters are down');
  } else if (state.timer <= 0 && !state.plantDone) {
    endRound('player', 'Time ran out with no plant');
  }

  // Crosshair follows the current spread.
  const def = WEAPONS[weapon.current];
  const spread = currentSpread(def, weapon, isMoving(player), player.state.crouched, !player.state.onGround, elapsed);
  hud.setCrosshairSpread(4 + spread * 900);
  lastKeys = new Set(input.state.keys);
}

// ---- Render: read the sim, never write it. ----
function render() {
  const s = player.state;
  if (state.phase === 'menu') {
    const r = 26;
    camera.position.set(Math.cos(menuAngle) * r, 12, Math.sin(menuAngle) * r);
    camera.lookAt(0, 0, -2);
  } else {
    eyePosition(player, _eye);
    camera.position.copy(_eye);
    if (!s.alive) {
      camera.position.y = 0.6;
      camera.rotation.set(-0.9, s.yaw, 0, 'YXZ');
    } else {
      camera.rotation.set(s.pitch + weapon.recoilPitch, s.yaw + weapon.recoilYaw, 0, 'YXZ');
    }
  }
  // Viewmodel kick and sway.
  vmKick = Math.max(0, vmKick - 0.25 * (1 / 60));
  viewmodel.position.z = -0.6 + vmKick;
  const moving = isMoving(player);
  viewmodel.position.x = 0.3 + (moving ? Math.sin(elapsed * 9) * 0.006 : 0);
  viewmodel.position.y = -0.28 + (moving ? Math.abs(Math.cos(elapsed * 9)) * 0.008 : 0);

  // Bot meshes follow their sim bodies.
  for (const bot of bots) {
    bot.mesh.group.position.copy(bot.position);
    bot.mesh.group.rotation.y = bot.yaw;
    if (bot.alive && bot.state === 'route') {
      bot.mesh.group.position.y = Math.abs(Math.sin(elapsed * 8 + bot.id)) * 0.04;
    }
  }

  world.update(elapsed);
  effects.update(1 / 60);
  hud.update(1 / 60);
  renderer.render(scene, camera);
}

let last = performance.now();
let acc = 0;
function loop(now) {
  if (frozen) return;
  requestAnimationFrame(loop);
  const frameDt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += frameDt;
  let guard = 0;
  while (acc >= FIXED_STEP && guard < 15) {
    step(FIXED_STEP);
    acc -= FIXED_STEP;
    guard += 1;
  }
  render();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Screenshot staging: put the real game into a chosen frame. ----
function stageShot() {
  if (shot === 'start') {
    state.phase = 'menu';
    menuAngle = 0.6;
    hud.showMenu();
  } else if (shot === 'buy') {
    state.money = 2400;
    state.phase = 'buy';
    state.timer = 14;
    startBuyPhase();
    state.money = 2400;
    hud.setMoney(2400);
    player.state.position.set(0, 0, 15);
    player.state.yaw = 0;
  } else if (shot === 'play' || shot === 'plant') {
    state.phase = 'live';
    state.timer = state.roundTime;
    hud.hideAll();
    startRound(bots, world, random);
    // Step the real sim forward so the Drifters are mid-route. The defender
    // is unkillable while staging, so a stray burst cannot end the round
    // before the frame is taken — and marked not-alive, so no bot can see
    // them and stop to engage during the walk-in.
    player.state.health = 1000;
    player.state.alive = false;
    player.state.position.set(-23, 0, 17);
    for (let i = 0; i < 240; i++) step(FIXED_STEP);
    player.state.health = 100;
    player.state.alive = true;
    hud.clearDamage();
    // South-west of mid-yard, looking north-east up the B lane: the
    // Drifters on the mid routes cross the frame with the salt mounds
    // behind them and the silo off to the right edge.
    player.state.position.set(-11, 0, 5);
    player.state.yaw = -0.55;
    player.state.pitch = 0.0;
    player.state.health = 100;
    if (shot === 'plant') {
      const planter = bots.find((b) => b.role === 'planter' && b.alive) || bots[0];
      planter.position.set(-17, 0, -11);
      planter.state = 'plant';
      planter.plantProgress = 0.97;
      planter.site = 'A';
      player.state.health = 1000;
      player.state.alive = false;
      player.state.position.set(-23, 0, 17);
      for (let i = 0; i < 30; i++) step(FIXED_STEP);
      player.state.health = 100;
      player.state.alive = true;
      hud.clearDamage();
      player.state.position.set(-12.5, 0, -6.5);
      player.state.yaw = 0.55;
      player.state.pitch = -0.05;
      state.defuseProgress = 0.45;
      state.defusing = true;
      hud.setProgress('Defusing…', 0.45);
      hud.setObjective('Defuse the charge at Evap Pans');
    }
    hud.setTimer(state.plantDone ? state.fuseLeft : state.timer);
    hud.setFuse(state.plantDone ? state.fuseLeft : null, state.fuseTime);
    refreshHud();
  }
  render();
  render();
  window.__shotReady = true;
  frozen = true;
}

// Debug handle for play tests and captures. Everything here is the real
// game state; the helpers only move the game into states it can reach.
window.__tidebreak = {
  state,
  player,
  weapon,
  bots,
  world,
  hud,
  debug: {
    teleport(x, z) {
      player.state.position.set(x, 0, z);
    },
    setHealth(h) {
      player.state.health = h;
    },
    forcePlant(site) {
      const planter = bots.find((b) => b.role === 'planter' && b.alive) || bots.find((b) => b.alive);
      if (!planter) return;
      planter.position.copy(world.sites[site].center);
      planter.state = 'plant';
      planter.plantProgress = 0;
      planter.site = site;
    },
    // Advance the real simulation by a fixed amount of game time, the same
    // step() the animation loop calls. Play tests use this to wait out a
    // 5 s plant or defuse channel without depending on render speed: on
    // software rendering a frame can take a second, so wall-clock waits
    // would make the test flaky without changing what is being tested.
    advance(seconds) {
      const n = Math.round(seconds / FIXED_STEP);
      for (let i = 0; i < n; i++) step(FIXED_STEP);
    },
  },
};

if (shot) {
  startRound(bots, world, random);
  stageShot();
} else {
  startRound(bots, world, random);
  hud.showMenu();
  refreshHud();
  requestAnimationFrame(loop);
}
