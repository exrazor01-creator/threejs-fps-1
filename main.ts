// Tidebreak's hand-in program (Node 22, standard library only).
//
// The repository holds the game as plain static files under game/ and a few
// screenshots under screenshots/. This program copies both into the output
// directory and writes dossier.json there, using the kit's vendored
// buildDossier library — the summary the judge reads. Nothing is built,
// minified or reordered: the copy is byte for byte, so running this program
// twice over the same repository writes the same bytes twice.
//
// Run it locally with MAKEFUN_OUTPUT_DIR standing in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// and play the game itself with `node serve.ts` (http://localhost:8080).

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// The scorer's own limits, from the kit's reference/gate.json. Only
// text_max_bytes changes the dossier's bytes; the rest refuse an entry the
// scorer would refuse anyway, so a failure here is a failure there.
const DOSSIER_TEXT_MAX_BYTES = 163840;
const SCREENSHOTS_MAX = 4;
const SCREENSHOT_MAX_BYTES = 262144;
const GAME_MAX_FILES = 993;
const GAME_MAX_BYTES = 50331648;

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const gameDir = join(repoRoot, 'game');
const shotsDir = join(repoRoot, 'screenshots');
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function fail(message) {
  throw new Error(`main.ts: ${message}`);
}

function checkGameTree() {
  if (!existsSync(join(gameDir, 'index.html'))) {
    fail(`game/index.html is missing under ${repoRoot}`);
  }
  let files = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const info = statSync(path);
      if (info.isSymbolicLink()) fail(`game/ holds a symlink: ${path}`);
      if (info.isDirectory()) {
        files += 1;
        walk(path);
      } else if (info.isFile()) {
        files += 1;
        bytes += info.size;
      }
    }
  };
  walk(gameDir);
  if (files > GAME_MAX_FILES) fail(`game/ holds ${files} entries, over the ${GAME_MAX_FILES} cap`);
  if (bytes > GAME_MAX_BYTES) fail(`game/ is ${bytes} bytes, over the ${GAME_MAX_BYTES} cap`);
}

function checkShots() {
  if (!existsSync(shotsDir)) return;
  const shots = readdirSync(shotsDir).filter((name) => !name.startsWith('.'));
  if (shots.length > SCREENSHOTS_MAX) {
    fail(`screenshots/ holds ${shots.length} files, over the ${SCREENSHOTS_MAX} cap`);
  }
  for (const name of shots) {
    const size = statSync(join(shotsDir, name)).size;
    if (size > SCREENSHOT_MAX_BYTES) {
      fail(`screenshots/${name} is ${size} bytes, over the ${SCREENSHOT_MAX_BYTES} cap`);
    }
  }
}

checkGameTree();
checkShots();

mkdirSync(outDir, { recursive: true });
cpSync(gameDir, join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });
}

writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
    screenshots: { max: SCREENSHOTS_MAX, max_bytes: SCREENSHOT_MAX_BYTES },
    game_max_files: GAME_MAX_FILES,
    game_max_bytes: GAME_MAX_BYTES,
  }),
);
