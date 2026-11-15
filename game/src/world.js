// Saltworks No. 9: a walled night yard, 48 by 36 metres, on the coast.
// Two bomb sites — the Evap Pans in the north-west and the Pump House in the
// north-east — joined by three lanes: the north ridge over the salt mounds,
// the mid canal past the central silo, and the south corridor through the
// crane yard. The defender spawns south; the four Drifters spawn north and
// push one of the sites. Every solid box is also a collider; water is visual
// only and walkable. Geometry is styled boxes, cones and cylinders with a
// procedural ground texture — no borrowed art.
import * as THREE from 'three';
import { WORLD_COLORS } from './palette.js';
import { boxCollider } from './physics.js';

const MAP_W = 48;
const MAP_D = 36;

function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2a2f38';
  ctx.fillRect(0, 0, 512, 384);
  // Expansion joints: a faint grid every 4 metres.
  ctx.strokeStyle = '#343b47';
  ctx.lineWidth = 2;
  for (let x = 0; x <= 512; x += 43) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 384);
    ctx.stroke();
  }
  for (let y = 0; y <= 384; y += 43) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  // Salt dust and tyre stains, seeded so the yard looks the same every load.
  let s = 1234567;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 900; i++) {
    const v = rnd();
    ctx.fillStyle = v < 0.5 ? 'rgba(233,237,240,0.05)' : 'rgba(0,0,0,0.10)';
    ctx.fillRect(rnd() * 512, rnd() * 384, 1 + rnd() * 5, 1 + rnd() * 3);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function waterTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#17707e';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(220,245,250,0.25)';
  ctx.lineWidth = 2;
  for (let y = 8; y < 256; y += 22) {
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 16) {
      const wob = Math.sin((x + y * 3) * 0.08) * 4;
      if (x === 0) ctx.moveTo(x, y + wob);
      else ctx.lineTo(x, y + wob);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(scene) {
  const colliders = [];
  const shootables = [];
  const group = new THREE.Group();
  scene.add(group);

  const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05, ...opts });

  function addBox(cx, cy, cz, w, h, d, color, opts) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    shootables.push(mesh);
    return mesh;
  }

  function addSolid(cx, cz, w, d, y0, y1, color, opts) {
    const mesh = addBox(cx, (y0 + y1) / 2, cz, w, y1 - y0, d, color, opts);
    colliders.push(boxCollider(cx, cz, w, d, y0, y1));
    return mesh;
  }

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_W, MAP_D),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  shootables.push(ground);

  // Perimeter walls, height 4.
  addSolid(0, -18.5, MAP_W + 2, 1, 0, 4, WORLD_COLORS.wall);
  addSolid(0, 18.5, MAP_W + 2, 1, 0, 4, WORLD_COLORS.wall);
  addSolid(-24.5, 0, 1, MAP_D + 2, 0, 4, WORLD_COLORS.wall);
  addSolid(24.5, 0, 1, MAP_D + 2, 0, 4, WORLD_COLORS.wall);
  // Wall caps, a pale line so the yard reads at a glance at night.
  addBox(0, 4.08, -18.5, MAP_W + 2, 0.16, 1.1, WORLD_COLORS.wallTop);
  addBox(0, 4.08, 18.5, MAP_W + 2, 0.16, 1.1, WORLD_COLORS.wallTop);
  addBox(-24.5, 4.08, 0, 1.1, 0.16, MAP_D + 2, WORLD_COLORS.wallTop);
  addBox(24.5, 4.08, 0, 1.1, 0.16, MAP_D + 2, WORLD_COLORS.wallTop);

  // --- Site A: the Evap Pans (north-west). Three shallow pans of brine.
  const panWaterMat = new THREE.MeshStandardMaterial({
    map: waterTexture(),
    color: WORLD_COLORS.panWater,
    transparent: true,
    opacity: 0.85,
    roughness: 0.2,
    metalness: 0.1,
  });
  const panCenters = [[-19, -13.5], [-14.5, -9.5], [-19, -6.5]];
  for (const [px, pz] of panCenters) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(7, 5.5), panWaterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(px, 0.07, pz);
    water.receiveShadow = true;
    group.add(water);
    // Low rims around each pan.
    addBox(px, 0.14, pz - 2.85, 7.4, 0.28, 0.3, WORLD_COLORS.salt);
    addBox(px, 0.14, pz + 2.85, 7.4, 0.28, 0.3, WORLD_COLORS.salt);
    addBox(px - 3.55, 0.14, pz, 0.3, 0.28, 5.5, WORLD_COLORS.salt);
    addBox(px + 3.55, 0.14, pz, 0.3, 0.28, 5.5, WORLD_COLORS.salt);
  }

  // --- Site B: the Pump House (north-east). Open-front shed, roof, pipes.
  addSolid(18, -15.5, 12, 1, 0, 4.5, WORLD_COLORS.wall); // back wall
  addSolid(12.5, -12, 1, 8, 0, 4.5, WORLD_COLORS.wall); // west wall
  addSolid(23.5, -12, 1, 8, 0, 4.5, WORLD_COLORS.wall); // east wall
  addBox(18, 4.7, -12, 12.5, 0.4, 9, WORLD_COLORS.wallTop); // roof
  addSolid(18, -10.5, 3, 2, 0, 1.4, WORLD_COLORS.rust); // pump block
  const pipeMat = mat(WORLD_COLORS.pipe, { metalness: 0.5, roughness: 0.5 });
  for (const [px, pz, len, rotY] of [[15, -14.5, 6, 0], [21, -14.5, 6, 0], [18, -9.2, 5, Math.PI / 2]]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, len, 10), pipeMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.rotation.y = rotY;
    pipe.position.set(px, 1.1, pz);
    pipe.castShadow = true;
    group.add(pipe);
    shootables.push(pipe);
  }

  // --- Mid: the central silo and the canal.
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 6, 20), mat(WORLD_COLORS.silo, { metalness: 0.35, roughness: 0.6 }));
  silo.position.set(0, 3, -2);
  silo.castShadow = true;
  silo.receiveShadow = true;
  group.add(silo);
  shootables.push(silo);
  colliders.push(boxCollider(0, -2, 4.4, 4.4, 0, 6));
  const siloCap = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.4, 20), mat(WORLD_COLORS.rust));
  siloCap.position.set(0, 6.7, -2);
  siloCap.castShadow = true;
  group.add(siloCap);

  // Canal: a teal strip running east-west, banks of pale salt.
  const canalMat = new THREE.MeshStandardMaterial({
    map: waterTexture(),
    color: WORLD_COLORS.canalWater,
    transparent: true,
    opacity: 0.9,
    roughness: 0.15,
    metalness: 0.1,
  });
  const canal = new THREE.Mesh(new THREE.PlaneGeometry(40, 3), canalMat);
  canal.rotation.x = -Math.PI / 2;
  canal.position.set(0, 0.06, 3);
  canal.receiveShadow = true;
  group.add(canal);
  addBox(0, 0.12, 1.4, 40, 0.24, 0.3, WORLD_COLORS.salt);
  addBox(0, 0.12, 4.6, 40, 0.24, 0.3, WORLD_COLORS.salt);

  // --- North ridge: salt mounds for cover.
  const moundMat = mat(WORLD_COLORS.salt, { roughness: 1 });
  const mounds = [[-10, -14.5], [-2, -15], [8, -14.5], [14, -15.5], [-21, -15], [21, -15.5]];
  for (const [mx, mz] of mounds) {
    const mound = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.3, 12), moundMat);
    mound.position.set(mx, 0.65, mz);
    mound.castShadow = true;
    mound.receiveShadow = true;
    group.add(mound);
    shootables.push(mound);
    colliders.push(boxCollider(mx, mz, 2, 2, 0, 1.2));
  }

  // --- South corridor: the crane yard. Two containers and a gantry.
  addSolid(-12, 13, 6, 2.4, 0, 2.4, WORLD_COLORS.containerA);
  addSolid(-12, 15.9, 6, 2.4, 0, 2.4, WORLD_COLORS.containerB);
  addSolid(12, 14, 6, 2.4, 0, 2.4, WORLD_COLORS.containerB);
  addSolid(12, 16.6, 6, 2.4, 0, 1.2, WORLD_COLORS.containerA);
  // Gantry crane: two legs and a beam over the south lane.
  addSolid(-6, 11.5, 0.8, 0.8, 0, 5.5, WORLD_COLORS.rust);
  addSolid(6, 11.5, 0.8, 0.8, 0, 5.5, WORLD_COLORS.rust);
  addBox(0, 5.7, 11.5, 13.5, 0.7, 0.9, WORLD_COLORS.rust);

  // --- Mid cover: crates, barrels, low walls.
  const crateMat = mat(0x6b5a34, { roughness: 0.95 });
  const crates = [[-8, -6, 1.2], [-7, -4.8, 1.2], [8, -6, 1.2], [9.2, -5, 1.2], [-13, 7, 1.2], [13, 7, 1.2], [-4, 8, 1.2], [5, -9, 1.2], [-19, 2, 1.2], [19, 2, 1.2]];
  for (const [cx, cz, s] of crates) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
    crate.position.set(cx, s / 2, cz);
    crate.rotation.y = (cx * 7 + cz * 3) % 0.9;
    crate.castShadow = true;
    crate.receiveShadow = true;
    group.add(crate);
    shootables.push(crate);
    colliders.push(boxCollider(cx, cz, s, s, 0, s));
  }
  // Low walls you can crouch behind on the mid approaches.
  addSolid(-9, -1, 4, 0.6, 0, 1.1, WORLD_COLORS.wall);
  addSolid(9, -1, 4, 0.6, 0, 1.1, WORLD_COLORS.wall);
  addSolid(0, 8.5, 5, 0.6, 0, 1.1, WORLD_COLORS.wall);
  // Barrels near the sites.
  const barrelMat = mat(WORLD_COLORS.rust, { metalness: 0.4, roughness: 0.6 });
  for (const [bx, bz] of [[-15, -15.5], [-21.5, -9], [15, -15.5], [21.5, -9], [-2, 11], [3, 11.5]]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 12), barrelMat);
    barrel.position.set(bx, 0.55, bz);
    barrel.castShadow = true;
    group.add(barrel);
    shootables.push(barrel);
    colliders.push(boxCollider(bx, bz, 1, 1, 0, 1.1));
  }

  // --- Light: moon, sky, lamps.
  const hemi = new THREE.HemisphereLight(0x8fb0d8, 0x1a2028, 0.7);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(WORLD_COLORS.moon, 1.8);
  moon.position.set(-18, 26, -12);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = -30;
  moon.shadow.camera.right = 30;
  moon.shadow.camera.top = 24;
  moon.shadow.camera.bottom = -24;
  moon.shadow.camera.far = 70;
  scene.add(moon);

  const lampPositions = [[-12, -8], [12, -8], [-12, 8], [12, 8]];
  const lampLights = [];
  for (const [lx, lz] of lampPositions) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.6, 8), mat(0x22262e, { metalness: 0.6, roughness: 0.5 }));
    pole.position.set(lx, 2.3, lz);
    pole.castShadow = true;
    group.add(pole);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshStandardMaterial({ color: WORLD_COLORS.lamp, emissive: WORLD_COLORS.lamp, emissiveIntensity: 2.2 }),
    );
    bulb.position.set(lx, 4.7, lz);
    group.add(bulb);
    const light = new THREE.PointLight(WORLD_COLORS.lamp, 22, 17, 1.8);
    light.position.set(lx, 4.5, lz);
    scene.add(light);
    lampLights.push(light);
  }

  // Stars and the moon disc, so the night sky is not a flat colour.
  const starGeo = new THREE.BufferGeometry();
  const starCount = 320;
  const starPos = new Float32Array(starCount * 3);
  let s = 987654321;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < starCount; i++) {
    const a = rnd() * Math.PI * 2;
    const e = 0.25 + rnd() * 1.2;
    const r = 120;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
    starPos[i * 3 + 1] = Math.sin(e) * r;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdde8ff, size: 0.7, sizeAttenuation: false }));
  scene.add(stars);
  const moonDisc = new THREE.Mesh(
    new THREE.CircleGeometry(4, 24),
    new THREE.MeshBasicMaterial({ color: 0xe8f0ff, fog: false }),
  );
  moonDisc.position.set(-60, 55, -70);
  moonDisc.lookAt(0, 0, 0);
  scene.add(moonDisc);

  // Bomb sites, spawns and bot routes.
  const sites = {
    A: { name: 'Evap Pans', center: new THREE.Vector3(-18, 0, -11), radius: 4.5 },
    B: { name: 'Pump House', center: new THREE.Vector3(18, 0, -11), radius: 4.5 },
  };
  const defenderSpawn = { position: new THREE.Vector3(0, 0, 15), yaw: 0 };
  const attackerSpawns = [
    new THREE.Vector3(-14, 0, -16),
    new THREE.Vector3(-4, 0, -16),
    new THREE.Vector3(6, 0, -16),
    new THREE.Vector3(16, 0, -16),
  ];
  const routes = {
    A_ridge: [new THREE.Vector3(-20, 0, -14), new THREE.Vector3(-20, 0, -10.5), new THREE.Vector3(-18, 0, -11)],
    A_mid: [new THREE.Vector3(-9.5, 0, -4), new THREE.Vector3(-14, 0, -8), new THREE.Vector3(-18, 0, -11)],
    B_mid: [new THREE.Vector3(10.5, 0, -4), new THREE.Vector3(14, 0, -8), new THREE.Vector3(18, 0, -11)],
    B_ridge: [new THREE.Vector3(20, 0, -14), new THREE.Vector3(20, 0, -10.5), new THREE.Vector3(18, 0, -11)],
    mid_hold: [new THREE.Vector3(-2, 0, -5), new THREE.Vector3(0, 0, -4)],
  };

  return {
    colliders,
    shootables,
    sites,
    defenderSpawn,
    attackerSpawns,
    routes,
    update(t) {
      // A slow shimmer on the canal and pans, and a faint lamp flicker.
      canalMat.map.offset.x = (t * 0.008) % 1;
      panWaterMat.map.offset.x = (t * 0.005) % 1;
      const flicker = 0.94 + 0.06 * Math.sin(t * 13.7) * Math.sin(t * 7.3);
      for (const light of lampLights) light.intensity = 22 * flicker;
    },
  };
}
