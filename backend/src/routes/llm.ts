import { Router, Request, Response } from "express"
import { chatComplete } from "../services/llmClient"
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

export default router
