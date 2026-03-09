import { app, safeStorage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { AzureDevOpsConfig } from '@shared/types';

interface StoredConfig {
  ado?: {
    organizationUrl: string;
    project: string;
    encryptedPat: string; // base64-encoded encrypted PAT
  };
}

const CONFIG_FILE = 'config.json';

export class ConfigService {
  private static getConfigPath(): string {
    return path.join(app.getPath('userData'), CONFIG_FILE);
  }

  private static readConfig(): StoredConfig {
    try {
      const configPath = this.getConfigPath();
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
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

  static getAdoConfig(): AzureDevOpsConfig | null {
    const config = this.readConfig();
    if (!config.ado) return null;

    let pat = '';
    try {
      if (safeStorage.isEncryptionAvailable()) {
        pat = safeStorage.decryptString(Buffer.from(config.ado.encryptedPat, 'base64'));
      } else {
        pat = Buffer.from(config.ado.encryptedPat, 'base64').toString('utf-8');
      }
    } catch (err) {
      console.error('[ConfigService] Failed to decrypt ADO PAT:', err);
      return null;
    }

    return {
      organizationUrl: config.ado.organizationUrl,
      project: config.ado.project,
      pat,
    };
  }

  static saveAdoConfig(adoConfig: AzureDevOpsConfig): void {
    const config = this.readConfig();

    let encryptedPat: string;
    if (safeStorage.isEncryptionAvailable()) {
      encryptedPat = safeStorage.encryptString(adoConfig.pat).toString('base64');
    } else {
      encryptedPat = Buffer.from(adoConfig.pat, 'utf-8').toString('base64');
    }

    config.ado = {
      organizationUrl: adoConfig.organizationUrl,
      project: adoConfig.project,
      encryptedPat,
    };

    this.writeConfig(config);
  }

  static removeAdoConfig(): void {
    const config = this.readConfig();
    delete config.ado;
    this.writeConfig(config);
  }

  static isAdoConfigured(): boolean {
    return this.getAdoConfig() !== null;
  }
}
