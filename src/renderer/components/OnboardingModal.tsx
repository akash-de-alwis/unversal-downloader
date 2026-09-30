import React from 'react';
import logoUrl from '../assets/logo.png';
import {
  Zap,
  Layers,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" id="onboarding-modal-backdrop">
      <div className="onboarding-card" id="onboarding-modal-card">
        {/* Header Branding */}
        <div className="onboarding-header">
          <img className="onboarding-logo" src={logoUrl} alt="" draggable={false} />
          <h2 className="onboarding-title">Welcome to Universal Downloader</h2>
          <p className="onboarding-subtitle">
            High-performance, multi-stream media downloader for videos, audio, and playlists.
          </p>
        </div>

        {/* Feature Highlights */}
        <div className="onboarding-features-list">
          <div className="onboarding-feature-item">
            <div className="feature-icon-box">
              <Zap size={18} color="var(--aurora-blue)" />
            </div>
            <div className="feature-text">
              <span className="feature-name">Fast &amp; Resumable Downloads</span>
              <span className="feature-desc">
                Pipes directly through yt-dlp with built-in chunk continuation and pause/resume.
              </span>
            </div>
          </div>

          <div className="onboarding-feature-item">
            <div className="feature-icon-box">
              <Layers size={18} color="#8ab8ff" />
            </div>
            <div className="feature-text">
              <span className="feature-name">Smart Format &amp; Audio Merging</span>
              <span className="feature-desc">
                Integrated FFmpeg engine automatically merges separate high-res video and audio tracks.
              </span>
            </div>
          </div>

          <div className="onboarding-feature-item">
            <div className="feature-icon-box">
              <ShieldCheck size={18} color="var(--success-text)" />
            </div>
            <div className="feature-text">
              <span className="feature-name">Persistent Queue &amp; History</span>
              <span className="feature-desc">
                Queue multiple items with concurrency limits and keep track of downloads across restarts.
              </span>
            </div>
          </div>
        </div>

        {/* Legal & Compliance Notice */}
        <div className="onboarding-disclaimer" id="onboarding-disclaimer-box">
          <div className="disclaimer-header">
            <AlertCircle size={15} color="#fbbf24" />
            <span>Responsible Use Notice</span>
          </div>
          <p className="disclaimer-body">
            Universal Downloader is designed for downloading public, personal, creative commons,
            or permitted media. Users are solely responsible for ensuring they have the legal right
            and authorization to download any content. Please respect copyright laws and the terms of
            service of content providers.
          </p>
          <p className="disclaimer-body">
            To show live stats, the app sends an anonymous, random ID when it runs and a count when a
            download finishes. No personal data or download content is ever included.
          </p>
        </div>

        {/* Action Button */}
        <button
          id="btn-onboarding-get-started"
          type="button"
          className="btn-onboarding-cta"
          onClick={onClose}
        >
          <CheckCircle2 size={16} />
          <span>I Understand &amp; Get Started</span>
        </button>
      </div>
    </div>
  );
};
