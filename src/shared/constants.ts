export const IPC_CHANNELS = {
  PING: 'app:ping',
  GET_APP_INFO: 'app:get-info',
  DOWNLOAD_FETCH_INFO: 'download:fetch-info',
  DOWNLOAD_SEARCH: 'download:search',
  DOWNLOAD_START: 'download:start',
  DOWNLOAD_CANCEL: 'download:cancel',
  DOWNLOAD_PROGRESS: 'download:progress',
  DIALOG_SELECT_FOLDER: 'dialog:select-folder',
  STORE_GET_DOWNLOAD_FOLDER: 'store:get-download-folder',
  STORE_SET_DOWNLOAD_FOLDER: 'store:set-download-folder',
  CLIPBOARD_READ: 'clipboard:read',
  SHELL_OPEN_PATH: 'shell:open-path',
  SHELL_OPEN_EXTERNAL: 'shell:open-external',

  // Queue Channels
  QUEUE_GET_ITEMS: 'queue:get-items',
  QUEUE_ADD_ITEM: 'queue:add-item',
  QUEUE_PAUSE_ITEM: 'queue:pause-item',
  QUEUE_RESUME_ITEM: 'queue:resume-item',
  QUEUE_CANCEL_ITEM: 'queue:cancel-item',
  QUEUE_CLEAR_COMPLETED: 'queue:clear-completed',
  QUEUE_STATE_CHANGED: 'queue:state-changed',

  // History Channels
  HISTORY_GET: 'history:get',
  HISTORY_DELETE_ITEM: 'history:delete-item',
  HISTORY_CLEAR_ALL: 'history:clear-all',

  // Settings Channels
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // Diagnostics & Updater Channels
  DIAGNOSTICS_GET: 'diagnostics:get',
  UPDATER_CHECK: 'updater:check',
  UPDATER_STATUS: 'updater:status',
  STORE_GET_ONBOARDING: 'store:get-onboarding',
  STORE_SET_ONBOARDING: 'store:set-onboarding',
  LOGS_OPEN: 'logs:open',
  LOGS_GET_PATH: 'logs:get-path',

  // Anonymous public stats
  STATS_GET: 'stats:get',
} as const;

export const APP_METADATA = {
  NAME: 'Universal Downloader',
  VERSION: '1.0.0',
  DESCRIPTION: 'Cross-platform universal desktop downloader',
} as const;

/** How many YouTube results a search by name returns */
export const SEARCH_RESULT_COUNT = 8;

/** Bitrate for audio-only downloads, which are converted to MP3 */
export const MP3_BITRATE_KBPS = 192;

/** Anonymous usage stats backend (Cloudflare Worker in stats-backend/) */
export const STATS_API_BASE_URL = 'https://universal-downloader-stats.akashmakes.workers.dev';
