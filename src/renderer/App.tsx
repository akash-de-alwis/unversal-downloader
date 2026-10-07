import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  CheckCircle2,
  FolderOpen,
  Clipboard,
  AlertTriangle,
  RotateCcw,
  Video as VideoIcon,
  XCircle,
  X as XIcon,
  ExternalLink,
  Pause,
  Play,
  Trash2,
  HelpCircle,
  Copy,
  RefreshCw,
  Search as SearchIcon,
  ChevronLeft,
} from 'lucide-react';
import type {
  AppInfoResponse,
  VideoMetadata,
  VideoFormat,
  FriendlyFormatOption,
  QueueItem,
  HistoryItem,
  AppSettings,
  UpdateStatus,
  PublicStats,
  SearchResult,
} from '../shared/types';
import { MP3_BITRATE_KBPS } from '../shared/constants';
import { OnboardingModal } from './components/OnboardingModal';
import logoUrl from './assets/logo.png';
import developerPhotoUrl from './assets/developer.png';

// How often the Download screen refreshes the public stats row
const STATS_REFRESH_MS = 30_000;

const DEVELOPER_LINKS = {
  facebook: 'https://www.facebook.com/profile.php?id=61594043770505',
  tiktok: 'https://www.tiktok.com/@akashmakes',
} as const;

// lucide-react no longer ships brand marks, so these are inline
const FacebookIcon: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07z" />
  </svg>
);

const TikTokIcon: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
  </svg>
);

export type ActiveTab = 'downloader' | 'queue' | 'history' | 'settings';
export type FetchState = 'idle' | 'loading' | 'searching' | 'results' | 'preview' | 'error';

/** Links go straight to the single-video fetch; anything else is a YouTube search */
function looksLikeUrl(input: string): boolean {
  return /^(https?:\/\/|www\.)/i.test(input.trim());
}

function groupFormatsIntoFriendlyOptions(
  formats: VideoFormat[],
  durationSec: number
): FriendlyFormatOption[] {
  const options: FriendlyFormatOption[] = [];
  const videoFormats = formats.filter((f) => f.hasVideo);

  if (videoFormats.length > 0) {
    const sorted = [...videoFormats].sort((a, b) => {
      const getH = (res: string) => {
        const m = res.match(/(\d+)x(\d+)/);
        if (m) return parseInt(m[2], 10);
        const p = res.match(/(\d+)p/);
        if (p) return parseInt(p[1], 10);
        return 0;
      };
      return getH(b.resolution) - getH(a.resolution);
    });

    const best = sorted[0];
    options.push({
      id: 'best',
      label: `Best (${best.resolution})`,
      formatId: best.formatId,
      resolution: best.resolution,
      ext: best.ext,
      filesizeFormatted: best.filesizeFormatted,
      isAudioOnly: false,
      needsMerge: !best.hasAudio,
    });

    const targets = [
      { name: '1080p (Full HD)', height: 1080 },
      { name: '720p (HD)', height: 720 },
      { name: '480p (SD)', height: 480 },
      { name: '360p (Low)', height: 360 },
      { name: '240p (Lowest)', height: 240 },
    ];

    const addedHeights = new Set<number>();
    const bestHeight =
      best.resolution.match(/(\d+)x(\d+)/)?.[2] || best.resolution.match(/(\d+)p/)?.[1];
    if (bestHeight) addedHeights.add(parseInt(bestHeight, 10));

    for (const t of targets) {
      if (addedHeights.has(t.height)) continue;
      const match = sorted.find((f) => {
        const m = f.resolution.match(/(\d+)x(\d+)/);
        if (m && parseInt(m[2], 10) === t.height) return true;
        const p = f.resolution.match(/(\d+)p/);
        if (p && parseInt(p[1], 10) === t.height) return true;
        return false;
      });

      if (match) {
        addedHeights.add(t.height);
        options.push({
          id: `${t.height}p`,
          label: t.name,
          formatId: match.formatId,
          resolution: match.resolution,
          ext: match.ext,
          filesizeFormatted: match.filesizeFormatted,
          isAudioOnly: false,
          needsMerge: !match.hasAudio,
        });
      }
    }

    const lowest = sorted[sorted.length - 1];
    if (!options.some((o) => o.formatId === lowest.formatId)) {
      options.push({
        id: 'lowest',
        label: `Lowest (${lowest.resolution})`,
        formatId: lowest.formatId,
        resolution: lowest.resolution,
        ext: lowest.ext,
        filesizeFormatted: lowest.filesizeFormatted,
        isAudioOnly: false,
        needsMerge: !lowest.hasAudio,
      });
    }
  }

  // Audio-only takes the best audio track ('ba/b') and converts it to a constant-bitrate
  // MP3, so the final size follows from the duration rather than the source stream.
  const mp3Bytes = durationSec > 0 ? (durationSec * MP3_BITRATE_KBPS * 1000) / 8 : 0;
  options.push({
    id: 'audio',
    label: 'Audio only (MP3)',
    formatId: 'ba/b',
    resolution: 'Audio only',
    ext: 'mp3',
    filesizeFormatted: mp3Bytes ? `~${(mp3Bytes / (1024 * 1024)).toFixed(1)} MB` : undefined,
    isAudioOnly: true,
    needsMerge: false,
  });

  return options;
}

function shortOptionLabel(opt: FriendlyFormatOption): string {
  const height = opt.resolution.match(/(\d+)x(\d+)/)?.[2] || opt.resolution.match(/(\d+)p/)?.[1];
  const res = height ? (parseInt(height, 10) >= 2160 ? '4K' : `${height}p`) : '';
  if (opt.id === 'best') return res ? `Best · ${res}` : 'Best';
  if (opt.id === 'lowest') return res ? `Lowest · ${res}` : 'Lowest';
  if (opt.isAudioOnly) return 'Audio';
  return opt.id === '2160p' ? '4K' : opt.id;
}

