import { randomUUID } from 'node:crypto';
import Store from 'electron-store';
import { STATS_API_BASE_URL } from '../shared/constants';
import type { PublicStats } from '../shared/types';
import { logger } from './logger';

/**
 * Anonymous usage stats (see stats-backend/). The only thing that identifies this
 * install is a random UUID created on first launch; no personal data, file names,
 * URLs or download content are ever sent. Every call is best-effort: failures are
 * logged once and never surface to the user or affect downloads.
 */

// A little under the backend's 5-minute "right now" window, so an open app always counts
const PING_INTERVAL_MS = 4 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

interface StatsStoreSchema {
  deviceId?: string;
}

class StatsClient {
  private store = new Store<StatsStoreSchema>({ name: 'stats' });
  private pingTimer: NodeJS.Timeout | null = null;
  // Log only the first failure in a row, so an offline machine doesn't flood the log
  private lastCallFailed = false;

  private get deviceId(): string {
    let id = this.store.get('deviceId');
    if (!id) {
      id = randomUUID();
      this.store.set('deviceId', id);
    }
    return id;
  }

  /** Ping now, then every few minutes while the app is running. */
  public start(): void {
    if (this.pingTimer) return;
    void this.ping();
    this.pingTimer = setInterval(() => void this.ping(), PING_INTERVAL_MS);
  }

  public reportDownloadComplete(): void {
    void this.request('/download-complete', { method: 'POST' });
  }

  /** Current public counters, or null when the backend can't be reached. */
  public async getStats(): Promise<PublicStats | null> {
    const res = await this.request('/stats');
    if (!res) return null;
    try {
      const body = (await res.json()) as Partial<PublicStats>;
      const { totalDownloads, activeUsers } = body;
      if (
        typeof totalDownloads !== 'number' ||
        typeof activeUsers?.last5Minutes !== 'number' ||
        typeof activeUsers?.last24Hours !== 'number'
      ) {
        return null;
      }
      return { totalDownloads, activeUsers };
    } catch {
      return null;
    }
  }

  private async ping(): Promise<void> {
    await this.request('/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: this.deviceId }),
    });
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response | null> {
    try {
      const res = await fetch(STATS_API_BASE_URL + path, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.lastCallFailed = false;
      return res;
    } catch (err) {
      if (!this.lastCallFailed) {
        logger.warn(`[stats] ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.lastCallFailed = true;
      return null;
    }
  }
}

export const statsClient = new StatsClient();
