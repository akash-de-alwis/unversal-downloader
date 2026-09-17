const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Path to save screenshot
const screenshotPath = 'C:\\Users\\akash\\.gemini\\antigravity-ide\\brain\\98d4f872-fa6a-46c8-87fb-2feb3abfc52b\\engine_ui_screenshot.png';

process.env.NODE_ENV = 'production';

// Import the main index logic by loading the app entry point
// To do this cleanly, require dist/main/index.js which sets up all IPC handlers and downloadManager
require(path.resolve(__dirname, '../dist/main/index.js'));

app.whenReady().then(async () => {
  // Find the window created by index.js
  let win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    await new Promise((r) => setTimeout(r, 1000));
    win = BrowserWindow.getAllWindows()[0];
  }

  console.log('Window acquired:', Boolean(win));

  win.webContents.on('console-message', (_event, level, message) => {
    console.log(`[Renderer Console] ${message}`);
  });

  // Wait for React UI to mount
  await new Promise((r) => setTimeout(r, 2000));

  console.log('Triggering YouTube Test Preset click in UI...');
  await win.webContents.executeJavaScript(`
    const btn = document.getElementById('preset-youtube-btn');
    if (btn) btn.click();
  `);

  // Poll until #video-preview-card is present or 15s max
  const start = Date.now();
  let found = false;
  while (Date.now() - start < 15000) {
    found = await win.webContents.executeJavaScript(`Boolean(document.getElementById('video-preview-card'))`);
    if (found) {
      console.log('Video preview card detected in DOM!');
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Small delay for thumbnail and layout settle
  await new Promise((r) => setTimeout(r, 1500));

  const image = await win.webContents.capturePage();
  fs.writeFileSync(screenshotPath, image.toPNG());
  console.log(`Captured verified screenshot to ${screenshotPath}`);

  app.quit();
});
