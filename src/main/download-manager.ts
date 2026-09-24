import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import YTDlpWrap from 'yt-dlp-wrap';
import ffmpegPath from 'ffmpeg-static';
import { logger } from './logger';
import type {
  VideoMetadata,
  VideoFormat,
  DownloadProgress,
  StartDownloadResult,
  CancelDownloadResult,
} from '../shared/types';

interface ActiveDownload {
  downloadId: string;
  url: string;
  outputPath: string;
  emitter: ReturnType<YTDlpWrap['exec']>;
  isCancelled: boolean;
}

export class DownloadManager {
  private ytDlp: YTDlpWrap | null = null;
  private binaryPath: string = '';
  private ffmpegBinaryPath: string = '';
  private denoBinaryPath: string = '';
  private activeDownloads: Map<string, ActiveDownload> = new Map();
  private progressCallback: ((progress: DownloadProgress) => void) | null = null;
  private infoCache = new Map<string, { data: VideoMetadata; timestamp: number }>();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache

  constructor() {
    this.ffmpegBinaryPath = this.resolveFfmpegPath();
    this.denoBinaryPath = this.resolveDenoPath();
  }

  public setProgressCallback(cb: (progress: DownloadProgress) => void): void {
    this.progressCallback = cb;
  }

  private resolveFfmpegPath(): string {
    let resolved = (ffmpegPath as string) || '';
    if (resolved.includes('app.asar')) {
      resolved = resolved.replace('app.asar', 'app.asar.unpacked');
    }
    return resolved;
  }

