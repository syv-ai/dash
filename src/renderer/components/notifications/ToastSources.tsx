import { useEffect } from 'react';
import { toast } from '../ui/toast';
import { useWizardToasts } from '../ports/useWizardToasts';
import { useMergedPrToast } from './useMergedPrToast';
import { useReleaseNotesToast } from './useReleaseNotesToast';
import { useReviewCommentsToast } from './useReviewCommentsToast';

/** The features that raise toasts on their own (store subscriptions, the
 *  ports wizard) and the bridge for toasts main raises. Renders nothing. */
export function ToastSources() {
  useWizardToasts();
  useReleaseNotesToast();
  useMergedPrToast();
  useReviewCommentsToast();
  useEffect(
    () =>
      window.electronAPI.onToast(({ message, url }) =>
        toast.info(message, {
          action: url
            ? { label: 'Open', onClick: () => void window.electronAPI.openExternal(url) }
            : undefined,
        }),
      ),
    [],
  );
  return null;
}
