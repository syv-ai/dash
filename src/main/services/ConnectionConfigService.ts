import { app, safeStorage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { AzureDevOpsConfig } from '@shared/types';

interface StoredAdoEntry {
  organizationUrl: string;
  project: string;
  encryptedPat: string;
}

interface StoredConfig {
  ado?: Record<string, StoredAdoEntry>; // keyed by projectId or 'default'
}

const CONFIG_FILE = 'config.json';
const DEFAULT_KEY = 'default';

export class ConnectionConfigService {
  private static getConfigPath(): string {
    return path.join(app.getPath('userData'), CONFIG_FILE);
  }

  private static readConfig(): StoredConfig {
    try {
      const configPath = this.getConfigPath();
      if (fs.existsSync(configPath)) {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        // Migrate legacy flat ado config to keyed format
        if (raw.ado && typeof raw.ado.encryptedPat === 'string') {
          raw.ado = { [DEFAULT_KEY]: raw.ado };
          this.writeConfig(raw);
        }
        return raw;
      }
    } catch {
      // Corrupted config — return empty
    }
    return {};
  }

  private static writeConfig(config: StoredConfig): void {
    const configPath = this.getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }

  private static decryptPat(encryptedPat: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encryptedPat, 'base64'));
    }
    return Buffer.from(encryptedPat, 'base64').toString('utf-8');
  }

  private static encryptPat(pat: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(pat).toString('base64');
    }
    return Buffer.from(pat, 'utf-8').toString('base64');
  }

  /**
   * Get ADO config for a project. Falls back to default config if no
   * project-specific config exists.
   */
  static getAdoConfig(projectId?: string): AzureDevOpsConfig | null {
    const config = this.readConfig();
    if (!config.ado) return null;

    const entry = (projectId && config.ado[projectId]) || config.ado[DEFAULT_KEY];
    if (!entry) return null;

    try {
      return {
        organizationUrl: entry.organizationUrl,
        project: entry.project,
        pat: this.decryptPat(entry.encryptedPat),
      };
    } catch {
      return null;
    }
  }

  static saveAdoConfig(adoConfig: AzureDevOpsConfig, projectId?: string): void {
    const config = this.readConfig();
    if (!config.ado) config.ado = {};

    const key = projectId || DEFAULT_KEY;
    config.ado[key] = {
      organizationUrl: adoConfig.organizationUrl,
      project: adoConfig.project,
      encryptedPat: this.encryptPat(adoConfig.pat),
    };

    this.writeConfig(config);
  }

  static removeAdoConfig(projectId?: string): void {
    const config = this.readConfig();
    if (!config.ado) return;

    const key = projectId || DEFAULT_KEY;
    delete config.ado[key];

    // Clean up empty ado object
    if (Object.keys(config.ado).length === 0) {
      delete config.ado;
    }

    this.writeConfig(config);
  }

  /** Check presence of ADO config without decrypting the PAT */
  static isAdoConfigured(projectId?: string): boolean {
    const config = this.readConfig();
    if (!config.ado) return false;
    if (projectId && config.ado[projectId]) return true;
    return config.ado[DEFAULT_KEY] != null;
  }
}
