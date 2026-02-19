/**
 * POST /api/transcribe — Audio transcription.
 *
 * Routes to local Whisper (default, no API key needed) or OpenAI Whisper API.
 * Body: multipart/form-data with a "file" field containing audio data.
 * Response: { text: string }
 */

import { Hono } from 'hono';
import { config } from '../lib/config.js';
import { transcribe as transcribeOpenAI } from '../services/openai-whisper.js';
import { transcribeLocal, isModelAvailable, getActiveModel, setWhisperModel, getDownloadProgress, getSystemInfo } from '../services/whisper-local.js';
import { rateLimitTranscribe } from '../middleware/rate-limit.js';

const MAX_FILE_SIZE = config.limits.transcribe; // 12 MB

/** MIME types accepted for transcription */
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/mp3',
  'audio/mpeg',
  'audio/mp4',
  'audio/m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'audio/x-flac',
]);

const app = new Hono();

app.post('/api/transcribe', rateLimitTranscribe, async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || !(file instanceof File)) {
      return c.text('No file found in request', 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return c.text(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`, 413);
    }

    if (file.type && !ALLOWED_AUDIO_TYPES.has(file.type)) {
      return c.text(`Unsupported audio format: ${file.type}`, 415);
    }

    const arrayBuf = await file.arrayBuffer();
    const fileData = Buffer.from(arrayBuf);
    const filename = file.name || 'audio.webm';

    // Route to configured STT provider
    let result;
    if (config.sttProvider === 'openai') {
      if (!config.openaiApiKey) {
        return c.text('OpenAI API key not configured. Set OPENAI_API_KEY in .env or switch to STT_PROVIDER=local', 500);
      }
      result = await transcribeOpenAI(fileData, filename, file.type || 'audio/webm');
    } else {
      result = await transcribeLocal(fileData, filename);
    }

    if (!result.ok) {
      return c.text(result.message, result.status as 400 | 500);
    }

    return c.json({ text: result.text });
  } catch (err) {
    console.error('[transcribe] error:', (err as Error).message || err);
    return c.text('Transcription failed', 500);
  }
});

/** GET /api/transcribe/config — current STT provider info + download progress */
app.get('/api/transcribe/config', (c) => {
  const model = getActiveModel();
  const download = getDownloadProgress();
  const { hasGpu } = getSystemInfo();
  return c.json({
    provider: config.sttProvider,
    model,
    modelReady: config.sttProvider === 'local' ? isModelAvailable() : true,
    openaiKeySet: !!config.openaiApiKey,
    replicateKeySet: !!config.replicateApiToken,
    hasGpu,
    availableModels: {
      'tiny.en':  { size: '75MB',  ready: isModelAvailable('tiny.en') },
      'base.en':  { size: '142MB', ready: isModelAvailable('base.en') },
      'small.en': { size: '466MB', ready: isModelAvailable('small.en') },
    },
    download: download ? {
      model: download.model,
      downloading: download.downloading,
      percent: download.percent,
      error: download.error,
    } : null,
  });
});

/** PUT /api/transcribe/config — switch STT provider or model at runtime */
app.put('/api/transcribe/config', async (c) => {
  try {
    const body = await c.req.json() as { model?: string; provider?: string };
    const messages: string[] = [];

    // Switch provider
    if (body.provider === 'local' || body.provider === 'openai') {
      (config as Record<string, unknown>).sttProvider = body.provider;
      messages.push(`Provider set to ${body.provider}`);
    }

    // Switch model
    if (body.model) {
      const result = await setWhisperModel(body.model);
      if (!result.ok) return c.text(result.message, 400);
      messages.push(result.message);
    }

    return c.json({
      provider: config.sttProvider,
      model: getActiveModel(),
      message: messages.join(', ') || 'No changes',
    });
  } catch {
    return c.text('Invalid request', 400);
  }
});

export default app;
