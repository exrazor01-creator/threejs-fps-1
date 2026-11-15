// Synthesised sound: no audio files, just the Web Audio API. Shots are a
// filtered noise burst with a low thump, reloads are short clicks, the
// charge beeps once a second and faster as the fuse runs down, and the
// round jingles are two-note phrases. Everything is guarded: if the browser
// has no audio context yet, calls are no-ops.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBurst(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(filter).connect(gain).connect(master);
    src.start();
  }

  function tone(freq, duration, gainValue, type = 'sine', when = 0) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainValue, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  return {
    unlock() {
      ensure();
    },
    shot(kind) {
      if (kind === 'Shotgun') {
        noiseBurst(0.22, 900, 0.9);
        tone(70, 0.18, 0.5, 'sine');
      } else if (kind === 'DMR') {
        noiseBurst(0.16, 1600, 0.8);
        tone(95, 0.12, 0.4, 'sine');
      } else if (kind === 'Pistol') {
        noiseBurst(0.1, 2200, 0.6);
      } else {
        noiseBurst(0.09, 2800, 0.5);
      }
    },
    enemyShot() {
      noiseBurst(0.08, 1800, 0.22);
    },
    dryFire() {
      tone(1400, 0.03, 0.15, 'square');
    },
    reload() {
      tone(900, 0.04, 0.18, 'square');
      tone(620, 0.04, 0.18, 'square', 0.16);
    },
    hit() {
      tone(1900, 0.05, 0.22, 'sine');
    },
    kill() {
      tone(1900, 0.05, 0.22, 'sine');
      tone(2600, 0.08, 0.22, 'sine', 0.06);
    },
    hurt() {
      noiseBurst(0.12, 500, 0.4);
      tone(160, 0.14, 0.3, 'sine');
    },
    beep(urgent) {
      tone(urgent ? 1500 : 1050, 0.09, 0.25, 'square');
    },
    plantDone() {
      tone(700, 0.12, 0.25, 'square');
      tone(700, 0.12, 0.25, 'square', 0.18);
    },
    explosion() {
      noiseBurst(0.9, 320, 1.0);
      tone(48, 0.7, 0.7, 'sine');
    },
    roundWin() {
      tone(523, 0.14, 0.25, 'triangle');
      tone(659, 0.14, 0.25, 'triangle', 0.13);
      tone(784, 0.22, 0.28, 'triangle', 0.26);
    },
    roundLose() {
      tone(392, 0.16, 0.25, 'triangle');
      tone(330, 0.16, 0.25, 'triangle', 0.15);
      tone(262, 0.28, 0.28, 'triangle', 0.3);
    },
    buy() {
      tone(880, 0.06, 0.2, 'sine');
      tone(1174, 0.08, 0.2, 'sine', 0.07);
    },
  };
}
