import { useEffect } from 'react';
import { Toaster as Sonner, toast, type ToasterProps } from 'sonner';
import { useSettings } from '../../stores/settingsStore';
import { useWizardToasts } from '../ports/useWizardToasts';
import { useReleaseNotesToast } from './useReleaseNotesToast';
import { useMergedPrToast } from './useMergedPrToast';
import { useReviewCommentsToast } from './useReviewCommentsToast';

/**
 * Sonner's toaster on the raised surface (index.css sets its colours and
 * shadow from the tokens). Pass `theme` from Dash's setting, not the OS: sonner
 * colours its description line from it, and Dash can be light on a dark Mac.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: 'text-sm',
          title: 'font-medium',
          description: 'text-ink-2',
        },
      }}
      {...props}
    />
  );
}

/** The app's toaster plus the hooks that raise its toasts. */
export function ToastContainer() {
  const theme = useSettings((s) => s.theme);
  useWizardToasts();
  useReleaseNotesToast();
  useMergedPrToast();
  useReviewCommentsToast();

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

  return <Toaster theme={theme} />;
}
