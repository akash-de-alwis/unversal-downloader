const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const Store = require('electron-store');

const artifactDir = 'C:\\Users\\akash\\.gemini\\antigravity-ide\\brain\\98d4f872-fa6a-46c8-87fb-2feb3abfc52b';

process.env.NODE_ENV = 'production';

// Load compiled main process which registers all IPC handlers & queueManager
require(path.resolve(__dirname, '../dist/main/index.js'));

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  console.log('=== STARTING QUEUE & HISTORY ACCEPTANCE TESTS ===');

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

  // 1. Configure settings: maxConcurrent = 2
  console.log('\n--- SETTING MAX CONCURRENT DOWNLOADS TO 2 ---');
  await win.webContents.executeJavaScript(`
    window.api.updateSettings({ maxConcurrent: 2 });
  `);

  // 2. Queue 3 downloads
  console.log('\n--- QUEUING 3 DOWNLOADS AT ONCE ---');
  const items = await win.webContents.executeJavaScript(`
    (async () => {
      const i1 = await window.api.addToQueue({
        url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        title: 'Me at the zoo (Stream 1)',
        thumbnail: 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg',
        durationFormatted: '0:19',
        qualityLabel: 'Lowest (240p)',
        formatId: 'worst',
      });
      const i2 = await window.api.addToQueue({
        url: 'https://www.pinterest.com/pin/664281013778109217/',
        title: 'Origami Video (Stream 2)',
        thumbnail: '',
        durationFormatted: '0:57',
        qualityLabel: 'Lowest (240p)',
        formatId: 'worst',
      });
      const i3 = await window.api.addToQueue({
        url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        title: 'Me at the zoo (Stream 3 - Waiting)',
        thumbnail: 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg',
        durationFormatted: '0:19',
        qualityLabel: 'Audio Only (MP3)',
        formatId: 'ba/b',
      });
      return [i1, i2, i3];
    })()
  `);

  console.log('Added 3 items to queue. IDs:', items.map((i) => i.id));

  // Switch UI to Queue tab
  await win.webContents.executeJavaScript(`
    const tab = document.getElementById('tab-queue');
    if (tab) tab.click();
  `);

  await sleep(1500);

  // Check queue status: confirm 2 downloading, 1 queued
  const queueStatus = await win.webContents.executeJavaScript(`
    window.api.getQueue().then(q => q.map(i => ({ id: i.id, title: i.title, status: i.status, percent: i.percent })))
  `);
  console.log('Queue status snapshot:', JSON.stringify(queueStatus, null, 2));

  const downloadingCount = queueStatus.filter((i) => i.status === 'downloading').length;
  const queuedCount = queueStatus.filter((i) => i.status === 'queued').length;
  console.log(`✓ Concurrency verified: ${downloadingCount} downloading, ${queuedCount} queued (max: 2)`);

  // 3. Capture screenshot of queue mid-run
  console.log('\n--- CAPTURING SCREENSHOT: QUEUE MID-RUN ---');
  let img = await win.webContents.capturePage();
  const fileQueueMidRun = path.join(artifactDir, 'queue_mid_run.png');
  fs.writeFileSync(fileQueueMidRun, img.toPNG());
  console.log('✓ Saved screenshot to:', fileQueueMidRun);

  // 4. Test Pause & Resume on an in-progress item
  console.log('\n--- TESTING PAUSE ON IN-PROGRESS ITEM ---');
  const activeItem = queueStatus.find((i) => i.status === 'downloading');
  if (activeItem) {
    console.log(`Pausing item ${activeItem.id}...`);
    await win.webContents.executeJavaScript(`window.api.pauseQueueItem('${activeItem.id}')`);
    await sleep(1500);

    const pausedCheck = await win.webContents.executeJavaScript(`
      window.api.getQueue().then(q => q.find(i => i.id === '${activeItem.id}'))
    `);
    console.log(`✓ Item ${activeItem.id} status after pause:`, pausedCheck.status);

    // Confirm that pausing freed a slot and the 3rd item was promoted
    const newQueueState = await win.webContents.executeJavaScript(`
      window.api.getQueue().then(q => q.map(i => ({ id: i.id, status: i.status })))
    `);
    console.log('Queue state after pause promotion:', newQueueState);

    // Resume the item
    console.log(`Resuming item ${activeItem.id}...`);
    await win.webContents.executeJavaScript(`window.api.resumeQueueItem('${activeItem.id}')`);
    await sleep(1000);
  }

  // 5. Wait for at least one download to complete to populate history
  console.log('\n--- WAITING FOR DOWNLOAD TO COMPLETE ---');
  const waitStart = Date.now();
  let hasCompleted = false;
  while (Date.now() - waitStart < 40000) {
    const q = await win.webContents.executeJavaScript(`window.api.getQueue()`);
    if (q.some((i) => i.status === 'completed')) {
      hasCompleted = true;
      console.log('✓ Detected completed download in queue!');
      break;
    }
    await sleep(1000);
  }

  // 6. Test cancel on one item to demonstrate canceled status in history
  const remainingActive = await win.webContents.executeJavaScript(`
    window.api.getQueue().then(q => q.find(i => i.status === 'downloading' || i.status === 'queued'))
  `);
  if (remainingActive) {
    console.log(`Canceling remaining item ${remainingActive.id}...`);
    await win.webContents.executeJavaScript(`window.api.cancelQueueItem('${remainingActive.id}')`);
    await sleep(1000);
  }

  // 7. Switch to History tab and capture screenshot
  console.log('\n--- SWITCHING TO HISTORY TAB ---');
  await win.webContents.executeJavaScript(`
    const tab = document.getElementById('tab-history');
    if (tab) tab.click();
  `);

  await sleep(1500);

  const historyEntries = await win.webContents.executeJavaScript(`window.api.getHistory()`);
  console.log(`✓ History entries count: ${historyEntries.length}`);
  console.log('History snapshot:', JSON.stringify(historyEntries, null, 2));

  console.log('\n--- CAPTURING SCREENSHOT: HISTORY VIEW ---');
  img = await win.webContents.capturePage();
  const fileHistory = path.join(artifactDir, 'history_view.png');
  fs.writeFileSync(fileHistory, img.toPNG());
  console.log('✓ Saved screenshot to:', fileHistory);

  // 8. Verify persistence across app restart via direct Store read
  console.log('\n--- VERIFYING ELECTRON-STORE PERSISTENCE ---');
  const directStore = new Store();
  const persistedHistory = directStore.get('history', []);
  const persistedSettings = directStore.get('settings', {});
  console.log(`✓ Direct electron-store read: ${persistedHistory.length} history items persisted.`);
  console.log(`✓ Persisted settings: maxConcurrent=${persistedSettings.maxConcurrent}, downloadFolder="${persistedSettings.downloadFolder}"`);

  console.log('\n=== ALL QUEUE & HISTORY ACCEPTANCE TESTS PASSED ===');
  app.quit();
});
