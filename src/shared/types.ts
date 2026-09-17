export interface PingResponse {
  message: string;
  timestamp: number;
  processType: string;
  nodeVersion: string;
  electronVersion: string;
}

export interface AppInfoResponse {
  name: string;
  version: string;
  platform: NodeJS.Platform;
  arch: string;
}

export interface VideoFormat {
  formatId: string;
  resolution: string;
  ext: string;
  filesize?: number;
  filesizeFormatted?: string;
  note?: string;
  fps?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  isLowestQuality?: boolean;
  isHighestQuality?: boolean;
}

export interface VideoMetadata {
  title: string;
  thumbnail: string;
  duration: number;
  durationFormatted: string;
  uploader: string;
  formats: VideoFormat[];
  webpageUrl: string;
}

export interface FriendlyFormatOption {
  id: string;
  label: string;
  formatId: string;
  resolution: string;
  ext: string;
  filesizeFormatted?: string;
  isAudioOnly: boolean;
  needsMerge: boolean;
}

export interface DownloadProgress {
  downloadId: string;
  percent: number;
  speed?: string;
  eta?: string;
  totalSize?: string;
  status: 'downloading' | 'completed' | 'cancelled' | 'error';
  outputPath?: string;
  error?: string;
}

export interface StartDownloadResult {
  downloadId: string;
  outputPath: string;
}

export interface CancelDownloadResult {
  success: boolean;
  downloadId: string;
}

export type QueueItemStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface QueueItem {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  durationFormatted: string;
  qualityLabel: string;
  formatId: string;
  outputPath: string;
  status: QueueItemStatus;
  percent: number;
  speed?: string;
  eta?: string;
  totalSize?: string;
  createdAt: number;
  completedAt?: number;
  error?: string;
}

export interface AddToQueueInput {
  url: string;
  title: string;
  thumbnail: string;
  durationFormatted: string;
  qualityLabel: string;
  formatId: string;
  outputPath?: string;
}

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  date: string;
  quality: string;
  filePath: string;
  status: 'completed' | 'failed' | 'canceled';
  fileSizeFormatted?: string;
}

export interface AppSettings {
  downloadFolder: string;
  maxConcurrent: number;
  theme: 'dark' | 'light';
  hasCompletedOnboarding?: boolean;
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

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  releaseNotes?: string;
  error?: string;
}

export interface IpcApi {
  ping: () => Promise<PingResponse>;
  getAppInfo: () => Promise<AppInfoResponse>;
  fetchInfo: (url: string) => Promise<VideoMetadata>;
  startDownload: (
    url: string,
    formatId: string,
    outputPath?: string
  ) => Promise<StartDownloadResult>;
  cancelDownload: (downloadId: string) => Promise<CancelDownloadResult>;
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
  selectFolder: () => Promise<string | null>;
  getDownloadFolder: () => Promise<string>;
  setDownloadFolder: (folderPath: string) => Promise<string>;
  readClipboard: () => Promise<string>;
  openPath: (targetPath: string) => Promise<void>;

  // Queue APIs
  getQueue: () => Promise<QueueItem[]>;
  addToQueue: (input: AddToQueueInput) => Promise<QueueItem>;
  pauseQueueItem: (id: string) => Promise<{ success: boolean }>;
  resumeQueueItem: (id: string) => Promise<{ success: boolean }>;
  cancelQueueItem: (id: string) => Promise<{ success: boolean }>;
  clearCompletedQueue: () => Promise<void>;
  onQueueStateChanged: (callback: (items: QueueItem[]) => void) => () => void;

  // History APIs
  getHistory: () => Promise<HistoryItem[]>;
  deleteHistoryItem: (id: string) => Promise<void>;
  clearAllHistory: () => Promise<void>;

  // Settings APIs
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;

  // Diagnostics & Auto-Update
  getDiagnostics: () => Promise<DiagnosticsReport>;
  checkForUpdates: () => Promise<UpdateStatus>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  hasCompletedOnboarding: () => Promise<boolean>;
  setOnboardingCompleted: () => Promise<void>;
}

declare global {
  interface Window {
    api: IpcApi;
  }
}
