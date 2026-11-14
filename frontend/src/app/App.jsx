import "./App.css"
import { Editor } from "@monaco-editor/react"
import { MonacoBinding } from "y-monaco"
import { useMemo, useState, useEffect, useRef } from "react"
import * as Y from "yjs"
import { SocketIOProvider } from "y-socket.io"

const LANGUAGE_CONFIG = {
  plaintext: {
    languageId: null,
    monacoLang: "plaintext",
    label: "Plain Text",
    isExecutable: false
  },
  javascript: {
    languageId: 63, // JavaScript (Node.js)
    monacoLang: "javascript",
    label: "JavaScript (Node.js)",
    isExecutable: true
  },
  typescript: {
    languageId: 74, // TypeScript
    monacoLang: "typescript",
    label: "TypeScript",
    isExecutable: true
  },
  python: {
    languageId: 71, // Python 3
    monacoLang: "python",
    label: "Python 3",
    isExecutable: true
  },
  java: {
    languageId: 62, // Java (OpenJDK)
    monacoLang: "java",
    label: "Java (OpenJDK)",
    isExecutable: true
  },
  csharp: {
    languageId: 51, // C# (.NET Core)
    monacoLang: "csharp",
    label: "C# (.NET)",
    isExecutable: true
  },
  cpp: {
    languageId: 54, // C++ (GCC)
    monacoLang: "cpp",
    label: "C++ (GCC)",
    isExecutable: true
  },
  c: {
    languageId: 50, // C (GCC)
    monacoLang: "c",
    label: "C (GCC)",
    isExecutable: true
  },
  sql: {
    languageId: 82, // SQL (SQLite)
    monacoLang: "sql",
    label: "SQL (SQLite3)",
    isExecutable: true
  },
  go: {
    languageId: 60, // Go
    monacoLang: "go",
    label: "Go",
    isExecutable: true
  }
}

