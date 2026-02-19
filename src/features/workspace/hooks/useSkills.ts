/**
 * useSkills — Fetch skills list from the server.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

export interface SkillMissing {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
}

export interface Skill {
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

/** Hook to fetch installed skills and their missing-dependency status from the gateway. */
export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/skills');
      const data = (await res.json()) as { ok: boolean; skills?: Skill[]; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to fetch skills');
      setSkills(data.skills || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      refresh();
    }
  }, [refresh]);

  return { skills, isLoading, error, refresh };
}
