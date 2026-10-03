// Differential test of the translated cartridge (src/pitfallMachine.mjs) against
// the real ROM interpreted on the 6502 core: both get the same inputs each
// frame, and after every frame the CPU registers, cycle count, RAM, TIA write
// log and finished picture must be identical.
// Inputs: random joystick and button, and Game Reset now and then. With
// 'cover', identical RAM pokes in both machines set a random scene number
// now and then (Pitfall! builds each scene from that byte), so many of the
// 255 scenes get drawn and played, and top up Harry's lives.
// usage: node tools/verify-recomp.mjs [frames] [seed] [cover]
import { VCS, loadRom } from './atari/vcs.mjs';
import { PitfallMachine } from '../src/pitfallMachine.mjs';
import { ROM_DATA } from '../src/pitfallRomData.mjs';

const frames = Number(process.argv[2] ?? 3000), seed = Number(process.argv[3] ?? 1), cover = process.argv[4] === 'cover';
const rom = new VCS(loadRom());
const adv = new PitfallMachine();
// every ROM read the translated code makes must land on a byte in the data image
const mapped = new Uint8Array(4096);
for (const [at, h] of ROM_DATA) for (let i = 0; i < h.length / 2; i += 1) mapped[(at + i) & 0xfff] = 1;
const unmapped = new Set();
const busRead = adv.bus.read.bind(adv.bus);
adv.bus.read = (addr) => { if ((addr & 0x1000) && !mapped[addr & 0xfff]) unmapped.add((0xf000 | (addr & 0xfff)).toString(16)); return busRead(addr); };
let s = seed >>> 0;
const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const hex = (v) => v.toString(16);
const LIVES = 0x80, SCENE = 0x81, NO_GAME = 0x9e, TREASURES = 0xf1;
const z = (a) => rom.ram[a & 0x7f];
const poke = (addr, v) => { rom.ram[addr & 0x7f] = v; adv.bus.ram[addr & 0x7f] = v; };
const playing = (ram) => ram[NO_GAME & 0x7f] === 0;

let stick = 0xff, bad = 0;
const scenes = new Set();
const stats = { gamesStarted: 0, livesLost: 0, treasures: 0 };
for (let f = 0; f < frames; f += 1) {
  if (f % 20 === 0) { const r = rand(); stick = [0x7f, 0xbf, 0xdf, 0xef, 0x5f, 0x6f, 0x9f, 0xaf, 0xff, 0x7f, 0xbf][Math.floor(r * 11)]; }
  const fire = rand() < 0.2 ? 0x00 : 0x80;
  const swchb = f % 4000 < 4 ? 0x0a : 0x0b; // Game Reset every 4000 frames
  if (cover && playing(rom.ram) && f % 300 === 150) { poke(SCENE, Math.floor(rand() * 256)); poke(LIVES, 0xa0); }
  for (const m of [rom, adv.bus]) { m.swcha = stick; m.inpt4 = fire; m.swchb = swchb; }
  const before = rom.ram.slice();
  rom.runFrames(1);
  adv.runFrame();
  const diffs = [];
  for (const r of ['a', 'x', 'y', 's', 'p', 'pc', 'cycles']) if (rom.cpu[r] !== adv.cpu[r]) diffs.push(`${r} rom ${hex(rom.cpu[r])} js ${hex(adv.cpu[r])}`);
  for (let i = 0; i < 128; i += 1) if (rom.ram[i] !== adv.bus.ram[i]) diffs.push(`$${hex(0x80 + i)} rom ${hex(rom.ram[i])} js ${hex(adv.bus.ram[i])}`);
  const wr = rom.lastFrameWrites, wj = adv.bus.lastFrameWrites;
  if (wr.length !== wj.length) diffs.push(`writes rom ${wr.length} js ${wj.length}`);
  for (let i = 0; i < Math.min(wr.length, wj.length); i += 1) {
    if (wr[i].reg !== wj[i].reg || wr[i].value !== wj[i].value || wr[i].cycle !== wj[i].cycle) { diffs.push(`write ${i} rom ${JSON.stringify(wr[i])} js ${JSON.stringify(wj[i])}`); break; }
  }
  const pr = rom.tia.lastFrame, pj = adv.bus.tia.lastFrame;
  if (pr && pr.some((row, y) => row.some((c, x) => c !== pj[y][x]))) diffs.push('picture differs');
  if (diffs.length) { bad += 1; if (bad <= 5) console.log(`frame ${f}: ${diffs.slice(0, 8).join(', ')}`); if (bad === 5) break; }
  scenes.add(z(SCENE));
  if (!playing(before) && playing(rom.ram)) stats.gamesStarted += 1;
  if (z(LIVES) !== before[LIVES & 0x7f] && z(LIVES) < before[LIVES & 0x7f]) stats.livesLost += 1;
  if (z(TREASURES) !== before[TREASURES & 0x7f]) stats.treasures += 1;
}
if (unmapped.size) console.log('reads outside the data image:', [...unmapped].join(' '));
console.log({ frames, bad, ...stats, scenes: scenes.size });
process.exit(bad || unmapped.size ? 1 : 0);
