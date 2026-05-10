import { Router, Request, Response } from "express"
import { getEam } from "../services/eamClient"
import { getWorkdayUserByEmail } from "../services/workdayClient"
import {
    createSession,
    deleteSession,
    getSession,
} from "../services/sessionStore"
import { IntegrationError } from "../errors/integrationError"

const router = Router()
const BEARER_RE = /^Bearer\s+(.+)$/i

// Derive the canonical EAM username from a Vopak email. EAM stores usernames
// in uppercase form ("RASHID.SIDDIQUI"), and convention at Vopak is that the
// EAM username matches the local part of the user's @vopak.com email. We do
// the derivation server-side so the user never has to know the EAM username
// exists - one identity (email), one credential (password), the bot maps it
// to whatever the downstream systems need.
//
// Returns "" when the email has no usable local part; the route treats that
// as a 400 VALIDATION_ERROR rather than punting to Workday/EAM with garbage.
function deriveEamUsername(email: string): string {
    const at = email.indexOf("@")
    if (at <= 0) return ""
    return email.slice(0, at).toUpperCase()
}

// POST /login - two-step validation:
//   1) Workday lookup by email (does this Vopak person exist + are they active?)
//   2) EAM cred check (does the typed password work for the derived username?)
//
// Two-step lets us return DISTINCT errors for "email not recognized" vs "EAM
// password rejected" - the user can self-diagnose typos. Inactive Workday
// users get rejected at login (USER_INACTIVE) instead of being allowed to log
// in only to have the agent reject every run. Cheaper UX, fewer round-trips.
router.post("/login", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { email?: unknown; eamPassword?: unknown }
    const email =
        typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    const eamPassword =
        typeof body.eamPassword === "string" ? body.eamPassword : ""

    if (!email || !eamPassword) {
        return res.status(400).send({
            code: "VALIDATION_ERROR",
            message: "email and eamPassword required in JSON body",
        })
    }

    const eamUsername = deriveEamUsername(email)
    if (!eamUsername) {
        return res.status(400).send({
            code: "VALIDATION_ERROR",
            message: "email must be a valid address with a local part before @",
        })
    }

    // ---- Step 1: Workday lookup --------------------------------------------
    let user
    try {
        user = await getWorkdayUserByEmail(email)
    } catch (err) {
        if (err instanceof IntegrationError) {
            if (err.code === "RESOURCE_NOT_FOUND") {
                return res.status(401).send({
                    code: "EMAIL_NOT_FOUND",
                    message: "We don't recognize this email. Check for typos or use your Vopak (mypulse) address.",
                })
            }
            if (err.code === "USER_INACTIVE") {
                return res.status(403).send({
                    code: "USER_INACTIVE",
                    message: "Your Vopak account is inactive. Contact your administrator.",
                })
            }
            if (err.code === "UPSTREAM_TIMEOUT") {
                return res.status(504).send({
                    code: "UPSTREAM_TIMEOUT",
                    message: "Workday is slow right now - please try again",
                })
            }
            return res.status(502).send({
                code: "UPSTREAM_ERROR",
                message: "Could not look up the user in Workday",
                upstream: err.code,
            })
        }
        return res.status(500).send({
            code: "INTERNAL_ERROR",
            message: "Unexpected error looking up the user",
        })
    }

    // ---- Step 2: EAM credential check --------------------------------------
    // We only need EAM to ACCEPT the auth - response body is irrelevant.
    try {
        await getEam("/positions", {
            username: eamUsername,
            password: eamPassword,
        })
    } catch (err) {
        if (err instanceof IntegrationError) {
            // EAM returns 401 for bad password and 400 ("Role is invalid")
            // when the username is unknown to EAM. From the user's POV both
            // mean "EAM didn't accept your credentials" - distinct error
            // code from EMAIL_NOT_FOUND so they know to check the password.
            const upstreamStatus =
                typeof err.details?.status === "number"
                    ? err.details.status
                    : undefined
            const isAuthFailure =
                err.code === "UPSTREAM_AUTH_FAILED" ||
                err.code === "UPSTREAM_FORBIDDEN" ||
                upstreamStatus === 400
            if (isAuthFailure) {
                return res.status(401).send({
                    code: "EAM_AUTH_FAILED",
                    message: "EAM rejected the password for this user.",
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
            message: "Unexpected error during EAM credential check",
        })
    }

    // ---- Both validations passed - mint the session ------------------------
    const ctx = createSession({
        eamAuth: { username: eamUsername, password: eamPassword },
        email: user.email,
        displayName: user.displayName,
    })
    return res.send({
        sessionId: ctx.sessionId,
        expiresAt: ctx.expiresAt,
        email: ctx.email,
        displayName: ctx.displayName,
        eamUsername: ctx.eamAuth.username,
    })
})

// POST /logout - invalidates the session. Idempotent: missing or unknown
// session id still returns 200 (logout should never fail loudly).
router.post("/logout", (req: Request, res: Response) => {
    const header = req.header("authorization") ?? ""
    const match = BEARER_RE.exec(header)
    if (match) deleteSession(match[1])
    return res.send({ status: "ok" })
})

// GET /me - whether the current session is valid + the user identity (NEVER
// the password). Useful for the frontend to hydrate "Logged in as ..." state.
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
        email: ctx.email,
        displayName: ctx.displayName,
        eamUsername: ctx.eamAuth.username,
    })
})

export default router
