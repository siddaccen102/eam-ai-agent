import { apiCall } from "./client"

// Mirrors the backend's /auth route shape. We only model what we actually use.
export type Session = {
    sessionId: string
    expiresAt: number       // ms-since-epoch
    eamUsername: string
}

export async function loginEam(eamUsername: string, eamPassword: string): Promise<Session> {
    return await apiCall<Session>("/auth/login", {
        method: "POST",
        body: { eamUsername, eamPassword },
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
