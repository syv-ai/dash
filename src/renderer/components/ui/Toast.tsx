import { useEffect } from 'react';
import { Toaster, toast } from 'sonner';
import { useSettings } from '../../stores/settingsStore';
import { useReleaseNotesToast } from './useReleaseNotesToast';

export function ToastContainer() {
  // Follow Dash's theme, not the OS one: sonner's own text colours (the
  // description line) come from this, and Dash can be light on a dark Mac.
  const theme = useSettings((s) => s.theme);
  useReleaseNotesToast();

  useEffect(() => {
    return window.electronAPI.onToast((data) => {
      if (data.url) {
        toast(data.message, {
          action: {
            label: 'Open',
            onClick: () => {
              void window.electronAPI.openExternal(data.url!);
            },
          },
          duration: 6000,
        });
      } else {
        toast(data.message, { duration: 6000 });
      }
    });
  }, []);

  return <Toaster theme={theme} position="bottom-right" />;
}
