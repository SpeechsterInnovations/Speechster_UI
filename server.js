// server.js — Speechster Cloud API (Express + ws)
// CommonJS, pkg-aware, single-ESP mode, HTTP(S), WebSocket
const fs = require("fs");
const https = require("https");
const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");
const path = require("path");
const { spawn } = require("child_process");

// ─────────────────────────────────────────────
// Speechster Backend — Safe Launcher (pkg-aware)
// ─────────────────────────────────────────────
//
// When running from source (`node server.js`) → enables self-restart.
// When running as a packaged binary (`pkg`) → disables launcher (runs once).
//

let currentDeviceId = null;
let lastTelemetry = null;
let currentCommand = null;
let lastAudioFiles = [];


if (!process.pkg && process.argv[2] !== "--child") {
  const { spawn } = require("child_process");
  const execPath = process.execPath;
  const scriptArg = process.argv[1];
  const childArgs = [scriptArg, "--child", ...process.argv.slice(2)];

  console.log("Spawning server child:", execPath, childArgs.join(" "));
  const child = spawn(execPath, childArgs, { stdio: "inherit" });

  child.on("exit", (code, signal) => {
    if (signal === "SIGINT" || signal === "SIGTERM" || code === 0) {
      console.log("Child exited cleanly — exiting parent.");
      process.exit(0);
    } else {
      console.log(`💥 Child crashed (code ${code}, signal ${signal}). Restarting in 3 s...`);
      setTimeout(() => {
        spawn(execPath, childArgs, { stdio: "inherit" });
      }, 3000);
    }
  });

  process.exit();
}
// ─────────────────────────────────────────────
// End launcher — actual server code begins below
// ─────────────────────────────────────────────

// -------------------------------
// pkg-aware path resolver
// -------------------------------
function resolvePath(rel) {
  // When packaged with pkg, assets are typically copied next to the binary by your packaging script.
  // Use the binary directory (process.execPath) when packaged; otherwise use __dirname.
  if (process.pkg) {
    return path.join(path.dirname(process.execPath), rel);
  } else {
    return path.join(__dirname, rel);
  }
}

// -------------------------------
// Config (env overrides)
 // -------------------------------
const HTTP_PORT = Number(process.env.HTTP_PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const DATA_DIR = process.env.DATA_DIR || resolvePath("data");
const API_KEY = process.env.SPEECHSTER_API_KEY || "";

// Ensure data folder exists
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

// -------------------------------
// open browser helper
// -------------------------------
const { exec: execChild } = require("child_process");
function openBrowser(url) {
  try {
    const platform = process.platform;
    if (platform === "win32") execChild(`start "" "${url}"`);
    else if (platform === "darwin") execChild(`open "${url}"`);
    else execChild(`xdg-open "${url}"`);
  } catch (e) {
    console.warn("openBrowser failed:", e && e.message);
  }
}

// -------------------------------
// Express + servers
// -------------------------------
const app = express();

let SSL_OPTS = null;
try {
  // Look for certs in ./certs/ as relative to repo or binary
  SSL_OPTS = {
    key: fs.readFileSync(resolvePath("certs/localhost+3-key.pem")),
    cert: fs.readFileSync(resolvePath("certs/localhost+3.pem")),
  };
} catch (err) {
  console.warn("HTTPS certs not found at certs/localhost+3-*.pem. HTTPS will not start unless certs are present.", err.message);
  SSL_OPTS = null;
}

const httpServer = http.createServer(app);
const httpsServer = SSL_OPTS ? https.createServer(SSL_OPTS, app) : null;

// WebSocket servers
const wssHttp = new WebSocketServer({ server: httpServer, path: "/ws" });
const wssHttps = httpsServer ? new WebSocketServer({ server: httpsServer, path: "/ws" }) : null;

// ─────────────────────────────
// Real-time audio WebSocket (minimal / safe handler)
// ─────────────────────────────
const wssAudio = new WebSocketServer({ server: httpServer, path: "/data/audio" });
const wssAudioHttps = httpsServer ? new WebSocketServer({ server: httpsServer, path: "/data/audio" }) : null;

function startAudioHandler(wss) {
  if (!wss) return;
  wss.on("connection", (ws) => {
    console.log("🎧 Audio stream connected");
    // create a per-connection session file in the device folder
    const deviceId = currentDeviceId || "esp_unknown";
    const { audioDir } = ensureDeviceFolder(deviceId);
    const sessionId = crypto.randomUUID();
    const filename = `stream_${sessionId}.raw`;
    const outPath = path.join(audioDir, filename);

    // create a writable stream (non-blocking)
    let fileStream;
    try {
      fileStream = fs.createWriteStream(outPath);
    } catch (e) {
      console.error("Failed to open audio file for writing:", e);
      ws.close(1011, "server-error");
      return;
    }

    ws.on("message", (chunk) => {
      try {
        if (Buffer.isBuffer(chunk)) {
          fileStream.write(chunk);
        } else {
          // keep existing control JSON handling for this socket (if JSON arrives here)
          // ignore or log non-binary messages for audio stream sockets
          // (no-op to avoid interfering with control channel)
        }
      } catch (e) {
        console.warn("Audio write error:", e);
      }
    });

    ws.on("close", () => {
      try { fileStream.end(); } catch (e) {}
      console.log("Audio stream closed — saved:", outPath);

      // record in lastAudioFiles and notify UI same as upload endpoint does
      const ts = Date.now();
      lastAudioFiles.push({ device_id: deviceId, filename, ts });
      if (lastAudioFiles.length > 1000) lastAudioFiles.shift();

      emitToWebClients("esp.audio", { device_id: deviceId, filename, path: `/data/${deviceId}/audio/${filename}`, ts });
    });

    ws.on("error", (err) => {
      console.warn("Audio WS error:", err && err.message);
      try { fileStream.end(); } catch (e) {}
    });
  });
}

startAudioHandler(wssAudio);
startAudioHandler(wssAudioHttps);

// include audio WS servers so /status.ws_clients reflects them
function allClients() {
  const out = [];
  if (wssHttp) out.push(...wssHttp.clients);
  if (wssHttps) out.push(...wssHttps.clients);
  if (wssAudio) out.push(...wssAudio.clients);
  if (wssAudioHttps) out.push(...wssAudioHttps.clients);
  return out;
}

// -------------------------------
// Middleware & parsers
// -------------------------------
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fieldSize: 50 * 1024 * 1024 } });

