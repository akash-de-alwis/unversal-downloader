export const IPC_CHANNELS = {
  PING: 'app:ping',
  GET_APP_INFO: 'app:get-info',
} as const;

export const APP_METADATA = {
  NAME: 'Universal Downloader',
  VERSION: '1.0.0',
  DESCRIPTION: 'Cross-platform universal desktop downloader',
} as const;
