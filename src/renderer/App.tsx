import React, { useState, useEffect } from 'react';
import {
  Download,
  Link as LinkIcon,
  ArrowDownToLine,
  Activity,
  CheckCircle2,
  Folder,
  FolderOpen,
  Clipboard,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  RotateCcw,
  Clock,
  User,
  Music,
  Video as VideoIcon,
  XCircle,
  PlayCircle,
  Bookmark,
  ExternalLink,
  Layers,
  ListOrdered,
  History as HistoryIcon,
  Settings as SettingsIcon,
  Pause,
  Play,
  Trash2,
  Moon,
  Sun,
  PlusCircle,
  HelpCircle,
  Copy,
  RefreshCw,
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
} from '../shared/types';
import { OnboardingModal } from './components/OnboardingModal';

export type ActiveTab = 'downloader' | 'queue' | 'history' | 'settings';
export type FetchState = 'idle' | 'loading' | 'preview' | 'error';

function groupFormatsIntoFriendlyOptions(formats: VideoFormat[]): FriendlyFormatOption[] {
  const options: FriendlyFormatOption[] = [];
  const videoFormats = formats.filter((f) => f.hasVideo);
  const audioFormats = formats.filter((f) => f.hasAudio && !f.hasVideo);

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

  if (audioFormats.length > 0) {
    const bestAudio = audioFormats[0];
    options.push({
      id: 'audio',
      label: 'Audio only (MP3/M4A)',
      formatId: bestAudio.formatId,
      resolution: 'Audio only',
      ext: bestAudio.ext,
      filesizeFormatted: bestAudio.filesizeFormatted,
      isAudioOnly: true,
      needsMerge: false,
    });
  } else {
    options.push({
      id: 'audio',
      label: 'Audio only (Extracted MP3)',
      formatId: 'ba/b',
      resolution: 'Audio only',
      ext: 'mp3',
      isAudioOnly: true,
      needsMerge: false,
    });
  }

  return options;
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('downloader');
  const [url, setUrl] = useState('');
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [videoInfo, setVideoInfo] = useState<VideoMetadata | null>(null);
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

  useEffect(() => {
    // Initial data load
    if (window.api?.getAppInfo) {
      window.api.getAppInfo().then(setAppInfo).catch(console.error);
    }
    if (window.api?.getSettings) {
      window.api.getSettings().then((s) => {
        setSettings(s);
        document.documentElement.setAttribute('data-theme', s.theme || 'dark');
      }).catch(console.error);
    }
    if (window.api?.hasCompletedOnboarding) {
      window.api.hasCompletedOnboarding().then((completed) => {
        if (!completed) setShowOnboarding(true);
      }).catch(console.error);
    }
    if (window.api?.getQueue) {
      window.api.getQueue().then(setQueue).catch(console.error);
    }
    if (window.api?.getHistory) {
      window.api.getHistory().then(setHistory).catch(console.error);
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

  const handleFetch = async (targetUrl?: string) => {
    const urlToFetch = (targetUrl ?? url).trim();
    if (!urlToFetch) return;

    try {
      setFetchState('loading');
      setErrorMessage('');
      setRawErrorDetails('');
      setShowErrorDetails(false);

      const info = await window.api.fetchInfo(urlToFetch);
      const grouped = groupFormatsIntoFriendlyOptions(info.formats);

      setVideoInfo(info);
      setFriendlyOptions(grouped);
      if (grouped.length > 0) {
        setSelectedOptionId(grouped[0].id);
      }

      setFetchState('preview');
    } catch (err: any) {
      console.error('Fetch error:', err);
      const raw = err?.message || String(err);
      let friendly = 'Could not retrieve video information. Please check the URL and internet connection.';
      if (raw.includes('Unsupported URL')) {
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
      const safeTitle = (videoInfo.title || 'video').replace(/[/\\?%*:|"<>]/g, '_').substring(0, 60);
      const finalExt = opt.ext || 'mp4';
      const folder = settings.downloadFolder || '';
      const outputPath = folder ? `${folder}\\${safeTitle}_${opt.id}.${finalExt}` : undefined;

      await window.api.addToQueue({
        url: url.trim(),
        title: videoInfo.title,
        thumbnail: videoInfo.thumbnail,
        durationFormatted: videoInfo.durationFormatted,
        qualityLabel: opt.label,
        formatId: opt.formatId,
        outputPath,
      });

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

  const handleToggleTheme = async (theme: 'dark' | 'light') => {
    const updated = await window.api.updateSettings({ theme });
    setSettings(updated);
    document.documentElement.setAttribute('data-theme', theme);
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

  const activeDownloadsCount = queue.filter((i) => i.status === 'downloading' || i.status === 'queued').length;

  return (
    <div className="app-container" id="app-root">
      {/* First-Run Onboarding Modal */}
      <OnboardingModal isOpen={showOnboarding} onClose={handleCloseOnboarding} />

      {/* Title Bar with Navigation Tabs */}
      <header className="titlebar" id="app-titlebar">
        <div className="titlebar-brand">
          <div className="titlebar-logo-icon">
            <ArrowDownToLine size={16} />
          </div>
          <span className="titlebar-title">Universal Downloader</span>
        </div>

        {/* Navigation Tabs */}
        <nav className="nav-tabs" id="navigation-tabs">
          <button
            id="tab-downloader"
            type="button"
            className={`nav-tab-btn ${activeTab === 'downloader' ? 'active' : ''}`}
            onClick={() => setActiveTab('downloader')}
          >
            <Download size={14} />
            <span>Downloader</span>
          </button>

          <button
            id="tab-queue"
            type="button"
            className={`nav-tab-btn ${activeTab === 'queue' ? 'active' : ''}`}
            onClick={() => setActiveTab('queue')}
          >
            <ListOrdered size={14} />
            <span>Queue</span>
            {activeDownloadsCount > 0 && (
              <span className="tab-badge" id="queue-count-badge">
                {activeDownloadsCount}
              </span>
            )}
          </button>

          <button
            id="tab-history"
            type="button"
            className={`nav-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <HistoryIcon size={14} />
            <span>History</span>
            {history.length > 0 && (
              <span className="tab-badge" id="history-count-badge">
                {history.length}
              </span>
            )}
          </button>

          <button
            id="tab-settings"
            type="button"
            className={`nav-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <SettingsIcon size={14} />
            <span>Settings</span>
          </button>
        </nav>

        {/* System Pill */}
        <div className="titlebar-right">
          <div className="system-pill" id="app-system-status">
            <span className="status-dot" />
            <span>{appInfo ? `${appInfo.platform} (${appInfo.arch})` : 'Desktop Ready'}</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="main-content" id="app-main-content">
        {/* TAB 1: DOWNLOADER */}
        {activeTab === 'downloader' && (
          <>
            <section className="hero-section">
              <h1 className="hero-title">Download Any Video or Audio Stream</h1>
              <p className="hero-subtitle">
                Paste a media link from YouTube, Pinterest, Vimeo, or any supported site.
              </p>
            </section>

            {/* URL Input Box */}
            <section className="url-card" id="url-input-card">
              <div className="url-input-row">
                <span className="url-icon">
                  <LinkIcon size={18} />
                </span>
                <input
                  id="main-url-input"
                  type="text"
                  className="main-url-input"
                  placeholder="Paste media link here (e.g., https://www.youtube.com/watch?v=...)"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFetch();
                  }}
                  disabled={fetchState === 'loading'}
                />
                <button
                  id="btn-paste-clipboard"
                  type="button"
                  className="btn-paste"
                  onClick={handlePaste}
                  disabled={fetchState === 'loading'}
                >
                  <Clipboard size={14} />
                  <span>Paste</span>
                </button>
                <button
                  id="btn-fetch-url"
                  type="button"
                  className="btn-fetch"
                  onClick={() => handleFetch()}
                  disabled={!url.trim() || fetchState === 'loading'}
                >
                  {fetchState === 'loading' ? (
                    <>
                      <Activity size={15} className="spin-icon" />
                      <span>Fetching...</span>
                    </>
                  ) : (
                    <>
                      <Download size={15} />
                      <span>Fetch</span>
                    </>
                  )}
                </button>
              </div>

              {/* Controls Meta Row */}
              <div className="controls-meta-row">
                <div className="folder-selector" id="folder-selector-container">
                  <Folder size={14} color="var(--accent-primary)" />
                  <span>Save to:</span>
                  <span className="folder-path-text" title={settings.downloadFolder}>
                    {settings.downloadFolder || 'Default Downloads'}
                  </span>
                  <button
                    id="btn-change-folder"
                    type="button"
                    className="btn-change-folder"
                    onClick={handleChooseFolder}
                  >
                    Change
                  </button>
                </div>

                <div className="presets-container" id="quick-presets-container">
                  <span style={{ color: 'var(--text-muted)' }}>Presets:</span>
                  <button
                    id="preset-youtube-btn"
                    type="button"
                    className="preset-pill"
                    onClick={() => {
                      setUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw');
                      handleFetch('https://www.youtube.com/watch?v=jNQXAC9IVRw');
                    }}
                    disabled={fetchState === 'loading'}
                  >
                    <PlayCircle size={12} color="#ef4444" />
                    <span>YouTube</span>
                  </button>
                  <button
                    id="preset-pinterest-btn"
                    type="button"
                    className="preset-pill"
                    onClick={() => {
                      setUrl('https://www.pinterest.com/pin/664281013778109217/');
                      handleFetch('https://www.pinterest.com/pin/664281013778109217/');
                    }}
                    disabled={fetchState === 'loading'}
                  >
                    <Bookmark size={12} color="#e60023" />
                    <span>Pinterest</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Loading State */}
            {fetchState === 'loading' && (
              <section className="loading-card" id="state-loading-card">
                <div className="loading-spinner-container">
                  <div className="spinner-ring" />
                </div>
                <div>
                  <h2 className="loading-title">Analyzing Media Link...</h2>
                  <p className="loading-subtitle">
                    Probing video streams, available resolutions, and audio tracks via yt-dlp.
                  </p>
                </div>
              </section>
            )}

            {/* Error State */}
            {fetchState === 'error' && (
              <section className="error-card" id="state-error-card">
                <div className="error-main-row">
                  <div className="error-icon-box">
                    <AlertTriangle size={20} />
                  </div>
                  <div className="error-content">
                    <h3 className="error-title">Extraction Error</h3>
                    <p className="error-message">{errorMessage}</p>

                    {rawErrorDetails && (
                      <div>
                        <button
                          id="btn-toggle-error-details"
                          type="button"
                          className="error-details-toggle"
                          onClick={() => setShowErrorDetails(!showErrorDetails)}
                        >
                          {showErrorDetails ? (
                            <>
                              <ChevronUp size={14} />
                              <span>Hide technical details</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown size={14} />
                              <span>View technical details</span>
                            </>
                          )}
                        </button>

                        {showErrorDetails && (
                          <div className="error-details-box" id="error-details-content">
                            {rawErrorDetails}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Preview State */}
            {fetchState === 'preview' && videoInfo && (
              <section className="preview-card" id="state-preview-card">
                <div className="preview-main-info">
                  <div className="preview-thumb-container">
                    {videoInfo.thumbnail ? (
                      <img
                        src={videoInfo.thumbnail}
                        alt={videoInfo.title}
                        className="preview-thumb"
                      />
                    ) : (
                      <div
                        style={{
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <VideoIcon size={38} color="var(--text-muted)" />
                      </div>
                    )}
                    {videoInfo.duration > 0 && (
                      <span className="preview-duration-badge">
                        <Clock size={11} />
                        <span>{videoInfo.durationFormatted}</span>
                      </span>
                    )}
                  </div>

                  <div className="preview-meta">
                    <h2 className="preview-title">{videoInfo.title}</h2>
                    <div className="preview-uploader-row">
                      <span className="preview-uploader-badge">
                        <User size={13} />
                        <span>{videoInfo.uploader}</span>
                      </span>
                      <a
                        href={videoInfo.webpageUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          color: 'var(--text-muted)',
                          textDecoration: 'none',
                        }}
                      >
                        <span>Source</span>
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                </div>

                {/* Quality Selector */}
                <div className="format-section">
                  <div className="format-section-header">
                    <span className="format-section-title">
                      <Layers size={14} color="var(--accent-primary)" />
                      Select Quality &amp; Format:
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Auto-merges audio &amp; video via FFmpeg
                    </span>
                  </div>

                  <div className="format-grid" id="format-selection-grid">
                    {friendlyOptions.map((opt) => (
                      <button
                        key={opt.id}
                        id={`format-opt-${opt.id}`}
                        type="button"
                        className={`format-card-btn ${selectedOptionId === opt.id ? 'selected' : ''}`}
                        onClick={() => setSelectedOptionId(opt.id)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {opt.isAudioOnly ? (
                            <Music size={14} color="var(--accent-secondary)" />
                          ) : (
                            <VideoIcon size={14} color="var(--accent-primary)" />
                          )}
                          <span className="format-card-label">{opt.label}</span>
                        </div>
                        <div className="format-card-details">
                          <span>
                            {opt.ext.toUpperCase()}
                            {opt.filesizeFormatted ? ` • ${opt.filesizeFormatted}` : ''}
                          </span>
                          {opt.needsMerge && (
                            <span className="format-merge-badge">+Audio</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bottom Actions Row */}
                <div className="preview-action-row">
                  <div className="destination-info">
                    <FolderOpen size={15} color="var(--accent-primary)" />
                    <span>Destination:</span>
                    <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                      {settings.downloadFolder || 'Default Downloads'}
                    </span>
                  </div>

                  <button
                    id="btn-add-to-queue"
                    type="button"
                    className="btn-start-download"
                    onClick={handleAddToQueue}
                  >
                    <PlusCircle size={16} />
                    <span>Add to Queue &amp; Download</span>
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        {/* TAB 2: QUEUE */}
        {activeTab === 'queue' && (
          <div className="queue-container" id="queue-view-container">
            <div className="view-header">
              <div className="view-title-group">
                <h2 className="view-title">Download Queue</h2>
                <p className="view-subtitle">
                  {queue.filter((i) => i.status === 'downloading').length} active,{' '}
                  {queue.filter((i) => i.status === 'queued').length} waiting (Max concurrent: {settings.maxConcurrent})
                </p>
              </div>

              {queue.some((i) => i.status === 'completed' || i.status === 'canceled' || i.status === 'failed') && (
                <button
                  id="btn-clear-completed-queue"
                  type="button"
                  className="btn-secondary"
                  onClick={handleClearCompleted}
                >
                  <Trash2 size={13} />
                  <span>Clear Completed</span>
                </button>
              )}
            </div>

            {queue.length === 0 ? (
              <div className="empty-tab-state" id="empty-queue-state">
                <div className="empty-icon-circle">
                  <ListOrdered size={28} />
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Queue is Empty</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: 360 }}>
                  Add downloads from the Downloader tab. Downloads will automatically queue and execute according to your concurrency limits.
                </p>
                <button
                  type="button"
                  className="btn-fetch"
                  style={{ marginTop: 8 }}
                  onClick={() => setActiveTab('downloader')}
                >
                  Go to Downloader
                </button>
              </div>
            ) : (
              queue.map((item) => (
                <div
                  key={item.id}
                  id={`queue-item-${item.id}`}
                  className={`queue-card ${item.status === 'downloading' ? 'active-card' : ''}`}
                >
                  <div className="queue-header-row">
                    <img
                      src={item.thumbnail || ''}
                      alt={item.title}
                      className="queue-thumb"
                    />
                    <div className="queue-meta">
                      <div className="queue-title">{item.title}</div>
                      <div className="queue-subtext">
                        <span className={`status-badge ${item.status}`}>
                          {item.status.toUpperCase()}
                        </span>
                        <span>•</span>
                        <span>{item.qualityLabel}</span>
                        {item.durationFormatted && (
                          <>
                            <span>•</span>
                            <span>{item.durationFormatted}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Controls per item */}
                    <div className="queue-actions">
                      {item.status === 'downloading' && (
                        <button
                          id={`btn-pause-${item.id}`}
                          type="button"
                          className="action-icon-btn"
                          title="Pause Download"
                          onClick={() => handlePauseQueueItem(item.id)}
                        >
                          <Pause size={14} />
                        </button>
                      )}

                      {item.status === 'paused' && (
                        <button
                          id={`btn-resume-${item.id}`}
                          type="button"
                          className="action-icon-btn"
                          title="Resume Download"
                          onClick={() => handleResumeQueueItem(item.id)}
                        >
                          <Play size={14} />
                        </button>
                      )}

                      {(item.status === 'downloading' || item.status === 'queued' || item.status === 'paused') && (
                        <button
                          id={`btn-cancel-${item.id}`}
                          type="button"
                          className="action-icon-btn danger"
                          title="Cancel Download"
                          onClick={() => handleCancelQueueItem(item.id)}
                        >
                          <XCircle size={14} />
                        </button>
                      )}

                      {item.status === 'completed' && (
                        <button
                          type="button"
                          className="action-icon-btn"
                          title="Show in Folder"
                          onClick={() => handleOpenFile(item.outputPath)}
                        >
                          <FolderOpen size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar for active item */}
                  {(item.status === 'downloading' || item.status === 'paused' || item.status === 'completed') && (
                    <div className="queue-progress-bar">
                      <div
                        className="queue-progress-fill"
                        style={{ width: `${Math.round(item.percent)}%` }}
                      />
                    </div>
                  )}

                  {/* Stats Row */}
                  <div className="queue-stats-row">
                    <span>{Math.round(item.percent)}% Complete</span>
                    {item.speed && <span>Speed: {item.speed}</span>}
                    {item.eta && <span>ETA: {item.eta}</span>}
                    {item.totalSize && <span>Size: {item.totalSize}</span>}
                    {item.error && (
                      <span style={{ color: 'var(--danger-text)' }}>{item.error}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 3: HISTORY */}
        {activeTab === 'history' && (
          <div className="history-container" id="history-view-container">
            <div className="view-header">
              <div className="view-title-group">
                <h2 className="view-title">Download History</h2>
                <p className="view-subtitle">
                  {history.length} recorded items stored permanently
                </p>
              </div>

              {history.length > 0 && (
                <button
                  id="btn-clear-all-history"
                  type="button"
                  className="btn-secondary"
                  onClick={handleClearAllHistory}
                >
                  <Trash2 size={13} />
                  <span>Clear All History</span>
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="empty-tab-state" id="empty-history-state">
                <div className="empty-icon-circle">
                  <HistoryIcon size={28} />
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: 600 }}>No Download History</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: 360 }}>
                  Completed, failed, and canceled downloads will appear here and persist across application restarts.
                </p>
              </div>
            ) : (
              history.map((item) => (
                <div key={item.id} id={`history-item-${item.id}`} className="history-card">
                  <img
                    src={item.thumbnail || ''}
                    alt={item.title}
                    className="history-thumb"
                  />
                  <div className="history-meta">
                    <div className="history-title">{item.title}</div>
                    <div className="history-details">
                      <span className={`status-badge ${item.status}`}>
                        {item.status.toUpperCase()}
                      </span>
                      <span>{item.date}</span>
                      <span>•</span>
                      <span>{item.quality}</span>
                      {item.fileSizeFormatted && (
                        <>
                          <span>•</span>
                          <span>{item.fileSizeFormatted}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="history-actions">
                    {item.status === 'completed' && (
                      <button
                        id={`btn-history-folder-${item.id}`}
                        type="button"
                        className="action-icon-btn"
                        title="Show in Folder"
                        onClick={() => handleOpenFile(item.filePath)}
                      >
                        <FolderOpen size={14} />
                      </button>
                    )}

                    <button
                      id={`btn-history-redownload-${item.id}`}
                      type="button"
                      className="action-icon-btn"
                      title="Re-download Video"
                      onClick={() => handleRedownloadHistory(item)}
                    >
                      <RotateCcw size={14} />
                    </button>

                    <button
                      id={`btn-history-delete-${item.id}`}
                      type="button"
                      className="action-icon-btn danger"
                      title="Delete History Entry"
                      onClick={() => handleDeleteHistory(item.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 4: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="settings-container" id="settings-view-container">
            <div className="view-header">
              <div className="view-title-group">
                <h2 className="view-title">Application Settings</h2>
                <p className="view-subtitle">
                  Configure download directories, concurrent tasks, interface theme, and diagnostics
                </p>
              </div>
            </div>

            <div className="settings-card">
              {/* Default Folder */}
              <div className="setting-row">
                <div className="setting-info">
                  <span className="setting-label">Default Download Directory</span>
                  <span className="setting-desc">
                    Folder where media downloads are saved by default
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                      marginTop: 4,
                    }}
                  >
                    {settings.downloadFolder}
                  </span>
                </div>
                <button
                  id="btn-settings-choose-folder"
                  type="button"
                  className="btn-secondary"
                  onClick={handleChooseFolder}
                >
                  <FolderOpen size={14} />
                  <span>Browse Folder...</span>
                </button>
              </div>

              {/* Concurrency Limit */}
              <div className="setting-row">
                <div className="setting-info">
                  <span className="setting-label">Max Concurrent Downloads</span>
                  <span className="setting-desc">
                    Maximum number of video streams downloaded simultaneously
                  </span>
                </div>
                <div className="concurrency-picker" id="concurrency-picker">
                  {[1, 2, 3, 4, 5].map((val) => (
                    <button
                      key={val}
                      id={`btn-concurrency-${val}`}
                      type="button"
                      className={`concurrency-btn ${settings.maxConcurrent === val ? 'active' : ''}`}
                      onClick={() => handleUpdateConcurrency(val)}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Theme Toggle */}
              <div className="setting-row">
                <div className="setting-info">
                  <span className="setting-label">Interface Theme</span>
                  <span className="setting-desc">
                    Switch between sleek Dark Mode and high-contrast Light Mode
                  </span>
                </div>
                <div className="theme-toggle-group" id="theme-toggle-group">
                  <button
                    id="btn-theme-dark"
                    type="button"
                    className={`theme-toggle-btn ${settings.theme === 'dark' ? 'active' : ''}`}
                    onClick={() => handleToggleTheme('dark')}
                  >
                    <Moon size={14} />
                    <span>Dark</span>
                  </button>
                  <button
                    id="btn-theme-light"
                    type="button"
                    className={`theme-toggle-btn ${settings.theme === 'light' ? 'active' : ''}`}
                    onClick={() => handleToggleTheme('light')}
                  >
                    <Sun size={14} />
                    <span>Light</span>
                  </button>
                </div>
              </div>

              {/* Diagnostics & Support */}
              <div className="setting-row">
                <div className="setting-info">
                  <span className="setting-label">Support &amp; Diagnostics</span>
                  <span className="setting-desc">
                    Export system metadata and logs to clipboard for bug reporting and support
                  </span>
                </div>
                <button
                  id="btn-copy-diagnostics"
                  type="button"
                  className="btn-secondary"
                  onClick={handleCopyDiagnostics}
                >
                  {copiedDiagnostics ? (
                    <>
                      <CheckCircle2 size={14} color="var(--success-text)" />
                      <span style={{ color: 'var(--success-text)' }}>Diagnostics Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={14} />
                      <span>Copy Diagnostics</span>
                    </>
                  )}
                </button>
              </div>

              {/* Auto Updates */}
              <div className="setting-row">
                <div className="setting-info">
                  <span className="setting-label">Application Auto-Updates</span>
                  <span className="setting-desc">
                    Check GitHub Releases for new desktop app versions (Engine yt-dlp updates independently)
                  </span>
                  {updateStatus.status === 'available' && (
                    <span style={{ color: 'var(--success-text)', fontSize: '11px', marginTop: 2 }}>
                      Update v{updateStatus.version} available!
                    </span>
                  )}
                  {updateStatus.status === 'not-available' && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: 2 }}>
                      App is up to date (v{updateStatus.version || appInfo?.version})
                    </span>
                  )}
                </div>
                <button
                  id="btn-check-updates"
                  type="button"
                  className="btn-secondary"
                  onClick={handleCheckUpdates}
                  disabled={isCheckingUpdate}
                >
                  <RefreshCw size={14} className={isCheckingUpdate ? 'spin-icon' : ''} />
                  <span>{isCheckingUpdate ? 'Checking...' : 'Check for Updates'}</span>
                </button>
              </div>

              {/* First-Run Welcome Guide Reopen */}
              <div className="setting-row">
                <div className="setting-info">
                  <span className="setting-label">Welcome &amp; Usage Guide</span>
                  <span className="setting-desc">
                    Re-read the introductory guide and responsible use guidelines
                  </span>
                </div>
                <button
                  id="btn-reopen-onboarding"
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowOnboarding(true)}
                >
                  <HelpCircle size={14} />
                  <span>View Welcome Guide</span>
                </button>
              </div>

              {/* Runtime Info */}
              <div className="setting-row">
                <div className="setting-info">
                  <span className="setting-label">Runtime Metadata</span>
                  <span className="setting-desc">
                    Universal Downloader v1.0.0 • Electron • Node.js • yt-dlp &amp; FFmpeg Static
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', color: 'var(--success-text)' }}>
                  <CheckCircle2 size={15} />
                  <span>Production Ready</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
