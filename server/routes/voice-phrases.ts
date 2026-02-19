/**
 * GET /api/voice-phrases — Returns configured stop/cancel phrases.
 * Client uses these for voice recognition instead of hardcoded values.
 */

import { Hono } from 'hono';
import { getVoicePhrases } from '../lib/voice-phrases.js';

const app = new Hono();

app.get('/api/voice-phrases', (c) => {
  return c.json(getVoicePhrases());
});

export default app;
