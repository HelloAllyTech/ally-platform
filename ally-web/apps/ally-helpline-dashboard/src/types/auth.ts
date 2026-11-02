import { AppType } from "./user";

export interface GenerateOTPRequest {
  phone?: string;
  email?: string;
  appType?: AppType;
}

export interface VerifyOTPRequest {
  phone?: string;
  email?: string;
  otp: string;
}

export interface GenerateOTPResponse {
  success: boolean;
  expiresIn: number;
}

export interface VerifyOTPResponse {
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}
export interface GetProfileUrlRequest {
  fileName: string;
  fileSize: number;
  contentType: string;
}
export interface GetProfileUrlResponse {
  presignedUrl: string;
  profileImageUrl: string;
}

export interface profileUrlRequest {
  profileImageUrl: string;
}
export interface logoUrlResponse {
  name: string;
  logoUrl: string;
  /** Resolved organization branding; absent on backends that predate it. */
  branding?: TenantBranding;
}

/** Light-to-dark ramp the backend derives from the org's one brand hex. */
export interface BrandColourRamp {
  DEFAULT: string;
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
}

/**
 * What the app paints for an organization. Always complete: Ally defaults
 * while the org's branding switch is off, so `enabled` is the only thing a
 * caller has to check before trusting the rest.
 */
export interface TenantBranding {
  enabled: boolean;
  displayName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  welcomeLine: string | null;
  poweredByAlly: true;
  tokens: {
    primary: BrandColourRamp;
    /** Label colour that reads on the brand colour. */
    onPrimary: string;
  };
}
