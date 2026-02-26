import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Globe, Copy, Check, Loader2 } from 'lucide-react';
import QRCode from 'qrcode';
import type { RemoteControlState } from '../../shared/types';

interface RemoteControlModalProps {
  ptyId: string;
  state: RemoteControlState | null;
  onClose: () => void;
}

export function RemoteControlModal({ ptyId, state, onClose }: RemoteControlModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const enabledRef = useRef(false);

  // Send /rc when modal opens if no active state
  useEffect(() => {
    if (!state && !enabledRef.current) {
      enabledRef.current = true;
      setEnabling(true);
      window.electronAPI.ptyRemoteControlEnable(ptyId);
    }
  }, [ptyId, state]);

  // Update enabling state when we get a URL
  useEffect(() => {
    if (state?.url) {
      setEnabling(false);
    }
  }, [state?.url]);

  // Generate QR code when URL arrives
  useEffect(() => {
    if (!state?.url) return;
    console.log('[RemoteControl] QR code URL:', state.url);
    QRCode.toDataURL(state.url, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(setQrDataUrl);
  }, [state?.url]);

  const handleCopy = useCallback(() => {
    if (!state?.url) return;
    navigator.clipboard.writeText(state.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [state?.url]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[380px] animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 border-b border-border/60"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          <div className="flex items-center gap-2">
            <Globe size={14} strokeWidth={1.8} className="text-primary" />
            <h2 className="text-[14px] font-semibold text-foreground">Remote Control</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="p-5 flex flex-col items-center gap-4">
          {enabling && !state?.url ? (
            <>
              <div className="w-[200px] h-[200px] rounded-lg bg-accent/30 flex items-center justify-center">
                <Loader2 size={24} className="text-muted-foreground animate-spin" />
              </div>
              <p className="text-[13px] text-muted-foreground">Enabling remote access...</p>
            </>
          ) : state?.url ? (
            <>
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="Remote control QR code"
                  className="w-[200px] h-[200px] rounded-lg"
                />
              )}
              <p className="text-[12px] text-muted-foreground text-center max-w-[280px]">
                Scan with your phone or open the link to continue this session remotely
              </p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors w-full justify-center"
              >
                {copied ? (
                  <>
                    <Check size={13} strokeWidth={2} />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={13} strokeWidth={2} />
                    Copy link
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <div className="w-[200px] h-[200px] rounded-lg bg-accent/30 flex items-center justify-center">
                <X size={24} className="text-muted-foreground/40" />
              </div>
              <p className="text-[13px] text-muted-foreground text-center max-w-[280px]">
                Could not enable remote access. Make sure you have a Claude Pro plan and are signed
                in.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
