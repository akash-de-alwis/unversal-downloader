import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type {
  IpcApi,
  DownloadProgress,
  QueueItem,
  AddToQueueInput,
  AppSettings,
  UpdateStatus,
} from '../shared/types';

const api: IpcApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.PING),
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_INFO),
  fetchInfo: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_FETCH_INFO, url),
  startDownload: (url: string, formatId: string, outputPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_START, url, formatId, outputPath),
  cancelDownload: (downloadId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_CANCEL, downloadId),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const handler = (_event: IpcRendererEvent, progress: DownloadProgress) => callback(progress);
    ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOAD_PROGRESS, handler);
    };
  },
  selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_FOLDER),
  getDownloadFolder: () => ipcRenderer.invoke(IPC_CHANNELS.STORE_GET_DOWNLOAD_FOLDER),
  setDownloadFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.STORE_SET_DOWNLOAD_FOLDER, folderPath),
  readClipboard: () => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_READ),
  openPath: (targetPath: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_PATH, targetPath),

  // Queue APIs
  getQueue: () => ipcRenderer.invoke(IPC_CHANNELS.QUEUE_GET_ITEMS),
  addToQueue: (input: AddToQueueInput) => ipcRenderer.invoke(IPC_CHANNELS.QUEUE_ADD_ITEM, input),
  pauseQueueItem: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.QUEUE_PAUSE_ITEM, id),
  resumeQueueItem: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.QUEUE_RESUME_ITEM, id),
  cancelQueueItem: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.QUEUE_CANCEL_ITEM, id),
  clearCompletedQueue: () => ipcRenderer.invoke(IPC_CHANNELS.QUEUE_CLEAR_COMPLETED),
  onQueueStateChanged: (callback: (items: QueueItem[]) => void) => {
    const handler = (_event: IpcRendererEvent, items: QueueItem[]) => callback(items);
    ipcRenderer.on(IPC_CHANNELS.QUEUE_STATE_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.QUEUE_STATE_CHANGED, handler);
    };
  },

  // History APIs
  getHistory: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET),
  deleteHistoryItem: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_DELETE_ITEM, id),
  clearAllHistory: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_CLEAR_ALL),

  // Settings APIs
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  updateSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, settings),

  // Diagnostics & Auto-Update
  getDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_GET),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_CHECK),
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    const handler = (_event: IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.UPDATER_STATUS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.UPDATER_STATUS, handler);
    };
  },
  hasCompletedOnboarding: () => ipcRenderer.invoke(IPC_CHANNELS.STORE_GET_ONBOARDING),
  setOnboardingCompleted: () => ipcRenderer.invoke(IPC_CHANNELS.STORE_SET_ONBOARDING),
};

contextBridge.exposeInMainWorld('api', api);
