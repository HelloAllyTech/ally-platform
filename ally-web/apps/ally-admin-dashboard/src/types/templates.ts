/** Use-case templates (Agents v2, T1), as ally-be's `TemplateService` sends them. */

export type TemplateGroupId = "organisations" | "businesses";

export interface TemplateSetupQuestion {
  key: string;
  ask: string;
  /** `phone`: one phone number, the helpline a crisis reply may give (TF1 round 2, S-1). */
  kind: "text" | "long_text" | "yes_no" | "choices" | "phone";
  choices?: string[];
  hint?: string;
}

export interface TemplateCard {
  id: string;
  group: TemplateGroupId;
  name: string;
  one_liner: string;
  for: string;
  /** A sign-in motif id for the organisation templates; an emoji for the business ones. */
  icon: string;
  purpose: string;
  /** The safety pack's name, when the template asks for one. */
  pack: string | null;
  hand_over: boolean;
  memory: boolean;
  lists: { key: string; name: string; optional: boolean; has: boolean }[];
  setup: TemplateSetupQuestion[];
  checkups: number;
  suggested: boolean;
}

export interface TemplateCatalogue {
  suggested: string | null;
  groups: { id: TemplateGroupId; name: string; templates: TemplateCard[] }[];
}

export type TemplateAnswer = string | boolean | string[];
export type TemplateAnswers = Record<string, TemplateAnswer>;

export type TemplatePackOutcome =
  | { outcome: "none" }
  | { outcome: "raised"; pack: string }
  | { outcome: "kept"; pack: string; asked: string }
  | { outcome: "cant_combine"; pack: string; asked: string; message: string };

export interface TemplateInstallResult {
  template: { id: string; name: string };
  added: string[];
  skipped: string[];
  pack: TemplatePackOutcome;
  checkups: number;
  examples: number;
  channels: string[] | null;
}

export interface TemplateOrigin {
  template: { id: string; name: string } | null;
  examples_left: { total: number; lists: { key: string; name: string; count: number }[] };
}
