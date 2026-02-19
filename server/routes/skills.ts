/**
 * Skills API Routes
 *
 * GET /api/skills — List all skills via `openclaw skills list --json`
 */

import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { resolveOpenclawBin } from '../lib/openclaw-bin.js';

const app = new Hono();

const SKILLS_TIMEOUT_MS = 15_000;

/** Ensure PATH includes the directory of the current Node binary (for #!/usr/bin/env node shims under systemd) */
const nodeDir = dirname(process.execPath);
const enrichedEnv = { ...process.env, PATH: `${nodeDir}:${process.env.PATH || ''}` };

interface SkillMissing {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
}

interface RawSkill {
  name: string;
  description: string;
  emoji: string;
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  source: string;
  bundled: boolean;
  homepage?: string;
  missing?: SkillMissing;
}

interface SkillsOutput {
  workspaceDir?: string;
  managedSkillsDir?: string;
  skills?: RawSkill[];
}

function execOpenclawSkills(): Promise<RawSkill[]> {
  return new Promise((resolve) => {
    const openclawBin = resolveOpenclawBin();
    execFile(openclawBin, ['skills', 'list', '--json'], {
      timeout: SKILLS_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      env: enrichedEnv,
    }, (err, stdout) => {
      if (err) {
        console.warn('[skills] openclaw skills list failed:', err.message);
        return resolve([]);
      }
      try {
        const data = JSON.parse(stdout) as SkillsOutput;
        if (!Array.isArray(data.skills)) return resolve([]);
        return resolve(data.skills);
      } catch (parseErr) {
        console.warn('[skills] Failed to parse openclaw output:', (parseErr as Error).message);
        resolve([]);
      }
    });
  });
}

app.get('/api/skills', rateLimitGeneral, async (c) => {
  try {
    const skills = await execOpenclawSkills();
    return c.json({ ok: true, skills });
  } catch (err) {
    console.error('[skills] list error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

export default app;
