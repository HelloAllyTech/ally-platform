export interface ForceUpdateModalProps {
  visible?: boolean;
}

export interface ForceUpdateResponse {
  minimumSupportedVersion: string;
}

export interface VersionInfo {
  currentVersion: string;
  minimumVersion: string;
  isUpdateRequired: boolean;
}

export interface UseForceUpdateReturn {
  versionInfo: VersionInfo | null;
  isLoading: boolean;
  error: string | null;
  checkForUpdate: () => void;
}
