// Weapons and grenades. Five guns, two grenades, one set of numbers each.
// Damage falls off with distance; spread grows while moving, in the air, and
// with every shot fired, and shrinks while crouched or still — stopping to
// aim pays. A shot is a hitscan ray with a pellet count (the Pelican fires
// eight), and each gun keeps its own magazine and reserve.
import * as THREE from 'three';

export const WEAPONS = {
  tide9: {
    id: 'tide9', name: 'Tide-9', kind: 'Pistol', price: 0,
    damage: 26, headMult: 2.0, pellets: 1, mag: 12, reserve: 48,
    fireInterval: 0.22, reloadTime: 1.1, spread: 0.011, bloomPerShot: 0.006,
    kick: 0.011, range: 40, auto: false,
  },
  gull: {
    id: 'gull', name: 'Gull', kind: 'SMG', price: 900,
    damage: 19, headMult: 2.0, pellets: 1, mag: 28, reserve: 84,
    fireInterval: 0.085, reloadTime: 1.6, spread: 0.02, bloomPerShot: 0.005,
    kick: 0.008, range: 32, auto: true,
  },
  pelican: {
    id: 'pelican', name: 'Pelican', kind: 'Shotgun', price: 1400,
    damage: 13, headMult: 1.8, pellets: 8, mag: 6, reserve: 24,
    fireInterval: 0.85, reloadTime: 2.2, spread: 0.075, bloomPerShot: 0.02,
    kick: 0.05, range: 18, auto: false,
  },
  heron: {
    id: 'heron', name: 'Heron', kind: 'Rifle', price: 2200,
    damage: 30, headMult: 2.2, pellets: 1, mag: 25, reserve: 75,
    fireInterval: 0.11, reloadTime: 1.9, spread: 0.013, bloomPerShot: 0.006,
    kick: 0.013, range: 60, auto: true,
  },
  cormorant: {
    id: 'cormorant', name: 'Cormorant', kind: 'DMR', price: 3100,
    damage: 68, headMult: 2.2, pellets: 1, mag: 8, reserve: 32,
    fireInterval: 0.75, reloadTime: 2.4, spread: 0.006, bloomPerShot: 0.01,
    kick: 0.035, range: 80, auto: false,
  },
};

export const GRENADES = {
  he: { id: 'he', name: 'Squall HE', price: 300, radius: 6, maxDamage: 95 },
  smoke: { id: 'smoke', name: 'Fog Smoke', price: 250, radius: 3.2, duration: 18 },
};

export function createWeaponState() {
  const ammo = {};
  for (const id of Object.keys(WEAPONS)) {
    ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  }
  return {
    owned: new Set(['tide9']),
    current: 'tide9',
    ammo,
    reloading: false,
    reloadEnd: 0,
    lastShot: -10,
    bloom: 0,
    recoilPitch: 0,
    recoilYaw: 0,
  };
}

// Spread in radians for the current shot: base, plus bloom, plus movement.
export function currentSpread(def, state, moving, crouched, airborne) {
  let s = def.spread + state.bloom;
  if (moving) s *= 1.9;
  if (airborne) s *= 2.4;
  if (crouched) s *= 0.6;
  return s;
}

// Damage at a distance: full inside half the range, half at the range edge.
export function damageAt(def, distance) {
  const half = def.range * 0.5;
  if (distance <= half) return def.damage;
  const t = Math.min(1, (distance - half) / half);
  return def.damage * (1 - 0.5 * t);
}

export function canFire(state, def, now) {
  if (state.reloading) return false;
  if (state.ammo[def.id].mag <= 0) return false;
  return now - state.lastShot >= def.fireInterval;
}

export function consumeShot(state, def, now) {
  state.ammo[def.id].mag -= 1;
  state.lastShot = now;
  state.bloom = Math.min(0.05, state.bloom + def.bloomPerShot);
  state.recoilPitch += def.kick;
  state.recoilYaw += (Math.random() - 0.5) * def.kick * 0.5;
}

export function startReload(state, def, now) {
  if (state.reloading) return false;
  const a = state.ammo[def.id];
  if (a.mag >= def.mag || a.reserve <= 0) return false;
  state.reloading = true;
  state.reloadEnd = now + def.reloadTime;
  return true;
}

export function updateReload(state, def, now) {
  if (!state.reloading) return false;
  if (now < state.reloadEnd) return false;
  const a = state.ammo[def.id];
  const need = def.mag - a.mag;
  const take = Math.min(need, a.reserve);
  a.mag += take;
  a.reserve -= take;
  state.reloading = false;
  return true;
}

// Thrown grenades: simple ballistic points with a bounce and a fuse. The
// simulation owns positions and velocities; detonation is reported as an
// event the match loop drains and resolves (damage, smoke cloud).
export function createGrenades() {
  return { list: [], events: [] };
}

export function throwGrenade(grens, type, origin, direction, now) {
  grens.list.push({
    type,
    pos: origin.clone(),
    vel: direction.clone().multiplyScalar(13).add(new THREE.Vector3(0, 3.2, 0)),
    fuse: 1.7,
    bounced: false,
  });
  return true;
}

const _g = new THREE.Vector3();

export function updateGrenades(grens, dt, colliders) {
  const events = grens.events;
  for (let i = grens.list.length - 1; i >= 0; i--) {
    const g = grens.list[i];
    g.fuse -= dt;
    g.vel.y -= 14 * dt;
    _g.copy(g.vel).multiplyScalar(dt);
    // Bounce off the ground and the walls: a cheap axis check against the
    // yard bounds and the collider boxes.
    g.pos.add(_g);
    if (g.pos.y < 0.12) {
      g.pos.y = 0.12;
      g.vel.y = Math.abs(g.vel.y) * 0.45;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
      g.bounced = true;
    }
    if (Math.abs(g.pos.x) > 23.8) {
      g.pos.x = Math.sign(g.pos.x) * 23.8;
      g.vel.x *= -0.45;
    }
    if (Math.abs(g.pos.z) > 17.8) {
      g.pos.z = Math.sign(g.pos.z) * 17.8;
      g.vel.z *= -0.45;
    }
    for (let j = 0; j < colliders.length; j++) {
      const c = colliders[j];
      if (c.max.y < 0.4) continue;
      if (
        g.pos.x > c.min.x - 0.12 && g.pos.x < c.max.x + 0.12 &&
        g.pos.y > c.min.y && g.pos.y < c.max.y + 0.12 &&
        g.pos.z > c.min.z - 0.12 && g.pos.z < c.max.z + 0.12
      ) {
        g.vel.x *= -0.4;
        g.vel.z *= -0.4;
        g.vel.y = Math.abs(g.vel.y) * 0.4 + 0.5;
        g.pos.y = c.max.y + 0.13;
      }
    }
    if (g.fuse <= 0) {
      events.push({ type: g.type === 'he' ? 'detonate-he' : 'detonate-smoke', pos: g.pos.clone() });
      grens.list.splice(i, 1);
    }
  }
}
