import express from "express";
import "dotenv/config";

const app = express()

const PORT = Number(process.env.PORT)

// app.use(path)

app.get("/health", (req, res) => {
    res.send({
        "status": "ok",
        "service": "backend",
        "timestamp": new Date()
    })
})

app.listen(PORT, () => console.log(`Server running on PORT: ${PORT}...`))
