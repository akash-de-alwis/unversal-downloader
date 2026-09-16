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

export interface IpcApi {
  ping: () => Promise<PingResponse>;
  getAppInfo: () => Promise<AppInfoResponse>;
}

declare global {
  interface Window {
    api: IpcApi;
  }
}
