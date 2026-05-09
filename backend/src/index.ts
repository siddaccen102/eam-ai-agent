import express from "express";
import { env } from "./config/env";
import workdayRouter from "./routes/workday"
import eamRouter from "./routes/eam"
import llmRouter from "./routes/llm"
import authRouter from "./routes/auth"

const app = express()

// to add JSON body parsing on every route
app.use(express.json())

// mount the router
app.use("/auth", authRouter)
app.use("/integrations/workday", workdayRouter)
app.use("/integrations/eam", eamRouter)
app.use("/integrations/llm", llmRouter)

const PORT = Number(env.PORT)

app.get("/health", (req, res) => {
    res.send({
        "status": "ok",
        "service": "backend",
        "timestamp": new Date().toISOString()
    })
})

app.listen(env.PORT, () => console.log(`Server running on PORT: ${PORT}...`))
