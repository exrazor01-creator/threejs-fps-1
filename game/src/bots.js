// The Drifters: four attackers who push a site, plant a charge, and guard
// it. One bot carries the charge (the planter); the others walk their
// routes and hold angles. The squad works as a squad:
//  - A bot that sees the defender calls it out: every Drifter turns toward
//    the contact, and a nearby support walks over to investigate the last
//    known position.
//  - A bot that hears a shot investigates the sound instead of staring at
//    the wall it came through.
//  - One support is the flanker: it pushes the far site, then crosses the
//    ridge to the real site from the other side, so a defender holding one
//    angle gets caught between two.
//  - If the push stalls and the clock runs down with no plant started, the
//    squad rotates: the planter and the supports re-plan to the other site
//    instead of walking into the same held angle.
//  - After the plant they fall back to hold spots around the charge and
//    defend it. If the planter dies, the nearest living bot picks the
//    charge up and goes to plant.
import * as THREE from 'three';
import { hasLineOfSight, moveCircle } from './physics.js';
import { WORLD_COLORS } from './palette.js';

const BOT_NAMES = ['Rook', 'Tern', 'Skua', 'Plover'];
const BOT_SPEED = 3.1;
const PLANT_TIME = 5;
// The clock reading at which a stalled push rotates to the other site.
const ROTATE_AT = 40;
// How far a heard shot pulls a support off its route to investigate.
const INVESTIGATE_RANGE = 15;

const _eye = new THREE.Vector3();
const _eyeTarget = new THREE.Vector3();
const _toPlayer = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _out = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();

function buildBotMesh(scene) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: WORLD_COLORS.botBody, roughness: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: WORLD_COLORS.botDark, roughness: 0.9 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: WORLD_COLORS.botVisor,
    emissive: WORLD_COLORS.botVisor,
    emissiveIntensity: 1.4,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.78, 0.34), bodyMat);
  body.position.y = 0.98;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.32), darkMat);
  head.position.y = 1.56;
  head.castShadow = true;
  group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.05), visorMat);
  visor.position.set(0, 1.58, 0.17);
  group.add(visor);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.56, 0.22), darkMat);
    leg.position.set(side * 0.14, 0.28, 0);
    leg.castShadow = true;
    group.add(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.15), bodyMat);
    arm.position.set(side * 0.35, 1.0, 0.1);
    arm.castShadow = true;
    group.add(arm);
  }
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.72), darkMat);
  gun.position.set(0.2, 1.15, 0.32);
  gun.castShadow = true;
  group.add(gun);

  body.userData.part = 'body';
  head.userData.part = 'head';
  scene.add(group);
  return { group, body, head, gun };
}

export function createBots(scene, world) {
  const bots = [];
  for (let i = 0; i < 4; i++) {
    const mesh = buildBotMesh(scene);
    const bot = {
      id: i,
      name: BOT_NAMES[i],
      mesh,
      position: world.attackerSpawns[i].clone(),
      yaw: 0,
      health: 100,
      alive: true,
      state: 'route',
      stateTime: 0,
      site: 'A',
      role: i === 0 ? 'planter' : 'support',
      route: [],
      waypoint: 0,
      plantProgress: 0,
      strafeDir: 1,
      strafeTime: 0,
      burstLeft: 0,
      nextShot: 0,
      burstPause: 0,
      loseSight: 0,
      alertUntil: 0,
      alertPos: new THREE.Vector3(),
      holdSpot: new THREE.Vector3(),
      flankSpot: new THREE.Vector3(),
      // Last place the squad knows the defender was, and when.
      lastSeenPos: new THREE.Vector3(),
      lastSeenAt: -100,
      investigateUntil: 0,
      investigatePos: new THREE.Vector3(),
      rotated: false,
      // Stuck steering: when a wall stops the walk, sidestep around it.
      stuck: 0,
      side: 0,
      sideUntil: 0,
    };
    mesh.body.userData.bot = bot;
    mesh.head.userData.bot = bot;
    bots.push(bot);
  }
  return bots;
}

function faceToward(bot, target, dt) {
  const dx = target.x - bot.position.x;
  const dz = target.z - bot.position.z;
  const want = Math.atan2(-dx, -dz);
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  bot.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
}

