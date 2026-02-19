/**
 * File browser API routes.
 *
 * Provides directory tree listing and file reading for the workspace
 * file browser UI. All paths are relative to the workspace root
 * (~/.openclaw/workspace/) and validated against traversal + exclusion rules.
 *
 * GET  /api/files/tree  — List directory entries (lazy, depth-limited)
 * GET  /api/files/read  — Read a text file's content
 * PUT  /api/files/write — Write/update a text file
 * @module
 */

import { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getWorkspaceRoot,
  resolveWorkspacePath,
  isExcluded,
  isBinary,
  MAX_FILE_SIZE,
} from '../lib/file-utils.js';

const app = new Hono();

// ── Types ────────────────────────────────────────────────────────────

interface TreeEntry {
  name: string;
  path: string;         // relative to workspace root
  type: 'file' | 'directory';
  size?: number;        // bytes, files only
  mtime?: number;       // epoch ms
  binary?: boolean;     // true for binary files
  children?: TreeEntry[] | null; // null = not loaded, [] = empty dir
}

// ── Helpers ──────────────────────────────────────────────────────────

async function listDirectory(
  dirPath: string,
  basePath: string,
  depth: number,
): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];

  let items;
  try {
    items = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return entries;
  }

  // Sort: directories first, then alphabetical (case-insensitive)
  items.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  for (const item of items) {
    // Skip excluded names and hidden files (except specific ones)
    if (isExcluded(item.name)) continue;
    if (item.name.startsWith('.') && item.name !== '.nerveignore') continue;

    const relativePath = basePath ? path.join(basePath, item.name) : item.name;
    const fullPath = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      entries.push({
        name: item.name,
        path: relativePath,
        type: 'directory',
        children: depth > 1
          ? await listDirectory(fullPath, relativePath, depth - 1)
          : null,
      });
    } else if (item.isFile()) {
      try {
        const stat = await fs.stat(fullPath);
        entries.push({
          name: item.name,
          path: relativePath,
          type: 'file',
          size: stat.size,
          mtime: Math.floor(stat.mtimeMs),
          binary: isBinary(item.name) || undefined,
        });
      } catch {
        // Skip files we can't stat
      }
    }
  }

  return entries;
}

// ── GET /api/files/tree ──────────────────────────────────────────────

app.get('/api/files/tree', async (c) => {
  const root = getWorkspaceRoot();
  const subPath = c.req.query('path') || '';
  const depth = Math.min(Math.max(Number(c.req.query('depth')) || 1, 1), 5);

  // Resolve the target directory
  let targetDir: string;
  if (subPath) {
    const resolved = await resolveWorkspacePath(subPath);
    if (!resolved) {
      return c.json({ ok: false, error: 'Invalid path' }, 400);
    }
    targetDir = resolved;

    // Ensure it's a directory
    try {
      const stat = await fs.stat(targetDir);
      if (!stat.isDirectory()) {
        return c.json({ ok: false, error: 'Not a directory' }, 400);
      }
    } catch {
      return c.json({ ok: false, error: 'Directory not found' }, 404);
    }
  } else {
    targetDir = root;
  }

  const entries = await listDirectory(targetDir, subPath, depth);

  return c.json({ ok: true, root: subPath || '.', entries });
});

// ── GET /api/files/read ──────────────────────────────────────────────

app.get('/api/files/read', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) {
    return c.json({ ok: false, error: 'Missing path parameter' }, 400);
  }

  const resolved = await resolveWorkspacePath(filePath);
  if (!resolved) {
    return c.json({ ok: false, error: 'Invalid or excluded path' }, 403);
  }

  // Check if binary
  if (isBinary(path.basename(resolved))) {
    return c.json({ ok: false, error: 'Binary file', binary: true }, 415);
  }

  // Stat the file
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return c.json({ ok: false, error: 'File not found' }, 404);
  }

  if (!stat.isFile()) {
    return c.json({ ok: false, error: 'Not a file' }, 400);
  }

  if (stat.size > MAX_FILE_SIZE) {
    return c.json({ ok: false, error: `File too large (${(stat.size / 1024).toFixed(0)}KB, max 1MB)` }, 413);
  }

  try {
    const content = await fs.readFile(resolved, 'utf-8');
    return c.json({
      ok: true,
      content,
      size: stat.size,
      mtime: Math.floor(stat.mtimeMs),
    });
  } catch {
    return c.json({ ok: false, error: 'Failed to read file' }, 500);
  }
});

// ── PUT /api/files/write ─────────────────────────────────────────────

app.put('/api/files/write', async (c) => {
  let body: { path?: string; content?: string; expectedMtime?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { path: filePath, content, expectedMtime } = body;

  if (!filePath || typeof filePath !== 'string') {
    return c.json({ ok: false, error: 'Missing path' }, 400);
  }
  if (typeof content !== 'string') {
    return c.json({ ok: false, error: 'Missing or invalid content' }, 400);
  }
  if (content.length > MAX_FILE_SIZE) {
    return c.json({ ok: false, error: 'Content too large (max 1MB)' }, 413);
  }

  const resolved = await resolveWorkspacePath(filePath, { allowNonExistent: true });
  if (!resolved) {
    return c.json({ ok: false, error: 'Invalid or excluded path' }, 403);
  }

  if (isBinary(path.basename(resolved))) {
    return c.json({ ok: false, error: 'Cannot write binary files' }, 415);
  }

  // Conflict detection: check mtime if expectedMtime provided
  if (typeof expectedMtime === 'number') {
    try {
      const stat = await fs.stat(resolved);
      const currentMtime = Math.floor(stat.mtimeMs);
      if (currentMtime !== expectedMtime) {
        return c.json({
          ok: false,
          error: 'File was modified since you loaded it',
          currentMtime,
        }, 409);
      }
    } catch {
      // File doesn't exist yet — no conflict possible
    }
  }

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(resolved), { recursive: true });

  // Write the file
  try {
    await fs.writeFile(resolved, content, 'utf-8');
    const stat = await fs.stat(resolved);
    return c.json({
      ok: true,
      mtime: Math.floor(stat.mtimeMs),
    });
  } catch {
    return c.json({ ok: false, error: 'Failed to write file' }, 500);
  }
});

// ── GET /api/files/raw ───────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico']);

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Check if a file is a supported image. */
export function isImage(name: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

app.get('/api/files/raw', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) {
    return c.json({ ok: false, error: 'Missing path parameter' }, 400);
  }

  const resolved = await resolveWorkspacePath(filePath);
  if (!resolved) {
    return c.json({ ok: false, error: 'Invalid or excluded path' }, 403);
  }

  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_TYPES[ext];
  if (!mime) {
    return c.json({ ok: false, error: 'Unsupported file type' }, 415);
  }

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return c.json({ ok: false, error: 'Not a file' }, 400);
    }
    // Cap at 10MB for images
    if (stat.size > 10_485_760) {
      return c.json({ ok: false, error: 'File too large (max 10MB)' }, 413);
    }

    const buffer = await fs.readFile(resolved);
    return new Response(buffer, {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(stat.size),
        'Cache-Control': 'no-cache',
      },
    });
  } catch {
    return c.json({ ok: false, error: 'Failed to read file' }, 500);
  }
});

export default app;
