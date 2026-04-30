import { Router, Request, Response } from "express"
import { getEamCollection } from "../services/eamClient"
import {
    IntegrationError,
    integrationErrorHttpStatus
} from "../errors/integrationError"

const router = Router()

// GET /smoke/assets[?<any-eam-supported-param>]
// Returns clean { records, total, cursor, entityName } shape.
// Upstream Result.ResultData envelope is unwrapped inside the adapter.
router.get("/smoke/assets", async (req: Request, res: Response) => {
    try {
        // unknown for the per-record type - narrowing is Mini 4.7's job
        const result = await getEamCollection<unknown>(
            "/assets",
            req.query as Record<string, unknown>
        )
        return res.send({
            status: "ok",
            provider: "eam",
            params: req.query,
            ...result
        })
    } catch (err) {
        if (err instanceof IntegrationError) {
            return res.status(integrationErrorHttpStatus(err)).send(err.toJSON())
        }
        // fallback if nothing worked
        return res.status(500).send({
            code: "INTERNAL_ERROR",
            message: "Unexpected error during EAM assets smoke test"
        })
    }
})

export default router
