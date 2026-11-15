// The defender: first-person movement with acceleration, friction, crouch,
// jump and gravity, resolved against the world's boxes. The camera sits at
// eye height; the view direction is yaw and pitch plus the weapon's recoil,
// which the weapon state owns and the renderer reads.
import * as THREE from 'three';
import { moveCircle } from './physics.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;
export const RADIUS = 0.38;
export const HEIGHT_STAND = 1.7;
export const HEIGHT_CROUCH = 1.15;

export function createPlayer(colliders) {
  return {
    colliders,
    state: {
      position: new THREE.Vector3(0, 0, 15),
      velocity: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      health: 100,
      armor: 0,
      crouched: false,
      onGround: true,
      alive: true,
    },
  };
}

const _wish = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _out = new THREE.Vector3();

export function updatePlayer(player, input, dt) {
  const s = player.state;
  if (!s.alive) return;
  const keys = input.state.keys;

  // Look: pointer-lock deltas, or drag deltas when unlocked.
  const look = input.takeLook();
  s.yaw -= look.x * 0.0021;
  s.pitch -= look.y * 0.0021;
  s.pitch = Math.max(-1.45, Math.min(1.45, s.pitch));

  const crouched = keys.has('ControlLeft') || keys.has('ControlRight');
  s.crouched = crouched;
  const height = crouched ? HEIGHT_CROUCH : HEIGHT_STAND;

  // Wish direction in world space from WASD and the yaw.
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const sin = Math.sin(s.yaw);
  const cos = Math.cos(s.yaw);
  _wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe);
  if (_wish.lengthSq() > 0) _wish.normalize();

  const walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = crouched ? 2.2 : walking ? 2.6 : 4.6;
  const accel = s.onGround ? 42 : 12;
  s.velocity.x += _wish.x * accel * dt;
  s.velocity.z += _wish.z * accel * dt;
  // Friction: exponential damp toward the wish speed, faster on the ground.
  const damp = s.onGround ? Math.exp(-9 * dt) : Math.exp(-1.2 * dt);
  s.velocity.x *= damp;
  s.velocity.z *= damp;
  const hSpeed = Math.hypot(s.velocity.x, s.velocity.z);
  if (hSpeed > speed) {
    s.velocity.x *= speed / hSpeed;
    s.velocity.z *= speed / hSpeed;
  }

  // Jump and gravity.
  if ((keys.has('Space')) && s.onGround) {
    s.velocity.y = 5.2;
    s.onGround = false;
  }
  s.velocity.y -= 15 * dt;
  if (s.velocity.y < -18) s.velocity.y = -18;

  _delta.copy(s.velocity).multiplyScalar(dt);
  moveCircle(s.position, _delta, RADIUS, height, player.colliders, _out);
  const wasAirborne = !s.onGround;
  s.position.copy(_out);
  if (s.position.y <= 0 && s.velocity.y <= 0) {
    s.position.y = 0;
    s.velocity.y = 0;
    s.onGround = true;
  } else if (wasAirborne && s.position.y > 0) {
    s.onGround = false;
  }
}

export function eyePosition(player, out) {
  const s = player.state;
  out.set(s.position.x, s.position.y + (s.crouched ? EYE_CROUCH : EYE_STAND), s.position.z);
  return out;
}

export function eyeForward(player, recoilPitch, recoilYaw, out) {
  const s = player.state;
  const pitch = s.pitch + recoilPitch;
  const yaw = s.yaw + recoilYaw;
  out.set(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
  return out;
}

export function isMoving(player) {
  const s = player.state;
  return Math.hypot(s.velocity.x, s.velocity.z) > 0.6;
}
