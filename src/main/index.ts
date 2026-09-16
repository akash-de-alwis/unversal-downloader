import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { IPC_CHANNELS, APP_METADATA } from '../shared/constants';
import type { PingResponse, AppInfoResponse } from '../shared/types';

let mainWindow: BrowserWindow | null = null;

function setupIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PING, async (): Promise<PingResponse> => {
    return {
      message: 'pong',
      timestamp: Date.now(),
      processType: 'main',
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
    };
  });

  ipcMain.handle(IPC_CHANNELS.GET_APP_INFO, async (): Promise<AppInfoResponse> => {
    return {
      name: APP_METADATA.NAME,
      version: APP_METADATA.VERSION,
      platform: process.platform,
      arch: process.arch,
    };
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    title: APP_METADATA.NAME,
    backgroundColor: '#0c0e14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow?.loadFile(path.join(__dirname, '../renderer/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
