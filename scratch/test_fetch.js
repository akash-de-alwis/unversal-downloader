const path = require('node:path');
const { downloadManager } = require('../dist/main/download-manager.js');

async function test() {
  await downloadManager.initialize();
  console.log('Testing fetch info...');
  const t0 = Date.now();
  try {
    const info = await downloadManager.fetchInfo('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    console.log(`Fetch completed in ${Date.now() - t0}ms:`, info.title);
  } catch (e) {
    console.error('Fetch error:', e);
  }
  process.exit(0);
}
test();