function canSee(bot, playerPos, colliders, smokeClouds) {
  _toPlayer.subVectors(playerPos, bot.position);
  const dist = _toPlayer.length();
  if (dist > 34) return false;
  _eye.set(bot.position.x, bot.position.y + 1.5, bot.position.z);
  _eyeTarget.set(playerPos.x, playerPos.y + 1.3, playerPos.z);
  if (!hasLineOfSight(_eye, _eyeTarget, colliders, smokeClouds)) return false;
  _fwd.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
  _toPlayer.normalize();
  // Peripheral vision is narrow while walking a route, wide once alerted.
  const fov = bot.state === 'engage' ? -0.35 : 0.35;
  return _fwd.dot(_toPlayer) > fov;
}

function moveToward(bot, target, speed, dt, colliders, now) {
  _delta.subVectors(target, bot.position);
  _delta.y = 0;
  const dist = _delta.length();
  if (dist < 0.05) return true;
  _delta.normalize();
  if (bot.sideUntil > now) {
    // Sidestepping around an obstacle: mostly sideways, a little forward.
    const px = -_delta.z * bot.side;
    const pz = _delta.x * bot.side;
    _delta.x = _delta.x * 0.3 + px * 0.95;
    _delta.z = _delta.z * 0.3 + pz * 0.95;
    _delta.normalize();
  }
  const stepLen = Math.min(speed * dt, dist);
  const beforeX = bot.position.x;
  const beforeZ = bot.position.z;
  _delta.multiplyScalar(stepLen);
  moveCircle(bot.position, _delta, 0.38, 1.7, colliders, _out);
  bot.position.copy(_out);
  faceToward(bot, target, dt);
  // Stuck detection: if the wall ate most of the step, start sidestepping.
  const moved = Math.hypot(bot.position.x - beforeX, bot.position.z - beforeZ);
  if (stepLen > 0.05 && moved < stepLen * 0.35) {
    bot.stuck += dt;
  } else {
    bot.stuck = 0;
  }
  if (bot.stuck > 0.3 && bot.sideUntil <= now) {
    bot.side = probeSide(bot, colliders);
    bot.sideUntil = now + 0.9;
    bot.stuck = 0;
  }
  return dist <= 0.7;
}

// Is the point 1.2 m to the bot's left (side -1) or right (side 1) free of
// colliders? Returns the freer side; left wins a tie.
function probeSide(bot, colliders) {
  const fx = -Math.sin(bot.yaw);
  const fz = -Math.cos(bot.yaw);
  for (const side of [-1, 1]) {
    const px = bot.position.x + (-fz * side) * 1.2;
    const pz = bot.position.z + (fx * side) * 1.2;
    let blocked = false;
    for (const c of colliders) {
      if (c.max.y < 0.5) continue;
      if (px > c.min.x && px < c.max.x && pz > c.min.z && pz < c.max.z) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return side;
  }
  return -1;
}

// Pick a hold spot near a site: offset from the site centre by a seeded
// angle, clamped inside the yard. The spot faces the site's approach from
// the defender's side, so a holder watches the way in, not the wall.
function pickHoldSpot(bot, site, random) {
  const angle = random() * Math.PI * 2;
  const r = 3.5 + random() * 2.5;
  bot.holdSpot.set(
    Math.max(-22, Math.min(22, site.center.x + Math.cos(angle) * r)),
    0,
    Math.max(-16, Math.min(16, site.center.z + Math.sin(angle) * r)),
  );
}

// The flank spot is on the far side of the site from the planter's lane:
// the flanker arrives there from the other site and watches the plant from
// the opposite angle.
function pickFlankSpot(bot, site) {
  const towardDefender = site.center.x < 0 ? 1 : -1;
  bot.flankSpot.set(
    Math.max(-22, Math.min(22, site.center.x + towardDefender * 6)),
    0,
    Math.max(-16, Math.min(16, site.center.z - 2)),
  );
}

export function startRound(bots, world, random) {
  // Three bots push one site, one lurks mid and rotates to the plant. The
  // flanker (bot 2) pushes the other site first, then crosses to the real
  // site from the far side.
  const mainSite = random() < 0.5 ? 'A' : 'B';
  const otherSite = mainSite === 'A' ? 'B' : 'A';
  const routes = world.routes;
  const plan = [
    { site: mainSite, route: mainSite === 'A' ? routes.A_ridge : routes.B_ridge },
    { site: mainSite, route: mainSite === 'A' ? routes.A_mid : routes.B_mid },
    { site: otherSite, route: otherSite === 'A' ? routes.A_mid : routes.B_mid },
    { site: mainSite, route: routes.mid_hold },
  ];
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    bot.position.copy(world.attackerSpawns[i]);
    bot.health = 100;
    bot.alive = true;
    bot.state = 'route';
    bot.stateTime = 0;
    bot.site = plan[i].site;
    bot.route = plan[i].route;
    bot.waypoint = 0;
    bot.plantProgress = 0;
    bot.burstLeft = 0;
    bot.loseSight = 0;
    bot.alertUntil = 0;
    bot.investigateUntil = 0;
    bot.rotated = false;
    bot.mesh.group.visible = true;
    bot.mesh.group.rotation.set(0, 0, 0);
    bot.mesh.group.position.copy(bot.position);
    pickHoldSpot(bot, world.sites[bot.site], random);
    pickFlankSpot(bot, world.sites[mainSite]);
  }
  bots[0].role = 'planter';
  for (let i = 1; i < bots.length; i++) bots[i].role = 'support';
  bots[2].role = 'flanker';
}

