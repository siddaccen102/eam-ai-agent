import express from "express";
import { env } from "./config/env";

const app = express()

const PORT = Number(env.PORT)

// app.use(path)

app.get("/health", (req, res) => {
    res.send({
        "status": "ok",
        "service": "backend",
        "timestamp": new Date().toISOString()
    })
})

app.listen(env.PORT, () => console.log(`Server running on PORT: ${PORT}...`))