// Optional redirect for Chrome to HTTPS when possible
app.use((req, res, next) => {
  if (httpsServer && !req.secure && req.headers["user-agent"]?.includes("Chrome")) {
    return res.redirect(`https://${req.hostname}:${HTTPS_PORT}${req.url}`);
  }
  next();
});

// require API key for sensitive routes if configured
function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const key = req.header("x-api-key") || req.query.key || req.header("authorization");
  if (!key) return res.status(401).json({ error: "Missing API key" });
  const raw = key.startsWith("Bearer ") ? key.slice(7) : key;
  if (raw !== API_KEY) return res.status(403).json({ error: "Invalid API key" });
  next();
}

// -------------------------------
// Helpers
// -------------------------------
function emitToWebClients(type, payload) {
  const msg = JSON.stringify({ type, payload });
  allClients().forEach((c) => {
    if (c.readyState === c.OPEN) c.send(msg);
  });
}

function ensureDeviceFolder(deviceId) {
  const safe = (deviceId || "unknown").replace(/[^a-zA-Z0-9_\-\.]/g, "_");
  const dir = path.join(DATA_DIR, safe);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const audioDir = path.join(dir, "audio");
  try { fs.mkdirSync(audioDir, { recursive: true }); } catch (e) {}
  return { dir, audioDir };
}

