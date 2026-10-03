// Renders the site's images from the translated cartridge (no ROM needed):
// the poster (the first scene after Game Reset), screenshots of other scenes
// met while Harry runs right through the jungle, and the app icons. Pixels
// are 2:1 like the game. Harry's lives are topped up, and after a second in
// each scene he is put on the surface at its right edge so he walks on into
// the next; the scenes themselves are the cartridge's.
// usage: node tools/gen-images.mjs   -> img/*.png
import { mkdirSync } from 'node:fs';
import { PitfallMachine } from '../src/pitfallMachine.mjs';
import { writeFramePng } from './atari/png.mjs';

const FIRST = 43, LINES = 192;
const LIVES = 0x80, SCENE = 0x81, OBJECT_TYPE = 0x93, SCENE_TYPE = 0x94, X_HARRY = 0xe1, Y_HARRY = 0xe9;
const m = new PitfallMachine();
const z = (a) => m.bus.ram[a & 0x7f];
const run = (n) => { for (let i = 0; i < n; i += 1) { m.bus.ram[LIVES & 0x7f] = 0xa0; m.runFrame(); } };
const visible = () => m.bus.tia.lastFrame.slice(FIRST, FIRST + LINES).map((r) => Array.from(r));

mkdirSync('img', { recursive: true });
run(30); m.bus.swchb = 0x0a; run(4); m.bus.swchb = 0x0b; run(60);
const start = visible();
writeFramePng('img/start.png', start, 4, 2);

// run right through the jungle and keep the first frame of each wanted scene
const WANTED = {
  'scene-croco': () => z(SCENE_TYPE) === 4,
  'scene-treasure': () => z(SCENE_TYPE) === 5,
  'scene-fire': () => z(SCENE_TYPE) !== 5 && z(OBJECT_TYPE) === 6, // in treasure scenes the byte numbers the treasure instead
  'scene-cobra': () => z(SCENE_TYPE) !== 5 && z(OBJECT_TYPE) === 7,
  'scene-tarpit': () => z(SCENE_TYPE) === 3 || z(SCENE_TYPE) === 7,
};
const got = new Set();
let scene = z(SCENE), sinceChange = 0;
m.bus.swcha = 0x7f;
for (let f = 0; f < 60000 && got.size < Object.keys(WANTED).length; f += 1) {
  run(1);
  if (z(SCENE) !== scene) { scene = z(SCENE); sinceChange = 0; continue; }
  sinceChange += 1;
  if (sinceChange === 12 && z(Y_HARRY) < 64) {
    for (const [name, test] of Object.entries(WANTED)) {
      if (!got.has(name) && test()) { got.add(name); writeFramePng(`img/${name}.png`, visible(), 4, 2); }
    }
  }
  // after a second in the scene, put Harry on the surface at the right edge
  // so he walks into the next one (running right he would fall down holes,
  // into ponds and against walls)
  if (sinceChange % 60 === 59) { m.bus.ram[X_HARRY & 0x7f] = 140; m.bus.ram[Y_HARRY & 0x7f] = 32; }
}

// icons: the first scene's tree line and Harry, cropped square
for (const size of [180, 192, 512]) {
  const src = start.slice(40, 140).map((r) => r.slice(8, 108));
  const rows = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => src[Math.floor(y * src.length / size)][Math.floor(x * src[0].length / size)]));
  writeFramePng(`img/icon-${size}.png`, rows, 1, 1);
}
console.log('wrote img/:', ['start', ...got].join(', '));
