/**
 * useSession – React hook that bootstraps the session on app mount.
 *
 * Returns { sessionId, sessionMeta, loading, error }. While loading is true,
 * child components should show a loading state or skip API calls.
 *
 * sessionMeta includes has_balance / has_curves flags so components know
 * whether to hydrate on mount without extra localStorage markers.
 */

import { useEffect, useState } from "react";
import type { SessionMeta } from "../lib/api";
import { getOrCreateSession } from "../lib/session";

export function useSession() {
  const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const meta = await getOrCreateSession();
        if (!cancelled) setSessionMeta(meta);
      } catch (e) {
        if (!cancelled) setError(e as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    sessionId: sessionMeta?.session_id ?? null,
    sessionMeta,
    loading,
    error,
  };
}
