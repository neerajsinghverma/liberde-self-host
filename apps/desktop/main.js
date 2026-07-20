// Liberde desktop shell — wraps the Liberde web app in a native window,
// starting the local server automatically if it isn't already running.
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const SERVER_URL = process.env.LIBERDE_URL || "http://localhost:3000";
// Repo layout: <root>/apps/desktop → the web app lives at <root>.
const WEB_ROOT = process.env.LIBERDE_WEB_ROOT || path.resolve(__dirname, "..", "..");
const BOUNDS_FILE = () => path.join(app.getPath("userData"), "window-bounds.json");

let serverProcess = null;

async function serverIsUp() {
  try {
    const res = await fetch(SERVER_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverIsUp()) return true;
  if (!fs.existsSync(path.join(WEB_ROOT, "package.json"))) return false;

  const port = new URL(SERVER_URL).port || "3000";
  serverProcess = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "start", "-p", port],
    { cwd: WEB_ROOT, stdio: "ignore", shell: true }
  );

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await serverIsUp()) return true;
  }
  return false;
}

function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(BOUNDS_FILE(), "utf-8"));
  } catch {
    return { width: 1280, height: 860 };
  }
}

async function createWindow() {
  const win = new BrowserWindow({
    ...loadBounds(),
    minWidth: 480,
    minHeight: 400,
    autoHideMenuBar: true,
    backgroundColor: "#faf9f5",
    title: "Liberde",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.on("close", () => {
    try {
      fs.writeFileSync(BOUNDS_FILE(), JSON.stringify(win.getBounds()));
    } catch {
      /* not fatal */
    }
  });

  // External links open in the system browser, not inside the shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(SERVER_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  const ok = await ensureServer();
  if (ok) {
    await win.loadURL(SERVER_URL);
  } else {
    await win.loadURL(
      "data:text/html," +
        encodeURIComponent(
          `<body style="font-family:sans-serif;display:grid;place-items:center;height:100vh">
             <div style="text-align:center">
               <h2>Can't reach the Liberde server</h2>
               <p>Start it with <code>npm start</code> in the Liberde folder,<br>
               or set <code>LIBERDE_URL</code> to your server address.</p>
             </div>
           </body>`
        )
    );
  }
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => {
  if (serverProcess) serverProcess.kill();
});
