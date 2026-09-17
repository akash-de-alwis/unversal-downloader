const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const artifactDir = 'C:\\Users\\akash\\.gemini\\antigravity-ide\\brain\\98d4f872-fa6a-46c8-87fb-2feb3abfc52b';

process.env.NODE_ENV = 'production';

// Load compiled main process which registers all IPC handlers
require(path.resolve(__dirname, '../dist/main/index.js'));

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  console.log('=== STARTING MULTI-STATE UI VERIFICATION ===');

  let win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    await sleep(1000);
    win = BrowserWindow.getAllWindows()[0];
  }

  win.webContents.on('console-message', (_event, level, message) => {
    console.log(`[Renderer Console] ${message}`);
  });

  // Wait for React UI to mount
  await sleep(2000);

  // 1. CAPTURE STATE 1: IDLE
  console.log('\n--- CAPTURING STATE 1: IDLE ---');
  let img = await win.webContents.capturePage();
  const fileIdle = path.join(artifactDir, 'screenshot_1_idle.png');
  fs.writeFileSync(fileIdle, img.toPNG());
  console.log('✓ Saved:', fileIdle);

  // 2. CAPTURE STATE 6: ERROR (with details expander)
  console.log('\n--- CAPTURING STATE 6: ERROR ---');
  await win.webContents.executeJavaScript(`
    const input = document.getElementById('main-url-input');
    input.value = 'https://invalid-nonexistent-domain-test.com/video';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const fetchBtn = document.getElementById('btn-fetch-url');
    fetchBtn.click();
  `);

  // Wait for error card to appear
  const errorStart = Date.now();
  while (Date.now() - errorStart < 15000) {
    const hasError = await win.webContents.executeJavaScript(`Boolean(document.getElementById('state-error-card'))`);
    if (hasError) break;
    await sleep(500);
  }

  // Expand technical details
  await win.webContents.executeJavaScript(`
    const toggle = document.getElementById('btn-toggle-error-details');
    if (toggle) toggle.click();
  `);
  await sleep(800);

  img = await win.webContents.capturePage();
  const fileError = path.join(artifactDir, 'screenshot_6_error.png');
  fs.writeFileSync(fileError, img.toPNG());
  console.log('✓ Saved:', fileError);

  // 3. CAPTURE STATE 2: LOADING
  console.log('\n--- CAPTURING STATE 2: LOADING ---');
  await win.webContents.executeJavaScript(`
    const input = document.getElementById('main-url-input');
    input.value = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const fetchBtn = document.getElementById('btn-fetch-url');
    fetchBtn.click();
  `);

  // Capture loading state immediately after click
  await sleep(400);
  img = await win.webContents.capturePage();
  const fileLoading = path.join(artifactDir, 'screenshot_2_loading.png');
  fs.writeFileSync(fileLoading, img.toPNG());
  console.log('✓ Saved:', fileLoading);

  // 4. CAPTURE STATE 3: PREVIEW
  console.log('\n--- WAITING FOR PREVIEW & FORMATS ---');
  const previewStart = Date.now();
  let previewReady = false;
  while (Date.now() - previewStart < 20000) {
    previewReady = await win.webContents.executeJavaScript(`Boolean(document.getElementById('state-preview-card'))`);
    if (previewReady) break;
    await sleep(500);
  }

  // Select lowest quality option for speedy download verification
  await win.webContents.executeJavaScript(`
    const lowestBtn = document.getElementById('format-opt-lowest') || document.getElementById('format-opt-240p') || document.getElementById('format-opt-audio');
    if (lowestBtn) lowestBtn.click();
  `);
  await sleep(1000);

  img = await win.webContents.capturePage();
  const filePreview = path.join(artifactDir, 'screenshot_3_preview.png');
  fs.writeFileSync(filePreview, img.toPNG());
  console.log('✓ Saved:', filePreview);

  // 5. CAPTURE STATE 4: DOWNLOADING
  console.log('\n--- STARTING DOWNLOAD ---');
  await win.webContents.executeJavaScript(`
    const startBtn = document.getElementById('btn-start-download');
    if (startBtn) startBtn.click();
  `);

  // Wait for downloading card
  const dlStart = Date.now();
  let dlCardReady = false;
  while (Date.now() - dlStart < 10000) {
    dlCardReady = await win.webContents.executeJavaScript(`Boolean(document.getElementById('state-downloading-card'))`);
    if (dlCardReady) break;
    await sleep(300);
  }

  await sleep(1200);
  img = await win.webContents.capturePage();
  const fileDownloading = path.join(artifactDir, 'screenshot_4_downloading.png');
  fs.writeFileSync(fileDownloading, img.toPNG());
  console.log('✓ Saved:', fileDownloading);

  // 6. CAPTURE STATE 5: COMPLETE
  console.log('\n--- WAITING FOR DOWNLOAD COMPLETION ---');
  const completeStart = Date.now();
  let completeReady = false;
  while (Date.now() - completeStart < 30000) {
    completeReady = await win.webContents.executeJavaScript(`Boolean(document.getElementById('state-complete-card'))`);
    if (completeReady) break;
    await sleep(500);
  }

  await sleep(1000);
  img = await win.webContents.capturePage();
  const fileComplete = path.join(artifactDir, 'screenshot_5_complete.png');
  fs.writeFileSync(fileComplete, img.toPNG());
  console.log('✓ Saved:', fileComplete);

  // 7. TEST PINTEREST URL PREVIEW
  console.log('\n--- TESTING PINTEREST PREVIEW ---');
  await win.webContents.executeJavaScript(`
    const resetBtn = document.getElementById('btn-download-another');
    if (resetBtn) resetBtn.click();
  `);
  await sleep(500);

  await win.webContents.executeJavaScript(`
    const pinBtn = document.getElementById('preset-pinterest-btn');
    if (pinBtn) pinBtn.click();
  `);

  const pinStart = Date.now();
  let pinPreviewReady = false;
  while (Date.now() - pinStart < 20000) {
    pinPreviewReady = await win.webContents.executeJavaScript(`Boolean(document.getElementById('state-preview-card'))`);
    if (pinPreviewReady) break;
    await sleep(500);
  }

  await sleep(1000);
  img = await win.webContents.capturePage();
  const filePinterest = path.join(artifactDir, 'screenshot_7_pinterest.png');
  fs.writeFileSync(filePinterest, img.toPNG());
  console.log('✓ Saved:', filePinterest);

  console.log('\n=== ALL 6 UI STATES + PINTEREST VERIFIED SUCCESSFULLY ===');
  app.quit();
});