function App() {
  const editorRef = useRef(null)
  const monacoRef = useRef(null)

  // Language & Execution States
  const [selectedLanguage, setSelectedLanguage] = useState("javascript")
  const [output, setOutput] = useState("")
  const [isRunning, setIsRunning] = useState(false)
  const [isOutputOpen, setIsOutputOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Read URL query params
  const [username, setUsername] = useState(() => {
    return new URLSearchParams(window.location.search).get("username") || ""
  })
  const [roomId, setRoomId] = useState(() => {
    return new URLSearchParams(window.location.search).get("room") || ""
  })
  const [users, setUsers] = useState([])

  // Document instance tied to roomId
  const ydoc = useMemo(() => new Y.Doc(), [roomId])
  const yText = useMemo(() => ydoc.getText("monaco"), [ydoc])
  // Shared Yjs Map to synchronize room metadata (selected language) across all users in real time
  const yMeta = useMemo(() => ydoc.getMap("meta"), [ydoc])

  // Sync language changes across all users in the room via Yjs
  useEffect(() => {
    const handleMetaChange = () => {
      const roomLang = yMeta.get("language")
      if (roomLang && LANGUAGE_CONFIG[roomLang]) {
        setSelectedLanguage(roomLang)
      }
    }

    const existingLang = yMeta.get("language")
    if (existingLang && LANGUAGE_CONFIG[existingLang]) {
      setSelectedLanguage(existingLang)
    }

    yMeta.observe(handleMetaChange)
    return () => {
      yMeta.unobserve(handleMetaChange)
    }
  }, [yMeta])

  // Immediately update Monaco's syntax highlighting model when selectedLanguage changes
  useEffect(() => {
    if (editorRef.current && monacoRef.current) {
      const model = editorRef.current.getModel()
      const langConfig = LANGUAGE_CONFIG[selectedLanguage]
      if (model && langConfig) {
        monacoRef.current.editor.setModelLanguage(model, langConfig.monacoLang)
      }
    }
  }, [selectedLanguage])

  const handleLanguageChange = (newLang) => {
    setSelectedLanguage(newLang)
    yMeta.set("language", newLang)
  }

  const handleMount = (editorInstance, monacoInstance) => {
    editorRef.current = editorInstance
    monacoRef.current = monacoInstance

    const model = editorInstance.getModel()
    if (model) {
      // Force LF to prevent cross-platform CRLF vs LF desync (Windows vs macOS)
      model.setEOL(monacoInstance?.editor?.EndOfLineSequence?.LF ?? 0)
    }

    new MonacoBinding(
      yText,
      editorInstance.getModel(),
      new Set([editorInstance]),
    )
  }

  const handleGenerateRoom = () => {
    const randomId = "room-" + Math.random().toString(36).substring(2, 8)
    setRoomId(randomId)
  }

  const handleJoin = (e) => {
    e.preventDefault()
    const enteredUsername = e.target.username.value.trim()
    const enteredRoomId = e.target.room.value.trim().toLowerCase()

    if (!enteredUsername || !enteredRoomId) return

    setUsername(enteredUsername)
    setRoomId(enteredRoomId)
    window.history.pushState(
      {},
      "",
      `?room=${encodeURIComponent(enteredRoomId)}&username=${encodeURIComponent(enteredUsername)}`
    )
  }

  const copyInviteLink = () => {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleLeaveRoom = () => {
    setUsername("")
    window.history.pushState({}, "", roomId ? `?room=${encodeURIComponent(roomId)}` : window.location.pathname)
  }

  // Manage dynamic SocketIOProvider for the specific Room
  useEffect(() => {
    if (username && roomId) {
      const provider = new SocketIOProvider("/", roomId, ydoc, {
        autoConnect: true,
      })

      provider.awareness.setLocalStateField("user", { username })

      const updateUsers = () => {
        const states = Array.from(provider.awareness.getStates().values())
        setUsers(states.filter(state => state.user && state.user.username).map(state => state.user))
      }

      updateUsers()
      provider.awareness.on("change", updateUsers)

      function handleBeforeUnload() {
        provider.awareness.setLocalStateField("user", null)
      }

      window.addEventListener("beforeunload", handleBeforeUnload)

      return () => {
        provider.awareness.off("change", updateUsers)
        provider.disconnect()
        window.removeEventListener("beforeunload", handleBeforeUnload)
      }
    }
  }, [username, roomId, ydoc])

  const handleRunCode = async () => {
    if (!editorRef.current) return

    const code = editorRef.current.getValue()
    const config = LANGUAGE_CONFIG[selectedLanguage]

    if (!config?.isExecutable || !config.languageId) return

    setIsRunning(true)
    setIsOutputOpen(true)
    setOutput("Executing code via Judge0 cloud sandbox...")

    try {
      const response = await fetch("/api/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          languageId: config.languageId,
          sourceCode: code,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setOutput(data.output || "Program executed successfully with no output.")
      } else {
        setOutput(data.error || "Execution failed.")
      }
    } catch (error) {
      setOutput("Network error: Failed to connect to backend execution service.")
    } finally {
      setIsRunning(false)
    }
  }

  // Lobby Screen
  if (!username || !roomId) {
    return (
      <main className="h-screen w-full bg-gray-950 flex gap-4 p-4 items-center justify-center">
        <form
          onSubmit={handleJoin}
          className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Enter your username"
            className="p-2 rounded-lg bg-gray-800 text-white"
            name="username"
            defaultValue={username}
            required
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Room ID"
              className="p-2 rounded-lg bg-gray-800 text-white flex-1"
              name="room"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={handleGenerateRoom}
              className="p-2 rounded-lg bg-gray-700 text-white text-xs font-bold cursor-pointer"
            >
              New Room
            </button>
          </div>
          <button
            type="submit"
            className="p-2 rounded-lg bg-amber-50 text-gray-950 font-bold cursor-pointer"
          >
            Join
          </button>
        </form>
      </main>
    )
  }

  // Collaborative IDE Screen
  return (
    <main className="h-screen w-full bg-gray-950 flex gap-4 p-4">
      {/* Sidebar */}
      <aside className="h-full w-1/4 bg-amber-50 rounded-lg flex flex-col justify-between">
        <div>
          <div className="p-4 border-b border-gray-300 flex justify-between items-center">
            <h2 className="text-2xl font-bold">Users</h2>
            <span className="text-xs bg-gray-800 text-white px-2 py-1 rounded">
              Room: {roomId}
            </span>
          </div>
          <ul className="p-4">
            {users.map((user, index) => (
              <li key={index} className="p-2 bg-gray-800 text-white rounded mb-2">
                {user.username}
              </li>
            ))}
          </ul>
        </div>

        <div className="p-4 border-t border-gray-300 flex flex-col gap-2">
          <button
            onClick={copyInviteLink}
            className="w-full p-2 bg-gray-950 text-white rounded font-bold text-sm cursor-pointer"
          >
            {copied ? "Link Copied!" : "Copy Invite Link"}
          </button>
          <button
            onClick={handleLeaveRoom}
            className="w-full p-2 bg-red-600 hover:bg-red-700 text-white rounded font-bold text-sm cursor-pointer transition"
          >
            Leave Room
          </button>
        </div>
      </aside>

      {/* Editor & Control Panel */}
      <section className="w-3/4 bg-neutral-800 rounded-lg overflow-hidden flex flex-col border border-neutral-700">
        {/* Top Control Bar: Language Selector & Run Button */}
        <div className="p-2.5 bg-neutral-900 border-b border-neutral-700 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-300 font-bold uppercase tracking-wider">
              Language:
            </label>
            <select
              value={selectedLanguage}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="bg-neutral-800 text-white text-xs p-1.5 rounded border border-neutral-700 focus:outline-none cursor-pointer"
            >
              {Object.entries(LANGUAGE_CONFIG).map(([key, config]) => (
                <option key={key} value={key}>
                  {config.label}
                </option>
              ))}
            </select>
          </div>

          {LANGUAGE_CONFIG[selectedLanguage]?.isExecutable && (
            <button
              onClick={handleRunCode}
              disabled={isRunning}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-1.5 rounded font-bold text-xs cursor-pointer transition flex items-center gap-1.5"
            >
              {isRunning ? "Running..." : "▶ Run Code"}
            </button>
          )}
        </div>

        {/* Monaco Editor */}
        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            language={LANGUAGE_CONFIG[selectedLanguage].monacoLang}
            defaultValue="// Start coding here..."
            theme="vs-dark"
            onMount={handleMount}
          />
        </div>

        {/* Collapsible Output Terminal */}
        {isOutputOpen && (
          <div className="h-44 bg-neutral-950 border-t border-neutral-700 flex flex-col">
            <div className="px-3 py-1.5 bg-neutral-900 flex justify-between items-center border-b border-neutral-800">
              <span className="text-xs text-gray-300 font-mono font-bold">Terminal Output</span>
              <button
                onClick={() => setIsOutputOpen(false)}
                className="text-gray-400 hover:text-white text-xs cursor-pointer px-1"
              >
                ✕ Close
              </button>
            </div>
            <pre className="p-3 text-xs font-mono text-green-400 overflow-auto flex-1 whitespace-pre-wrap">
              {output}
            </pre>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
