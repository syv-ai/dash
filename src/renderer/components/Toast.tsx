import { useEffect } from 'react';
import { Toaster, toast } from 'sonner';

export function ToastContainer() {
  useEffect(() => {
    return window.electronAPI.onToast((data) => {
      if (data.url) {
        toast(data.message, {
          action: {
            label: 'Open',
            onClick: () => window.electronAPI.openExternal(data.url!),
          },
          duration: 6000,
        });
      } else {
        toast(data.message, { duration: 6000 });
      }
    });
  }, []);

  // Auto-update: update available
  useEffect(() => {
    return window.electronAPI.onAutoUpdateAvailable((info) => {
      toast(`Update v${info.version} available`, {
        duration: Infinity,
        action: {
          label: 'Download',
          onClick: () => {
            window.electronAPI.autoUpdateDownload();
          },
        },
      });
    });
  }, []);

  // Auto-update: download complete
  useEffect(() => {
    return window.electronAPI.onAutoUpdateDownloaded(() => {
      toast('Update ready to install', {
        duration: Infinity,
        action: {
          label: 'Restart',
          onClick: () => {
            window.electronAPI.autoUpdateQuitAndInstall();
          },
        },
      });
    });
  }, []);

  // Auto-update: error
  useEffect(() => {
    return window.electronAPI.onAutoUpdateError((message) => {
      toast.error(message, { duration: 5000 });
    });
  }, []);

  return <Toaster theme="system" position="bottom-right" />;
}
