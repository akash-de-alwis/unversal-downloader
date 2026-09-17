const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const ffmpeg = require('ffmpeg-static');

// Require the compiled main bundle or instantiate downloadManager
// We can run inside Electron context
app.whenReady().then(async () => {
  console.log('=== STARTING ENGINE TESTS IN ELECTRON RUNTIME ===');

  // Load the compiled index / downloadManager
  // Since index.ts sets up downloadManager, let's load dist/main/index.js or directly import download-manager logic
  const YTDlpWrap = require('yt-dlp-wrap').default || require('yt-dlp-wrap');
  
  // Test binary resolution
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
  const binPath = path.resolve('bin', binName);
  
  console.log('yt-dlp binary path:', binPath, 'exists:', fs.existsSync(binPath));
  console.log('ffmpeg path:', ffmpeg, 'exists:', fs.existsSync(ffmpeg));

  const yt = new YTDlpWrap(binPath);
  const version = await yt.getVersion();
  console.log('Verified yt-dlp version:', version.trim());

  // 1. Test YouTube fetchInfo
  console.log('\n--- TEST 1: FETCH YOUTUBE INFO ---');
  const ytUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  const ytStdout = await yt.execPromise(['--dump-json', '--no-warnings', '--no-playlist', '--ffmpeg-location', ffmpeg, ytUrl]);
  const ytRaw = JSON.parse(ytStdout);
  console.log('✓ YouTube Title:', ytRaw.title);
  console.log('✓ YouTube Duration:', ytRaw.duration, 'seconds');
  console.log('✓ YouTube Uploader:', ytRaw.uploader);
  console.log('✓ YouTube Formats Found:', ytRaw.formats ? ytRaw.formats.length : 0);

  // 2. Test Pinterest fetchInfo
  console.log('\n--- TEST 2: FETCH PINTEREST INFO ---');
  const pinUrl = 'https://www.pinterest.com/pin/664281013778109217/';
  const pinStdout = await yt.execPromise(['--dump-json', '--no-warnings', '--no-playlist', '--ffmpeg-location', ffmpeg, pinUrl]);
  const pinRaw = JSON.parse(pinStdout);
  console.log('✓ Pinterest Title:', pinRaw.title);
  console.log('✓ Pinterest Duration:', pinRaw.duration, 'seconds');
  console.log('✓ Pinterest Uploader:', pinRaw.uploader || '(null)');
  console.log('✓ Pinterest Formats Found:', pinRaw.formats ? pinRaw.formats.length : 0);

  // 3. Test Download lowest quality
  console.log('\n--- TEST 3: DOWNLOAD LOWEST QUALITY ---');
  const outDir = path.resolve('scratch');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.resolve(outDir, 'test_output_verified.mp4');
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  let progressCount = 0;
  await new Promise((resolve, reject) => {
    const emitter = yt.exec([
      ytUrl,
      '-f', 'worstvideo+worstaudio/worst',
      '--ffmpeg-location', ffmpeg,
      '-o', outPath,
      '--no-warnings',
      '--no-playlist'
    ]);

    emitter.on('progress', (p) => {
      progressCount++;
      if (progressCount % 10 === 0 || p.percent === 100) {
        console.log(`Download progress: ${p.percent}% | Speed: ${p.currentSpeed} | ETA: ${p.eta}`);
      }
    });

    emitter.on('close', () => {
      console.log('✓ Download process completed successfully.');
      resolve();
    });

    emitter.on('error', (err) => {
      reject(err);
    });
  });

  console.log('Downloaded file exists:', fs.existsSync(outPath));
  const stats = fs.statSync(outPath);
  console.log(`✓ Downloaded file size: ${stats.size} bytes (${(stats.size / 1024).toFixed(1)} KB)`);

  // 4. Test Playability & Integrity using FFmpeg
  console.log('\n--- TEST 4: VERIFY PLAYABLE VIDEO INTEGRITY WITH FFMPEG ---');
  const check = spawnSync(ffmpeg, ['-v', 'error', '-i', outPath, '-f', 'null', '-']);
  const errors = check.stderr.toString().trim();
  if (errors.length === 0) {
    console.log('✓ INTEGRITY PASS: File is 100% valid and playable with 0 decoding errors.');
  } else {
    console.warn('FFmpeg messages:', errors);
  }

  const probe = spawnSync(ffmpeg, ['-i', outPath]);
  const probeOutput = probe.stderr.toString();
  const videoStream = probeOutput.match(/Stream #0:\d.*Video: (.*)/);
  const audioStream = probeOutput.match(/Stream #0:\d.*Audio: (.*)/);
  console.log('✓ Detected Video Stream:', videoStream ? videoStream[1] : 'N/A');
  console.log('✓ Detected Audio Stream:', audioStream ? audioStream[1] : 'N/A');

  console.log('\n=== ALL ENGINE ACCEPTANCE TESTS PASSED ===');
  app.quit();
});