// Re-plan one bot to a different site from where it stands: the route list
// is swapped for the far site's mid route and the walk restarts. The third
// argument is the update context, which carries the world's routes.
function rotateToSite(bot, site, ctx) {
  bot.site = site;
  bot.route = site === 'A' ? ctx.routes.A_mid : ctx.routes.B_mid;
  bot.waypoint = 0;
  bot.state = 'route';
  bot.stateTime = 0;
  bot.rotated = true;
  pickHoldSpot(bot, ctx.sites[site], Math.random);
}

export function updateBots(bots, dt, ctx) {
  // ctx: { now, playerPos, playerAlive, playerMoving, playerCrouched,
  //   colliders, smokeClouds, roundTimeLeft, plantDone, plantSite, sites,
  //   routes, lastShotAt, lastShotPos, events }
  const events = ctx.events;
  for (const bot of bots) {
    if (!bot.alive) continue;
    bot.stateTime += dt;
    const playerPos = ctx.playerPos;

    // Hearing: a recent shot turns nearby bots toward the sound, and a
    // support close enough walks over to check it out.
    if (ctx.lastShotAt > 0 && ctx.now - ctx.lastShotAt < 1.2) {
      const d = bot.position.distanceTo(ctx.lastShotPos);
      if (d < 26 && bot.state === 'route') {
        bot.alertUntil = ctx.now + 1.2;
        bot.alertPos.copy(ctx.lastShotPos);
        if (bot.role === 'support' && d < INVESTIGATE_RANGE && bot.investigateUntil <= ctx.now) {
          bot.investigateUntil = ctx.now + 3;
          bot.investigatePos.copy(ctx.lastShotPos);
        }
      }
    }

    const sees = ctx.playerAlive && canSee(bot, playerPos, ctx.colliders, ctx.smokeClouds);
    if (sees) {
      // Squad callout: everyone hears where the contact is.
      bot.lastSeenPos.copy(playerPos);
      bot.lastSeenAt = ctx.now;
      for (const other of bots) {
        if (other === bot || !other.alive) continue;
        other.alertUntil = ctx.now + 2;
        other.alertPos.copy(playerPos);
        other.lastSeenPos.copy(playerPos);
        other.lastSeenAt = ctx.now;
      }
    }

    if (bot.state === 'plant') {
      if (sees) {
        const dist = bot.position.distanceTo(playerPos);
        if (dist < 14) {
          bot.state = 'engage';
          bot.stateTime = 0;
          bot.loseSight = 0;
        }
      }
      if (bot.state === 'plant') {
        bot.plantProgress += dt / PLANT_TIME;
        events.push({ type: 'plant-progress', bot, value: bot.plantProgress });
        if (bot.plantProgress >= 1) {
          bot.state = 'hold';
          bot.stateTime = 0;
          pickHoldSpot(bot, ctx.sites[bot.site], Math.random);
          events.push({ type: 'planted', site: bot.site, bot });
        }
        continue;
      }
    }

    if (sees) {
      if (bot.state !== 'engage') {
        bot.state = 'engage';
        bot.stateTime = 0;
        bot.burstLeft = 0;
        bot.burstPause = 0;
      }
      bot.loseSight = 0;
    } else if (bot.state === 'engage') {
      bot.loseSight += dt;
      if (bot.loseSight > 2.2) {
        // Lost the defender: fall back to the last place they were seen
        // before giving up and returning to the route.
        if (ctx.now - bot.lastSeenAt < 4 && bot.role !== 'planter') {
          bot.state = 'investigate';
          bot.stateTime = 0;
          bot.investigatePos.copy(bot.lastSeenPos);
          bot.investigateUntil = ctx.now + 3;
        } else {
          bot.state = ctx.plantDone ? 'hold' : 'route';
          bot.stateTime = 0;
        }
      }
    }

    if (bot.state === 'engage') {
      faceToward(bot, playerPos, dt);
      // Strafe sideways while firing, flipping direction every second.
      bot.strafeTime += dt;
      if (bot.strafeTime > 1.1) {
        bot.strafeTime = 0;
        bot.strafeDir *= -1;
      }
      const side = bot.strafeDir;
      _delta.set(Math.cos(bot.yaw) * side, 0, -Math.sin(bot.yaw) * side);
      _delta.multiplyScalar(BOT_SPEED * 0.45 * dt);
      moveCircle(bot.position, _delta, 0.38, 1.7, ctx.colliders, _out);
      bot.position.copy(_out);

      if (ctx.playerAlive) {
        if (bot.burstLeft > 0 && ctx.now >= bot.nextShot) {
          bot.burstLeft -= 1;
          bot.nextShot = ctx.now + 0.13;
          fireAtPlayer(bot, ctx, events);
        } else if (bot.burstLeft <= 0 && ctx.now >= bot.burstPause) {
          bot.burstLeft = 3 + Math.floor(Math.random() * 3);
          bot.nextShot = ctx.now + 0.05;
          bot.burstPause = ctx.now + 1.0;
        }
      }
      continue;
    }

    if (bot.state === 'investigate') {
      const arrived = moveToward(bot, bot.investigatePos, BOT_SPEED * 1.15, dt, ctx.colliders, ctx.now);
      if (arrived || ctx.now >= bot.investigateUntil) {
        bot.state = ctx.plantDone ? 'hold' : 'route';
        bot.stateTime = 0;
      }
      continue;
    }

    if (bot.state === 'hold') {
      const target = ctx.plantDone && ctx.plantSite ? ctx.sites[ctx.plantSite].center : bot.holdSpot;
      const arrived = moveToward(bot, target, BOT_SPEED * 0.8, dt, ctx.colliders, ctx.now);
      if (arrived) faceToward(bot, ctx.plantSite ? ctx.sites[ctx.plantSite].center : bot.holdSpot, dt);
      continue;
    }

    if (bot.state === 'flank') {
      const arrived = moveToward(bot, bot.flankSpot, BOT_SPEED, dt, ctx.colliders, ctx.now);
      if (arrived) {
        bot.state = 'hold';
        bot.stateTime = 0;
        bot.holdSpot.copy(bot.flankSpot);
      }
      continue;
    }

    // Route: walk the waypoints. The planter plants on arrival; supports
    // hold at the site and watch the approaches; the flanker crosses to
    // the real site from the far side.
    // A stalled push rotates: with the clock under ROTATE_AT and no plant
    // started, the whole squad re-plans to the other site once per round.
    if (!ctx.plantDone && !bot.rotated && ctx.roundTimeLeft < ROTATE_AT && bot.stateTime > 12) {
      const otherSite = bot.site === 'A' ? 'B' : 'A';
      rotateToSite(bot, otherSite, ctx);
      continue;
    }
    const speed = ctx.roundTimeLeft < 25 ? BOT_SPEED * 1.3 : BOT_SPEED;
    if (bot.alertUntil > ctx.now) {
      faceToward(bot, bot.alertPos, dt);
    } else if (bot.investigateUntil > ctx.now && bot.role === 'support') {
      const arrived = moveToward(bot, bot.investigatePos, BOT_SPEED * 1.15, dt, ctx.colliders, ctx.now);
      if (arrived) bot.investigateUntil = 0;
    } else if (bot.waypoint < bot.route.length) {
      const target = bot.route[bot.waypoint];
      const arrived = moveToward(bot, target, speed, dt, ctx.colliders, ctx.now);
      if (arrived) bot.waypoint += 1;
      if (bot.waypoint >= bot.route.length) {
        if (bot.role === 'planter' && !ctx.plantDone) {
          bot.state = 'plant';
          bot.stateTime = 0;
          bot.plantProgress = 0;
        } else if (bot.role === 'flanker' && !ctx.plantDone) {
          bot.state = 'flank';
          bot.stateTime = 0;
        } else {
          bot.state = 'hold';
          bot.stateTime = 0;
        }
      }
    } else {
      bot.state = 'hold';
      bot.stateTime = 0;
    }
  }

  // Separation: Drifters never stack on one spot — push apart any pair
  // closer than a body width, so a single grenade cannot catch the squad.
  for (let i = 0; i < bots.length; i++) {
    const a = bots[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < bots.length; j++) {
      const b = bots[j];
      if (!b.alive) continue;
      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 0.0001 && d2 < 1.44) {
        const d = Math.sqrt(d2);
        const push = (1.2 - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        a.position.x -= nx * push;
        a.position.z -= nz * push;
        b.position.x += nx * push;
        b.position.z += nz * push;
      }
    }
  }
}

