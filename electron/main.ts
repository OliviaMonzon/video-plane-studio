import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import type { MessageBoxOptions } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const currentStudioUrl = devServerUrl ?? "http://127.0.0.1:5173/";
const mediaPermissions = new Set(["camera", "microphone", "media"]);
const midiPermissions = new Set(["midi", "midiSysex"]);
const midiBridgeClients = new Set<ServerResponse>();

const midiBridgeServer = createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-cache");

  if (request.url === "/events") {
    response.writeHead(200, {
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream",
    });
    response.write("event: status\ndata: connected\n\n");
    midiBridgeClients.add(response);
    request.on("close", () => midiBridgeClients.delete(response));
    return;
  }

  response.writeHead(404);
  response.end();
});

const broadcastMidiToBrowsers = (data: number[]) => {
  const payload = `event: midi\ndata: ${JSON.stringify(data)}\n\n`;
  midiBridgeClients.forEach((client) => client.write(payload));
};

type AppPreferences = {
  alwaysAllowMedia?: boolean;
};

const readPreferences = (): AppPreferences => {
  const preferencesPath = join(app.getPath("userData"), "video-plane-studio-preferences.json");

  try {
    if (!existsSync(preferencesPath)) {
      return {};
    }

    return JSON.parse(readFileSync(preferencesPath, "utf8")) as AppPreferences;
  } catch {
    return {};
  }
};

const writePreferences = (preferences: AppPreferences) => {
  const preferencesPath = join(app.getPath("userData"), "video-plane-studio-preferences.json");

  try {
    writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2));
  } catch {
    // If preferences cannot be written, the one-time permission still works.
  }
};

const askForMediaPermission = async (parentWindow: BrowserWindow | null) => {
  const preferences = readPreferences();

  if (preferences.alwaysAllowMedia) {
    return true;
  }

  const dialogOptions: MessageBoxOptions = {
    buttons: ["Always allow for this app", "Allow this time", "Cancel"],
    cancelId: 2,
    defaultId: 0,
    detail: "Video Plane Studio uses the camera and microphone only as sources for its 3D visual effects. Choosing \"Always allow for this app\" remembers this choice for future presets.",
    message: "Allow camera and microphone access?",
    noLink: true,
    type: "question",
  };

  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);

  if (result.response === 0) {
    writePreferences({ ...preferences, alwaysAllowMedia: true });
    return true;
  }

  return result.response === 1;
};

const createWindow = async () => {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: "#050505",
    title: "Video Plane Studio",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.js"),
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    const response = await fetch(currentStudioUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Studio server returned ${response.status}`);
    }
    const separator = currentStudioUrl.includes("?") ? "&" : "?";
    await mainWindow.loadURL(`${currentStudioUrl}${separator}desktop=${Date.now()}`);
    if (process.env.OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
    return;
  } catch {
    await mainWindow.loadFile(join(__dirname, "../dist/index.html"), {
      query: { desktop: String(Date.now()) },
    });
  }
};

app.whenReady().then(async () => {
  await session.defaultSession.clearCache();
  midiBridgeServer.listen(5174, "127.0.0.1");
  ipcMain.on("grid-midi-message", (_event, data: unknown) => {
    if (Array.isArray(data) && data.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
      broadcastMidiToBrowsers(data as number[]);
    }
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return midiPermissions.has(permission);
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (midiPermissions.has(permission)) {
      callback(true);
      return;
    }

    if (!mediaPermissions.has(permission)) {
      callback(false);
      return;
    }

    const parentWindow = BrowserWindow.fromWebContents(webContents);
    void askForMediaPermission(parentWindow).then(callback, () => callback(false));
  });

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  midiBridgeClients.forEach((client) => client.end());
  midiBridgeServer.close();
});
