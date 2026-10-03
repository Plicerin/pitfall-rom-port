// Playable Pitfall! for the site: the translated cartridge (pitfallMachine.mjs)
// on a canvas, keyboard input while the game has focus, a gamepad, touch
// buttons on phones, Game Reset and the TV type switch, and the TIA sound
// worklet. Mount with mountPlayer(root); root holds the canvas and the
// [data-*] controls.
import { PitfallMachine } from './pitfallMachine.mjs';
import { NTSC_PALETTE_RGB } from './palette.mjs';
import { createTiaAudio } from './tiaAudio.mjs';
import { readGamepad, gamepadEdges } from './gamepad.mjs';

export const FIRST_LINE = 43;    // VBLANK goes off early in frame line 43 and back on early in line 235
export const VISIBLE_LINES = 192;
const FRAME_MS = 1000 / 60;
const KEYS = {
  ArrowRight: 'right', KeyD: 'right', ArrowLeft: 'left', KeyA: 'left',
  ArrowDown: 'down', KeyS: 'down', ArrowUp: 'up', KeyW: 'up', Space: 'fire', KeyZ: 'fire',
};
const NO_GAME = 0x9e, TIMER_HI = 0xd8; // NO_GAME 0 = a game is running; the clock starts at $20 (20:00)

export function mountPlayer(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const playButton = root.querySelector('[data-play]');
  const poster = root.querySelector('[data-poster]');
  const hint = root.querySelector('[data-hint]');
  const muteButton = root.querySelector('[data-mute]');
  const pauseButton = root.querySelector('[data-pause]');

  const pf = new PitfallMachine();
  const held = new Set();
  const audio = createTiaAudio(new URL('./tiaSound.worklet.js', import.meta.url).href);
  const screen = document.createElement('canvas');
  screen.width = 160;
  screen.height = VISIBLE_LINES;
  const screenCtx = screen.getContext('2d');
  const image = screenCtx.createImageData(160, VISIBLE_LINES);

  let started = false, paused = false, muted = false, resetHold = 0, resetDown = false;
  let last = 0, acc = 0, pad = null, lastState = '';
  const switches = { color: true }; // the TV type switch: Pitfall! reads it and Game Reset

  const setHint = (text) => { if (hint) hint.textContent = text; };
  const silence = () => audio.setSilent(muted || paused || !started);
  const ram = (addr) => pf.bus.ram[addr & 0x7f];

  function step() {
    const on = (control) => held.has(control) || !!pad?.[control];
    let swcha = 0xff;
    if (on('right')) swcha &= ~0x80;
    if (on('left')) swcha &= ~0x40;
    if (on('down')) swcha &= ~0x20;
    if (on('up')) swcha &= ~0x10;
    pf.bus.swcha = swcha;
    pf.bus.inpt4 = on('fire') ? 0x00 : 0x80;
    // SWCHB: bit 0 RESET (low = pressed), bit 3 color
    pf.bus.swchb = (resetHold > 0 || resetDown ? 0 : 0x01) | 0x02 | (switches.color ? 0x08 : 0);
    pf.runFrame();
    if (resetHold > 0) resetHold -= 1;
    audio.update(pf.bus.audio);
    // hints follow the game: waiting for the first step, playing, over
    const state = ram(NO_GAME) === 0 ? 'playing' : ram(TIMER_HI) === 0x20 && lastState !== 'playing' ? 'waiting' : 'over';
    if (started && state !== lastState) {
      if (state === 'waiting') setHint('Move the joystick to start: the clock starts with your first step.');
      else if (state === 'playing') setHint('Run, jump with Space or Z, climb ladders and swing on vines. P pauses, M mutes.');
      else setHint('Game over. Press Enter or Reset to play again.');
    }
    lastState = state;
  }

  function draw() {
    const rows = pf.bus.tia.lastFrame;
    if (!rows) return;
    const data = image.data;
    for (let y = 0; y < VISIBLE_LINES; y += 1) {
      const row = rows[FIRST_LINE + y];
      for (let x = 0; x < 160; x += 1) {
        const rgb = NTSC_PALETTE_RGB[(row[x] >> 1) & 0x7f];
        const o = (y * 160 + x) * 4;
        data[o] = rgb >> 16; data[o + 1] = (rgb >> 8) & 0xff; data[o + 2] = rgb & 0xff; data[o + 3] = 255;
      }
    }
    screenCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(screen, 0, 0, canvas.width, canvas.height);
  }

  function frame(t) {
    if (!last) last = t;
    const dt = Math.min(100, t - last);
    last = t;
    pad = readGamepad();
    const edges = gamepadEdges(pad);
    if (edges.start) (started ? pressReset() : play());
    if (edges.back && started) togglePause();
    if (!paused && !document.hidden) {
      acc += dt;
      while (acc >= FRAME_MS) { step(); acc -= FRAME_MS; }
    }
    draw();
    requestAnimationFrame(frame);
  }

  function pressReset() {
    resetHold = 2;
    paused = false;
    if (pauseButton) pauseButton.textContent = 'Pause';
    silence();
  }

  async function play() {
    started = true;
    lastState = ''; // show the hint for wherever the game is now
    if (poster) poster.hidden = true;
    canvas.focus({ preventScroll: true });
    pressReset(); // before the audio: starting it can take a moment, the game should not wait
    await audio.start();
    silence();
  }

  function togglePause() {
    paused = !paused;
    if (pauseButton) pauseButton.textContent = paused ? 'Resume' : 'Pause';
    silence();
  }

  function toggleMute() {
    muted = !muted;
    if (muteButton) {
      muteButton.textContent = muted ? 'Sound on' : 'Mute';
      muteButton.setAttribute('aria-pressed', String(muted));
    }
    silence();
  }

  playButton?.addEventListener('click', play);
  pauseButton?.addEventListener('click', () => { if (started) togglePause(); });
  muteButton?.addEventListener('click', toggleMute);
  const resetButton = root.querySelector('[data-reset]');
  resetButton?.addEventListener('pointerdown', () => { if (!started) play(); else pressReset(); resetDown = true; });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) resetButton?.addEventListener(ev, () => { resetDown = false; });
  root.querySelectorAll('[data-switch]').forEach((button) => {
    const name = button.dataset.switch;
    const show = () => button.setAttribute('aria-pressed', String(switches[name]));
    show();
    button.addEventListener('click', () => { switches[name] = !switches[name]; show(); });
  });

  canvas.addEventListener('keydown', (event) => {
    const control = KEYS[event.code];
    if (control) { event.preventDefault(); held.add(control); }
    if (event.code === 'Enter') { event.preventDefault(); if (!started) play(); else { if (!event.repeat) pressReset(); resetDown = true; } }
    if (event.code === 'KeyP') togglePause();
    if (event.code === 'KeyM') toggleMute();
  });
  canvas.addEventListener('keyup', (event) => {
    const control = KEYS[event.code];
    if (control) held.delete(control);
    if (event.code === 'Enter') resetDown = false;
  });
  canvas.addEventListener('blur', () => { held.clear(); resetDown = false; });
  canvas.addEventListener('pointerdown', () => { if (!started) play(); });

  // touch controls: hold to press
  root.querySelectorAll('[data-hold]').forEach((button) => {
    const control = button.dataset.hold;
    const down = (event) => {
      event.preventDefault();
      held.add(control);
      if (!started) play();
      try { button.setPointerCapture(event.pointerId); } catch { /* finger already lifted: the press still counts */ }
    };
    const up = () => held.delete(control);
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
  });

  document.addEventListener('visibilitychange', () => (document.hidden ? audio.suspend() : audio.resume()));

  step();
  draw();
  requestAnimationFrame(frame);

  // dev hook for headless checks: runs frames without the animation loop
  return {
    machine: pf,
    step(n = 1) { for (let i = 0; i < n; i += 1) step(); draw(); },
    hold(control, on) { if (on) held.add(control); else held.delete(control); },
    reset: pressReset,
    play,
    switches,
  };
}
