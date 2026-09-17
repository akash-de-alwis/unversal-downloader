import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import YTDlpWrap from 'yt-dlp-wrap';
import ffmpegPath from 'ffmpeg-static';
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
  private activeDownloads: Map<string, ActiveDownload> = new Map();
  private progressCallback: ((progress: DownloadProgress) => void) | null = null;

  constructor() {
    this.ffmpegBinaryPath = this.resolveFfmpegPath();
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

  private initPromise: Promise<void> | null = null;

  public initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    const isWin = process.platform === 'win32';
    const binaryName = isWin ? 'yt-dlp.exe' : 'yt-dlp';

    // Cache in app's userData directory
    const userDataPath = app.getPath('userData');
    const binDir = path.join(userDataPath, 'bin');
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    this.binaryPath = path.join(binDir, binaryName);

    // Check if binary already exists and is valid (> 5MB)
    const exists = fs.existsSync(this.binaryPath);
    let needsDownload = true;

    if (exists) {
      try {
        const stats = fs.statSync(this.binaryPath);
        if (stats.size > 5 * 1024 * 1024) {
          needsDownload = false;
        }
      } catch (err) {
        console.warn('Error checking existing yt-dlp binary:', err);
      }
    }

    // Check if a local project bin exists as fallback
    if (needsDownload) {
      const devBinPath = path.resolve(process.cwd(), 'bin', binaryName);
      if (fs.existsSync(devBinPath)) {
        try {
          fs.copyFileSync(devBinPath, this.binaryPath);
          needsDownload = false;
          console.log(`Copied cached yt-dlp binary from ${devBinPath} to ${this.binaryPath}`);
        } catch (copyErr) {
          console.warn('Failed to copy dev binary:', copyErr);
        }
      }
    }

    if (needsDownload) {
      console.log(`Downloading latest official yt-dlp release binary into ${this.binaryPath}...`);
      await YTDlpWrap.downloadFromGithub(this.binaryPath);
      if (!isWin) {
        try {
          fs.chmodSync(this.binaryPath, 0o755);
        } catch (e) {
          console.warn('chmod failed on yt-dlp binary:', e);
        }
      }
      console.log('yt-dlp binary successfully downloaded and cached in userData.');
    }

    this.ytDlp = new YTDlpWrap(this.binaryPath);
    try {
      const version = await this.ytDlp.getVersion();
      console.log(`yt-dlp initialized successfully (version: ${version.trim()})`);
    } catch (verErr) {
      console.warn('Could not verify yt-dlp version:', verErr);
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

  public async fetchInfo(url: string): Promise<VideoMetadata> {
    const yt = await this.ensureInitialized();

    const args = ['--dump-json', '--no-warnings', '--no-playlist'];
    if (this.ffmpegBinaryPath) {
      args.push('--ffmpeg-location', this.ffmpegBinaryPath);
    }
    args.push(url);

    const stdout = await yt.execPromise(args);
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

    return {
      title: raw.title || 'Untitled Media',
      thumbnail: thumbnail || '',
      duration,
      durationFormatted: this.formatSeconds(duration),
      uploader: raw.uploader || raw.channel || raw.uploader_id || 'Unknown',
      formats,
      webpageUrl: raw.webpage_url || url,
    };
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

    const args = [
      url,
      '-f',
      formatArg,
      '--continue',
      '-o',
      finalOutputPath,
      '--no-warnings',
      '--no-playlist',
    ];

    if (this.ffmpegBinaryPath) {
      args.push('--ffmpeg-location', this.ffmpegBinaryPath);
    }

    const emitter = yt.exec(args);

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
      if (activeItem.isCancelled) return;
      this.activeDownloads.delete(downloadId);
      this.progressCallback?.({
        downloadId,
        percent: 100,
        status: 'completed',
        outputPath: finalOutputPath,
      });
    });

    emitter.on('error', (err: any) => {
      if (activeItem.isCancelled) return;
      this.activeDownloads.delete(downloadId);
      this.progressCallback?.({
        downloadId,
        percent: 0,
        status: 'error',
        error: err?.message || 'Download error occurred',
        outputPath: finalOutputPath,
      });
    });

    return { downloadId, outputPath: finalOutputPath };
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
      console.warn(`Error killing process for download ${downloadId}:`, e);
    }

    this.activeDownloads.delete(downloadId);

    // Clean up partial file if requested
    if (!keepPartial) {
      try {
        const partialPart = `${item.outputPath}.part`;
        if (fs.existsSync(partialPart)) fs.unlinkSync(partialPart);
      } catch {
        // Ignore partial file cleanup error
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
