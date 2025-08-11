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
