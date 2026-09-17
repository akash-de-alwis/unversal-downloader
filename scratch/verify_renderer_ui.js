const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const YTDlpWrap = require('yt-dlp-wrap').default || require('yt-dlp-wrap');
const ffmpegPath = require('ffmpeg-static');

const screenshotPath = 'C:\\Users\\akash\\.gemini\\antigravity-ide\\brain\\98d4f872-fa6a-46c8-87fb-2feb3abfc52b\\engine_ui_screenshot.png';

// Setup real IPC handlers matching main/index.ts
const binPath = path.resolve(__dirname, '../bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const yt = new YTDlpWrap(binPath);

ipcMain.handle('app:ping', async () => ({
  message: 'pong',
  timestamp: Date.now(),
  processType: 'main',
  nodeVersion: process.versions.node,
  electronVersion: process.versions.electron,
}));

ipcMain.handle('app:get-info', async () => ({
  name: 'Universal Downloader',
  version: '1.0.0',
  platform: process.platform,
  arch: process.arch,
}));

ipcMain.handle('download:fetch-info', async (_event, url) => {
  const stdout = await yt.execPromise(['--dump-json', '--no-warnings', '--no-playlist', '--ffmpeg-location', ffmpegPath, url]);
  const raw = JSON.parse(stdout);

  const formats = [];
  const seen = new Set();
  if (Array.isArray(raw.formats)) {
    for (const f of raw.formats) {
      if (!f.format_id || seen.has(f.format_id)) continue;
      seen.add(f.format_id);
      const hasVideo = Boolean(f.vcodec && f.vcodec !== 'none');
      const hasAudio = Boolean(f.acodec && f.acodec !== 'none');
      const resolution = f.resolution || (f.width && f.height ? `${f.width}x${f.height}` : hasVideo ? 'video' : 'audio only');
      const filesize = f.filesize || f.filesize_approx;
      formats.push({
        formatId: f.format_id,
        resolution,
        ext: f.ext || 'mp4',
        filesize,
        filesizeFormatted: filesize ? `${(filesize / (1024 * 1024)).toFixed(1)} MB` : undefined,
        note: f.format_note || f.format,
        fps: f.fps,
        hasVideo,
        hasAudio,
      });
    }
  }

  formats.sort((a, b) => {
    const getRes = (res) => {
      const m = res.match(/(\d+)x(\d+)/);
      if (m) return parseInt(m[2], 10);
      const p = res.match(/(\d+)p/);
      if (p) return parseInt(p[1], 10);
      return a.hasVideo ? 1 : 0;
    };
    return getRes(a.resolution) - getRes(b.resolution);
  });

  const videoFormats = formats.filter((f) => f.hasVideo);
  if (videoFormats.length > 0) {
    videoFormats[0].isLowestQuality = true;
    videoFormats[videoFormats.length - 1].isHighestQuality = true;
  }

  const duration = raw.duration || 0;
  const mins = Math.floor(duration / 60);
  const secs = Math.floor(duration % 60);

  return {
    title: raw.title || 'Untitled Media',
    thumbnail: raw.thumbnail || (raw.thumbnails && raw.thumbnails.length ? raw.thumbnails[raw.thumbnails.length - 1].url : ''),
    duration,
    durationFormatted: `${mins}:${secs.toString().padStart(2, '0')}`,
    uploader: raw.uploader || raw.channel || 'Unknown',
    formats,
    webpageUrl: raw.webpage_url || url,
  };
});

ipcMain.handle('download:start', async (_event, url, formatId, outputPath) => {
  const downloadId = `dl_${Date.now()}`;
  return { downloadId, outputPath: outputPath || 'download.mp4' };
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1080,
    height: 780,
    show: false,
    backgroundColor: '#0c0e14',
    webPreferences: {
      preload: path.resolve(__dirname, '../dist/main/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Forward console messages to terminal
  win.webContents.on('console-message', (_event, level, message) => {
    console.log(`[Renderer Console] ${message}`);
  });

  await win.loadFile(path.resolve(__dirname, '../dist/renderer/index.html'));

  // Wait for initial mount
  await new Promise((r) => setTimeout(r, 1500));

  console.log('Simulating YouTube preset click & fetch in renderer...');
  await win.webContents.executeJavaScript(`
    const ytBtn = document.getElementById('preset-youtube-btn');
    if (ytBtn) ytBtn.click();
  `);

  // Wait 8.5 seconds for metadata fetch to complete and UI to update
  await new Promise((r) => setTimeout(r, 8500));

  // Capture UI screenshot with fetched video card
  const image = await win.webContents.capturePage();
  fs.writeFileSync(screenshotPath, image.toPNG());
  console.log(`Saved screenshot to: ${screenshotPath}`);

  app.quit();
});