function safeListen(server, port, name) {
  server.listen(port, "0.0.0.0");
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} already in use (${name}).`);
      process.exit(1);
    }
  });
}

// -------------------------------
// Static serve for website (public) and data
// -------------------------------
const PUBLIC_DIR = resolvePath("public");
try { app.use(express.static(PUBLIC_DIR)); } catch (e) {}
app.get("/", (req, res) => {
  const indexPath = path.join(PUBLIC_DIR, "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.send("Speechster backend - no public/index.html found.");
});
app.use("/data", express.static(DATA_DIR)); // simple file serving for uploaded audio

// -------------------------------
// Existing control route (website -> server -> ESP)
// Single-slot command (overwrites previous)
// -------------------------------
app.post("/control", requireApiKey, (req, res) => {
  const { device_id, command } = req.body;
  if (!device_id || typeof command === "undefined") return res.status(400).json({ error: "Missing fields" });

  // If a different device_id is provided, set it as the currentDeviceId (single-ESP)
  currentDeviceId = device_id;
  const id = crypto.randomUUID();
  currentCommand = { command, id, ts: Date.now() };

  emitToWebClients("control.queued", { device_id: currentDeviceId, command, id });
  return res.json({ status: "queued", id });
});

// -------------------------------
// ESP telemetry: POST JSON
// -------------------------------
app.post("/esp/telemetry", (req, res) => {
  // allow but warn if API_KEY present
  if (API_KEY && req.header("x-api-key") !== API_KEY) {
    console.warn("esp/telemetry: missing/invalid api key (if you configured SPEECHSTER_API_KEY).");
    return res.status(401).json({ error: "Missing/invalid API key" });
  }

  const payload = req.body || {};
  const device_id = payload.device_id || payload.id || "esp_unknown";
  // Single-ESP policy: accept first seen device or overwrite if same
  if (!currentDeviceId) currentDeviceId = device_id;
  if (device_id !== currentDeviceId) {
    console.warn(`Telemetry received from unexpected device "${device_id}" while current is "${currentDeviceId}". Replacing current device.`);
    currentDeviceId = device_id;
  }

  lastTelemetry = { payload, ts: Date.now(), device_id };

  // Emit to web clients for parsing
  emitToWebClients("esp.telemetry", { device_id, payload });

  return res.json({ status: "ok" });
});

// -------------------------------
// ESP audio upload (multipart/form-data)
// form fields: device_id, optional metadata
// file field: file
// -------------------------------
app.post("/esp/upload", upload.single("file"), (req, res) => {
  const device_id = (req.body && req.body.device_id) || currentDeviceId || "esp_unknown";
  if (!req.file) return res.status(400).json({ error: "Missing file" });

  const { audioDir } = ensureDeviceFolder(device_id);
  const ts = Date.now();
  const filename = `upload_${ts}_${crypto.randomUUID().slice(0,8)}.raw`;
  const outPath = path.join(audioDir, filename);

  fs.writeFile(outPath, req.file.buffer, (err) => {
    if (err) {
      console.error("Failed to write upload:", err);
      return res.status(500).json({ error: "Write failed" });
    }
    lastAudioFiles.push({ device_id, filename, ts });
    // keep last N entries to avoid unbounded growth
    if (lastAudioFiles.length > 1000) lastAudioFiles.shift();

    emitToWebClients("esp.audio", { device_id, filename, path: `/data/${device_id}/audio/${filename}`, ts });
    return res.json({ status: "ok", filename });
  });
});

// -------------------------------
// ESP OTA/status
// -------------------------------
app.post("/esp/ota", (req, res) => {
  const payload = req.body || {};
  const device_id = payload.device_id || currentDeviceId || "esp_unknown";
  emitToWebClients("esp.ota", { device_id, payload });
  return res.json({ status: "ok" });
});

// -------------------------------
// ESP commands poll: GET /esp/commands?device_id=<id>
// Returns and clears currentCommand if device matches.
// -------------------------------
app.get("/esp/commands", (req, res) => {
  const device_id = req.query.device_id;
  if (!device_id) return res.status(400).json({ error: "Missing device_id" });

  // Only serve command if the poll request is from the current device (single-ESP)
  if (!currentDeviceId) {
    // if server doesn't know any device yet, accept first poller as current
    currentDeviceId = device_id;
  } else if (device_id !== currentDeviceId) {
    // reject polls from other devices (single-ESP policy)
    console.warn(`Rejected command poll from ${device_id} — current device is ${currentDeviceId}`);
    return res.json({ empty: true, message: "not-registered" });
  }

  if (!currentCommand) return res.json({ empty: true });

  // return and clear the current command
  const response = { empty: false, command: currentCommand.command, id: currentCommand.id, ts: currentCommand.ts };
  // Clear after handing to device
  currentCommand = null;

  emitToWebClients("control.sent", { device_id, id: response.id });
  return res.json(response);
});

// -------------------------------
// Small status endpoint
// -------------------------------
app.get("/status", (req, res) => {
  res.json({
    uptime: process.uptime(),
    ws_clients: allClients().length,
    device: currentDeviceId,
    hasCommand: !!currentCommand,
    lastTelemetryTs: lastTelemetry ? lastTelemetry.ts : null,
  });
});

// -------------------------------
// WebSocket handling
// -------------------------------
function setupWebSocketServer(wss) {
  if (!wss) return;
  wss.on("connection", (ws) => {
    console.log("WS client connected");
    ws.send(JSON.stringify({ type: "welcome", ts: Date.now() }));

    ws.on("message", (msg) => {
      // Existing control command logic
      try {
        const obj = JSON.parse(msg.toString());
        if (obj.action === "control" && obj.device_id && typeof obj.command !== "undefined") {
          currentDeviceId = obj.device_id;
          const id = crypto.randomUUID();
          currentCommand = { command: obj.command, id, ts: Date.now() };
          emitToWebClients("control.queued", { device_id: currentDeviceId, command: obj.command, id });
          ws.send(JSON.stringify({ type: "control.queued", device_id: currentDeviceId, id }));
        }
      } catch (e) {
        console.warn("WS invalid JSON", e);
      }
    });
    ws.on("close", () => console.log("WS client disconnected"));
  });
}
setupWebSocketServer(wssHttp);
setupWebSocketServer(wssHttps);

// -------------------------------
// Graceful shutdown
// -------------------------------
function gracefulShutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  try { httpServer.close(() => console.log("HTTP closed")); } catch (e) {}
  if (httpsServer) try { httpsServer.close(() => console.log("HTTPS closed")); } catch (e) {}
  allClients().forEach(c => { try { c.close(1001, "Server shutting down"); } catch (e) {} });
  setTimeout(() => { console.log("Exited."); process.exit(0); }, 300);
}
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  gracefulShutdown("uncaughtException");
});

// -------------------------------
// Start servers
// -------------------------------

safeListen(httpServer, HTTP_PORT, "HTTP");

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, "0.0.0.0", () => {
    console.log(`HTTPS server (Browser) listening on https://0.0.0.0:${HTTPS_PORT}`);
    // auto-open browser (you asked yes)
    try {
      openBrowser(`https://0.0.0.0:${HTTPS_PORT}`);
    } catch (e) { console.warn("openBrowser failed:", e && e.message); }
  });
} else {
  console.warn("HTTPS not started (missing certs). Starting HTTP only; Web Bluetooth will not work without trusted HTTPS.");
  // still open HTTP UI so you can test
  try { openBrowser(`http://0.0.0.0:${HTTP_PORT}`); } catch (e) {}
}
