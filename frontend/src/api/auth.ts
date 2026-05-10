import { apiCall } from "./client"

// Mirrors the backend's /auth route shape. We only model what we actually use.
// The session carries email + displayName from Workday (captured at login)
// alongside the EAM username (canonical uppercase form derived server-side).
// Three identity-shaped fields, but they're each load-bearing in different
// places: email for "who is the user" (agent input), displayName for UI
// chrome, eamUsername for EAM audit fields and URL paths.
export type Session = {
    sessionId: string
    expiresAt: number       // ms-since-epoch
    email: string           // e.g. "rashid.siddiqui@vopak.com"
    displayName: string     // Workday-friendly e.g. "Rashid Siddiqui"
    eamUsername: string     // EAM canonical e.g. "RASHID.SIDDIQUI"
}

// login - send email + EAM password; backend looks up Workday, derives the
// EAM username, validates EAM creds, returns the full session.
export async function login(email: string, eamPassword: string): Promise<Session> {
    return await apiCall<Session>("/auth/login", {
        method: "POST",
        body: { email, eamPassword },
    })
}

// Logout is idempotent on the backend - missing/expired session still returns 200.
// We don't surface failures from this endpoint to the user; the caller wraps
// the call in try/catch and discards errors.
export async function logoutEam(sessionId: string): Promise<void> {
    await apiCall<{ status: string }>("/auth/logout", {
        method: "POST",
        sessionId,
    })
}

// Used on app load to validate a stored sessionId. Throws ApiError(401) if the
// session is unknown/expired - the caller treats that as "user is anonymous".
export async function fetchMe(sessionId: string): Promise<Session> {
    return await apiCall<Session>("/auth/me", { sessionId })
}
