import { autoUpdater, UpdateInfo } from 'electron-updater';
import { app, BrowserWindow } from 'electron';
import { logger } from './logger';
import { IPC_CHANNELS } from '../shared/constants';
import type { UpdateStatus } from '../shared/types';

/**
 * Checks GitHub Releases, downloads a newer version in the background as soon as
 * one is found, and installs it when the user clicks "Restart to Update" (or on
 * the next normal quit, if they never do).
 */
export class AppUpdater {
  private mainWindow: BrowserWindow | null = null;
  private currentStatus: UpdateStatus = { status: 'idle' };

  constructor() {
    autoUpdater.logger = logger;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    this.setupListeners();
  }

  public setWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  public getStatus(): UpdateStatus {
    return this.currentStatus;
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
      logger.info('Application update available, downloading in the background:', info.version);
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
      this.handleError(err);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      this.sendStatus({
        status: 'downloading',
        // Progress events don't carry the version; keep the one from 'update-available'
        version: this.currentStatus.version,
        percent: progressObj.percent,
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      logger.info('Application update downloaded and ready to install:', info.version);
      this.sendStatus({ status: 'downloaded', version: info.version });
    });
  }

  private handleError(err: Error): void {
    // A repository with no releases yet isn't a failure from the user's point of view
    if (/No published versions/i.test(err.message)) {
      logger.info('No releases published on GitHub yet; treating as up to date.');
      this.sendStatus({ status: 'not-available', version: app.getVersion() });
      return;
    }
    logger.warn('Application auto-update error:', err.message);
    this.sendStatus({ status: 'error', version: this.currentStatus.version, error: err.message });
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

    // Already fetching or holding an update: nothing new to check
    if (this.currentStatus.status === 'downloading' || this.currentStatus.status === 'downloaded') {
      return this.currentStatus;
    }

    try {
      await autoUpdater.checkForUpdates();
      return this.currentStatus;
    } catch (err: any) {
      this.handleError(err);
      return this.currentStatus;
    }
  }

  /**
   * Quit, run the downloaded installer silently and relaunch the app. Callers must
   * stop running downloads first, so no yt-dlp/ffmpeg/deno process keeps files locked.
   */
  public installAndRestart(): boolean {
    if (this.currentStatus.status !== 'downloaded') {
      logger.warn('installAndRestart called without a downloaded update; ignoring.');
      return false;
    }
    logger.info(`Installing update ${this.currentStatus.version} and restarting`);
    // isSilent: no installer wizard; isForceRunAfter: relaunch once installed
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  }
}

export const appUpdater = new AppUpdater();
