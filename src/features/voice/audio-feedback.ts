// Shared AudioContext for all voice feedback sounds
let sharedAudioContext: AudioContext | null = null;

/** Initialize or resume the shared AudioContext (call on user interaction) */
export function ensureAudioContext(): void {
  try {
    if (!sharedAudioContext) {
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        sharedAudioContext = new AudioContextCtor();
      }
    }
    if (sharedAudioContext?.state === 'suspended') {
      sharedAudioContext.resume().catch(() => {});
    }
  } catch {
    // AudioContext not available
  }
}

function playPingTone(freq: number, freq2?: number, duration = 0.12) {
  try {
    ensureAudioContext();
    if (!sharedAudioContext) return;

    const ctx = sharedAudioContext;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    const osc = ctx.createOscillator();
    osc.connect(gain);
    osc.frequency.value = freq;
    osc.type = 'sine';
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);

    if (freq2) {
      const gain2 = ctx.createGain();
      gain2.connect(ctx.destination);
      gain2.gain.setValueAtTime(0.3, ctx.currentTime + duration);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration * 2);

      const osc2 = ctx.createOscillator();
      osc2.connect(gain2);
      osc2.frequency.value = freq2;
      osc2.type = 'sine';
      osc2.start(ctx.currentTime + duration);
      osc2.stop(ctx.currentTime + duration * 2);
    }
  } catch {
    // AudioContext not available, silently skip
  }
}

/** Play ascending ping when wake-word is detected. */
export function playWakePing() { playPingTone(880); }
/** Play two-tone ascending ping when voice input is submitted. */
export function playSubmitPing() { playPingTone(660, 880); }
/** Play descending tone when voice input is cancelled. */
export function playCancelPing() { playPingTone(880, 440); }

/** Simple notification ping (used for chat completion sounds) */
export function playPing(): void {
  try {
    ensureAudioContext();
    if (!sharedAudioContext) return;

    const ctx = sharedAudioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // AudioContext not available, silently skip
  }
}
