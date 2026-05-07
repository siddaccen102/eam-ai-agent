import { Router, Request, Response } from "express"
import { chatComplete } from "../services/llmClient"
import { getWorkdayUserByEmail } from "../services/workdayClient"
import { getEamOrganizations } from "../services/eamClient"
import { resolveOrg } from "../services/orgMatcher"
import {
    IntegrationError,
    integrationErrorHttpStatus
} from "../errors/integrationError"

const router = Router()

// GET /smoke?prompt=Say hello in five words
router.get("/smoke", async (req: Request, res: Response) => {
    const prompt = typeof req.query.prompt === "string" ? req.query.prompt : "Say hello in five words"

    try {
        const reply = await chatComplete([
            { role: "system", content: "You are a terse assistant. Reply in one short sentence." },
            { role: "user", content: prompt },
        ])
        return res.send({
            status: "ok",
            provider: "llm",
            prompt,
            reply,
        })
    } catch (err) {
        if (err instanceof IntegrationError) {
            return res.status(integrationErrorHttpStatus(err)).send(err.toJSON())
        }
        return res.status(500).send({
            code: "INTERNAL_ERROR",
            message: "Unexpected error during LLM smoke test",
        })
    }
})

// GET /smoke/match-org?email=leticia.sales@vopak.com
// Showcase: Workday user lookup -> EAM org list -> AI match -> typed OrgResolution.
router.get("/smoke/match-org", async (req: Request, res: Response) => {
    const email = typeof req.query.email === "string" ? req.query.email : undefined
    if (!email) {
        return res.status(400).send({
            code: "VALIDATION_ERROR",
            message: "email query parameter is required",
        })
    }

    try {
        const user = await getWorkdayUserByEmail(email)
        const orgList = await getEamOrganizations()
        const resolution = await resolveOrg(user, orgList.records)
        return res.send({
            status: "ok",
            input: { email, location: user.location, company: user.company },
            candidatesCount: orgList.records.length,
            truncated: orgList.truncated,
            resolution,
        })
    } catch (err) {
        if (err instanceof IntegrationError) {
            return res.status(integrationErrorHttpStatus(err)).send(err.toJSON())
        }
        return res.status(500).send({
            code: "INTERNAL_ERROR",
            message: "Unexpected error during org match smoke test",
        })
    }
})

export default router
