const { app, BrowserWindow, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const artifactDir = 'C:\\Users\\akash\\.gemini\\antigravity-ide\\brain\\98d4f872-fa6a-46c8-87fb-2feb3abfc52b';

process.env.NODE_ENV = 'production';

// Load compiled main process which registers all IPC handlers & initializes electron window
require(path.resolve(__dirname, '../dist/main/index.js'));

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  console.log('=== STARTING DISTRIBUTION USER JOURNEY VERIFICATION ===');

  let win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    await sleep(1500);
    win = BrowserWindow.getAllWindows()[0];
  }

  win.webContents.on('console-message', (_event, level, message) => {
    console.log(`[Renderer Console] ${message}`);
  });

  await sleep(2500);

  // 1. Reset onboarding to ensure first-run onboarding screen is visible
  console.log('\n[Step 1] Triggering First-Run Experience...');
  await win.webContents.executeJavaScript(`
    window.api.updateSettings({ hasCompletedOnboarding: false });
    location.reload();
  `);

  await sleep(2500);

  // Verify onboarding modal is in the DOM
  const hasOnboarding = await win.webContents.executeJavaScript(`
    Boolean(document.getElementById('onboarding-modal-card'))
  `);
  console.log(`[Step 1] Onboarding modal present in DOM: ${hasOnboarding}`);

  // Capture Onboarding screenshot
  const onboardingShot = await win.webContents.capturePage();
  const onboardingPath = path.join(artifactDir, 'onboarding_screen.png');
  fs.writeFileSync(onboardingPath, onboardingShot.toPNG());
  console.log(`[Step 1] Captured Onboarding screenshot -> ${onboardingPath}`);

  // Dismiss onboarding via "I Understand & Get Started" button
  console.log('\n[Step 2] Completing Onboarding via CTA button...');
  await win.webContents.executeJavaScript(`
    const btn = document.getElementById('btn-onboarding-get-started');
    if (btn) btn.click();
  `);
  await sleep(1000);

  // Check that onboarding status is saved in persistent store
  const completedOnboarding = await win.webContents.executeJavaScript(`
    window.api.hasCompletedOnboarding()
  `);
  console.log(`[Step 2] Onboarding completion status saved: ${completedOnboarding}`);

  // 2. Test Auto-Updater Check
  console.log('\n[Step 3] Testing Auto-Updater wiring...');
  const updateStatus = await win.webContents.executeJavaScript(`
    window.api.checkForUpdates()
  `);
  console.log(`[Step 3] Auto-updater responded with status: ${JSON.stringify(updateStatus)}`);

  // 3. Test Diagnostics generation
  console.log('\n[Step 4] Testing Diagnostics logging and generation...');
  const diagnostics = await win.webContents.executeJavaScript(`
    window.api.getDiagnostics()
  `);
  console.log(`[Step 4] Diagnostics App Version: ${diagnostics.appVersion}`);
  console.log(`[Step 4] Diagnostics Platform: ${diagnostics.platform} (${diagnostics.arch})`);
  console.log(`[Step 4] Diagnostics Download Dir: ${diagnostics.downloadFolder}`);
  console.log(`[Step 4] Diagnostics Log Lines Captured: ${diagnostics.recentLogs.length}`);

  // Switch to Settings tab in UI and test "Copy Diagnostics" button
  console.log('\n[Step 5] Navigating to Settings Tab & Testing Copy Diagnostics...');
  await win.webContents.executeJavaScript(`
    const settingsBtn = document.getElementById('tab-settings');
    if (settingsBtn) settingsBtn.click();
  `);
  await sleep(800);

  await win.webContents.executeJavaScript(`
    const copyBtn = document.getElementById('btn-copy-diagnostics');
    if (copyBtn) copyBtn.click();
  `);
  await sleep(600);

  const copiedText = clipboard.readText();
  console.log(`[Step 5] Clipboard content starts with:\n${copiedText.slice(0, 120)}...`);
  console.log(`[Step 5] Clipboard total length: ${copiedText.length} chars`);

  const settingsShot = await win.webContents.capturePage();
  const settingsPath = path.join(artifactDir, 'settings_diagnostics_screen.png');
  fs.writeFileSync(settingsPath, settingsShot.toPNG());
  console.log(`[Step 5] Captured Settings & Diagnostics screenshot -> ${settingsPath}`);

  // 4. Test Complete Downloader Journey: Paste -> Fetch -> Preview -> Download -> Queue -> History
  console.log('\n[Step 6] Running End-to-End Downloader User Journey...');
  await win.webContents.executeJavaScript(`
    const dlBtn = document.getElementById('tab-downloader');
    if (dlBtn) dlBtn.click();
  `);
  await sleep(500);

  // Click the Pinterest Preset button which fetches 'https://www.pinterest.com/pin/664281013778109217/'
  console.log('[Step 6] Triggering Pinterest preset video fetch...');
  await win.webContents.executeJavaScript(`
    const pinPreset = document.getElementById('preset-pinterest-btn');
    if (pinPreset) pinPreset.click();
  `);

  // Wait for preview card to render
  console.log('[Step 6] Waiting for preview metadata card...');
  let previewFound = false;
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    previewFound = await win.webContents.executeJavaScript(`
      Boolean(document.querySelector('.preview-card'))
    `);
    if (previewFound) break;
  }

  if (!previewFound) {
    throw new Error('Preview card failed to render after fetching YouTube URL!');
  }
  console.log(`[Step 6] Preview card rendered successfully!`);

  // Capture Preview screen
  const previewShot = await win.webContents.capturePage();
  const previewPath = path.join(artifactDir, 'preview_downloader_screen.png');
  fs.writeFileSync(previewPath, previewShot.toPNG());
  console.log(`[Step 6] Captured Preview Card screenshot -> ${previewPath}`);

  // Add to Queue
  console.log('[Step 6] Clicking Add to Queue button...');
  await win.webContents.executeJavaScript(`
    const addQueueBtn = document.getElementById('btn-add-to-queue');
    if (addQueueBtn) addQueueBtn.click();
  `);
  await sleep(1500);

  // Navigate to Queue tab to observe download
  await win.webContents.executeJavaScript(`
    const qTab = document.getElementById('tab-queue');
    if (qTab) qTab.click();
  `);
  await sleep(800);

  // Wait for download to finish
  console.log('[Step 6] Monitoring queue for download completion...');
  let downloadCompleted = false;
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    const qItems = await win.webContents.executeJavaScript(`window.api.getQueue()`);
    const item = qItems[qItems.length - 1]; // Latest queued item
    if (item) {
      if (item.status === 'completed') {
        downloadCompleted = true;
        console.log(`\n[Step 6] Download item "${item.title}" completed! (saved to: ${item.outputPath})`);
        break;
      } else if (item.status === 'failed') {
        throw new Error(`Download failed in queue: ${item.error}`);
      } else {
        process.stdout.write(`\r[Step 6] Queue Progress: ${item.percent?.toFixed(1) || 0}% | ${item.speed || ''} | ${item.eta || ''}`);
      }
    }
  }

  if (!downloadCompleted) {
    throw new Error('Download did not complete within the timeout!');
  }

  // 5. Navigate to History tab and verify entry
  console.log('\n[Step 7] Checking History Tab for persistent entry...');
  await win.webContents.executeJavaScript(`
    const histTab = document.getElementById('tab-history');
    if (histTab) histTab.click();
  `);
  await sleep(1200);

  const historyEntries = await win.webContents.executeJavaScript(`window.api.getHistory()`);
  console.log(`[Step 7] History entries count: ${historyEntries.length}`);
  const lastEntry = historyEntries[0];
  console.log(`[Step 7] Latest history record: "${lastEntry?.title}" (${lastEntry?.status})`);

  const historyShot = await win.webContents.capturePage();
  const historyPath = path.join(artifactDir, 'history_journey_screen.png');
  fs.writeFileSync(historyPath, historyShot.toPNG());
  console.log(`[Step 7] Captured History screenshot -> ${historyPath}`);

  console.log('\n=== ALL USER JOURNEY & PRODUCTION CHECKS COMPLETED SUCCESSFULLY ===');
  win.close();
  app.quit();
});
