import type { Session } from '@/types';
import { getSessionKey } from '@/types';

export interface TreeNode {
  session: Session;
  key: string;
  parentId: string | null;
  depth: number;
  children: TreeNode[];
  isExpanded: boolean;
}

/** Classify a session key by type. */
export function getSessionType(sessionKey: string): 'main' | 'subagent' | 'cron' | 'cron-run' {
  if (/:cron:[^:]+:run:/.test(sessionKey)) return 'cron-run';
  if (/:cron:/.test(sessionKey)) return 'cron';
  if (/:subagent:/.test(sessionKey)) return 'subagent';
  return 'main';
}

/**
 * Parse a session key to infer its parent key.
 * "agent:main:main" → null (root)
 * "agent:main:subagent:abc123" → "agent:main:main" (child of root)
 * "agent:main:cron:abc123" → "agent:main:main" (child of root)
 * "agent:main:cron:abc123:run:def456" → "agent:main:cron:abc123" (child of cron)
 */
function inferParentKey(sessionKey: string): string | null {
  // Cron run → parent is the cron job
  const cronRunMatch = sessionKey.match(/^(.+:cron:[^:]+):run:.+$/);
  if (cronRunMatch) return cronRunMatch[1];
  // Subagent → parent is main
  const subMatch = sessionKey.match(/^(agent:[^:]+):subagent:.+$/);
  if (subMatch) return `${subMatch[1]}:main`;
  // Cron job → parent is main
  const cronMatch = sessionKey.match(/^(agent:[^:]+):cron:.+$/);
  if (cronMatch) return `${cronMatch[1]}:main`;
  return null;
}

/**
 * Build a hierarchical tree from a flat list of sessions.
 *
 * Dual strategy:
 * 1. If sessions have `parentId` (gateway v2026.2.9+), use that.
 * 2. Fallback: parse session key structure to infer parent-child relationships.
 *
 * Returns an array of root-level TreeNodes (usually just one).
 */
export function buildSessionTree(sessions: Session[]): TreeNode[] {
  if (sessions.length === 0) return [];

  // Build a map of key → session for quick lookup
  const keyMap = new Map<string, Session>();
  for (const s of sessions) {
    keyMap.set(getSessionKey(s), s);
  }

  // Determine parent for each session
  const parentMap = new Map<string, string | null>();
  for (const s of sessions) {
    const sk = getSessionKey(s);
    if (s.parentId) {
      // Prefer explicit parentId from the gateway API
      parentMap.set(sk, keyMap.has(s.parentId) ? s.parentId : null);
    } else {
      // Fallback: infer from key structure
      const inferred = inferParentKey(sk);
      // Only set parent if the parent session actually exists in our list
      parentMap.set(sk, inferred && keyMap.has(inferred) ? inferred : null);
    }
  }

  // Group children by parent key
  const childrenOf = new Map<string | null, Session[]>();
  for (const s of sessions) {
    const sk = getSessionKey(s);
    const pid = parentMap.get(sk) ?? null;
    const list = childrenOf.get(pid);
    if (list) {
      list.push(s);
    } else {
      childrenOf.set(pid, [s]);
    }
  }

  // Recursive builder
  function buildNodes(parentKey: string | null, depth: number): TreeNode[] {
    const children = childrenOf.get(parentKey);
    if (!children) return [];

    // Sort: subagents first, then crons, then alphabetically
    const typeOrder = { main: 0, subagent: 1, cron: 2, 'cron-run': 3 };
    const sorted = [...children].sort((a, b) => {
      const ta = typeOrder[getSessionType(getSessionKey(a))] ?? 9;
      const tb = typeOrder[getSessionType(getSessionKey(b))] ?? 9;
      if (ta !== tb) return ta - tb;
      // Within cron-runs, sort by most recent first
      if (ta === 3) {
        const timeA = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
        const timeB = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
        return timeB - timeA;
      }
      const la = (a.label || getSessionKey(a)).toLowerCase();
      const lb = (b.label || getSessionKey(b)).toLowerCase();
      return la.localeCompare(lb);
    });

    return sorted.map((s) => {
      const sk = getSessionKey(s);
      return {
        session: s,
        key: sk,
        parentId: parentKey,
        depth,
        children: buildNodes(sk, depth + 1),
        isExpanded: true,
      };
    });
  }

  return buildNodes(null, 0);
}

/** Flatten a tree into an ordered list, respecting collapsed state. */
export function flattenTree(
  roots: TreeNode[],
  expandedState: Record<string, boolean>,
): TreeNode[] {
  const result: TreeNode[] = [];

  function walk(nodes: TreeNode[]) {
    for (const node of nodes) {
      result.push(node);
      const isExpanded = expandedState[node.key] ?? node.isExpanded;
      if (isExpanded && node.children.length > 0) {
        walk(node.children);
      }
    }
  }

  walk(roots);
  return result;
}
