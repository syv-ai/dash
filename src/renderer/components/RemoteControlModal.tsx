import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Check, Copy, Loader2, X } from 'lucide-react';
import QRCode from 'qrcode';
import type { RemoteControlState } from '../../shared/types';
import { Button } from './ui/Button';
import { Dialog, DialogBody, DialogHeader } from './ui/Dialog';

interface RemoteControlModalProps {
  ptyId: string;
  state: RemoteControlState | null;
  onClose: () => void;
}

export function RemoteControlModal(props: RemoteControlModalProps) {
  return (
    <Dialog size="sm" onClose={props.onClose}>
      <RemoteControlBody ptyId={props.ptyId} state={props.state} />
    </Dialog>
  );
}

interface RemoteControlBodyProps {
  ptyId: string;
  state: RemoteControlState | null;
}

function RemoteControlBody({ ptyId, state }: RemoteControlBodyProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const enabledRef = useRef(false);

  // Send /rc when modal opens if no active state
  useEffect(() => {
    if (!state && !enabledRef.current) {
      enabledRef.current = true;
      setEnabling(true);
      void window.electronAPI.ptyRemoteControlEnable(ptyId);
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
    void QRCode.toDataURL(state.url, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(setQrDataUrl);
  }, [state?.url]);

  const handleCopy = useCallback(() => {
    if (!state?.url) return;
    void navigator.clipboard.writeText(state.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [state?.url]);

  return (
    <>
      <DialogHeader
        title="Remote control"
        description="Continue this session from your phone or another browser."
      />
      <DialogBody className="justify-items-center text-center">
        {enabling && !state?.url ? (
          <>
            <QrSlot>
              <Loader2 size={14} strokeWidth={1.8} className="animate-spin text-icon" />
            </QrSlot>
            <p className="type-body">Turning on remote access…</p>
          </>
        ) : state?.url ? (
          <>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Remote control QR code" className="size-50 rounded-lg" />
            ) : (
              <QrSlot />
            )}
            <p className="type-caption">Scan it with your phone, or open the link.</p>
            <Button variant="secondary" className="w-full" onClick={handleCopy}>
              {copied ? (
                <Check size={14} strokeWidth={1.8} />
              ) : (
                <Copy size={14} strokeWidth={1.8} />
              )}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </>
        ) : (
          <>
            <QrSlot>
              <X size={14} strokeWidth={1.8} className="text-icon" />
            </QrSlot>
            <p className="type-body">
              Couldn&rsquo;t turn on remote access. It needs a Claude Pro plan and a signed-in
              Claude Code.
            </p>
          </>
        )}
      </DialogBody>
    </>
  );
}

/** Where the QR code goes, while there is none. */
function QrSlot({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex size-50 items-center justify-center rounded-lg bg-well">{children}</div>
  );
}
