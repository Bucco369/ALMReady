import { useEffect, useState } from "react";
import { getOrCreateSessionId } from "../lib/session";

export function useSession() {
  console.log("[useSession] hook mounted");

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    console.log("[useSession] effect running");

    let cancelled = false;

    (async () => {
      try {
        console.log("[useSession] calling getOrCreateSessionId()");
        const id = await getOrCreateSessionId();
        console.log("[useSession] got sessionId:", id);
        if (!cancelled) setSessionId(id);
      } catch (e) {
        console.error("[useSession] error:", e);
        if (!cancelled) setError(e as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { sessionId, loading, error };
}
