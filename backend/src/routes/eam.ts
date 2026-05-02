import { Router, Request, Response } from "express"
import { getEamCollection, getEamOrganizations } from "../services/eamClient"
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


// GET /smoke/organizations
// Returns the canonical EAM organization list - vendor-free, AI-matcher-ready
router.get("/smoke/organizations", async (req: Request, res: Response) =>{
    try {
        const result = await getEamOrganizations()
        return res.send({
            status: "ok",
            provider: "eam",
            ...result
        })
    } catch (err) {
        if (err instanceof IntegrationError) {
            return res.status(integrationErrorHttpStatus(err)).send(err.toJSON())
        }
        return res.status(500).send({
            code: "INTERNAL_ERROR",
            message: "Unexpected error during EAM organization smoke test"
        })
    }
})

export default router