function fireAtPlayer(bot, ctx, events) {
  const dist = bot.position.distanceTo(ctx.playerPos);
  // Base accuracy falls with distance; a moving target is easier to hit
  // than a crouched still one, and a bot that has just rounded a corner
  // fires its first burst wide.
  let chance = 0.58 - dist * 0.011;
  if (ctx.playerMoving) chance += 0.1;
  if (ctx.playerCrouched) chance -= 0.12;
  if (bot.stateTime < 0.5) chance -= 0.15;
  chance = Math.max(0.08, Math.min(0.75, chance));
  const hit = Math.random() < chance;
  _muzzle.set(bot.position.x, bot.position.y + 1.35, bot.position.z);
  _aim.copy(ctx.playerPos);
  _aim.y += 1.25;
  if (!hit) {
    _aim.x += (Math.random() - 0.5) * 2.4;
    _aim.y += (Math.random() - 0.5) * 1.6;
    _aim.z += (Math.random() - 0.5) * 2.4;
  }
  const damage = hit ? 9 + Math.random() * 6 : 0;
  events.push({ type: 'bot-shot', bot, from: _muzzle.clone(), to: _aim.clone(), hit, damage });
}

export function killBot(bot, killerName) {
  bot.alive = false;
  bot.health = 0;
  bot.mesh.group.rotation.x = -Math.PI / 2;
  bot.mesh.group.position.y = 0.25;
  return killerName;
}

// The nearest living bot becomes the planter when the carrier dies.
export function reassignPlanter(bots, world) {
  const planter = bots.find((b) => b.role === 'planter' && b.alive);
  if (planter) return planter;
  const alive = bots.filter((b) => b.alive);
  if (alive.length === 0) return null;
  const site = bots[0].site;
  let best = alive[0];
  let bestDist = Infinity;
  for (const b of alive) {
    const d = b.position.distanceTo(world.sites[site].center);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  best.role = 'planter';
  if (best.state !== 'engage') {
    // Beeline to the site on a fresh route: the bot's old route may end
    // mid-map (the lurker's hold), which is not a plant spot.
    best.route = best.site === 'A' ? world.routes.A_mid : world.routes.B_mid;
    best.waypoint = 0;
    best.state = 'route';
    best.stateTime = 0;
  }
  return best;
}
