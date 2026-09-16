import React, { useState, useEffect } from 'react';
import {
  Download,
  Link as LinkIcon,
  ArrowDownToLine,
  Activity,
  CheckCircle2,
  Layers,
  Zap,
  HardDriveDownload,
} from 'lucide-react';
import type { PingResponse, AppInfoResponse } from '../shared/types';

export const App: React.FC = () => {
  const [url, setUrl] = useState('');
  const [pingData, setPingData] = useState<PingResponse | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfoResponse | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [ipcConnected, setIpcConnected] = useState(false);

  const testIpcPing = async () => {
    if (!window.api?.ping) {
      console.warn('Electron IPC API not available in current environment');
      return;
    }

    try {
      setIsPinging(true);
      const start = performance.now();
      const res = await window.api.ping();
      const elapsed = Math.round(performance.now() - start);

      setPingData(res);
      setLatency(elapsed);
      setIpcConnected(true);
    } catch (err) {
      console.error('IPC ping failed:', err);
      setIpcConnected(false);
    } finally {
      setIsPinging(false);
    }
  };

  useEffect(() => {
    testIpcPing();

    if (window.api?.getAppInfo) {
      window.api.getAppInfo().then(setAppInfo).catch(console.error);
    }
  }, []);

  const handleDownload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    alert(`Queued placeholder download for: ${url}`);
  };

  return (
    <div className="app-container" id="app-root">
      {/* Title Bar */}
      <header className="titlebar" id="app-titlebar">
        <div className="titlebar-brand">
          <div className="titlebar-logo-icon">
            <ArrowDownToLine size={16} />
          </div>
          <span className="titlebar-title">Universal Downloader</span>
          <span className="titlebar-badge" id="app-version-badge">
            v{appInfo?.version ?? '1.0.0'}
          </span>
        </div>

        <div className="titlebar-status" id="app-system-status">
          <span className="status-dot" />
          <span>{appInfo ? `${appInfo.platform} (${appInfo.arch})` : 'Desktop Ready'}</span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content" id="app-main-content">
        {/* Placeholder Download Input Section */}
        <section className="input-card" id="download-input-section">
          <form onSubmit={handleDownload} className="input-group">
            <span className="input-icon">
              <LinkIcon size={18} />
            </span>
            <input
              id="url-input"
              type="text"
              className="download-input"
              placeholder="Enter URL to download (e.g., https://example.com/video.mp4 or YouTube link)..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              id="start-download-btn"
              type="submit"
              className="download-button"
              disabled={!url.trim()}
            >
              <Download size={15} />
              <span>Download</span>
            </button>
          </form>
        </section>

        {/* Empty Content Area */}
        <section className="content-card" id="empty-content-section">
          <div className="empty-graphic">
            <HardDriveDownload size={32} />
          </div>
          <h2 className="empty-title">Ready to Download</h2>
          <p className="empty-subtitle">
            Paste any media or file link above to start downloading. Downloads will appear here with
            real-time progress, speed, and format options.
          </p>

          <div className="features-pills">
            <span className="feature-pill">
              <Zap size={12} style={{ display: 'inline', marginRight: 4 }} />
              High Speed
            </span>
            <span className="feature-pill">
              <Layers size={12} style={{ display: 'inline', marginRight: 4 }} />
              Multi-Format
            </span>
            <span className="feature-pill">
              <CheckCircle2 size={12} style={{ display: 'inline', marginRight: 4 }} />
              NSIS Windows Ready
            </span>
          </div>
        </section>

        {/* IPC Scaffolding Verification Card */}
        <section className="ipc-card" id="ipc-verification-card">
          <div className="ipc-info">
            <div className="ipc-title">
              <Activity size={16} color="var(--accent-primary)" />
              <span>IPC Scaffolding Status</span>
              {ipcConnected && (
                <span className="ipc-badge-success" id="ipc-badge-status">
                  <CheckCircle2 size={12} />
                  Main &lt;-&gt; Renderer Connected
                </span>
              )}
            </div>
            <div className="ipc-details" id="ipc-details-text">
              {pingData ? (
                <>
                  Channel: <strong>app:ping</strong> &rarr; Reply: &quot;{pingData.message}&quot; |
                  Latency: <strong>{latency}ms</strong> | Electron: v{pingData.electronVersion} |
                  Node: v{pingData.nodeVersion}
                </>
              ) : (
                'Connecting to Electron main process...'
              )}
            </div>
          </div>

          <button
            id="test-ping-btn"
            type="button"
            className="ping-button"
            onClick={testIpcPing}
            disabled={isPinging}
          >
            <Activity size={14} className={isPinging ? 'animate-spin' : ''} />
            <span>{isPinging ? 'Pinging...' : 'Test Ping'}</span>
          </button>
        </section>
      </main>
    </div>
  );
};

export default App;
