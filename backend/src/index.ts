import express from "express";
import { env } from "./config/env";
import workdayRouter from "./routes/workday"

const app = express()

// to add JSON body parsing on every route
app.use(express.json())

// mount the router
app.use("/integrations/workday", workdayRouter)

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
