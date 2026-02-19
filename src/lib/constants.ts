/**
 * constants.ts — Shared constants for the Nerve client.
 *
 * Includes attachment limits, wake/stop phrases, model context-window
 * sizes, and context-usage warning thresholds.
 */

/** Maximum number of file attachments per message. */
export const MAX_ATTACHMENTS = 4;
/** Maximum size per attachment in bytes (4 MB). */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

// ─── Connection defaults ──────────────────────────────────────────────────────
// Used as placeholder/fallback only — actual URL comes from /api/connect-defaults
export const DEFAULT_GATEWAY_WS = 'ws://127.0.0.1:18789';

/** Escape special regex characters for safe use in RegExp constructors */
export function escapeRegex(input: string): string {
  if (!input) return '';
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build wake phrases for a given agent name */
export function buildWakePhrases(agentName: string): string[] {
  const name = agentName.trim().toLowerCase();
  // Fallback to 'agent' if empty
  if (!name) {
    return ['hey agent', 'hey, agent'];
  }
  const phrases = [
    `hey ${name}`,
    `hey, ${name}`,
  ];
  // Add phonetic variation for names ending in 'a' (e.g., helena → helenah)
  if (name.endsWith('a')) {
    const variant = name.slice(0, -1) + 'ah';
    phrases.push(`hey ${variant}`, `hey, ${variant}`);
  }
  return phrases;
}

/**
 * Default wake phrase arrays.
 * Used as test fixtures and fallback defaults.
 * Runtime code should use buildWakePhrases(agentName) for agent-specific phrases.
 */
export const DEFAULT_WAKE_PHRASES = buildWakePhrases('agent');
/** @deprecated Use DEFAULT_WAKE_PHRASES — kept for test compatibility */
export const WAKE_PHRASES = DEFAULT_WAKE_PHRASES;

/**
 * Stop/cancel phrases moved to voice-phrases.json (server config).
 * Served to client via GET /api/voice-phrases.
 * Constants below kept only for test compatibility.
 */
export const STOP_PHRASES = ["boom", "i'm done", "im done", "all right i'm done", "alright i'm done", "that's it", "thats it", "send it", "done"];
export const CANCEL_PHRASES = ['cancel', 'never mind', 'nevermind'];

/** @deprecated Use buildStopRegexFromPhrases in useVoiceInput — kept for test compatibility */
export function buildStopPhrasesRegex(agentName: string): RegExp {
  const name = agentName.trim().toLowerCase();
  const safeName = escapeRegex(name || 'agent');
  const allPhrases = [...STOP_PHRASES, ...CANCEL_PHRASES];
  const escaped = allPhrases.map(p => escapeRegex(p));
  escaped.push(`hey ${safeName}`);
  return new RegExp(`\\b(${escaped.join('|')})\\s*[.!?,]?\\s*$`, 'i');
}

/**
 * Default context window fallback (tokens).
 * The gateway sends the actual limit per session via contextTokens.
 * This is only used when the gateway doesn't provide it.
 */
export const DEFAULT_CONTEXT_LIMIT = 200_000;

// Param kept for API compat — actual limits come from gateway
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getContextLimit(_model: string): number {
  return DEFAULT_CONTEXT_LIMIT;
}

/** Percentage of context used before showing a yellow warning. */
export const CONTEXT_WARNING_THRESHOLD = 75;
/** Percentage of context used before showing a red critical warning. */
export const CONTEXT_CRITICAL_THRESHOLD = 90;
