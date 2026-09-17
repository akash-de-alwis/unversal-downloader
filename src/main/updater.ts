import { autoUpdater, UpdateInfo } from 'electron-updater';
import { app, BrowserWindow } from 'electron';
import { logger } from './logger';
import { IPC_CHANNELS } from '../shared/constants';
import type { UpdateStatus } from '../shared/types';

export class AppUpdater {
  private mainWindow: BrowserWindow | null = null;
  private currentStatus: UpdateStatus = { status: 'idle' };

  constructor() {
    autoUpdater.logger = logger;
    autoUpdater.autoDownload = false; // Prompt before downloading large updates
    autoUpdater.autoInstallOnAppQuit = true;

    this.setupListeners();
  }

  public setWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  private sendStatus(status: UpdateStatus): void {
    this.currentStatus = status;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.UPDATER_STATUS, status);
    }
  }

  private setupListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      logger.info('Checking for application updates from GitHub Releases...');
      this.sendStatus({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      logger.info('Application update available:', info.version);
      this.sendStatus({
        status: 'available',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      });
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      logger.info('Application is up to date (current version:', info.version, ')');
      this.sendStatus({ status: 'not-available', version: info.version });
    });

    autoUpdater.on('error', (err) => {
      logger.warn('Application auto-update check error:', err.message);
      this.sendStatus({ status: 'error', error: err.message });
    });

    autoUpdater.on('download-progress', (progressObj) => {
      this.sendStatus({
        status: 'downloading',
        percent: progressObj.percent,
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      logger.info('Application update downloaded successfully:', info.version);
      this.sendStatus({ status: 'downloaded', version: info.version });
    });
  }

  public async checkForUpdates(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      logger.info('AutoUpdater: running in development mode (update check simulated).');
      const simStatus: UpdateStatus = {
        status: 'not-available',
        version: app.getVersion(),
      };
      this.sendStatus(simStatus);
      return simStatus;
    }

    try {
      await autoUpdater.checkForUpdates();
      return this.currentStatus;
    } catch (err: any) {
      logger.warn('Error checking for updates:', err);
      const errStatus: UpdateStatus = { status: 'error', error: err.message };
      this.sendStatus(errStatus);
      return errStatus;
    }
  }
}

export const appUpdater = new AppUpdater();
