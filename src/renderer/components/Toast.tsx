import { useEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';

interface ToastContainerProps {
  updateNotificationsEnabled: boolean;
}

export function ToastContainer({ updateNotificationsEnabled }: ToastContainerProps) {
  const updateNotificationsRef = useRef(updateNotificationsEnabled);
  useEffect(() => {
    updateNotificationsRef.current = updateNotificationsEnabled;
  }, [updateNotificationsEnabled]);

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
      if (!updateNotificationsRef.current) return;
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
      if (!updateNotificationsRef.current) return;
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
    return window.electronAPI.onAutoUpdateError((info) => {
      if (!updateNotificationsRef.current) return;
      toast.error(`${info.message}. ${info.detail}`, {
        duration: 10000,
        action: {
          label: 'Download manually',
          onClick: () => {
            window.electronAPI.openExternal('https://github.com/syv-ai/dash/releases/latest');
          },
        },
      });
    });
  }, []);

  return <Toaster theme="system" position="bottom-right" />;
}
