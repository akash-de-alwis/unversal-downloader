import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import Store from 'electron-store';
import { IPC_CHANNELS } from '../shared/constants';
import type {
  QueueItem,
  AddToQueueInput,
  HistoryItem,
  AppSettings,
  DownloadProgress,
} from '../shared/types';
import { downloadManager } from './download-manager';

interface PersistentStoreSchema {
  settings: AppSettings;
  history: HistoryItem[];
}

export class QueueManager {
  private store: Store<PersistentStoreSchema>;
  private queue: Map<string, QueueItem> = new Map();
  private maxConcurrent = 2;
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.store = new Store<PersistentStoreSchema>({
      defaults: {
        settings: {
          downloadFolder: app.getPath('downloads') || app.getPath('userData'),
          maxConcurrent: 2,
          theme: 'dark',
        },
        history: [],
      },
    });

    const settings = this.store.get('settings');
    this.maxConcurrent = settings.maxConcurrent || 2;
  }

  public setWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  public initListeners(): void {
    downloadManager.setProgressCallback((progress: DownloadProgress) => {
      this.handleDownloadProgress(progress);
    });
  }

  private emitQueueState(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const items = Array.from(this.queue.values());
      this.mainWindow.webContents.send(IPC_CHANNELS.QUEUE_STATE_CHANGED, items);
    }
  }

  public getQueue(): QueueItem[] {
    return Array.from(this.queue.values());
  }

  public getActiveCount(): number {
    let count = 0;
    for (const item of this.queue.values()) {
      if (item.status === 'downloading') count++;
    }
    return count;
  }

  public async addItem(input: AddToQueueInput): Promise<QueueItem> {
    const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const settings = this.getSettings();

    let finalOutputPath = input.outputPath;
    if (!finalOutputPath) {
      const folder = settings.downloadFolder || app.getPath('downloads');
      const safeTitle = (input.title || 'video').replace(/[/\\?%*:|"<>]/g, '_').substring(0, 60);
      finalOutputPath = path.join(folder, `${safeTitle}_${Date.now()}.mp4`);
    }

    const item: QueueItem = {
      id,
      url: input.url,
      title: input.title,
      thumbnail: input.thumbnail,
      durationFormatted: input.durationFormatted,
      qualityLabel: input.qualityLabel,
      formatId: input.formatId,
      outputPath: finalOutputPath,
      status: 'queued',
      percent: 0,
      createdAt: Date.now(),
    };

    this.queue.set(id, item);
    this.emitQueueState();
    this.dispatch();

    return item;
  }

  public async pauseItem(id: string): Promise<{ success: boolean }> {
    const item = this.queue.get(id);
    if (!item) return { success: false };

    if (item.status === 'downloading') {
      // Keep partial file so we can resume seamlessly via yt-dlp --continue
      await downloadManager.cancelDownload(id, true);
      item.status = 'paused';
      this.emitQueueState();
      this.dispatch();
      return { success: true };
    } else if (item.status === 'queued') {
      item.status = 'paused';
      this.emitQueueState();
      return { success: true };
    }

    return { success: false };
  }

  public async resumeItem(id: string): Promise<{ success: boolean }> {
    const item = this.queue.get(id);
    if (!item || item.status !== 'paused') return { success: false };

    item.status = 'queued';
    this.emitQueueState();
    this.dispatch();

    return { success: true };
  }

  public async cancelItem(id: string): Promise<{ success: boolean }> {
    const item = this.queue.get(id);
    if (!item) return { success: false };

    if (item.status === 'downloading') {
      await downloadManager.cancelDownload(id, false);
    }

    item.status = 'canceled';
    item.completedAt = Date.now();
    this.addHistoryEntry(item, 'canceled');
    this.emitQueueState();
    this.dispatch();

    return { success: true };
  }

  public clearCompleted(): void {
    for (const [id, item] of this.queue.entries()) {
      if (item.status === 'completed' || item.status === 'canceled' || item.status === 'failed') {
        this.queue.delete(id);
      }
    }
    this.emitQueueState();
  }

  public dispatch(): void {
    while (this.getActiveCount() < this.maxConcurrent) {
      // Find next queued item
      let nextItem: QueueItem | null = null;
      for (const item of this.queue.values()) {
        if (item.status === 'queued') {
          nextItem = item;
          break;
        }
      }

      if (!nextItem) break;

      this.startItem(nextItem);
    }
  }

  private async startItem(item: QueueItem): Promise<void> {
    item.status = 'downloading';
    this.emitQueueState();

    try {
      await downloadManager.startDownload(
        item.url,
        item.formatId,
        item.outputPath,
        item.id // customDownloadId matching queue item
      );
    } catch (err: any) {
      console.error(`Error starting queue download ${item.id}:`, err);
      if (item.outputPath) {
        downloadManager.cleanPartialFiles(item.outputPath);
      }
      item.status = 'failed';
      item.error = err?.message || 'Download start error';
      item.completedAt = Date.now();
      this.addHistoryEntry(item, 'failed');
      this.emitQueueState();
      this.dispatch();
    }
  }

  private handleDownloadProgress(progress: DownloadProgress): void {
    const item = this.queue.get(progress.downloadId);
    if (!item) return;

    if (progress.status === 'downloading') {
      item.status = 'downloading';
      item.percent = progress.percent;
      item.speed = progress.speed;
      item.eta = progress.eta;
      item.totalSize = progress.totalSize;
      this.emitQueueState();
    } else if (progress.status === 'completed') {
      item.status = 'completed';
      item.percent = 100;
      item.completedAt = Date.now();
      if (progress.outputPath) {
        item.outputPath = progress.outputPath;
      }
      this.addHistoryEntry(item, 'completed');
      this.emitQueueState();
      this.dispatch();
    } else if (progress.status === 'error') {
      if (item.status !== 'paused' && item.status !== 'canceled') {
        item.status = 'failed';
        item.error = progress.error || 'Download failed';
        item.completedAt = Date.now();
        this.addHistoryEntry(item, 'failed');
        this.emitQueueState();
        this.dispatch();
      }
    }
  }

  // History Management
  public getHistory(): HistoryItem[] {
    return this.store.get('history', []);
  }

  private addHistoryEntry(item: QueueItem, status: 'completed' | 'failed' | 'canceled'): void {
    const history = this.getHistory();
    let sizeFormatted: string | undefined;

    if (status === 'completed' && fs.existsSync(item.outputPath)) {
      try {
        const stats = fs.statSync(item.outputPath);
        const mb = stats.size / (1024 * 1024);
        sizeFormatted = mb >= 1 ? `${mb.toFixed(1)} MB` : `${(stats.size / 1024).toFixed(0)} KB`;
      } catch (err) {
        console.warn('Could not read downloaded file stats:', err);
      }
    }

    const entry: HistoryItem = {
      id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      url: item.url,
      title: item.title,
      thumbnail: item.thumbnail,
      date: new Date().toLocaleString(),
      quality: item.qualityLabel,
      filePath: item.outputPath,
      status,
      fileSizeFormatted: sizeFormatted,
    };

    // Prepend new entry
    history.unshift(entry);

    // Keep max 100 history items
    if (history.length > 100) {
      history.pop();
    }

    this.store.set('history', history);
  }

  public deleteHistoryItem(id: string): void {
    const history = this.getHistory().filter((h) => h.id !== id);
    this.store.set('history', history);
  }

  public clearAllHistory(): void {
    this.store.set('history', []);
  }

  // Settings Management
  public getSettings(): AppSettings {
    return this.store.get('settings', {
      downloadFolder: app.getPath('downloads') || app.getPath('userData'),
      maxConcurrent: 2,
      theme: 'dark',
    });
  }

  public updateSettings(partial: Partial<AppSettings>): AppSettings {
    const current = this.getSettings();
    const updated: AppSettings = {
      ...current,
      ...partial,
    };

    this.maxConcurrent = updated.maxConcurrent || 2;
    this.store.set('settings', updated);

    // Concurrency might have increased, dispatch any waiting items
    this.dispatch();

    return updated;
  }
}

export const queueManager = new QueueManager();
