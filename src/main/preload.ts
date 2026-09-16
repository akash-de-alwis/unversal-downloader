import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { IpcApi } from '../shared/types';

const api: IpcApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.PING),
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_INFO),
};

contextBridge.exposeInMainWorld('api', api);
