import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * WSL distribution information
 */
export interface WslDistribution {
  name: string;
  isDefault: boolean;
  state: 'Running' | 'Stopped';
  version: 1 | 2;
}

/**
 * Module-level variable to store the user-selected WSL distribution.
 * Will be wired up to electron-store or settings later.
 */
let selectedDistribution: string = '';

/**
 * Service for Windows/WSL integration in Dash.
 * Detects WSL availability, lists distributions, and detects Claude CLI within WSL.
 */
export class WslService {
  /**
   * Check if WSL is available on this system.
   * @returns True if WSL is installed and available, false otherwise
   */
  static async isWslAvailable(): Promise<boolean> {
    try {
      await execFileAsync('wsl.exe', ['--status'], { timeout: 10000 });
      return true;
    } catch (err) {
      console.error('[WslService.isWslAvailable] WSL not available:', err);
      return false;
    }
  }

  /**
   * List all WSL distributions installed on the system.
   * Parses output from `wsl.exe --list --verbose`.
   *
   * Output format example:
   * ```
   *   NAME      STATE           VERSION
   * * Ubuntu    Running         2
   *   Debian    Stopped         2
   * ```
   *
   * @returns Array of WslDistribution objects
   */
  static async listDistributions(): Promise<WslDistribution[]> {
    try {
      const { stdout } = await execFileAsync('wsl.exe', ['--list', '--verbose'], {
        timeout: 10000,
        encoding: 'utf16le', // WSL output is typically UTF-16LE on Windows
      });

      const lines = stdout.split('\n').map((line) => line.trim());
      const distributions: WslDistribution[] = [];

      // Skip header line (first non-empty line)
      let startIndex = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 0) {
          startIndex = i + 1;
          break;
        }
      }

      // Parse each distribution line
      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.length === 0) continue;

        // Check if this is the default distribution (marked with *)
        const isDefault = line.startsWith('*');
        const cleanLine = line.replace(/^\*\s*/, '').trim();

        // Split by whitespace (multiple spaces/tabs)
        const parts = cleanLine.split(/\s+/).filter((p) => p.length > 0);
        if (parts.length < 3) continue;

        const [name, state, versionStr] = parts;

        // Parse state
        const normalizedState = state.toLowerCase();
        let distroState: 'Running' | 'Stopped';
        if (normalizedState.includes('running')) {
          distroState = 'Running';
        } else if (normalizedState.includes('stopped')) {
          distroState = 'Stopped';
        } else {
          // Default to Stopped for unknown states
          distroState = 'Stopped';
        }

        // Parse version
        const version = versionStr === '1' ? 1 : 2;

        distributions.push({
          name,
          isDefault,
          state: distroState,
          version,
        });
      }

      return distributions;
    } catch (err) {
      console.error('[WslService.listDistributions] Failed to list distributions:', err);
      return [];
    }
  }

  /**
   * Get the user-configured WSL distribution.
   * @returns The selected distribution name, or empty string if none set
   */
  static getSelectedDistribution(): string {
    return selectedDistribution;
  }

  /**
   * Set the user-configured WSL distribution.
   * @param name The distribution name to use
   */
  static setSelectedDistribution(name: string): void {
    selectedDistribution = name;
  }

  /**
   * Detect if Claude CLI is installed in the specified WSL distribution.
   * @param distro The WSL distribution name to check
   * @returns Detection result with installation status, version, and path
   */
  static async detectClaudeCli(
    distro: string,
  ): Promise<{ installed: boolean; version: string | null; path: string | null }> {
    try {
      // First, try to find the Claude CLI path using 'which'
      // Use bash -l -c to run as a login shell, ensuring PATH is set correctly
      const { stdout: whichOutput } = await execFileAsync(
        'wsl.exe',
        ['-d', distro, '--', 'bash', '-l', '-c', 'which claude'],
        { timeout: 15000 },
      );

      const claudePath = whichOutput.trim();
      if (!claudePath) {
        return { installed: false, version: null, path: null };
      }

      // Found the path, now get the version
      try {
        const { stdout: versionOutput } = await execFileAsync(
          'wsl.exe',
          ['-d', distro, '--', 'bash', '-l', '-c', 'claude --version'],
          { timeout: 15000 },
        );

        const version = versionOutput.trim();
        return { installed: true, version, path: claudePath };
      } catch (versionErr) {
        console.error(
          `[WslService.detectClaudeCli] Found Claude CLI at ${claudePath} but could not get version:`,
          versionErr,
        );
        // Still report as installed even if version check fails
        return { installed: true, version: null, path: claudePath };
      }
    } catch (err) {
      // 'which' command failed, Claude CLI not found
      console.error('[WslService.detectClaudeCli] Claude CLI not found in distribution:', err);
      return { installed: false, version: null, path: null };
    }
  }
}
