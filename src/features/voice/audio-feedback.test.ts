import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock AudioContext
class MockOscillatorNode {
  frequency = { value: 0 };
  type: OscillatorType = 'sine';
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockGainNode {
  gain = {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];
  state: AudioContextState = 'running';
  currentTime = 0;
  destination = {};
  
  constructor() {
    MockAudioContext.instances.push(this);
  }

  createOscillator = vi.fn(() => new MockOscillatorNode());
  createGain = vi.fn(() => new MockGainNode());
  resume = vi.fn(() => Promise.resolve());
}

describe('audio-feedback', () => {
  let originalAudioContext: typeof AudioContext | undefined;
  let originalWebkitAudioContext: unknown;
  // Import functions fresh each test to reset module state
  let ensureAudioContext: () => void;
  let playWakePing: () => void;
  let playSubmitPing: () => void;
  let playCancelPing: () => void;
  let playPing: () => void;

  beforeEach(async () => {
    MockAudioContext.instances = [];
    originalAudioContext = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    originalWebkitAudioContext = (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
    
    (window as unknown as { AudioContext: typeof MockAudioContext }).AudioContext = MockAudioContext as unknown as typeof AudioContext;
    vi.clearAllMocks();
    
    // Reset module cache and reimport to get fresh state
    vi.resetModules();
    const audioFeedback = await import('./audio-feedback');
    ensureAudioContext = audioFeedback.ensureAudioContext;
    playWakePing = audioFeedback.playWakePing;
    playSubmitPing = audioFeedback.playSubmitPing;
    playCancelPing = audioFeedback.playCancelPing;
    playPing = audioFeedback.playPing;
  });

  afterEach(() => {
    if (originalAudioContext) {
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext = originalAudioContext;
    } else {
      delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    }
    if (originalWebkitAudioContext) {
      (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = originalWebkitAudioContext;
    } else {
      delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
    }
  });

  describe('ensureAudioContext', () => {
    it('should create AudioContext on first call', () => {
      ensureAudioContext();
      expect(MockAudioContext.instances.length).toBe(1);
    });

    it('should reuse existing AudioContext on subsequent calls', () => {
      ensureAudioContext();
      ensureAudioContext();
      ensureAudioContext();
      
      // Should only create one instance
      expect(MockAudioContext.instances.length).toBe(1);
    });

    it('should resume suspended AudioContext', () => {
      ensureAudioContext();
      const ctx = MockAudioContext.instances[0];
      ctx.state = 'suspended';
      
      ensureAudioContext();
      
      expect(ctx.resume).toHaveBeenCalled();
    });

    it('should not throw when AudioContext is unavailable', () => {
      delete (window as unknown as { AudioContext?: unknown }).AudioContext;
      delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
      
      expect(() => ensureAudioContext()).not.toThrow();
    });

    it('should fall back to webkitAudioContext', () => {
      delete (window as unknown as { AudioContext?: unknown }).AudioContext;
      (window as unknown as { webkitAudioContext: typeof MockAudioContext }).webkitAudioContext = MockAudioContext as unknown as typeof AudioContext;
      
      ensureAudioContext();
      
      expect(MockAudioContext.instances.length).toBe(1);
    });
  });

  describe('playWakePing', () => {
    it('should create oscillator and gain nodes', () => {
      playWakePing();
      
      const ctx = MockAudioContext.instances[0];
      expect(ctx).toBeDefined();
      expect(ctx.createOscillator).toHaveBeenCalled();
      expect(ctx.createGain).toHaveBeenCalled();
    });

    it('should set frequency to 880Hz', () => {
      playWakePing();
      
      const ctx = MockAudioContext.instances[0];
      const osc = ctx.createOscillator.mock.results[0].value as MockOscillatorNode;
      expect(osc.frequency.value).toBe(880);
    });

    it('should start and schedule stop', () => {
      playWakePing();
      
      const ctx = MockAudioContext.instances[0];
      const osc = ctx.createOscillator.mock.results[0].value as MockOscillatorNode;
      expect(osc.start).toHaveBeenCalled();
      expect(osc.stop).toHaveBeenCalled();
    });

    it('should not throw when AudioContext is unavailable', () => {
      delete (window as unknown as { AudioContext?: unknown }).AudioContext;
      delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
      
      expect(() => playWakePing()).not.toThrow();
    });
  });

  describe('playSubmitPing', () => {
    it('should create two oscillators for two-tone ping', () => {
      playSubmitPing();
      
      const ctx = MockAudioContext.instances[0];
      expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
      expect(ctx.createGain).toHaveBeenCalledTimes(2);
    });

    it('should set frequencies to 660Hz and 880Hz', () => {
      playSubmitPing();
      
      const ctx = MockAudioContext.instances[0];
      const osc1 = ctx.createOscillator.mock.results[0].value as MockOscillatorNode;
      const osc2 = ctx.createOscillator.mock.results[1].value as MockOscillatorNode;
      
      expect(osc1.frequency.value).toBe(660);
      expect(osc2.frequency.value).toBe(880);
    });

    it('should not throw when AudioContext is unavailable', () => {
      delete (window as unknown as { AudioContext?: unknown }).AudioContext;
      delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
      
      expect(() => playSubmitPing()).not.toThrow();
    });
  });

  describe('playCancelPing', () => {
    it('should create two oscillators for two-tone ping', () => {
      playCancelPing();
      
      const ctx = MockAudioContext.instances[0];
      expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    });

    it('should set frequencies to 880Hz and 440Hz (descending)', () => {
      playCancelPing();
      
      const ctx = MockAudioContext.instances[0];
      const osc1 = ctx.createOscillator.mock.results[0].value as MockOscillatorNode;
      const osc2 = ctx.createOscillator.mock.results[1].value as MockOscillatorNode;
      
      expect(osc1.frequency.value).toBe(880);
      expect(osc2.frequency.value).toBe(440);
    });

    it('should not throw when AudioContext is unavailable', () => {
      delete (window as unknown as { AudioContext?: unknown }).AudioContext;
      delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
      
      expect(() => playCancelPing()).not.toThrow();
    });
  });

  describe('playPing', () => {
    it('should create oscillator at 880Hz', () => {
      playPing();
      
      const ctx = MockAudioContext.instances[0];
      expect(ctx.createOscillator).toHaveBeenCalled();
      
      const osc = ctx.createOscillator.mock.results[0].value as MockOscillatorNode;
      expect(osc.frequency.value).toBe(880);
    });

    it('should set gain to 0.08 (softer than other pings)', () => {
      playPing();
      
      const ctx = MockAudioContext.instances[0];
      const gain = ctx.createGain.mock.results[0].value as MockGainNode;
      expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.08, expect.any(Number));
    });

    it('should not throw when AudioContext is unavailable', () => {
      delete (window as unknown as { AudioContext?: unknown }).AudioContext;
      delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
      
      expect(() => playPing()).not.toThrow();
    });
  });

  describe('Audio Feedback Distinctiveness', () => {
    it('wake ping should be single 880Hz tone', () => {
      playWakePing();
      const ctx = MockAudioContext.instances[0];
      expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
      const osc = ctx.createOscillator.mock.results[0].value as MockOscillatorNode;
      expect(osc.frequency.value).toBe(880);
    });

    it('submit ping should be ascending (660Hz → 880Hz)', () => {
      playSubmitPing();
      const ctx = MockAudioContext.instances[0];
      expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
      const osc1 = ctx.createOscillator.mock.results[0].value as MockOscillatorNode;
      const osc2 = ctx.createOscillator.mock.results[1].value as MockOscillatorNode;
      expect(osc1.frequency.value).toBe(660);
      expect(osc2.frequency.value).toBe(880);
    });

    it('cancel ping should be descending (880Hz → 440Hz)', () => {
      playCancelPing();
      const ctx = MockAudioContext.instances[0];
      expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
      const osc1 = ctx.createOscillator.mock.results[0].value as MockOscillatorNode;
      const osc2 = ctx.createOscillator.mock.results[1].value as MockOscillatorNode;
      expect(osc1.frequency.value).toBe(880);
      expect(osc2.frequency.value).toBe(440);
    });
  });
});
