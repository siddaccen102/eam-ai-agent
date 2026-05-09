import { Router, Request, Response } from "express"
import { getEam } from "../services/eamClient"
import {
    createSession,
    deleteSession,
    getSession,
} from "../services/sessionStore"
import { IntegrationError } from "../errors/integrationError"

const router = Router()
const BEARER_RE = /^Bearer\s+(.+)$/i

// POST /login - validates EAM creds eagerly by hitting /positions, mints a
// session on success. Eager validation means bad creds get rejected at login
// rather than 30s later when the user clicks "show me equipment". The cost
// is one extra round-trip per login, which is fair insurance for UX clarity.
router.post("/login", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { eamUsername?: unknown; eamPassword?: unknown }
    // Normalize username to uppercase. EAM's Basic auth is case-insensitive so
    // login works either way, but path parameters like /usersetup/{user}/...
    // ARE case-sensitive: EAM returns a 200 with no DATARECORD for an unknown
    // (lowercased) user, which surfaces downstream as CONTRACT_MAPPING_ERROR.
    // Normalizing once here keeps every helper (and every URL path) on the
    // canonical form without each caller having to remember.
    const eamUsername = typeof body.eamUsername === "string" ? body.eamUsername.trim().toUpperCase() : ""
    const eamPassword = typeof body.eamPassword === "string" ? body.eamPassword : ""

    if (!eamUsername || !eamPassword) {
        return res.status(400).send({
            code: "VALIDATION_ERROR",
            message: "eamUsername and eamPassword required in JSON body",
        })
    }

    try {
        // We don't care about the response body - only that EAM accepts the auth.
        await getEam("/positions", { username: eamUsername, password: eamPassword })

        const ctx = createSession({ username: eamUsername, password: eamPassword })
        return res.send({
            sessionId: ctx.sessionId,
            expiresAt: ctx.expiresAt,
            eamUsername: ctx.eamAuth.username,
        })
    } catch (err) {
        if (err instanceof IntegrationError) {
            // EAM returns BOTH 401 (bad password) and 400 (e.g., "Role is invalid.
            // Cannot log in to the system." for unknown users) for credential
            // failures. Treating 400 as auth-failure for login is correct UX -
            // either way, the user typed something EAM rejected.
            const upstreamStatus =
                typeof err.details?.status === "number" ? err.details.status : undefined
            const isAuthFailure =
                err.code === "UPSTREAM_AUTH_FAILED" ||
                err.code === "UPSTREAM_FORBIDDEN" ||
                upstreamStatus === 400
            if (isAuthFailure) {
                return res.status(401).send({
                    code: "AUTH_FAILED",
                    message: "EAM rejected the credentials",
                })
            }
            if (err.code === "UPSTREAM_TIMEOUT") {
                return res.status(504).send({
                    code: "UPSTREAM_TIMEOUT",
                    message: "EAM is slow right now - please try again",
                })
            }
            return res.status(502).send({
                code: "UPSTREAM_ERROR",
                message: "Could not validate credentials with EAM",
                upstream: err.code,
            })
        }
        return res.status(500).send({
            code: "INTERNAL_ERROR",
            message: "Unexpected error during login",
        })
    }
})

// POST /logout - invalidates the session. Idempotent: missing or unknown
// session id still returns 200 (logout should never fail loudly).
router.post("/logout", (req: Request, res: Response) => {
    const header = req.header("authorization") ?? ""
    const match = BEARER_RE.exec(header)
    if (match) deleteSession(match[1])
    return res.send({ status: "ok" })
})

// GET /me - whether the current session is valid + the username (NEVER the
// password). Useful for the frontend to hydrate "Logged in as ..." state.
router.get("/me", (req: Request, res: Response) => {
    const header = req.header("authorization") ?? ""
    const match = BEARER_RE.exec(header)
    if (!match) {
        return res.status(401).send({ code: "AUTH_REQUIRED" })
    }
    const ctx = getSession(match[1])
    if (!ctx) {
        return res.status(401).send({ code: "AUTH_INVALID" })
    }
    return res.send({
        sessionId: ctx.sessionId,
        expiresAt: ctx.expiresAt,
        eamUsername: ctx.eamAuth.username,
    })
})

export default router
