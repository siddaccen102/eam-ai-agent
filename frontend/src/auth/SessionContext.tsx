import { createContext, useEffect, useState, ReactNode } from "react"
import { Session, fetchMe } from "../api/auth"

// localStorage key. Namespaced to avoid colliding with anything else the
// browser might have stored for this origin in dev.
const STORAGE_KEY = "eam-ai-agent.session"

// Three discrete states. "checking" is the initial state while we verify a
// stored session via /auth/me - the App renders a spinner during this window.
// Without it, a user who reloads with a valid session would see the login
// form flash before snapping to the authenticated shell.
export type SessionStatus = "checking" | "anonymous" | "authenticated"

export type SessionContextValue = {
    status: SessionStatus
    session: Session | null
    setSession: (s: Session | null) => void
}

export const SessionContext = createContext<SessionContextValue | null>(null)

function readStored(): Session | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as Partial<Session>
        if (typeof parsed?.sessionId !== "string") return null
        if (typeof parsed?.expiresAt !== "number") return null
        if (typeof parsed?.eamUsername !== "string") return null
        // email + displayName are required as of the email-based login change.
        // Older stored sessions (from before the change) lack them - treat as
        // invalid and force re-login. Cheap to detect, no migration needed.
        if (typeof parsed?.email !== "string") return null
        if (typeof parsed?.displayName !== "string") return null
        return parsed as Session
    } catch {
        // Corrupted storage. Clear and start fresh.
        return null
    }
}

function writeStored(s: Session | null): void {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    else localStorage.removeItem(STORAGE_KEY)
}

export function SessionProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<SessionStatus>("checking")
    const [session, setSessionState] = useState<Session | null>(null)

    // On mount: check localStorage. If a session is stored, validate it via
    // /auth/me before trusting it (the backend's in-memory store may have
    // restarted, the TTL may have elapsed, etc.). Either way we end up in
    // anonymous OR authenticated, never indefinitely in checking.
    useEffect(() => {
        const stored = readStored()
        if (!stored) {
            setStatus("anonymous")
            return
        }
        let cancelled = false
        fetchMe(stored.sessionId)
            .then((fresh) => {
                if (cancelled) return
                setSessionState(fresh)
                writeStored(fresh)
                setStatus("authenticated")
            })
            .catch(() => {
                if (cancelled) return
                writeStored(null)
                setSessionState(null)
                setStatus("anonymous")
            })
        return () => {
            cancelled = true
        }
    }, [])

    function setSession(s: Session | null) {
        setSessionState(s)
        writeStored(s)
        setStatus(s ? "authenticated" : "anonymous")
    }

    return (
        <SessionContext.Provider value={{ status, session, setSession }}>
            {children}
        </SessionContext.Provider>
    )
}
