/**
 * Voice phrase configuration — reads from voice-phrases.json.
 * Stop, cancel, and wake phrases live here instead of hardcoded in constants.
 *
 * Config file: <PROJECT_ROOT>/voice-phrases.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'voice-phrases.json');

export interface VoicePhrases {
  stopPhrases: string[];
  cancelPhrases: string[];
}

const DEFAULTS: VoicePhrases = {
  stopPhrases: ["boom", "i'm done", "im done", "all right i'm done", "alright i'm done", "that's it", "thats it", "send it", "done"],
  cancelPhrases: ['cancel', 'never mind', 'nevermind'],
};

let cached: VoicePhrases | null = null;
let cachedMtime = 0;

/** Read voice phrases, with file-change detection. */
export function getVoicePhrases(): VoicePhrases {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    if (cached && stat.mtimeMs === cachedMtime) return cached;

    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    cached = {
      stopPhrases: Array.isArray(raw.stopPhrases) ? raw.stopPhrases : DEFAULTS.stopPhrases,
      cancelPhrases: Array.isArray(raw.cancelPhrases) ? raw.cancelPhrases : DEFAULTS.cancelPhrases,
    };
    cachedMtime = stat.mtimeMs;
    return cached;
  } catch {
    // File missing or invalid — use defaults
    return DEFAULTS;
  }
}
