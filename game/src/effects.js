// Transient visuals: tracers, muzzle flashes, impact sparks, explosions,
// smoke clouds and the planted charge. Everything is pooled: a fixed set of
// line and sprite objects is reused, so a firefight allocates nothing.
import * as THREE from 'three';
import { WORLD_COLORS } from './palette.js';

const TRACER_COUNT = 24;
const SPARK_COUNT = 16;

export function createEffects(scene) {
  // Tracers: one Line per slot, hidden until fired.
  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
  const tracerGeo = new THREE.BufferGeometry();
  for (let i = 0; i < TRACER_COUNT; i++) {
    const geo = tracerGeo.clone();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerNext = 0;

  // Impact sparks: small additive points that burst and fade.
  const sparks = [];
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const sparkMat = new THREE.PointsMaterial({ color: 0xffc861, size: 0.14, transparent: true, opacity: 1 });
  for (let i = 0; i < SPARK_COUNT; i++) {
    const points = new THREE.Points(sparkGeo.clone(), sparkMat.clone());
    points.visible = false;
    points.frustumCulled = false;
    scene.add(points);
    sparks.push({ points, life: 0, vel: new THREE.Vector3() });
  }
  let sparkNext = 0;

  // Muzzle flash: a small additive plane at the camera, plus a point light.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  flash.position.set(0.28, -0.22, -0.6);
  flash.visible = false;
  scene.add(flash);
  const flashLight = new THREE.PointLight(0xffc861, 0, 9, 2);
  scene.add(flashLight);
  let flashLife = 0;

  // Explosion flash: an expanding additive sphere.
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  blast.visible = false;
  scene.add(blast);
  let blastLife = 0;

  // The planted charge: a blinking red box on the site floor.
  const charge = new THREE.Group();
  const chargeBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.32, 0.34),
    new THREE.MeshStandardMaterial({ color: WORLD_COLORS.charge, roughness: 0.5 }),
  );
  chargeBox.castShadow = true;
  charge.add(chargeBox);
  const chargeLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 3 }),
  );
  chargeLamp.position.set(0, 0.22, 0);
  charge.add(chargeLamp);
  charge.visible = false;
  scene.add(charge);

  // Smoke clouds: clusters of translucent spheres, one group per cloud.
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, transparent: true, opacity: 0.55, roughness: 1 });
  const clouds = [];
  for (let i = 0; i < 3; i++) {
    const group = new THREE.Group();
    const offsets = [[0, 1.2, 0], [1.1, 1.0, 0.5], [-1.0, 1.1, -0.4], [0.4, 1.8, -0.8], [-0.5, 0.9, 0.9]];
    for (const [ox, oy, oz] of offsets) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), smokeMat);
      puff.position.set(ox, oy, oz);
      group.add(puff);
    }
    group.visible = false;
    scene.add(group);
    clouds.push({ group, life: 0, center: new THREE.Vector3(), radius: 3.2 });
  }

  // Thrown grenade markers: a small dark sphere that flies with the grenade.
  const grenadeMarkers = [];
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.6 });
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), grenadeMat);
    m.visible = false;
    scene.add(m);
    grenadeMarkers.push(m);
  }

  return {
    spawnTracer(from, to) {
      const t = tracers[tracerNext];
      tracerNext = (tracerNext + 1) % TRACER_COUNT;
      const pos = t.line.geometry.attributes.position;
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, to.x, to.y, to.z);
      pos.needsUpdate = true;
      t.line.visible = true;
      t.life = 0.09;
    },
    spawnSparks(at, normal) {
      const s = sparks[sparkNext];
      sparkNext = (sparkNext + 1) % SPARK_COUNT;
      s.points.position.copy(at);
      s.vel.copy(normal).multiplyScalar(2.5);
      s.vel.y += 1.2;
      s.points.visible = true;
      s.life = 0.28;
    },
    muzzle(camera) {
      flash.visible = true;
      flashLife = 0.05;
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
      flash.position.copy(camera.position).addScaledVector(fwd, 0.62).addScaledVector(right, 0.28);
      flash.position.y -= 0.2;
      flashLight.position.copy(camera.position);
      flashLight.position.y += 0.2;
      flashLight.intensity = 26;
      flash.quaternion.copy(camera.quaternion);
    },
    explosion(at) {
      blast.position.copy(at);
      blast.position.y = Math.max(0.8, at.y);
      blast.visible = true;
      blastLife = 0.6;
    },
    showCharge(at) {
      charge.position.copy(at);
      charge.position.y = 0.18;
      charge.visible = true;
    },
    hideCharge() {
      charge.visible = false;
    },
    blinkCharge(on) {
      chargeLamp.material.emissiveIntensity = on ? 3 : 0.2;
    },
    spawnSmoke(at) {
      const free = clouds.find((c) => c.life <= 0);
      if (!free) return null;
      free.center.copy(at);
      free.center.y = 0;
      free.group.position.copy(at);
      free.group.position.y = 0;
      free.group.visible = true;
      free.life = 18;
      return free;
    },
    smokeClouds() {
      return clouds.filter((c) => c.life > 0);
    },
    updateGrenadeMarkers(list) {
      for (let i = 0; i < grenadeMarkers.length; i++) {
        const m = grenadeMarkers[i];
        if (i < list.length) {
          m.visible = true;
          m.position.copy(list[i].pos);
        } else {
          m.visible = false;
        }
      }
    },
    update(dt) {
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          if (t.life <= 0) t.line.visible = false;
        }
      }
      for (const s of sparks) {
        if (s.life > 0) {
          s.life -= dt;
          s.points.position.addScaledVector(s.vel, dt);
          s.vel.y -= 6 * dt;
          s.points.material.opacity = Math.max(0, s.life / 0.28);
          if (s.life <= 0) s.points.visible = false;
        }
      }
      if (flashLife > 0) {
        flashLife -= dt;
        flash.material.opacity = Math.max(0, flashLife / 0.05) * 0.9;
        flashLight.intensity = Math.max(0, flashLife / 0.05) * 26;
        if (flashLife <= 0) {
          flash.visible = false;
          flashLight.intensity = 0;
        }
      }
      if (blastLife > 0) {
        blastLife -= dt;
        const t = 1 - Math.max(0, blastLife / 0.6);
        blast.scale.setScalar(1 + t * 7);
        blast.material.opacity = Math.max(0, (blastLife / 0.6)) * 0.75;
        if (blastLife <= 0) blast.visible = false;
      }
      for (const c of clouds) {
        if (c.life > 0) {
          c.life -= dt;
          const fade = Math.min(1, c.life / 3);
          for (const puff of c.group.children) puff.material.opacity = 0.55 * fade;
          if (c.life <= 0) c.group.visible = false;
        }
      }
    },
  };
}
