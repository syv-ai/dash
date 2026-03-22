import { app, safeStorage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { AzureDevOpsConfig } from '@shared/types';

interface StoredAdoEntry {
  organizationUrl: string;
  project: string;
  encryptedPat: string;
}

interface StoredPixelAgentsToken {
  officeId: string;
  encryptedToken: string;
}

interface StoredConfig {
  ado?: Record<string, StoredAdoEntry>; // keyed by projectId or 'default'
  pixelAgentsTokens?: StoredPixelAgentsToken[];
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

  // ── Pixel Agents Token Storage ──────────────────────────────

  static savePixelAgentsToken(officeId: string, token: string): void {
    const config = this.readConfig();
    if (!config.pixelAgentsTokens) config.pixelAgentsTokens = [];
    const existing = config.pixelAgentsTokens.find((t) => t.officeId === officeId);
    const encryptedToken = this.encryptPat(token);
    if (existing) {
      existing.encryptedToken = encryptedToken;
    } else {
      config.pixelAgentsTokens.push({ officeId, encryptedToken });
    }
    this.writeConfig(config);
  }

  static getPixelAgentsToken(officeId: string): string | null {
    const config = this.readConfig();
    const entry = config.pixelAgentsTokens?.find((t) => t.officeId === officeId);
    if (!entry) return null;
    try {
      return this.decryptPat(entry.encryptedToken);
    } catch {
      return null;
    }
  }

  static removePixelAgentsToken(officeId: string): void {
    const config = this.readConfig();
    if (!config.pixelAgentsTokens) return;
    config.pixelAgentsTokens = config.pixelAgentsTokens.filter((t) => t.officeId !== officeId);
    if (config.pixelAgentsTokens.length === 0) delete config.pixelAgentsTokens;
    this.writeConfig(config);
  }

  static getAllPixelAgentsTokens(): Record<string, string> {
    const config = this.readConfig();
    const result: Record<string, string> = {};
    for (const entry of config.pixelAgentsTokens || []) {
      try {
        result[entry.officeId] = this.decryptPat(entry.encryptedToken);
      } catch {
        // Skip corrupted entries
      }
    }
    return result;
  }
}
