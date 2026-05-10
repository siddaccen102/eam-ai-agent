import { randomUUID } from "node:crypto"
import { AuthContext } from "../types/auth"

// In-memory session store. Demo-tier scope: single-process backend, ~10 users,
// sessions wiped on restart. Swap the Map for Redis or another shared store
// when cross-server persistence is needed; the public surface (createSession,
// getSession, deleteSession) stays the same.
const sessions = new Map<string, AuthContext>()

const DEFAULT_TTL_MS = 30 * 60 * 1000 // 30 minutes idle

export function createSession(
    args: {
        eamAuth: { username: string; password: string }
        email: string
        displayName: string
    },
    ttlMs: number = DEFAULT_TTL_MS,
): AuthContext {
    const sessionId = randomUUID()
    const ctx: AuthContext = {
        sessionId,
        eamAuth: args.eamAuth,
        email: args.email,
        displayName: args.displayName,
        expiresAt: Date.now() + ttlMs,
    }
    sessions.set(sessionId, ctx)
    return ctx
}

// Lazy expiry: we check TTL on lookup and delete-on-access if expired, rather
// than running a periodic sweep timer. For the demo's user count this leaves a
// negligible set of expired entries in memory; production-tier would add a
// periodic cleanup pass alongside this. Either way, callers see "expired ==
// not found".
export function getSession(sessionId: string): AuthContext | null {
    const ctx = sessions.get(sessionId)
    if (!ctx) return null
    if (ctx.expiresAt < Date.now()) {
        sessions.delete(sessionId)
        return null
    }
    return ctx
}

export function deleteSession(sessionId: string): void {
    sessions.delete(sessionId)
}
