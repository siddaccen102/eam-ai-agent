import { Router, Request, Response } from "express"
import { getEamCollection } from "../services/eamClient"
import { toEquipmentOption, EamAssetRaw } from "../services/eamMappers"
import {
    IntegrationError,
    integrationErrorHttpStatus
} from "../errors/integrationError"

const router = Router()

// GET /smoke/assets[?<any-eam-supported-param>]
// Returns canonical EquipmentOption[] - vendor-free, frontend-ready.
router.get("/smoke/assets", async (req: Request, res: Response) => {
    try {
        const collection = await getEamCollection<EamAssetRaw>(
            "/assets",
            req.query as Record<string, unknown>
        )
        const records = collection.records.map(toEquipmentOption)
        return res.send({
            status: "ok",
            provider: "eam",
            params: req.query,
            records,
            total: collection.total,
            cursor: collection.cursor,
            entityName: collection.entityName
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
