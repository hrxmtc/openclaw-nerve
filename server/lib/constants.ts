/**
 * Server-side constants — no hardcoded values in service files.
 * External API URLs, paths, and defaults all live here.
 * Override via env vars where noted.
 */

// ─── External API base URLs ───────────────────────────────────────────────────
// Override for proxies, self-hosted endpoints, or API-compatible alternatives.

export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
export const REPLICATE_BASE_URL = process.env.REPLICATE_BASE_URL || 'https://api.replicate.com/v1';

// ─── API endpoints (derived from base URLs) ──────────────────────────────────

export const OPENAI_TTS_URL = `${OPENAI_BASE_URL}/audio/speech`;
export const OPENAI_WHISPER_URL = `${OPENAI_BASE_URL}/audio/transcriptions`;
export const REPLICATE_QWEN_TTS_URL = `${REPLICATE_BASE_URL}/models/qwen/qwen3-tts/predictions`;

// ─── Default connection ──────────────────────────────────────────────────────

export const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:18789';
export const DEFAULT_GATEWAY_WS = 'ws://127.0.0.1:18789';
export const DEFAULT_PORT = 3080;
export const DEFAULT_SSL_PORT = 3443;
export const DEFAULT_HOST = '127.0.0.1';

// ─── Codex integration ──────────────────────────────────────────────────────

export const CODEX_DIR = process.env.CODEX_DIR || '.codex';

// ─── Whisper STT models (HuggingFace) ────────────────────────────────────────

export const WHISPER_MODELS_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
export const WHISPER_MODEL_FILES: Record<string, string> = {
  'tiny.en':  'ggml-tiny.en.bin',
  'base.en':  'ggml-base.en.bin',
  'small.en': 'ggml-small.en.bin',
};
export const WHISPER_DEFAULT_MODEL = 'tiny.en';