  private resolveDenoPath(): string {
    const isWin = process.platform === 'win32';
    const binaryName = isWin ? 'deno.exe' : 'deno';

    const candidates: string[] = [];

    // Packaged app: extraResources located at process.resourcesPath
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'bin', binaryName));
      candidates.push(path.join(process.resourcesPath, binaryName));
    }

    // Development / project root bin/
    candidates.push(path.resolve(process.cwd(), 'bin', binaryName));

    try {
      if (app && typeof app.getAppPath === 'function') {
        candidates.push(path.join(app.getAppPath(), 'bin', binaryName));
      }
      if (app && typeof app.getPath === 'function') {
        candidates.push(path.join(app.getPath('userData'), 'bin', binaryName));
      }
    } catch {
      // app paths may not be available early
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          const stats = fs.statSync(candidate);
          if (stats.size > 5 * 1024 * 1024) { // sanity check: deno.exe should be >5MB
            logger.info(
              `[DownloadManager] Found bundled Deno at "${candidate}" (${(stats.size / (1024 * 1024)).toFixed(1)} MB)`
            );
            return candidate;
          }
        } catch {
          // skip unreadable candidates
        }
      }
    }

    logger.warn(
      `[DownloadManager] Bundled Deno binary not found in any candidate path. ` +
      `JS challenge solving will fall back to yt-dlp defaults. ` +
      `Searched: ${candidates.join(', ')}`
    );
    return '';
  }

  private initPromise: Promise<void> | null = null;

  public initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize().catch((err) => {
        this.initPromise = null; // Reset so subsequent attempts can retry
        throw err;
      });
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    const isWin = process.platform === 'win32';
    const binaryName = isWin ? 'yt-dlp.exe' : 'yt-dlp';

    logger.info(
      `[DownloadManager] Initializing yt-dlp engine on platform=${process.platform}, arch=${process.arch}...`
    );

    if (!this.denoBinaryPath) {
      this.denoBinaryPath = this.resolveDenoPath();
    }

    // Cache in app's userData directory
    const userDataPath = app.getPath('userData');
    const binDir = path.join(userDataPath, 'bin');
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    this.binaryPath = path.join(binDir, binaryName);

    // Check if binary already exists and is valid (> 5MB)
    let needsDownload = true;
    if (fs.existsSync(this.binaryPath)) {
      try {
        const stats = fs.statSync(this.binaryPath);
        if (stats.size > 5 * 1024 * 1024) {
          needsDownload = false;
          logger.info(
            `[DownloadManager] Found cached yt-dlp binary at: "${this.binaryPath}" (${(stats.size / (1024 * 1024)).toFixed(1)} MB)`
          );
        } else {
          logger.warn(
            `[DownloadManager] Existing yt-dlp binary is incomplete (${stats.size} bytes). Re-acquiring.`
          );
        }
      } catch (err) {
        logger.warn(`[DownloadManager] Error checking existing yt-dlp binary:`, err);
      }
    }

    // Check fallback locations for pre-bundled binary (installer extraResources, process.resourcesPath, cwd)
    if (needsDownload) {
      const candidatePaths = [
        path.join(process.resourcesPath, 'bin', binaryName),
        path.join(process.resourcesPath, binaryName),
        path.resolve(process.cwd(), 'bin', binaryName),
        path.join(app.getAppPath(), 'bin', binaryName),
      ];

      for (const candidate of candidatePaths) {
        logger.info(`[DownloadManager] Checking candidate binary path: "${candidate}"`);
        if (fs.existsSync(candidate)) {
          try {
            const stats = fs.statSync(candidate);
            if (stats.size > 5 * 1024 * 1024) {
              fs.copyFileSync(candidate, this.binaryPath);
              needsDownload = false;
              logger.info(
                `[DownloadManager] Successfully copied pre-bundled yt-dlp from "${candidate}" to "${this.binaryPath}" (${(stats.size / (1024 * 1024)).toFixed(1)} MB)`
              );
              break;
            }
          } catch (copyErr) {
            logger.warn(`[DownloadManager] Failed copying candidate "${candidate}":`, copyErr);
          }
        }
      }
    }

    if (needsDownload) {
      logger.info(
        `[DownloadManager] No local or bundled binary found. Downloading latest official release into "${this.binaryPath}"...`
      );
      try {
        await Promise.race([
          YTDlpWrap.downloadFromGithub(this.binaryPath),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('GitHub download timed out after 60 seconds')), 60000)
          ),
        ]);
        if (!isWin) {
          try {
            fs.chmodSync(this.binaryPath, 0o755);
          } catch (e) {
            logger.warn(`[DownloadManager] chmod failed on yt-dlp binary:`, e);
          }
        }
        logger.info(`[DownloadManager] yt-dlp binary successfully downloaded from GitHub.`);
      } catch (dlErr: any) {
        logger.error(`[DownloadManager] Failed to download yt-dlp binary from GitHub:`, dlErr);
        throw new Error(`Failed to download yt-dlp media engine: ${dlErr?.message || dlErr}`);
      }
    }

    this.ytDlp = new YTDlpWrap(this.binaryPath);
    try {
      const version = await this.ytDlp.getVersion();
      logger.info(
        `[DownloadManager] yt-dlp engine verified (version: ${version.trim()}, binary: "${this.binaryPath}")`
      );
    } catch (verErr: any) {
      logger.warn(`[DownloadManager] Could not verify yt-dlp version on init:`, verErr);
      const msg = verErr?.message || String(verErr);
      if (msg.includes('EACCES') || msg.includes('EPERM')) {
        logger.error(
          `[DownloadManager] Execution permission error! Windows Defender or security software may be blocking: "${this.binaryPath}"`
        );
      }
    }
  }

  private async ensureInitialized(): Promise<YTDlpWrap> {
    if (this.initPromise) {
      await this.initPromise;
    } else {
      await this.initialize();
    }
    if (!this.ytDlp) {
      throw new Error('DownloadManager failed to initialize yt-dlp binary.');
    }
    return this.ytDlp;
  }

  public async fetchInfo(url: string, timeoutMs: number = 30000): Promise<VideoMetadata> {
    const startTime = Date.now();
    logger.info(`[fetchInfo] Starting info extraction for URL: "${url}" (timeout: ${timeoutMs}ms)`);

    // Return instant cached response if recently analyzed
    const cached = this.infoCache.get(url);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      logger.info(`[fetchInfo] Returning cached metadata for: "${url}" (0ms)`);
      return cached.data;
    }

    const yt = await this.ensureInitialized();

    const args = [
      '-4', // Crucial: Force IPv4 to eliminate 60-120s IPv6 socket connect timeout stalls on Windows
      '--dump-json',
      '--no-warnings',
      '--no-playlist',
      '--skip-download', // Pure metadata extraction, skip downloading
      '--no-check-formats', // Skip slow HTTP probes for every format
    ];
    if (this.denoBinaryPath) {
      args.push('--js-runtimes', `deno:${this.denoBinaryPath}`);
    }
    if (this.ffmpegBinaryPath) {
      args.push('--ffmpeg-location', this.ffmpegBinaryPath);
    }
    args.push(url);

    // Pre-flight check: does binary still exist?
    if (!fs.existsSync(this.binaryPath)) {
      const msg = `yt-dlp binary missing at "${this.binaryPath}". It may have been deleted or quarantined by Windows Defender/antivirus.`;
      logger.error(`[fetchInfo] ${msg}`);
      throw new Error(msg);
    }

    try {
      const stats = fs.statSync(this.binaryPath);
      logger.info(
        `[fetchInfo] Using binary: "${this.binaryPath}" (${(stats.size / (1024 * 1024)).toFixed(1)} MB), FFmpeg: "${this.ffmpegBinaryPath || 'none'}"`
      );
    } catch (statErr) {
      logger.warn(`[fetchInfo] Could not read binary stat:`, statErr);
    }

    logger.info(`[fetchInfo] Command arguments: ${args.join(' ')}`);

    const abortController = new AbortController();
    let isTimedOut = false;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        isTimedOut = true;
        logger.error(
          `[fetchInfo] Operation timed out after ${timeoutMs}ms for URL: "${url}". Triggering abort signal...`
        );
        abortController.abort();
        reject(
          new Error(
            `Analysis timed out after ${Math.round(timeoutMs / 1000)} seconds. The media extraction engine (yt-dlp) did not respond in time. ` +
            `This can occur if Windows Defender or antivirus is scanning/blocking the engine, a network firewall stalled the connection, or YouTube rate-limited requests.`
          )
        );
      }, timeoutMs);
    });

    let execPromise: ReturnType<YTDlpWrap['execPromise']>;
    try {
      execPromise = yt.execPromise(args, {}, abortController.signal);
      const childProc = execPromise.ytDlpProcess;
      logger.info(`[fetchInfo] Spawned yt-dlp child process (PID: ${childProc?.pid || 'pending'})`);

      const stdout = await Promise.race([execPromise, timeoutPromise]);
      const durationMs = Date.now() - startTime;
      logger.info(
        `[fetchInfo] Success in ${durationMs}ms (PID: ${childProc?.pid || 'unknown'}). Stdout size: ${stdout.length} bytes.`
      );

      const raw = JSON.parse(stdout);

      const formats: VideoFormat[] = [];
      const seenFormats = new Set<string>();

      if (Array.isArray(raw.formats)) {
        for (const f of raw.formats) {
          if (!f.format_id || seenFormats.has(f.format_id)) continue;
          seenFormats.add(f.format_id);

          const hasVideo = f.vcodec && f.vcodec !== 'none';
          const hasAudio = f.acodec && f.acodec !== 'none';
          const resolution =
            f.resolution ||
            (f.width && f.height ? `${f.width}x${f.height}` : hasVideo ? 'video' : 'audio only');

          const filesize = f.filesize || f.filesize_approx || undefined;

          formats.push({
            formatId: f.format_id,
            resolution,
            ext: f.ext || 'mp4',
            filesize,
            filesizeFormatted: filesize ? this.formatBytes(filesize) : undefined,
            note: f.format_note || f.format || undefined,
            fps: f.fps || undefined,
            hasVideo: Boolean(hasVideo),
            hasAudio: Boolean(hasAudio),
            protocol: f.protocol || undefined,
          });
        }
      }

      // Sort formats: video formats by height/resolution, then audio
      formats.sort((a, b) => {
        const getResNumber = (res: string) => {
          const m = res.match(/(\d+)x(\d+)/);
          if (m) return parseInt(m[2], 10);
          const p = res.match(/(\d+)p/);
          if (p) return parseInt(p[1], 10);
          return a.hasVideo ? 1 : 0;
        };
        return getResNumber(a.resolution) - getResNumber(b.resolution);
      });

      const videoFormats = formats.filter((f) => f.hasVideo);
      if (videoFormats.length > 0) {
        videoFormats[0].isLowestQuality = true;
        videoFormats[videoFormats.length - 1].isHighestQuality = true;
      }

      const duration = typeof raw.duration === 'number' ? raw.duration : 0;
      const thumbnail =
        raw.thumbnail ||
        (Array.isArray(raw.thumbnails) && raw.thumbnails.length > 0
          ? raw.thumbnails[raw.thumbnails.length - 1].url
          : '');

      const result: VideoMetadata = {
        title: raw.title || 'Untitled Media',
        thumbnail: thumbnail || '',
        duration,
        durationFormatted: this.formatSeconds(duration),
        uploader: raw.uploader || raw.channel || raw.uploader_id || 'Unknown',
        formats,
        webpageUrl: raw.webpage_url || url,
      };

      // Cache metadata for instant retrieval on repeat operations
      this.infoCache.set(url, { data: result, timestamp: Date.now() });

      return result;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      if (timeoutTimer) clearTimeout(timeoutTimer);

      if (isTimedOut) {
        throw err;
      }

      const errMsg = err?.message || String(err);
      const errCode = err?.code;
      const isStillPresent = fs.existsSync(this.binaryPath);

      logger.error(
        `[fetchInfo] Extraction failed after ${durationMs}ms. ErrorCode: ${errCode || 'none'}, BinaryExists: ${isStillPresent}. Error: ${errMsg}`
      );

      if (err?.stderr) {
        logger.error(`[fetchInfo] Stderr output: ${err.stderr}`);
      }

      if (!isStillPresent) {
        const quarantineMsg =
          `The yt-dlp binary was removed or quarantined by Windows Defender/antivirus during execution: "${this.binaryPath}". ` +
          `Please check Windows Security -> Protection history and restore or exclude the Universal Downloader folder.`;
        logger.error(`[fetchInfo] ${quarantineMsg}`);
        throw new Error(quarantineMsg);
      }

      if (
        errMsg.includes('EPERM') ||
        errMsg.includes('EACCES') ||
        errMsg.includes('spawn EACCES') ||
        errMsg.includes('spawn EPERM')
      ) {
        const permMsg =
          `Execution was blocked by Windows Defender, antivirus, or system permissions (EPERM/EACCES) for: "${this.binaryPath}". ` +
          `Please add an exclusion in Windows Security for Universal Downloader.`;
        logger.error(`[fetchInfo] ${permMsg}`);
        throw new Error(permMsg);
      }

      if (errMsg.includes('EBUSY')) {
        const busyMsg =
          `The yt-dlp executable is locked by another process (likely Windows Defender/antivirus real-time scan). ` +
          `Please wait a few seconds and try again.`;
        logger.error(`[fetchInfo] ${busyMsg}`);
        throw new Error(busyMsg);
      }

      if (errMsg.includes('3221225477') || errMsg.includes('0xC0000005')) {
        const avCrashMsg =
          `yt-dlp process terminated unexpectedly with code 0xC0000005 (Access Violation). ` +
          `This typically occurs when Windows Defender Exploit Guard or third-party antivirus forcefully blocks execution.`;
        logger.error(`[fetchInfo] ${avCrashMsg}`);
        throw new Error(avCrashMsg);
      }

      if (errMsg.includes('3221225786') || errMsg.includes('0xC000013A')) {
        const ctrlCMsg = `yt-dlp process was forcefully closed or cancelled (0xC000013A).`;
        logger.error(`[fetchInfo] ${ctrlCMsg}`);
        throw new Error(ctrlCMsg);
      }

      throw err;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  }

  /**
   * Safe asynchronous/retried deletion to handle Windows file locking
   * when processes have just closed.
   */
  private unlinkWithRetry(filePath: string, retries = 3, delayMs = 150): void {
    const tryUnlink = (attemptsLeft: number) => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          logger.info(`[cleanPartialFiles] Removed temp/fragment file: "${filePath}"`);
        }
      } catch (err: any) {
        if ((err?.code === 'EBUSY' || err?.code === 'EPERM') && attemptsLeft > 0) {
          setTimeout(() => tryUnlink(attemptsLeft - 1), delayMs);
        } else {
          logger.warn(`[cleanPartialFiles] Could not remove "${filePath}":`, err?.message || err);
        }
      }
    };
    tryUnlink(retries);
  }

  /**
   * Thoroughly clean up stale partial, resume, and fragment temp files left behind
   * by yt-dlp (.part, .ytdl, *.part-Frag*.part, *.part-Frag*, *-Frag*, etc.).
   * Called before a new download, after any failed download, on cancel, and on completion.
   */
  public cleanPartialFiles(outputPath: string): void {
    try {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) return;

      const baseName = path.basename(outputPath);
      // Strip extension to build the base name (e.g. "video" from "video.mp4")
      const baseNoExt = baseName.replace(/\.[^.]+$/, '');

      // Account for variations where yt-dlp or UI replaces spaces with underscores or vice versa
      const baseVariants = [
        baseNoExt.toLowerCase(),
        baseNoExt.replace(/\s+/g, '_').toLowerCase(),
        baseNoExt.replace(/_/g, ' ').toLowerCase(),
        baseNoExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase(),
      ].filter(Boolean);

      const candidates = new Set<string>([
        `${outputPath}.part`,
        `${outputPath}.ytdl`,
        `${outputPath}.part.ytdl`,
      ]);

      const dirEntries = fs.readdirSync(dir);
      for (const entry of dirEntries) {
        // Never delete the final completed non-empty output file
        if (entry === baseName) continue;

        const entryLower = entry.toLowerCase();

        // 1. Check if file matches target base name variants
        const matchesTargetBase = baseVariants.some((v) => {
          return (
            entryLower.startsWith(v + '.') ||
            entryLower.startsWith(v + '_') ||
            entryLower.startsWith(v + '-') ||
            entryLower === v
          );
        });

        // 2. Fragment file patterns: *.part-Frag*.part, *.part-Frag*, *-Frag*
        const isFragmentFile =
          /\.part-Frag\d+(\.part)?$/i.test(entry) ||
          /-Frag\d+(\.part)?$/i.test(entry) ||
          entry.includes('.part-Frag') ||
          entry.includes('-Frag');

        // 3. Temporary / partial / stream patterns
        const isTempOrStreamFile =
          entry.endsWith('.part') ||
          entry.endsWith('.ytdl') ||
          entry.endsWith('.temp') ||
          /\.f[a-zA-Z0-9_-]+\./.test(entry);

        if (matchesTargetBase && (isFragmentFile || isTempOrStreamFile)) {
          candidates.add(path.join(dir, entry));
        } else if (isFragmentFile) {
          // Orphaned fragment files matching *.part-Frag*.part anywhere in target directory
          candidates.add(path.join(dir, entry));
        }
      }

      for (const filePath of candidates) {
        this.unlinkWithRetry(filePath);
      }

      // Also remove main target file if it already exists but is 0 bytes (corrupt / incomplete)
      if (fs.existsSync(outputPath)) {
        try {
          const stat = fs.statSync(outputPath);
          if (stat.size === 0) {
            fs.unlinkSync(outputPath);
            logger.info(`[cleanPartialFiles] Removed 0-byte corrupt output file: "${outputPath}"`);
          }
        } catch (err) {
          logger.warn(`[cleanPartialFiles] Failed checking main output file size:`, err);
        }
      }
    } catch (scanErr) {
      logger.warn(`[cleanPartialFiles] Error scanning for fragment/temp files in "${outputPath}":`, scanErr);
    }
  }

  /**
   * Detect whether a download source uses HLS (m3u8), DASH, or fragmented streaming.
   * On fragmented sources, --http-chunk-size causes "Conflicting range" / HTTP 416
   * because CDNs deliver individual segment files (.ts / .m4s) and reject byte-range
   * requests on those segments.
   */
  private isHlsOrFragmented(url: string, formatArg: string): boolean {
    // 1. Check formatArg / formatId heuristics (e.g. V_HLSV3_MOBILE-..., hls-..., m3u8, dash)
    if (/hls|m3u8|dash|frag/i.test(formatArg)) {
      return true;
    }

    // 2. Check cached metadata for this URL
    const cached = this.infoCache.get(url);
    if (cached?.data?.formats) {
      const matching = cached.data.formats.filter((f) => {
        if (f.formatId && formatArg.includes(f.formatId)) return true;
        return false;
      });

      const formatsToCheck = matching.length > 0 ? matching : cached.data.formats;
      for (const f of formatsToCheck) {
        if (
          f.protocol &&
          (f.protocol.includes('m3u8') ||
            f.protocol.includes('dash') ||
            f.protocol.includes('frag') ||
            f.protocol === 'm3u8_native' ||
            f.protocol === 'http_dash_segments')
        ) {
          return true;
        }
        if (f.formatId && /hls|m3u8|dash/i.test(f.formatId)) {
          return true;
        }
      }
    }

    // 3. Known HLS-centric platforms when format is generic (best, worst)
    if (/pin\.it|pinterest\.com|tiktok\.com|instagram\.com/i.test(url)) {
      return true;
    }

    return false;
  }

  /**
   * Check if an error message indicates a range / chunking conflict that would
   * benefit from retrying with conservative single-connection settings.
   */
  private isRangeOrChunkError(errorMsg: string): boolean {
    const patterns = [
      /conflicting.*range/i,
      /range.*not.*satisfiable/i,
      /http.*error.*416/i,
      /requested range/i,
      /start=\d+.*>.*end=\d+/i,
      /chunk.*error/i,
      /http.*chunk.*size/i,
      /content.*range.*invalid/i,
      /downloaded.*file.*is.*empty/i,
    ];
    return patterns.some((p) => p.test(errorMsg));
  }

  public async startDownload(
    url: string,
    formatId: string,
    outputPath?: string,
    customDownloadId?: string
  ): Promise<StartDownloadResult> {
    const yt = await this.ensureInitialized();
    const downloadId =
      customDownloadId || `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Resolve output path if not provided
    let finalOutputPath = outputPath;
    if (!finalOutputPath) {
      const defaultDir = app.getPath('downloads') || app.getPath('userData');
      const sanitizedName = `download_${Date.now()}_${formatId}.mp4`;
      finalOutputPath = path.join(defaultDir, sanitizedName);
    }

    const parentDir = path.dirname(finalOutputPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // ── FIX (1): Clean stale partial / temp files before starting ────────
    // This prevents yt-dlp from trying to --continue a corrupted partial file,
    // which is the root cause of "Conflicting range" errors on Pinterest.
    this.cleanPartialFiles(finalOutputPath);

    // Format selection argument
    let formatArg = formatId;
    if (formatId === 'lowest') {
      formatArg = 'worstvideo+worstaudio/worst';
    } else if (formatId === 'best') {
      formatArg = 'bestvideo+bestaudio/best';
    } else {
      // Append bestaudio if the format is video-only so it gets merged with audio
      formatArg = `${formatId}+bestaudio/best/${formatId}`;
    }

    // Start with aggressive multi-connection settings (optimised for YouTube)
    return this.launchDownload(yt, {
      downloadId,
      url,
      formatArg,
      finalOutputPath,
      useAggressiveSettings: true,
    });
  }

  /**
   * Internal: actually launch a yt-dlp download. Separated out so we can call
   * it a second time with conservative settings on a retry.
   */
  private launchDownload(
    yt: YTDlpWrap,
    opts: {
      downloadId: string;
      url: string;
      formatArg: string;
      finalOutputPath: string;
      useAggressiveSettings: boolean;
      isRetry?: boolean;
    }
  ): Promise<StartDownloadResult> {
    const { downloadId, url, formatArg, finalOutputPath, useAggressiveSettings, isRetry } = opts;

    const args = [
      '-4', // Force IPv4: avoids fragment socket stalling
      url,
      '-f',
      formatArg,
      '--no-mtime', // Skip file modification time write to finish immediately
      '-o',
      finalOutputPath,
      '--no-warnings',
      '--no-playlist',
    ];

    if (finalOutputPath.toLowerCase().endsWith('.mp4')) {
      args.push('--merge-output-format', 'mp4');
    }

    const isHls = this.isHlsOrFragmented(url, formatArg);

    if (useAggressiveSettings) {
      if (isHls) {
        // ── Aggressive HLS/Fragmented: Native fragment concurrency (-N 8), NO byte-range chunking ──
        // HLS/DASH delivers media in pre-sliced fragments (.ts / .m4s). Passing --http-chunk-size causes
        // yt-dlp to send byte-range HTTP headers for each fragment, which CDNs reject (Conflicting range / 416).
        // We leverage yt-dlp's native fragment concurrency (-N 8) while omitting --http-chunk-size.
        args.push(
          '--continue',
          '-N', '8',             // 8 concurrent fragment connections
          '--buffer-size', '1024K',
        );
      } else {
        // ── Aggressive Progressive (e.g. YouTube): Multi-connection + 10MB chunking ──
        args.push(
          '--continue',
          '-N', '8',             // 8 concurrent connections
          '--buffer-size', '1024K',
          '--http-chunk-size', '10M', // 10MB byte-range chunks to avoid ISP/CDN throttling
        );
      }
    } else {
      // ── Conservative: single-connection, no chunking (safer fallback) ──
      // Many platforms (Pinterest, Instagram, Twitter/X) don't support HTTP
      // range requests or multi-connection downloads reliably.
      args.push(
        '--no-continue',       // Force fresh download, ignore stale partials
        '-N', '1',             // Single connection
        '--buffer-size', '512K',
      );
    }

    if (this.denoBinaryPath) {
      args.push('--js-runtimes', `deno:${this.denoBinaryPath}`);
    }

    if (this.ffmpegBinaryPath) {
      args.push('--ffmpeg-location', this.ffmpegBinaryPath);
    }

    const settingsLabel = useAggressiveSettings
      ? isHls
        ? 'aggressive-hls (N=8 fragments, native concurrency, no range-chunking)'
        : 'aggressive-progressive (N=8, 10M chunks)'
      : 'conservative (N=1, no chunks)';
    logger.info(
      `[startDownload] Launching download [${settingsLabel}]${isRetry ? ' (RETRY)' : ''} with args: ${args.join(' ')}`
    );

    const emitter = yt.exec(args);

    // Collect stderr for error analysis (range/chunk detection)
    let stderrBuffer = '';
    if (emitter.ytDlpProcess?.stderr) {
      emitter.ytDlpProcess.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
      });
    }

    const activeItem: ActiveDownload = {
      downloadId,
      url,
      outputPath: finalOutputPath,
      emitter,
      isCancelled: false,
    };
    this.activeDownloads.set(downloadId, activeItem);

    emitter.on('progress', (progressObj) => {
      if (activeItem.isCancelled) return;
      this.progressCallback?.({
        downloadId,
        percent: progressObj.percent || 0,
        speed: progressObj.currentSpeed ? `${progressObj.currentSpeed}` : undefined,
        eta: progressObj.eta ? `${progressObj.eta}` : undefined,
        totalSize: progressObj.totalSize ? `${progressObj.totalSize}` : undefined,
        status: 'downloading',
        outputPath: finalOutputPath,
      });
    });

    emitter.on('close', () => {
      if (activeItem.isCancelled) {
        this.cleanPartialFiles(finalOutputPath);
        return;
      }
      this.activeDownloads.delete(downloadId);
      // Clean up any lingering fragment files or temp files while keeping final completed file
      this.cleanPartialFiles(finalOutputPath);
      this.progressCallback?.({
        downloadId,
        percent: 100,
        status: 'completed',
        outputPath: finalOutputPath,
      });
    });

    emitter.on('error', (err: any) => {
      if (activeItem.isCancelled) {
        this.cleanPartialFiles(finalOutputPath);
        return;
      }

      const errMsg = (err?.message || '') + '\n' + stderrBuffer;

      // ── Retry with conservative settings on range/chunk errors ─
      if (useAggressiveSettings && !isRetry && this.isRangeOrChunkError(errMsg)) {
        logger.warn(
          `[startDownload] Range/chunk error detected, retrying with conservative settings. ` +
          `Error: ${err?.message || 'unknown'}`
        );

        // Clean up failed partial files before retry
        this.cleanPartialFiles(finalOutputPath);
        this.activeDownloads.delete(downloadId);

        // Retry with conservative (single-connection) settings
        this.launchDownload(yt, {
          downloadId,
          url,
          formatArg,
          finalOutputPath,
          useAggressiveSettings: false,
          isRetry: true,
        }).catch((retryErr) => {
          logger.error(`[startDownload] Conservative retry also failed:`, retryErr);
          this.cleanPartialFiles(finalOutputPath);
          this.progressCallback?.({
            downloadId,
            percent: 0,
            status: 'error',
            error: retryErr?.message || 'Download failed after retry with conservative settings',
            outputPath: finalOutputPath,
          });
        });
        return; // Don't emit error — the retry will handle it
      }

      // On any download error, clean up all partial, fragment, and empty files
      this.activeDownloads.delete(downloadId);
      this.cleanPartialFiles(finalOutputPath);
      this.progressCallback?.({
        downloadId,
        percent: 0,
        status: 'error',
        error: err?.message || 'Download error occurred',
        outputPath: finalOutputPath,
      });
    });

    return Promise.resolve({ downloadId, outputPath: finalOutputPath });
  }

  public async cancelDownload(
    downloadId: string,
    keepPartial = false
  ): Promise<CancelDownloadResult> {
    const item = this.activeDownloads.get(downloadId);
    if (!item) {
      return { success: false, downloadId };
    }

    item.isCancelled = true;
    try {
      if (item.emitter.ytDlpProcess && !item.emitter.ytDlpProcess.killed) {
        item.emitter.ytDlpProcess.kill('SIGTERM');
      }
    } catch (e) {
      logger.warn(`Error killing process for download ${downloadId}:`, e);
    }

    this.activeDownloads.delete(downloadId);

    // ── FIX (2): Thorough cleanup of ALL temp files on cancel ────────────
    // Prevents orphaned .part/.ytdl files from causing "Conflicting range"
    // errors on the next download attempt to the same output path.
    if (!keepPartial) {
      this.cleanPartialFiles(item.outputPath);

      // Also remove the main output file if it's empty (incomplete write)
      try {
        if (fs.existsSync(item.outputPath)) {
          const stat = fs.statSync(item.outputPath);
          if (stat.size === 0) {
            fs.unlinkSync(item.outputPath);
            logger.info(`[cancelDownload] Removed empty output file: "${item.outputPath}"`);
          }
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    this.progressCallback?.({
      downloadId,
      percent: 0,
      status: 'cancelled',
      outputPath: item.outputPath,
    });

    return { success: true, downloadId };
  }

  private formatSeconds(sec: number): string {
    const s = Math.floor(sec);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hrs > 0) {
      return `${hrs}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }
}

export const downloadManager = new DownloadManager();
