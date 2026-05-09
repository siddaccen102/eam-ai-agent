import { Request, Response, NextFunction } from "express"
import { getSession } from "../services/sessionStore"
import { AuthContext } from "../types/auth"

// Augment Express's Request type so route handlers can read req.auth without
// per-handler casts. The augmentation lives next to the middleware that
// populates the field - keeps "what fills it" and "what reads it" in one place.
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            auth?: AuthContext
        }
    }
}

const BEARER_RE = /^Bearer\s+(.+)$/i

// requireAuth - extracts the bearer session id from Authorization, looks up the
// session, attaches it to req.auth. 401s if the header is missing or the
// session is expired/unknown. Using the standard Authorization: Bearer header
// (instead of a custom X-Session-Id) gives us forward-compat: when Option C
// (SSO) lands, the same header will carry an SSO JWT - frontend doesn't change.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.header("authorization") ?? ""
    const match = BEARER_RE.exec(header)
    if (!match) {
        res.status(401).send({
            code: "AUTH_REQUIRED",
            message: "Authorization: Bearer <sessionId> header required",
        })
        return
    }
    const ctx = getSession(match[1])
    if (!ctx) {
        res.status(401).send({
            code: "AUTH_INVALID",
            message: "session not found or expired",
        })
        return
    }
    req.auth = ctx
    next()
}
