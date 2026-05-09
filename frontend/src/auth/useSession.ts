import { useContext } from "react"
import { SessionContext } from "./SessionContext"
import { loginEam, logoutEam } from "../api/auth"

// useSession - what every authenticated component reaches for. Returns the
// current session (or null), the status (checking/anonymous/authenticated),
// and login/logout actions that update the provider in one place.
//
// Why login/logout live here instead of in api/auth.ts:
//   The api helpers are pure transport. Reaching out to localStorage and
//   the React context is application-level glue - belongs in the hook
//   that knows about both worlds.
export function useSession() {
    const ctx = useContext(SessionContext)
    if (!ctx) {
        throw new Error("useSession must be used inside <SessionProvider>")
    }

    async function login(eamUsername: string, eamPassword: string) {
        const fresh = await loginEam(eamUsername, eamPassword)
        ctx!.setSession(fresh)
    }

    async function logout() {
        if (ctx!.session) {
            try {
                await logoutEam(ctx!.session.sessionId)
            } catch {
                // Logout is idempotent; backend tolerates unknown sessions.
                // We always clear local state regardless of upstream outcome.
            }
        }
        ctx!.setSession(null)
    }

    return {
        status: ctx.status,
        session: ctx.session,
        login,
        logout,
    }
}
