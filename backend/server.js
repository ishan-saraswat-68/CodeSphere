import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import { YSocketIO } from "y-socket.io/dist/server"
import cors from "cors"

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static("public"))

// Judge0 Execution Proxy Endpoint
app.post("/api/execute", async (req, res) => {
  const { languageId, sourceCode } = req.body

  if (!languageId || sourceCode === undefined) {
    return res.status(400).json({ error: "languageId and sourceCode are required" })
  }

  const apiKey = process.env.RAPIDAPI_KEY || "YOUR_RAPIDAPI_KEY"

  if (!apiKey || apiKey === "YOUR_RAPIDAPI_KEY") {
    return res.status(401).json({
      error: "RAPIDAPI_KEY not configured. Set RAPIDAPI_KEY in backend environment or pass your RapidAPI key."
    })
  }

  try {
    const response = await fetch("https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com"
      },
      body: JSON.stringify({
        language_id: languageId,
        source_code: sourceCode
      })
    })

    const data = await response.json()

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || "Execution request failed"
      })
    }

    const output = data.stdout || data.stderr || data.compile_output || data.message || "Executed with no output."
    return res.status(200).json({ output, status: data.status?.description })
  } catch (err) {
    return res.status(500).json({ error: "Failed to connect to Judge0 execution service: " + err.message })
  }
})

const httpServer = createServer(app)

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: [ "GET", "POST" ]
    }
})

const ySocketIO = new YSocketIO(io)
ySocketIO.initialize()

app.get('/health', (req, res) => {
    res.status(200).json({
        message: "ok",
        success: true
    })
})

const PORT = process.env.PORT || 3000
httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})