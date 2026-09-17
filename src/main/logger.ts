import log from 'electron-log/main';
import { app, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { downloadManager } from './download-manager';
import { queueManager } from './queue-manager';

// Initialize electron-log for main process
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

export const logger = log;

export function getLogFilePath(): string {
  try {
    return log.transports.file.getFile().path;
  } catch {
    return path.join(app.getPath('userData'), 'logs', 'main.log');
  }
}

export function openLogFileInExplorer(): boolean {
  const filePath = getLogFilePath();
  try {
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return true;
    } else {
      const dir = path.dirname(filePath);
      if (fs.existsSync(dir)) {
        shell.openPath(dir);
        return true;
      }
    }
  } catch (err) {
    logger.error('Failed to open log file in explorer:', err);
  }
  return false;
}

export function setupErrorLogging(): void {
  process.on('uncaughtException', (error) => {
    logger.error('Unhandled Exception caught in main process:', error);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection caught in main process:', reason);
  });

  logger.info('Logger initialized for Universal Downloader v' + app.getVersion());
  logger.info('Log file location:', getLogFilePath());
}

export interface DiagnosticsReport {
  timestamp: string;
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  osRelease: string;
  totalMemoryGB: string;
  freeMemoryGB: string;
  downloadFolder: string;
  maxConcurrent: number;
  theme: string;
  recentLogs: string[];
  rawSummary: string;
}

export async function generateDiagnosticsReport(): Promise<DiagnosticsReport> {
  const settings = queueManager.getSettings();
  let ytDlpVersion = 'unknown';

  try {
    const yt = (downloadManager as any).ytDlp;
    if (yt) {
      ytDlpVersion = (await yt.getVersion()).trim();
    }
  } catch {
    // Ignore error
  }

  // Read recent logs from file
  const logFile = log.transports.file.getFile().path;
  const recentLogs: string[] = [];

  if (fs.existsSync(logFile)) {
    try {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      recentLogs.push(...lines.slice(-30));
    } catch {
      // Ignore read error
    }
  }

  const report: DiagnosticsReport = {
    timestamp: new Date().toISOString(),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    totalMemoryGB: (os.totalmem() / (1024 ** 3)).toFixed(1) + ' GB',
    freeMemoryGB: (os.freemem() / (1024 ** 3)).toFixed(1) + ' GB',
    downloadFolder: settings.downloadFolder,
    maxConcurrent: settings.maxConcurrent,
    theme: settings.theme,
    recentLogs,
    rawSummary: '',
  };

  report.rawSummary = [
    '==============================',
    'UNIVERSAL DOWNLOADER DIAGNOSTICS',
    '==============================',
    `Timestamp: ${report.timestamp}`,
    `App Version: ${report.appVersion}`,
    `Electron: v${report.electronVersion}`,
    `Node.js: v${report.nodeVersion}`,
    `Platform: ${report.platform} (${report.arch}) - OS ${report.osRelease}`,
    `Memory: ${report.freeMemoryGB} free / ${report.totalMemoryGB} total`,
    `yt-dlp Engine Version: ${ytDlpVersion}`,
    `Download Directory: ${report.downloadFolder}`,
    `Max Concurrency: ${report.maxConcurrent}`,
    `Theme: ${report.theme}`,
    '',
    'Recent Application Logs (Last 30 lines):',
    '--------------------------------------',
    ...recentLogs,
    '==============================',
  ].join('\n');

  return report;
}