// Main Application Component
export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('downloader');
  const [url, setUrl] = useState('');
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [videoInfo, setVideoInfo] = useState<VideoMetadata | null>(null);
  // Search by name: the last term and its results (kept so the preview can go back to them)
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  // The input value the card's current preview / results / error belongs to
  const shownForInputRef = useRef('');
  const [friendlyOptions, setFriendlyOptions] = useState<FriendlyFormatOption[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<string>('best');

  // Queue & History state
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Settings & Diagnostics
  const [settings, setSettings] = useState<AppSettings>({
    downloadFolder: '',
    maxConcurrent: 2,
    theme: 'dark',
  });
  const [copiedDiagnostics, setCopiedDiagnostics] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' });
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  // Onboarding
  const [showOnboarding, setShowOnboarding] = useState(false);

  // App Info & Error state
  const [appInfo, setAppInfo] = useState<AppInfoResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [rawErrorDetails, setRawErrorDetails] = useState<string>('');
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  // Anonymous public stats; null hides the stats row (not loaded yet, or backend unreachable)
  const [publicStats, setPublicStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    if (activeTab !== 'downloader' || !window.api?.getStats) return;
    let cancelled = false;
    const load = () => {
      window.api
        .getStats()
        .then((stats) => !cancelled && setPublicStats(stats))
        .catch(() => !cancelled && setPublicStats(null));
    };
    load();
    const timer = setInterval(load, STATS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeTab]);

  useEffect(() => {
    // Initial data load
    if (window.api?.getAppInfo) {
      window.api.getAppInfo().then(setAppInfo).catch(console.error);
    }
    if (window.api?.getSettings) {
      window.api.getSettings().then(setSettings).catch(console.error);
    }
    if (window.api?.hasCompletedOnboarding) {
      window.api
        .hasCompletedOnboarding()
        .then((completed) => {
          if (!completed) setShowOnboarding(true);
        })
        .catch(console.error);
    }
    if (window.api?.getQueue) {
      window.api.getQueue().then(setQueue).catch(console.error);
    }
    if (window.api?.getHistory) {
      window.api.getHistory().then(setHistory).catch(console.error);
    }

    if (!window.api) {
      setSettings({
        downloadFolder: 'C:\\Users\\akash\\Downloads',
        maxConcurrent: 2,
        theme: 'dark',
      });
      setHistory([
        {
          id: 'hist-1',
          title: 'Lo-Fi Chill Beats to Study/Relax to [24/7 Deep Focus Music]',
          url: 'https://youtube.com/watch?v=mock1',
          quality: '1080p (60fps)',
          ext: 'mp4',
          filePath: 'C:\\Users\\akash\\Downloads\\lofi_chill_beats.mp4',
          fileSizeFormatted: '184.2 MB',
          date: '2026-09-27 21:15',
          status: 'completed',
          thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&q=80',
        },
        {
          id: 'hist-2',
          title: 'Cinematic Drone 4K Nature Landscapes Across Switzerland',
          url: 'https://youtube.com/watch?v=mock2',
          quality: '4K (2160p)',
          ext: 'mp4',
          filePath: 'C:\\Users\\akash\\Downloads\\switzerland_4k.mp4',
          fileSizeFormatted: '1.42 GB',
          date: '2026-09-27 20:30',
          status: 'completed',
          thumbnail: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=300&q=80',
        },
        {
          id: 'hist-3',
          title: 'Acoustic Guitar Sessions Vol. 3 — Fingerstyle Instrumental Album',
          url: 'https://youtube.com/watch?v=mock3',
          quality: 'Audio only (320kbps)',
          ext: 'mp3',
          filePath: 'C:\\Users\\akash\\Downloads\\acoustic_guitar_vol3.mp3',
          fileSizeFormatted: '94.8 MB',
          date: '2026-09-27 18:45',
          status: 'completed',
          thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80',
        },
        {
          id: 'hist-4',
          title: 'Full Stack Architecture in 2026: Deep Dive into Distributed Engines',
          url: 'https://youtube.com/watch?v=mock4',
          quality: '1080p',
          ext: 'mp4',
          filePath: 'C:\\Users\\akash\\Downloads\\fullstack_2026.mp4',
          fileSizeFormatted: '412.0 MB',
          date: '2026-09-27 16:10',
          status: 'completed',
          thumbnail: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=300&q=80',
        },
        {
          id: 'hist-5',
          title: 'Tokyo Cyberpunk Midnight Walk in Rain — Binaural 3D Audio',
          url: 'https://youtube.com/watch?v=mock5',
          quality: '1440p',
          ext: 'mkv',
          filePath: 'C:\\Users\\akash\\Downloads\\tokyo_midnight.mkv',
          fileSizeFormatted: '890.5 MB',
          date: '2026-09-26 23:50',
          status: 'completed',
          thumbnail: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=300&q=80',
        },
        {
          id: 'hist-6',
          title: 'Introduction to Quantum Algorithms and Tensor Networks',
          url: 'https://youtube.com/watch?v=mock6',
          quality: '720p',
          ext: 'mp4',
          filePath: 'C:\\Users\\akash\\Downloads\\quantum_algorithms.mp4',
          fileSizeFormatted: '215.3 MB',
          date: '2026-09-26 14:20',
          status: 'completed',
          thumbnail: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=300&q=80',
        },
      ]);
    }

    // Subscribe to live queue updates
    const unsubQueue = window.api?.onQueueStateChanged?.((items) => {
      setQueue(items);
      if (items.some((i) => i.status === 'completed')) {
        window.api?.getHistory?.().then(setHistory).catch(console.error);
      }
    });

    // Subscribe to auto-update status
    const unsubUpdate = window.api?.onUpdateStatus?.((status) => {
      setUpdateStatus(status);
      setIsCheckingUpdate(false);
    });

    return () => {
      unsubQueue?.();
      unsubUpdate?.();
    };
  }, []);

  const handleCloseOnboarding = async () => {
    setShowOnboarding(false);
    if (window.api?.setOnboardingCompleted) {
      await window.api.setOnboardingCompleted();
    }
  };

  const handlePaste = async () => {
    try {
      let text = '';
      if (window.api?.readClipboard) {
        text = await window.api.readClipboard();
      } else {
        text = await navigator.clipboard.readText();
      }
      if (text) {
        setUrl(text.trim());
        handleFetch(text.trim());
      }
    } catch (err) {
      console.warn('Clipboard read error:', err);
    }
  };

  const handleSearch = async (term: string) => {
    shownForInputRef.current = term;
    setFetchState('searching');
    setErrorMessage('');
    setRawErrorDetails('');
    setVideoInfo(null);
    setSearchTerm(term);
    setSearchResults(null);

    if (!window.api?.searchVideos) {
      setSearchResults([]);
      setFetchState('results');
      return;
    }

    try {
      setSearchResults(await window.api.searchVideos(term));
      setFetchState('results');
    } catch (err: any) {
      console.error('Search error:', err);
      const raw = err?.message || String(err);
      let friendly = "Couldn't search YouTube right now. Try again, or paste a video link instead.";
      if (raw.includes('ENOTFOUND') || raw.includes('getaddrinfo') || raw.includes('network')) {
        friendly = 'Network connection failed. Please check your connection.';
      } else if (raw.includes('timed out')) {
        friendly = 'The search took too long. Check your connection and try again.';
      }
      setErrorMessage(friendly);
      setRawErrorDetails(raw);
      setFetchState('error');
    }
  };

  // A picked result goes through the normal link flow: same fetch, preview and Download
  const handleSelectSearchResult = (result: SearchResult) => {
    setUrl(result.url);
    handleFetch(result.url, { fromSearch: true });
  };

  // Drop any preview, results or error so the card is ready for a new search or link
  const resetCard = () => {
    setFetchState('idle');
    setVideoInfo(null);
    setSearchResults(null);
    setSearchTerm('');
    setErrorMessage('');
    setRawErrorDetails('');
    setShowErrorDetails(false);
    shownForInputRef.current = '';
  };

  // The input's X: empty the box and reset the card
  const handleClearInput = () => {
    setUrl('');
    resetCard();
    urlInputRef.current?.focus();
  };

  // Typing a genuinely different value over a preview, results or error starts over
  const handleInputChange = (value: string) => {
    setUrl(value);
    const showingSomething =
      fetchState === 'preview' || fetchState === 'results' || fetchState === 'error';
    if (showingSomething && value.trim() !== shownForInputRef.current) {
      resetCard();
    }
  };

  const handleBackToResults = () => {
    shownForInputRef.current = searchTerm;
    setUrl(searchTerm);
    setVideoInfo(null);
    setFetchState('results');
  };

  const handleFetch = async (targetUrl?: string, { fromSearch = false } = {}) => {
    const urlToFetch = (targetUrl ?? url).trim();
    if (!urlToFetch) return;

    if (!looksLikeUrl(urlToFetch)) {
      await handleSearch(urlToFetch);
      return;
    }
    if (!fromSearch) setSearchResults(null);
    shownForInputRef.current = urlToFetch;

    try {
      setFetchState('loading');
      setErrorMessage('');
      setRawErrorDetails('');
      if (!window.api?.fetchInfo) {
        setTimeout(() => {
          const mockInfo: VideoMetadata = {
            id: 'mock-video-id',
            title: 'Exploring Alpine Peaks: Cinematic 4K HDR Documentary & Nature Soundscapes',
            webpageUrl: urlToFetch,
            thumbnail: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&q=80',
            duration: 754,
            durationFormatted: '12:34',
            uploader: 'Alpine Explorer Studio',
            viewCount: 2450000,
            formats: [],
          };
          setVideoInfo(mockInfo);
          setFriendlyOptions([
            {
              id: '2160p',
              label: '4K Ultra HD (2160p)',
              formatId: '4k',
              resolution: '3840x2160',
              ext: 'mp4',
              filesizeFormatted: '1.2 GB',
              isAudioOnly: false,
              needsMerge: true,
            },
            {
              id: '1080p',
              label: 'Full HD (1080p)',
              formatId: '1080',
              resolution: '1920x1080',
              ext: 'mp4',
              filesizeFormatted: '380 MB',
              isAudioOnly: false,
              needsMerge: true,
            },
            {
              id: '720p',
              label: 'HD (720p)',
              formatId: '720',
              resolution: '1280x720',
              ext: 'mp4',
              filesizeFormatted: '145 MB',
              isAudioOnly: false,
              needsMerge: false,
            },
            {
              id: 'audio',
              label: 'Audio only (MP3/M4A)',
              formatId: 'audio',
              resolution: 'Audio only',
              ext: 'mp3',
              filesizeFormatted: '28 MB',
              isAudioOnly: true,
              needsMerge: false,
            },
          ]);
          setSelectedOptionId('1080p');
          setFetchState('preview');
        }, 500);
        return;
      }

      const info = await window.api.fetchInfo(urlToFetch);
      const grouped = groupFormatsIntoFriendlyOptions(info.formats, info.duration);

      setVideoInfo(info);
      setFriendlyOptions(grouped);
      if (grouped.length > 0) {
        setSelectedOptionId(grouped[0].id);
      }

      setFetchState('preview');
    } catch (err: any) {
      console.error('Fetch error:', err);
      const raw = err?.message || String(err);
      let friendly =
        'Could not retrieve video information. Please check the URL and internet connection.';
      if (raw.includes('timed out') || raw.includes('timeout')) {
        friendly =
          'Analysis timed out after 30 seconds. The yt-dlp media engine did not respond in time (it may be blocked by Windows Defender/antivirus, stalled by a network firewall, or rate-limited).';
      } else if (raw.includes('quarantined') || raw.includes('removed')) {
        friendly =
          'The media extraction engine (yt-dlp) was quarantined or deleted by Windows Defender / antivirus. Please restore or exclude it in Windows Security.';
      } else if (
        raw.includes('blocked by Windows Defender') ||
        raw.includes('EPERM') ||
        raw.includes('EACCES')
      ) {
        friendly =
          'Execution was blocked by Windows Defender or security permissions. Please add an exclusion for Universal Downloader in your antivirus settings.';
      } else if (raw.includes('locked by another process') || raw.includes('EBUSY')) {
        friendly =
          'The media engine is currently locked by a system scan. Please wait a few moments and try again.';
      } else if (raw.includes('Unsupported URL')) {
        friendly = 'The provided URL is not supported or recognized as a valid media link.';
      } else if (raw.includes('Private video')) {
        friendly = 'This video is private or requires authentication.';
      } else if (raw.includes('ENOTFOUND')) {
        friendly = 'Network connection failed. Please check your connection.';
      }

      setErrorMessage(friendly);
      setRawErrorDetails(raw);
      setFetchState('error');
    }
  };

  const handleAddToQueue = async () => {
    if (!url.trim() || !videoInfo) return;

    const opt = friendlyOptions.find((o) => o.id === selectedOptionId) || friendlyOptions[0];
    if (!opt) return;

    try {
      const safeTitle = (videoInfo.title || 'video')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .substring(0, 60);
      // Matches what the main process produces: video is remuxed to .mp4, audio converted to .mp3
      const finalExt = opt.isAudioOnly ? 'mp3' : 'mp4';
      const folder = settings.downloadFolder || '';
      const outputPath = folder ? `${folder}\\${safeTitle}_${opt.id}.${finalExt}` : undefined;

      if (window.api?.addToQueue) {
        await window.api.addToQueue({
          url: url.trim(),
          title: videoInfo.title,
          thumbnail: videoInfo.thumbnail,
          durationFormatted: videoInfo.durationFormatted,
          qualityLabel: opt.label,
          formatId: opt.formatId,
          outputPath,
        });
      } else {
        setQueue((prev) => [
          ...prev,
          {
            id: `q-${Date.now()}`,
            url: url.trim(),
            title: videoInfo.title,
            thumbnail: videoInfo.thumbnail,
            durationFormatted: videoInfo.durationFormatted,
            qualityLabel: opt.label,
            formatId: opt.formatId,
            status: 'downloading',
            percent: 42,
            speed: '8.4 MB/s',
            eta: '00:45',
            totalSize: '380 MB',
          },
        ]);
      }

      setActiveTab('queue');
      setVideoInfo(null);
      setFetchState('idle');
      setUrl('');
    } catch (err) {
      console.error('Add to queue failed:', err);
    }
  };

  const handlePauseQueueItem = async (id: string) => {
    await window.api.pauseQueueItem(id);
  };

  const handleResumeQueueItem = async (id: string) => {
    await window.api.resumeQueueItem(id);
  };

  const handleCancelQueueItem = async (id: string) => {
    await window.api.cancelQueueItem(id);
    window.api?.getHistory?.().then(setHistory).catch(console.error);
  };

  const handleClearCompleted = async () => {
    await window.api.clearCompletedQueue();
  };

  const handleChooseFolder = async () => {
    try {
      const selected = await window.api?.selectFolder();
      if (selected) {
        const updated = await window.api.updateSettings({ downloadFolder: selected });
        setSettings(updated);
      }
    } catch (err) {
      console.error('Folder selection error:', err);
    }
  };

  const handleUpdateConcurrency = async (val: number) => {
    const updated = await window.api.updateSettings({ maxConcurrent: val });
    setSettings(updated);
  };

  const handleDeleteHistory = async (id: string) => {
    await window.api.deleteHistoryItem(id);
    const updated = await window.api.getHistory();
    setHistory(updated);
  };

  const handleClearAllHistory = async () => {
    await window.api.clearAllHistory();
    setHistory([]);
  };

  const handleOpenFile = (filePath: string) => {
    if (filePath && window.api?.openPath) {
      window.api.openPath(filePath);
    }
  };

  const handleRedownloadHistory = (item: HistoryItem) => {
    setUrl(item.url);
    setActiveTab('downloader');
    handleFetch(item.url);
  };

  const handleCopyDiagnostics = async () => {
    try {
      if (window.api?.getDiagnostics) {
        const report = await window.api.getDiagnostics();
        await navigator.clipboard.writeText(report.rawSummary);
        setCopiedDiagnostics(true);
        setTimeout(() => setCopiedDiagnostics(false), 3000);
      }
    } catch (err) {
      console.error('Failed to copy diagnostics:', err);
    }
  };

  const handleCheckUpdates = async () => {
    try {
      setIsCheckingUpdate(true);
      if (window.api?.checkForUpdates) {
        const res = await window.api.checkForUpdates();
        setUpdateStatus(res);
      }
    } catch (err) {
      console.error('Check update failed:', err);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const activeDownloadsCount = queue.filter(
    (i) => i.status === 'downloading' || i.status === 'queued'
  ).length;

  const isFetchBusy = fetchState === 'loading' || fetchState === 'searching';

  const engineStatus =
    fetchState === 'loading'
      ? 'Checking link…'
      : fetchState === 'searching'
        ? 'Searching…'
        : activeDownloadsCount > 0
          ? `${activeDownloadsCount} downloading`
          : 'Ready to download';

  const navItems: { id: ActiveTab; label: string }[] = [
    { id: 'downloader', label: 'Download' },
    { id: 'queue', label: 'Queue' },
    { id: 'history', label: 'History' },
    { id: 'settings', label: 'Settings' },
  ];

  const isPreview = fetchState === 'preview' && videoInfo !== null;

  return (
    <div className="app-shell" id="app-root">
      {/* First-Run Onboarding Modal */}
      <OnboardingModal isOpen={showOnboarding} onClose={handleCloseOnboarding} />

      {/* Aurora backdrop — fixed, behind all content */}
      <div className="aurora" aria-hidden="true">
        <div className="aurora-glow" />
        <div className="aurora-streaks" />
        <svg className="aurora-waves" viewBox="0 0 1200 200" preserveAspectRatio="none">
          <path d="M0,120 C150,40 300,40 450,110 C600,180 750,170 900,100 C1020,45 1120,60 1200,90" />
          <path d="M0,150 C200,190 350,70 550,90 C750,110 850,190 1050,150 C1120,135 1170,120 1200,115" />
          <path d="M0,90 C180,140 320,160 500,130 C700,95 820,60 1000,85 C1100,100 1160,125 1200,135" />
        </svg>
      </div>

      {/* Top bar */}
      <header className="topbar" id="app-titlebar">
        <img className="topbar-logo" src={logoUrl} alt="Universal Downloader" draggable={false} />

        <nav className="topbar-nav" id="navigation-tabs">
          {navItems.map((n) => (
            <button
              key={n.id}
              id={`tab-${n.id}`}
              type="button"
              className={`topbar-link ${activeTab === n.id ? 'active' : ''}`}
              onClick={() => setActiveTab(n.id)}
            >
              {n.label}
            </button>
          ))}
        </nav>

        <div className="topbar-status" id="app-system-status">
          <span
            className={`topbar-status-dot ${isFetchBusy || activeDownloadsCount > 0 ? 'busy' : ''}`}
          />
          <span>{engineStatus}</span>
        </div>
      </header>

      {/* Scrolling content column */}
      <main className="main-scroll" id="app-main-content">
        {/* TAB 1: DOWNLOADER */}
        {activeTab === 'downloader' && (
          <section className="download-screen" id="url-input-card">
            <h1 className="hero-title">Download Any Video, Anywhere</h1>
            <p className="hero-subtitle">
              Paste a link from YouTube, Pinterest, TikTok and 1,800+ sites.
            </p>

            <div
              className={`input-card ${isPreview || fetchState === 'results' ? 'expanded' : ''}`}
              id="download-input-card"
            >
              {/* URL field */}
              <div className="input-card-url-row">
                <input
                  ref={urlInputRef}
                  id="main-url-input"
                  type="text"
                  className="input-card-url"
                  placeholder="Search or paste a video link..."
                  value={url}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    // Same as clicking Fetch; ignore Enter that confirms an IME composition
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleFetch();
                    }
                  }}
                  disabled={isFetchBusy}
                  spellCheck={false}
                  autoFocus
                />
                {url && (
                  <button
                    id="btn-clear-input"
                    type="button"
                    className="input-card-clear"
                    onClick={handleClearInput}
                    disabled={isFetchBusy}
                    title="Clear"
                    aria-label="Clear"
                  >
                    <XIcon size={13} />
                  </button>
                )}
                <button
                  id="btn-paste-clipboard"
                  type="button"
                  className="input-card-paste"
                  onClick={handlePaste}
                  disabled={isFetchBusy}
                  title="Paste from clipboard"
                >
                  <Clipboard size={13} />
                  <span>Paste</span>
                </button>
              </div>

              {/* Loading shimmer */}
              {fetchState === 'loading' && (
                <div className="input-card-loading" id="state-loading-card">
                  <div className="shimmer-thumb" />
                  <div className="shimmer-lines">
                    <div className="shimmer-line" />
                    <div className="shimmer-line short" />
                  </div>
                </div>
              )}

              {/* Search loading: placeholder result rows */}
              {fetchState === 'searching' && (
                <div className="search-results" id="state-search-loading" aria-busy="true">
                  <div className="search-results-head">Searching YouTube for “{searchTerm}”…</div>
                  <div className="search-results-list">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="glass-row search-row search-row-skeleton">
                        <div className="row-main">
                          <div className="search-thumb shimmer-dark" />
                          <div className="row-meta">
                            <div className="shimmer-dark search-skeleton-line" />
                            <div className="shimmer-dark search-skeleton-line short" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Search results: picking one runs the normal link fetch */}
              {fetchState === 'results' &&
                searchResults &&
                (searchResults.length === 0 ? (
                  <div className="search-empty" id="state-search-empty">
                    <SearchIcon size={18} />
                    <p className="search-empty-title">No videos found for “{searchTerm}”</p>
                    <p className="search-empty-hint">
                      Try different words, or paste a video link instead.
                    </p>
                  </div>
                ) : (
                  <div className="search-results" id="state-search-results">
                    <div className="search-results-head">Top results for “{searchTerm}”</div>
                    <div className="search-results-list" role="list">
                      {searchResults.map((r) => (
                        <button
                          key={r.id}
                          id={`search-result-${r.id}`}
                          type="button"
                          role="listitem"
                          className="glass-row search-row"
                          onClick={() => handleSelectSearchResult(r)}
                          title={r.title}
                        >
                          <div className="row-main">
                            <div className="search-thumb">
                              {r.thumbnail ? (
                                <img src={r.thumbnail} alt="" loading="lazy" />
                              ) : (
                                <VideoIcon size={16} />
                              )}
                              {r.isLive ? (
                                <span className="search-thumb-badge live">LIVE</span>
                              ) : (
                                r.durationFormatted && (
                                  <span className="search-thumb-badge">{r.durationFormatted}</span>
                                )
                              )}
                            </div>
                            <div className="row-meta">
                              <div className="row-title search-row-title">{r.title}</div>
                              <div className="row-sub">
                                {r.channel && <span>{r.channel}</span>}
                                {r.durationFormatted && <span>{r.durationFormatted}</span>}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

              {/* Error — inline inside the card */}
              {fetchState === 'error' && (
                <div className="input-card-error" id="state-error-card">
                  <AlertTriangle size={15} className="input-card-error-icon" />
                  <div className="input-card-error-body">
                    <p className="input-card-error-msg">{errorMessage}</p>
                    <div className="input-card-error-links">
                      <button
                        id="btn-open-log-file"
                        type="button"
                        onClick={async () => {
                          try {
                            await window.api.openLogFile();
                          } catch (e) {
                            console.error('Could not open log file:', e);
                          }
                        }}
                      >
                        Open log file
                      </button>
                      {rawErrorDetails && (
                        <button
                          id="btn-toggle-error-details"
                          type="button"
                          onClick={() => setShowErrorDetails(!showErrorDetails)}
                        >
                          {showErrorDetails ? 'Hide details' : 'Technical details'}
                        </button>
                      )}
                    </div>
                    {rawErrorDetails && showErrorDetails && (
                      <pre className="input-card-error-details" id="error-details-content">
                        {rawErrorDetails}
                      </pre>
                    )}
                  </div>
                </div>
              )}

              {/* Preview — expands inside the same card */}
              {isPreview && videoInfo && (
                <div className="input-card-preview" id="state-preview-card">
                  <div className="input-card-thumb">
                    {videoInfo.thumbnail ? (
                      <img src={videoInfo.thumbnail} alt="" />
                    ) : (
                      <VideoIcon size={22} />
                    )}
                    {videoInfo.duration > 0 && (
                      <span className="input-card-duration">{videoInfo.durationFormatted}</span>
                    )}
                  </div>
                  <div className="input-card-meta">
                    <h2 className="input-card-title" title={videoInfo.title}>
                      {videoInfo.title}
                    </h2>
                    <div className="input-card-sub">
                      {searchResults && searchResults.length > 0 && (
                        <button
                          id="btn-back-to-results"
                          type="button"
                          className="input-card-back"
                          onClick={handleBackToResults}
                        >
                          <ChevronLeft size={12} /> Results
                        </button>
                      )}
                      {videoInfo.uploader && <span>{videoInfo.uploader}</span>}
                      {videoInfo.duration > 0 && <span>{videoInfo.durationFormatted}</span>}
                      <a href={videoInfo.webpageUrl} target="_blank" rel="noreferrer">
                        Source <ExternalLink size={10} />
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* Pill row + primary action */}
              <div className="input-card-actions">
                {isPreview && (
                  <div className="input-card-pills" id="format-selection-grid">
                    {friendlyOptions.map((opt) => (
                      <button
                        key={opt.id}
                        id={`format-opt-${opt.id}`}
                        type="button"
                        className={`light-pill ${selectedOptionId === opt.id ? 'selected' : ''}`}
                        onClick={() => setSelectedOptionId(opt.id)}
                        title={`${opt.label} · ${opt.ext.toUpperCase()}${opt.needsMerge ? ' · merges audio' : ''}`}
                      >
                        <span>{shortOptionLabel(opt)}</span>
                        {opt.filesizeFormatted && (
                          <span className="light-pill-meta">{opt.filesizeFormatted}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {isPreview ? (
                  <button
                    id="btn-add-to-queue"
                    type="button"
                    className="dark-pill"
                    onClick={handleAddToQueue}
                  >
                    Download
                  </button>
                ) : (
                  <button
                    id="btn-fetch-url"
                    type="button"
                    className="dark-pill"
                    onClick={() => handleFetch()}
                    disabled={!url.trim() || isFetchBusy}
                  >
                    {isFetchBusy ? (
                      <>
                        <Activity size={14} className="spin-icon" />
                        <span>{fetchState === 'searching' ? 'Searching' : 'Fetching'}</span>
                      </>
                    ) : (
                      'Fetch'
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="save-line" id="folder-selector-container">
              <span className="save-line-dot" />
              <span>Saving to</span>
              <span className="save-line-path" title={settings.downloadFolder}>
                {settings.downloadFolder || 'Default Downloads'}
              </span>
              <span className="save-line-sep">·</span>
              <button
                id="btn-change-folder"
                type="button"
                className="save-line-change"
                onClick={handleChooseFolder}
              >
                Change
              </button>
            </div>

            {publicStats && (
              <div className="stats-line" id="public-stats-row" aria-live="polite">
                <span>
                  <strong>{publicStats.totalDownloads.toLocaleString()}</strong>{' '}
                  {publicStats.totalDownloads === 1 ? 'video' : 'videos'} downloaded
                </span>
                <span className="stats-line-sep">·</span>
                <span>
                  <strong>{publicStats.activeUsers.last24Hours.toLocaleString()}</strong>{' '}
                  {publicStats.activeUsers.last24Hours === 1 ? 'person' : 'people'} online
                </span>
                <span className="stats-line-sep">·</span>
                <span className="stats-line-live">
                  <span className="stats-live-dot" aria-hidden="true" />
                  <strong>{publicStats.activeUsers.last5Minutes.toLocaleString()}</strong>{' '}
                  downloading now
                </span>
              </div>
            )}
          </section>
        )}

        {/* TAB 2: QUEUE */}
        {activeTab === 'queue' && (
          <section className="page page-fixed-header" id="queue-view-container">
            <header className="page-header">
              <h1 className="page-title">Queue</h1>
              <p className="page-subtitle">
                {queue.filter((i) => i.status === 'downloading').length} active ·{' '}
                {queue.filter((i) => i.status === 'queued').length} waiting · up to{' '}
                {settings.maxConcurrent} at once
              </p>
            </header>

            {queue.some(
              (i) => i.status === 'completed' || i.status === 'canceled' || i.status === 'failed'
            ) && (
              <div className="page-toolbar">
                <button
                  id="btn-clear-completed-queue"
                  type="button"
                  className="glass-pill"
                  onClick={handleClearCompleted}
                >
                  <Trash2 size={13} />
                  <span>Clear finished</span>
                </button>
              </div>
            )}

            <div className="page-scroll">
              {queue.length === 0 ? (
                <div className="empty-state" id="empty-queue-state">
                  <h3 className="empty-title">Nothing in the queue</h3>
                  <p className="empty-subtitle">
                    Downloads you start will appear here with live progress.
                  </p>
                  <button
                    type="button"
                    className="white-pill"
                    onClick={() => setActiveTab('downloader')}
                  >
                    Go to Download
                  </button>
                </div>
              ) : (
                <div className="row-list">
                  {queue.map((item) => (
                    <div
                      key={item.id}
                      id={`queue-item-${item.id}`}
                      className={`glass-row queue-row ${item.status === 'downloading' ? 'active' : ''}`}
                    >
                      <div className="row-main">
                        {item.thumbnail ? (
                          <img src={item.thumbnail} alt="" className="row-thumb" />
                        ) : (
                          <div className="row-thumb row-thumb-empty">
                            <VideoIcon size={16} />
                          </div>
                        )}
                        <div className="row-meta">
                          <div className="row-title" title={item.title}>
                            {item.title}
                          </div>
                          <div className="row-sub">
                            <span className={`status-badge ${item.status}`}>
                              {item.status.toUpperCase()}
                            </span>
                            <span>{item.qualityLabel}</span>
                            {item.durationFormatted && <span>{item.durationFormatted}</span>}
                          </div>
                        </div>

                        <div className="row-actions">
                          {item.status === 'downloading' && (
                            <button
                              id={`btn-pause-${item.id}`}
                              type="button"
                              className="icon-btn"
                              title="Pause download"
                              onClick={() => handlePauseQueueItem(item.id)}
                            >
                              <Pause size={14} />
                            </button>
                          )}
                          {item.status === 'paused' && (
                            <button
                              id={`btn-resume-${item.id}`}
                              type="button"
                              className="icon-btn"
                              title="Resume download"
                              onClick={() => handleResumeQueueItem(item.id)}
                            >
                              <Play size={14} />
                            </button>
                          )}
                          {(item.status === 'downloading' ||
                            item.status === 'queued' ||
                            item.status === 'paused') && (
                            <button
                              id={`btn-cancel-${item.id}`}
                              type="button"
                              className="icon-btn danger"
                              title="Cancel download"
                              onClick={() => handleCancelQueueItem(item.id)}
                            >
                              <XCircle size={14} />
                            </button>
                          )}
                          {item.status === 'completed' && (
                            <button
                              type="button"
                              className="icon-btn"
                              title="Show in folder"
                              onClick={() => handleOpenFile(item.outputPath)}
                            >
                              <FolderOpen size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {(item.status === 'downloading' ||
                        item.status === 'paused' ||
                        item.status === 'completed') && (
                        <div className="progress-track">
                          <div
                            className={`progress-fill ${item.status}`}
                            style={{ width: `${Math.round(item.percent)}%` }}
                          />
                        </div>
                      )}

                      <div className="row-stats">
                        <span>{Math.round(item.percent)}%</span>
                        {item.speed && <span>{item.speed}</span>}
                        {item.eta && <span>ETA {item.eta}</span>}
                        {item.totalSize && <span>{item.totalSize}</span>}
                        {item.error && <span className="row-error">{item.error}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 3: HISTORY */}
        {activeTab === 'history' && (
          <section className="page page-fixed-header" id="history-view-container">
            <header className="page-header">
              <h1 className="page-title">History</h1>
              <p className="page-subtitle">
                {history.length} {history.length === 1 ? 'download' : 'downloads'} saved across
                restarts
              </p>
            </header>

            {history.length > 0 && (
              <div className="page-toolbar">
                <button
                  id="btn-clear-all-history"
                  type="button"
                  className="glass-pill"
                  onClick={handleClearAllHistory}
                >
                  <Trash2 size={13} />
                  <span>Clear history</span>
                </button>
              </div>
            )}

            <div className="page-scroll">
              {history.length === 0 ? (
                <div className="empty-state" id="empty-history-state">
                  <h3 className="empty-title">No downloads yet</h3>
                  <p className="empty-subtitle">
                    Finished, failed and canceled downloads are kept here.
                  </p>
                  <button
                    type="button"
                    className="white-pill"
                    onClick={() => setActiveTab('downloader')}
                  >
                    Go to Download
                  </button>
                </div>
              ) : (
                <div className="row-list">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      id={`history-item-${item.id}`}
                      className="glass-row history-row"
                    >
                      <div className="row-main">
                        {item.thumbnail ? (
                          <img src={item.thumbnail} alt="" className="row-thumb" />
                        ) : (
                          <div className="row-thumb row-thumb-empty">
                            <VideoIcon size={16} />
                          </div>
                        )}
                        <div className="row-meta">
                          <div className="row-title" title={item.title}>
                            {item.title}
                          </div>
                          <div className="row-sub">
                            <span className={`status-badge ${item.status}`}>
                              {item.status.toUpperCase()}
                            </span>
                            <span>{item.date}</span>
                            <span>{item.quality}</span>
                            {item.fileSizeFormatted && <span>{item.fileSizeFormatted}</span>}
                          </div>
                        </div>

                        <div className="row-actions">
                          {item.status === 'completed' && (
                            <button
                              id={`btn-history-folder-${item.id}`}
                              type="button"
                              className="icon-btn"
                              title="Show in folder"
                              onClick={() => handleOpenFile(item.filePath)}
                            >
                              <FolderOpen size={14} />
                            </button>
                          )}
                          <button
                            id={`btn-history-redownload-${item.id}`}
                            type="button"
                            className="icon-btn"
                            title="Download again"
                            onClick={() => handleRedownloadHistory(item)}
                          >
                            <RotateCcw size={14} />
                          </button>
                          <button
                            id={`btn-history-delete-${item.id}`}
                            type="button"
                            className="icon-btn danger"
                            title="Remove from history"
                            onClick={() => handleDeleteHistory(item.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 4: SETTINGS */}
        {activeTab === 'settings' && (
          <section className="page page-fixed-header" id="settings-view-container">
            <header className="page-header">
              <h1 className="page-title">Settings</h1>
              <p className="page-subtitle">
                Where files go, how many run at once, and support tools.
              </p>
            </header>

            <div className="page-scroll settings-scroll">
              <div className="settings-group">
                <h2 className="settings-group-label">Downloads</h2>
                <div className="glass-section">
                  <div className="setting-row">
                    <div className="setting-info">
                      <span className="setting-label">Download folder</span>
                      <span className="setting-desc setting-mono" title={settings.downloadFolder}>
                        {settings.downloadFolder || 'Default Downloads'}
                      </span>
                    </div>
                    <button
                      id="btn-settings-choose-folder"
                      type="button"
                      className="glass-pill"
                      onClick={handleChooseFolder}
                    >
                      <FolderOpen size={13} />
                      <span>Change</span>
                    </button>
                  </div>

                  <div className="setting-row">
                    <div className="setting-info">
                      <span className="setting-label">Max concurrent downloads</span>
                      <span className="setting-desc">How many downloads run at the same time</span>
                    </div>
                    <div className="pill-group" id="concurrency-picker">
                      {[1, 2, 3, 4, 5].map((val) => (
                        <button
                          key={val}
                          id={`btn-concurrency-${val}`}
                          type="button"
                          className={`choice-pill ${settings.maxConcurrent === val ? 'selected' : ''}`}
                          onClick={() => handleUpdateConcurrency(val)}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-group">
                <h2 className="settings-group-label">Support</h2>
                <div className="glass-section">
                  <div className="setting-row">
                    <div className="setting-info">
                      <span className="setting-label">Diagnostics</span>
                      <span className="setting-desc">
                        Open the log or copy a system report for bug reports
                      </span>
                    </div>
                    <div className="setting-controls">
                      <button
                        id="btn-open-log-file-settings"
                        type="button"
                        className="glass-pill"
                        onClick={async () => {
                          try {
                            await window.api.openLogFile();
                          } catch (e) {
                            console.error('Could not open log file:', e);
                          }
                        }}
                      >
                        <FolderOpen size={13} />
                        <span>Open log</span>
                      </button>
                      <button
                        id="btn-copy-diagnostics"
                        type="button"
                        className="glass-pill"
                        onClick={handleCopyDiagnostics}
                      >
                        {copiedDiagnostics ? (
                          <>
                            <CheckCircle2 size={13} className="text-success" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy size={13} />
                            <span>Copy report</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="setting-row">
                    <div className="setting-info">
                      <span className="setting-label">App updates</span>
                      <span className="setting-desc">
                        {updateStatus.status === 'available'
                          ? `Version ${updateStatus.version} is available`
                          : updateStatus.status === 'not-available'
                            ? `Up to date (v${updateStatus.version || appInfo?.version})`
                            : 'Checks GitHub Releases. yt-dlp updates on its own.'}
                      </span>
                    </div>
                    <button
                      id="btn-check-updates"
                      type="button"
                      className="glass-pill"
                      onClick={handleCheckUpdates}
                      disabled={isCheckingUpdate}
                    >
                      <RefreshCw size={13} className={isCheckingUpdate ? 'spin-icon' : ''} />
                      <span>{isCheckingUpdate ? 'Checking' : 'Check now'}</span>
                    </button>
                  </div>

                  <div className="setting-row">
                    <div className="setting-info">
                      <span className="setting-label">Welcome guide</span>
                      <span className="setting-desc">
                        Re-read the intro and responsible-use notice
                      </span>
                    </div>
                    <button
                      id="btn-reopen-onboarding"
                      type="button"
                      className="glass-pill"
                      onClick={() => setShowOnboarding(true)}
                    >
                      <HelpCircle size={13} />
                      <span>Open guide</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-group">
                <h2 className="settings-group-label">About</h2>
                <div className="glass-section">
                  <div className="setting-row">
                    <div className="setting-info">
                      <span className="setting-label">
                        Universal Downloader {appInfo ? `v${appInfo.version}` : ''}
                      </span>
                      <span className="about-tagline">
                        A fast, free downloader for YouTube, Pinterest, TikTok and 1,800+ other
                        sites.
                      </span>
                    </div>
                  </div>

                  <div className="setting-row">
                    <div className="developer-info">
                      <img src={developerPhotoUrl} alt="" className="developer-avatar" />
                      <div className="setting-info">
                        <span className="setting-desc">Developer</span>
                        <span className="setting-label">Akash Makes</span>
                      </div>
                    </div>
                    <div className="setting-controls">
                      <button
                        id="btn-developer-facebook"
                        type="button"
                        className="glass-pill"
                        onClick={() => window.api.openExternal(DEVELOPER_LINKS.facebook)}
                        aria-label="Akash Makes on Facebook"
                      >
                        <FacebookIcon />
                        <span>Facebook</span>
                      </button>
                      <button
                        id="btn-developer-tiktok"
                        type="button"
                        className="glass-pill"
                        onClick={() => window.api.openExternal(DEVELOPER_LINKS.tiktok)}
                        aria-label="Akash Makes on TikTok"
                      >
                        <TikTokIcon />
                        <span>TikTok</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default App;
