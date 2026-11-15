// Collision and line-of-sight math, kept apart from rendering. The world is
// a list of axis-aligned boxes; movement is resolved one axis at a time
// against them, and shooting and seeing use segment tests against the same
// boxes. All functions reuse module-level temporaries: nothing here allocates
// in a hot loop.
import * as THREE from 'three';

// A collider is { min: Vector3, max: Vector3, solid: true }.
export function boxCollider(cx, cz, w, d, y0, y1) {
  return {
    min: new THREE.Vector3(cx - w / 2, y0, cz - d / 2),
    max: new THREE.Vector3(cx + w / 2, y1, cz + d / 2),
    solid: true,
  };
}

const _segDir = new THREE.Vector3();
const _segInv = new THREE.Vector3();

// Does the segment from a to b touch the box? Slab test, with a small
// epsilon so grazing shots count as blocked.
export function segmentHitsBox(a, b, box) {
  _segDir.subVectors(b, a);
  let tmin = 0;
  let tmax = 1;
  for (let i = 0; i < 3; i++) {
    const origin = i === 0 ? a.x : i === 1 ? a.y : a.z;
    const dir = i === 0 ? _segDir.x : i === 1 ? _segDir.y : _segDir.z;
    const lo = i === 0 ? box.min.x : i === 1 ? box.min.y : box.min.z;
    const hi = i === 0 ? box.max.x : i === 1 ? box.max.y : box.max.z;
    if (Math.abs(dir) < 1e-9) {
      if (origin < lo || origin > hi) return false;
    } else {
      let t0 = (lo - origin) / dir;
      let t1 = (hi - origin) / dir;
      if (t0 > t1) {
        const t = t0;
        t0 = t1;
        t1 = t;
      }
      if (t0 > tmin) tmin = t0;
      if (t1 < tmax) tmax = t1;
      if (tmin > tmax) return false;
    }
  }
  return true;
}

// Line of sight between two points, blocked by any solid box in the list.
// The caller passes the smoke clouds separately: a cloud blocks sight when
// the segment comes within its radius.
export function hasLineOfSight(a, b, colliders, smokeClouds) {
  for (let i = 0; i < colliders.length; i++) {
    if (segmentHitsBox(a, b, colliders[i])) return false;
  }
  if (smokeClouds) {
    for (let i = 0; i < smokeClouds.length; i++) {
      if (segmentNearPoint(a, b, smokeClouds[i].center, smokeClouds[i].radius)) return false;
    }
  }
  return true;
}

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();

// True when the segment ab passes within radius of point p.
export function segmentNearPoint(a, b, p, radius) {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const lenSq = _ab.lengthSq();
  let t = lenSq > 0 ? _ap.dot(_ab) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + _ab.x * t;
  const cy = a.y + _ab.y * t;
  const cz = a.z + _ab.z * t;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const dz = p.z - cz;
  return dx * dx + dy * dy + dz * dz < radius * radius;
}

// Move a circle (radius r, feet at y) through the box list one axis at a
// time. Returns the moved position in `out`. The ground is y = 0.
export function moveCircle(position, delta, radius, height, colliders, out) {
  out.copy(position);
  out.x += delta.x;
  resolveAxis(out, radius, height, colliders, 'x');
  out.z += delta.z;
  resolveAxis(out, radius, height, colliders, 'z');
  out.y += delta.y;
  if (out.y < 0) out.y = 0;
  return out;
}

function resolveAxis(p, radius, height, colliders, axis) {
  const feet = p.y;
  const head = p.y + height;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (head <= c.min.y || feet >= c.max.y) continue;
    if (axis === 'x') {
      if (p.z + radius <= c.min.z || p.z - radius >= c.max.z) continue;
      if (p.x + radius > c.min.x && p.x - radius < c.max.x) {
        const pushLeft = c.min.x - radius;
        const pushRight = c.max.x + radius;
        p.x = Math.abs(p.x - pushLeft) < Math.abs(p.x - pushRight) ? pushLeft : pushRight;
      }
    } else {
      if (p.x + radius <= c.min.x || p.x - radius >= c.max.x) continue;
      if (p.z + radius > c.min.z && p.z - radius < c.max.z) {
        const pushBack = c.min.z - radius;
        const pushFront = c.max.z + radius;
        p.z = Math.abs(p.z - pushBack) < Math.abs(p.z - pushFront) ? pushBack : pushFront;
      }
    }
  }
}
