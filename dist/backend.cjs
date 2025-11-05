// server.js
var fs = require("fs");
var https = require("https");
var http = require("http");
var express = require("express");
var bodyParser = require("body-parser");
var multer = require("multer");
var { WebSocketServer } = require("ws");
var crypto = require("crypto");
var path = require("path");
var { spawn } = require("child_process");
if (!process.pkg && process.argv[2] !== "--child") {
  const { spawn: spawn2 } = require("child_process");
  const execPath = process.execPath;
  const scriptArg = process.argv[1];
  const childArgs = [scriptArg, "--child", ...process.argv.slice(2)];
  console.log("Spawning server child:", execPath, childArgs.join(" "));
  const child = spawn2(execPath, childArgs, { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal === "SIGINT" || signal === "SIGTERM" || code === 0) {
      console.log("Child exited cleanly \u2014 exiting parent.");
      process.exit(0);
    } else {
      console.log(`\u{1F4A5} Child crashed (code ${code}, signal ${signal}). Restarting in 3 s...`);
      setTimeout(() => {
        spawn2(execPath, childArgs, { stdio: "inherit" });
      }, 3e3);
    }
  });
  process.exit();
}
function resolvePath(rel) {
  if (process.pkg) {
    return path.join(path.dirname(process.execPath), rel);
  } else {
    return path.join(__dirname, rel);
  }
}
var HTTP_PORT = Number(process.env.HTTP_PORT || 8080);
var HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
var DATA_DIR = process.env.DATA_DIR || resolvePath("data");
var API_KEY = process.env.SPEECHSTER_API_KEY || "";
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
}
var { exec: execChild } = require("child_process");
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
var app = express();
var SSL_OPTS = null;
try {
  SSL_OPTS = {
    key: fs.readFileSync(resolvePath("certs/localhost+3-key.pem")),
    cert: fs.readFileSync(resolvePath("certs/localhost+3.pem"))
  };
} catch (err) {
  console.warn("HTTPS certs not found at certs/localhost+3-*.pem. HTTPS will not start unless certs are present.", err.message);
  SSL_OPTS = null;
}
var httpServer = http.createServer(app);
var httpsServer = SSL_OPTS ? https.createServer(SSL_OPTS, app) : null;
var wssHttp = new WebSocketServer({ server: httpServer, path: "/ws" });
var wssHttps = httpsServer ? new WebSocketServer({ server: httpsServer, path: "/ws" }) : null;
function allClients() {
  const out = [];
  if (wssHttp) out.push(...wssHttp.clients);
  if (wssHttps) out.push(...wssHttps.clients);
  return out;
}
var currentDeviceId = null;
var lastTelemetry = null;
var currentCommand = null;
var lastAudioFiles = [];
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));
var upload = multer({ storage: multer.memoryStorage(), limits: { fieldSize: 50 * 1024 * 1024 } });
app.use((req, res, next) => {
  if (httpsServer && !req.secure && req.headers["user-agent"]?.includes("Chrome")) {
    return res.redirect(`https://${req.hostname}:${HTTPS_PORT}${req.url}`);
  }
  next();
});
function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const key = req.header("x-api-key") || req.query.key || req.header("authorization");
  if (!key) return res.status(401).json({ error: "Missing API key" });
  const raw = key.startsWith("Bearer ") ? key.slice(7) : key;
  if (raw !== API_KEY) return res.status(403).json({ error: "Invalid API key" });
  next();
}
function emitToWebClients(type, payload) {
  const msg = JSON.stringify({ type, payload });
  allClients().forEach((c) => {
    if (c.readyState === c.OPEN) c.send(msg);
  });
}
function ensureDeviceFolder(deviceId) {
  const safe = (deviceId || "unknown").replace(/[^a-zA-Z0-9_\-\.]/g, "_");
  const dir = path.join(DATA_DIR, safe);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
  }
  const audioDir = path.join(dir, "audio");
  try {
    fs.mkdirSync(audioDir, { recursive: true });
  } catch (e) {
  }
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
var PUBLIC_DIR = resolvePath("public");
try {
  app.use(express.static(PUBLIC_DIR));
} catch (e) {
}
app.get("/", (req, res) => {
  const indexPath = path.join(PUBLIC_DIR, "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.send("Speechster backend - no public/index.html found.");
});
app.use("/data", express.static(DATA_DIR));
app.post("/control", requireApiKey, (req, res) => {
  const { device_id, command } = req.body;
  if (!device_id || typeof command === "undefined") return res.status(400).json({ error: "Missing fields" });
  currentDeviceId = device_id;
  const id = crypto.randomUUID();
  currentCommand = { command, id, ts: Date.now() };
  emitToWebClients("control.queued", { device_id: currentDeviceId, command, id });
  return res.json({ status: "queued", id });
});
app.post("/esp/telemetry", (req, res) => {
  if (API_KEY && req.header("x-api-key") !== API_KEY) {
    console.warn("esp/telemetry: missing/invalid api key (if you configured SPEECHSTER_API_KEY).");
    return res.status(401).json({ error: "Missing/invalid API key" });
  }
  const payload = req.body || {};
  const device_id = payload.device_id || payload.id || "esp_unknown";
  if (!currentDeviceId) currentDeviceId = device_id;
  if (device_id !== currentDeviceId) {
    console.warn(`Telemetry received from unexpected device "${device_id}" while current is "${currentDeviceId}". Replacing current device.`);
    currentDeviceId = device_id;
  }
  lastTelemetry = { payload, ts: Date.now(), device_id };
  emitToWebClients("esp.telemetry", { device_id, payload });
  return res.json({ status: "ok" });
});
app.post("/esp/upload", upload.single("file"), (req, res) => {
  const device_id = req.body && req.body.device_id || currentDeviceId || "esp_unknown";
  if (!req.file) return res.status(400).json({ error: "Missing file" });
  const { audioDir } = ensureDeviceFolder(device_id);
  const ts = Date.now();
  const filename = `upload_${ts}_${crypto.randomUUID().slice(0, 8)}.raw`;
  const outPath = path.join(audioDir, filename);
  fs.writeFile(outPath, req.file.buffer, (err) => {
    if (err) {
      console.error("Failed to write upload:", err);
      return res.status(500).json({ error: "Write failed" });
    }
    lastAudioFiles.push({ device_id, filename, ts });
    if (lastAudioFiles.length > 1e3) lastAudioFiles.shift();
    emitToWebClients("esp.audio", { device_id, filename, path: `/data/${device_id}/audio/${filename}`, ts });
    return res.json({ status: "ok", filename });
  });
});
app.post("/esp/ota", (req, res) => {
  const payload = req.body || {};
  const device_id = payload.device_id || currentDeviceId || "esp_unknown";
  emitToWebClients("esp.ota", { device_id, payload });
  return res.json({ status: "ok" });
});
app.get("/esp/commands", (req, res) => {
  const device_id = req.query.device_id;
  if (!device_id) return res.status(400).json({ error: "Missing device_id" });
  if (!currentDeviceId) {
    currentDeviceId = device_id;
  } else if (device_id !== currentDeviceId) {
    console.warn(`Rejected command poll from ${device_id} \u2014 current device is ${currentDeviceId}`);
    return res.json({ empty: true, message: "not-registered" });
  }
  if (!currentCommand) return res.json({ empty: true });
  const response = { empty: false, command: currentCommand.command, id: currentCommand.id, ts: currentCommand.ts };
  currentCommand = null;
  emitToWebClients("control.sent", { device_id, id: response.id });
  return res.json(response);
});
app.get("/status", (req, res) => {
  res.json({
    uptime: process.uptime(),
    ws_clients: allClients().length,
    device: currentDeviceId,
    hasCommand: !!currentCommand,
    lastTelemetryTs: lastTelemetry ? lastTelemetry.ts : null
  });
});
function setupWebSocketServer(wss) {
  if (!wss) return;
  wss.on("connection", (ws) => {
    console.log("WS client connected");
    ws.send(JSON.stringify({ type: "welcome", ts: Date.now() }));
    ws.on("message", (msg) => {
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
function gracefulShutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  try {
    httpServer.close(() => console.log("HTTP closed"));
  } catch (e) {
  }
  if (httpsServer) try {
    httpsServer.close(() => console.log("HTTPS closed"));
  } catch (e) {
  }
  allClients().forEach((c) => {
    try {
      c.close(1001, "Server shutting down");
    } catch (e) {
    }
  });
  setTimeout(() => {
    console.log("Exited.");
    process.exit(0);
  }, 300);
}
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  gracefulShutdown("uncaughtException");
});
safeListen(httpServer, HTTP_PORT, "HTTP");
if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, "0.0.0.0", () => {
    console.log(`HTTPS server (Browser) listening on https://0.0.0.0:${HTTPS_PORT}`);
    try {
      openBrowser(`https://0.0.0.0:${HTTPS_PORT}`);
    } catch (e) {
      console.warn("openBrowser failed:", e && e.message);
    }
  });
} else {
  console.warn("HTTPS not started (missing certs). Starting HTTP only; Web Bluetooth will not work without trusted HTTPS.");
  try {
    openBrowser(`http://0.0.0.0:${HTTP_PORT}`);
  } catch (e) {
  }
}
