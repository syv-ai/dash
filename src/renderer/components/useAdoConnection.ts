import { useState, useEffect } from 'react';

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

interface AdoConnectionState {
  orgUrl: string;
  setOrgUrl: (v: string) => void;
  project: string;
  setProject: (v: string) => void;
  pat: string;
  setPat: (v: string) => void;
  testing: boolean;
  testResult: 'success' | 'error' | null;
  setTestResult: (v: 'success' | 'error' | null) => void;
  saving: boolean;
  isUrlValid: boolean;
  canSubmit: boolean;
  handleTest: () => Promise<void>;
  handleSave: () => Promise<void>;
}

interface UseAdoConnectionOptions {
  projectId?: string;
  initialOrgUrl?: string;
  initialProject?: string;
  onSaved?: () => void;
}

export function useAdoConnection({
  projectId,
  initialOrgUrl = '',
  initialProject = '',
  onSaved,
}: UseAdoConnectionOptions): AdoConnectionState {
  const [orgUrl, setOrgUrl] = useState(initialOrgUrl);
  const [project, setProject] = useState(initialProject);
  const [pat, setPat] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [saving, setSaving] = useState(false);

  const isUrlValid = orgUrl.startsWith('https://');
  const canSubmit = isUrlValid && !!project && !!pat;

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const resp = await window.electronAPI.adoTestConnection({
        organizationUrl: normalizeUrl(orgUrl),
        project,
        pat,
      });
      setTestResult(resp.success && resp.data ? 'success' : 'error');
    } catch {
      setTestResult('error');
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const normalized = normalizeUrl(orgUrl);
      await window.electronAPI.adoSaveConfig(
        { organizationUrl: normalized, project, pat },
        projectId,
      );
      setOrgUrl(normalized);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  return {
    orgUrl,
    setOrgUrl,
    project,
    setProject,
    pat,
    setPat,
    testing,
    testResult,
    setTestResult,
    saving,
    isUrlValid,
    canSubmit,
    handleTest,
    handleSave,
  };
}

/** Load existing ADO config into the hook state */
export function useAdoConnectionLoader(
  state: AdoConnectionState,
  projectId?: string,
  setEnabled?: (v: boolean) => void,
  setConfigured?: (v: boolean) => void,
) {
  useEffect(() => {
    window.electronAPI.adoGetConfig(projectId).then((resp) => {
      if (resp.success && resp.data) {
        state.setOrgUrl(resp.data.organizationUrl);
        state.setProject(resp.data.project);
        state.setPat(resp.data.pat);
        setConfigured?.(true);
        setEnabled?.(true);
      }
    });
  }, [projectId]);
}
