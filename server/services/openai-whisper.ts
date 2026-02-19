/**
 * OpenAI Whisper transcription client.
 *
 * Sends audio data to the OpenAI `whisper-1` model via a manually-constructed
 * multipart/form-data request (no FormData dependency needed).
 * @module
 */

import { config } from '../lib/config.js';
import { OPENAI_WHISPER_URL } from '../lib/constants.js';

export interface WhisperResult {
  ok: true;
  text: string;
}

export interface WhisperError {
  ok: false;
  status: number;
  message: string;
}

/**
 * Transcribe audio via OpenAI Whisper API.
 * Accepts raw file data and builds a multipart request.
 */
export async function transcribe(
  fileData: Buffer,
  filename: string,
  mimeType: string = 'audio/webm',
): Promise<WhisperResult | WhisperError> {
  if (!config.openaiApiKey) {
    return { ok: false, status: 500, message: 'OpenAI API key not configured' };
  }

  // Build multipart payload for OpenAI
  // Sanitize filename to prevent header injection via quotes/newlines
  const safeFilename = filename.replace(/[\r\n"]/g, '_');
  const boundary = `----FormBoundary${Date.now()}`;
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const footer = Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}--\r\n`,
  );
  const payload = Buffer.concat([header, fileData, footer]);

  const resp = await fetch(OPENAI_WHISPER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: payload,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[transcribe] API error:', resp.status, errText);
    return { ok: false, status: resp.status, message: errText };
  }

  const result = (await resp.json()) as { text: string };
  return { ok: true, text: result.text };
}
