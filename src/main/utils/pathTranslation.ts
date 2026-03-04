/**
 * Path translation utilities for Windows/WSL path conversion
 */

/**
 * Checks if a path is a Windows-style path (e.g., C:\Users\mike\project)
 * @param path - The path to check
 * @returns true if the path matches Windows format
 */
export function isWindowsPath(path: string): boolean {
  // Windows paths typically start with a drive letter followed by a colon and backslash
  // e.g., C:\, D:\, etc.
  return /^[a-zA-Z]:\\/.test(path);
}

/**
 * Checks if a path is a WSL /mnt/ path (e.g., /mnt/c/Users/mike/project)
 * @param path - The path to check
 * @returns true if the path matches WSL /mnt/ format
 */
export function isWslPath(path: string): boolean {
  // WSL paths start with /mnt/ followed by a single letter (drive) and forward slash
  return /^\/mnt\/[a-zA-Z]\//.test(path);
}

/**
 * Converts a Windows path to WSL format
 * @param windowsPath - The Windows path to convert (e.g., C:\Users\mike\project)
 * @returns The WSL-formatted path (e.g., /mnt/c/Users/mike/project)
 */
export function toWslPath(windowsPath: string): string {
  // If it's not a Windows path, return as-is (could be relative or already Unix format)
  if (!isWindowsPath(windowsPath)) {
    return windowsPath;
  }

  // Extract drive letter (e.g., "C" from "C:\")
  const driveLetter = windowsPath.charAt(0).toLowerCase();

  // Remove drive letter and colon (e.g., "C:" from "C:\Users\mike\project")
  const pathWithoutDrive = windowsPath.substring(2);

  // Convert backslashes to forward slashes
  const unixStylePath = pathWithoutDrive.replace(/\\/g, '/');

  // Construct WSL path: /mnt/{drive}/{rest of path}
  return `/mnt/${driveLetter}${unixStylePath}`;
}

/**
 * Converts a WSL /mnt/ path back to Windows format
 * @param wslPath - The WSL path to convert (e.g., /mnt/c/Users/mike/project)
 * @returns The Windows-formatted path (e.g., C:\Users\mike\project)
 */
export function toWindowsPath(wslPath: string): string {
  // If it's not a WSL /mnt/ path, return as-is
  if (!isWslPath(wslPath)) {
    return wslPath;
  }

  // Extract drive letter (e.g., "c" from "/mnt/c/Users/mike/project")
  const driveLetter = wslPath.charAt(5).toUpperCase();

  // Remove /mnt/{drive} prefix (e.g., "/mnt/c" from "/mnt/c/Users/mike/project")
  const pathWithoutMnt = wslPath.substring(6);

  // Convert forward slashes to backslashes
  const windowsStylePath = pathWithoutMnt.replace(/\//g, '\\');

  // Construct Windows path: {Drive}:\{rest of path}
  return `${driveLetter}:${windowsStylePath}`;
}
