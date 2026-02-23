/**
 * session.ts – Session lifecycle management using localStorage + backend API.
 *
 * === ROLE IN THE SYSTEM ===
 * A "session" is the central unit of work in ALMReady. It ties together:
 * balance data, curve data, What-If modifications, and (future) calculation
 * results. The session_id (UUID) is stored in localStorage so it survives
 * page refreshes.
 *
 * === FLOW ===
 * 1. On app load, getOrCreateSessionId() checks localStorage for an existing ID.
 * 2. If found, it validates with GET /api/sessions/{id} to ensure it still exists.
 * 3. If the backend forgot it (server restart), it creates a fresh session.
 * 4. The session_id is then used by all API calls to scope data.
 *
 * === STALE SESSION HANDLING ===
 * If the backend restarts, in-memory sessions are lost. The getSession() call
 * returns 404, and we transparently rotate to a new session. The user will need
 * to re-upload their balance/curves. In the future, disk-persisted sessions
 * survive restarts (which is already implemented in the backend).
 */

import { createSession, getSession, type SessionMeta } from "./api";

const LS_KEY = "almready_session_id";

async function createAndStore(): Promise<SessionMeta> {
  const meta = await createSession();
  localStorage.setItem(LS_KEY, meta.session_id);
  return meta;
}

export async function getOrCreateSession(): Promise<SessionMeta> {
  const existing = localStorage.getItem(LS_KEY);

  if (existing) {
    try {
      const meta = await getSession(existing);
      return meta;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isSessionMissing = msg.includes("HTTP 404") || msg.includes("Session not found");

      // If backend restarted and forgot in-memory sessions, rotate to a fresh one.
      if (!isSessionMissing) throw error;

      localStorage.removeItem(LS_KEY);
    }
  }

  return createAndStore();
}

/** @deprecated Use getOrCreateSession() instead */
export async function getOrCreateSessionId(): Promise<string> {
  const meta = await getOrCreateSession();
  return meta.session_id;
}

export function clearSessionId() {
  localStorage.removeItem(LS_KEY);
}
