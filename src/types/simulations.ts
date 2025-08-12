export interface Scenario {
  unique_id: string;
  title?: string;
  short_description?: string;
  long_description?: string;
  cover_image?: string | null;
}

export interface ScenariosResponse {
  scenarios: Scenario[];
}

export interface SendOtpResponse {
  success: boolean;
  message?: string;
}

export interface LoginResponse {
  tokens: {
    access_token: string;
    refresh_token: string;
  };
  name: string;
}

export interface RoomCreationResponse {
  id: string;
  script_type: string;
  created_at: string;
  updated_at: string;
  access_token: string;
}

export interface RoomListResponse {
  rooms: Array<{
    id: string;
    script_type: string;
    created_at: string;
    updated_at: string;
  }>;
}

export interface RoomDeletionResponse {
  success: boolean;
  message?: string;
}
