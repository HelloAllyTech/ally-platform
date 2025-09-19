export interface ForceUpdateModalProps {
  visible?: boolean;
}

export interface VersionInfo {
  currentVersion?: string;
  latestVersion?: string;
  isUpdateRequired: boolean;
  isUpdateAvailable: boolean;
}

export interface UseForceUpdateReturn {
  versionInfo: VersionInfo | null;
  isLoading: boolean;
  error: string | null;
  checkForUpdate: () => Promise<void>;
}
