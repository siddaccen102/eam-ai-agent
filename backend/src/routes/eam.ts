import { Router, Request, Response } from "express"
import { getEam } from "../services/eamClient"
import {
    IntegrationError,
    integrationErrorHttpStatus
} from "../errors/integrationError"

const router = Router()

// GET /smoke/assets[?<any-eam-supported-param>]
// Pass-through to EAM /assets, returning raw EAM envelope
// Real shape: { Result: { ResultData: { DATARECORD: [...] } } }
router.get("/smoke/assets", async (req: Request, res: Response) => {
    try {
        const data = await getEam("/assets", req.query as Record<string, unknown>)
        return res.send({
            status: "ok",
            provider: "eam",
            params: req.query,
            data
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