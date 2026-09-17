import { app, BrowserWindow, ipcMain, dialog, clipboard, shell } from 'electron';
import path from 'node:path';
import { IPC_CHANNELS, APP_METADATA } from '../shared/constants';
import type {
  PingResponse,
  AppInfoResponse,
  AddToQueueInput,
  AppSettings,
} from '../shared/types';
import { downloadManager } from './download-manager';
import { queueManager } from './queue-manager';
import {
  setupErrorLogging,
  logger,
  generateDiagnosticsReport,
  getLogFilePath,
  openLogFileInExplorer,
} from './logger';
import { appUpdater } from './updater';

// Initialize file & crash logger immediately
setupErrorLogging();

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

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_FETCH_INFO, async (_event, url: string) => {
    logger.info(`Fetching media info for: ${url}`);
    return await downloadManager.fetchInfo(url);
  });

  ipcMain.handle(
    IPC_CHANNELS.DOWNLOAD_START,
    async (_event, url: string, formatId: string, outputPath?: string) => {
      let targetPath = outputPath;
      if (!targetPath) {
        const settings = queueManager.getSettings();
        const folder = settings.downloadFolder || app.getPath('downloads');
        targetPath = path.join(folder, `download_${Date.now()}.mp4`);
      }
      logger.info(`Starting download: ${url}, format: ${formatId}, path: ${targetPath}`);
      return await downloadManager.startDownload(url, formatId, targetPath);
    }
  );

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CANCEL, async (_event, downloadId: string) => {
    logger.info(`Canceling download: ${downloadId}`);
    return await downloadManager.cancelDownload(downloadId);
  });

  // Queue Handlers
  ipcMain.handle(IPC_CHANNELS.QUEUE_GET_ITEMS, async () => {
    return queueManager.getQueue();
  });

  ipcMain.handle(IPC_CHANNELS.QUEUE_ADD_ITEM, async (_event, input: AddToQueueInput) => {
    logger.info(`Adding item to queue: "${input.title}" (${input.qualityLabel})`);
    return await queueManager.addItem(input);
  });

  ipcMain.handle(IPC_CHANNELS.QUEUE_PAUSE_ITEM, async (_event, id: string) => {
    logger.info(`Pausing queue item: ${id}`);
    return await queueManager.pauseItem(id);
  });

  ipcMain.handle(IPC_CHANNELS.QUEUE_RESUME_ITEM, async (_event, id: string) => {
    logger.info(`Resuming queue item: ${id}`);
    return await queueManager.resumeItem(id);
  });

  ipcMain.handle(IPC_CHANNELS.QUEUE_CANCEL_ITEM, async (_event, id: string) => {
    logger.info(`Canceling queue item: ${id}`);
    return await queueManager.cancelItem(id);
  });

  ipcMain.handle(IPC_CHANNELS.QUEUE_CLEAR_COMPLETED, async () => {
    queueManager.clearCompleted();
  });

  // History Handlers
  ipcMain.handle(IPC_CHANNELS.HISTORY_GET, async () => {
    return queueManager.getHistory();
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY_DELETE_ITEM, async (_event, id: string) => {
    queueManager.deleteHistoryItem(id);
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY_CLEAR_ALL, async () => {
    queueManager.clearAllHistory();
  });

  // Settings Handlers
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
    return queueManager.getSettings();
  });

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_UPDATE,
    async (_event, partial: Partial<AppSettings>) => {
      logger.info('Settings updated:', partial);
      return queueManager.updateSettings(partial);
    }
  );

  // Diagnostics & Auto-Update
  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_GET, async () => {
    return await generateDiagnosticsReport();
  });

  ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK, async () => {
    return await appUpdater.checkForUpdates();
  });

  ipcMain.handle(IPC_CHANNELS.STORE_GET_ONBOARDING, async () => {
    const s = queueManager.getSettings();
    return Boolean(s.hasCompletedOnboarding);
  });

  ipcMain.handle(IPC_CHANNELS.STORE_SET_ONBOARDING, async () => {
    queueManager.updateSettings({ hasCompletedOnboarding: true });
  });

  ipcMain.handle(IPC_CHANNELS.LOGS_OPEN, async () => {
    logger.info('Opening log file in explorer on user request');
    return openLogFileInExplorer();
  });

  ipcMain.handle(IPC_CHANNELS.LOGS_GET_PATH, async () => {
    return getLogFilePath();
  });

  // Folder & Utility Handlers
  ipcMain.handle(IPC_CHANNELS.STORE_GET_DOWNLOAD_FOLDER, async () => {
    return queueManager.getSettings().downloadFolder;
  });

  ipcMain.handle(IPC_CHANNELS.STORE_SET_DOWNLOAD_FOLDER, async (_event, folderPath: string) => {
    queueManager.updateSettings({ downloadFolder: folderPath });
    return folderPath;
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG_SELECT_FOLDER, async () => {
    if (!mainWindow) return null;
    const settings = queueManager.getSettings();
    const defaultPath = settings.downloadFolder || app.getPath('downloads');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Download Folder',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const selected = result.filePaths[0];
      queueManager.updateSettings({ downloadFolder: selected });
      return selected;
    }
    return null;
  });

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_READ, async () => {
    return clipboard.readText();
  });

  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_PATH, async (_event, targetPath: string) => {
    if (targetPath) {
      shell.showItemInFolder(targetPath);
    }
  });

  queueManager.initListeners();
}

function createWindow(): void {
  const iconPath = path.resolve(__dirname, '../../assets/icon.ico');

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 880,
    minHeight: 620,
    title: APP_METADATA.NAME,
    icon: iconPath,
    backgroundColor: '#0c0e14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  queueManager.setWindow(mainWindow);
  appUpdater.setWindow(mainWindow);

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
    queueManager.setWindow(null);
    appUpdater.setWindow(null);
  });
}

app.whenReady().then(async () => {
  setupIpcHandlers();
  createWindow();

  try {
    await downloadManager.initialize();
  } catch (err) {
    logger.error('Failed to initialize download manager:', err);
  }

  // Check for app updates quietly in production
  if (app.isPackaged) {
    setTimeout(() => {
      appUpdater.checkForUpdates().catch((e) => logger.warn('Background update check error:', e));
    }, 4000);
  }

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
