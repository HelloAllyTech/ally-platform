import type {
  BotDraft,
  Learned,
  PatchOp,
} from '../../bot-draft/type/bot-draft.type';

/**
 * ally-ai's onboarding builder (`/builder/*`, chunk 20a). Shapes mirror
 * `ally-ai/app/schemas/builder.py`; the draft itself is held in step by a shared fixture.
 */
export interface BuilderGap {
  key: string;
  item: string;
  why: string;
}

export interface BuilderDesignCard {
  id: string;
  title: string;
  best_for: string;
  will: string[];
  wont: string[];
  sample: { from: string; text: string }[];
  coming_soon?: boolean;
}

export interface BuilderStepRequest {
  draft_id: string;
  step: string;
  message: string;
  chip: string;
  draft: BotDraft;
  learned: Learned;
  answers: Record<string, string>;
  pending: string;
  industry: string | null;
  gaps: BuilderGap[] | null;
  designs: BuilderDesignCard[] | null;
  pages: { url: string; title: string; headings: string[]; snippet: string }[];
  safety_pack: {
    id: string;
    name: string;
    always: string[];
    never: string[];
    at_risk: string[];
  };
  description: string;
  history: { role: 'builder' | 'owner' | 'note'; text: string }[];
  prompts: Record<string, unknown>;
}

export interface BuilderStepResponse {
  message: string;
  chips: string[];
  patches: PatchOp[];
  learned_patches: PatchOp[];
  next_step: string;
  questions_left: number;
  asking: string;
  answer: string;
  industry: string | null;
  gaps: BuilderGap[] | null;
  designs: BuilderDesignCard[] | null;
  dropped_patches: number;
}

export type BuilderStreamEvent =
  | { event: 'status'; data: { code: string; label: string } }
  | { event: 'token'; data: { text: string } };

export interface BuilderExtractRequest {
  draft_id: string;
  pages: { url: string; title: string; text: string }[];
  known: string[];
  prompts: Record<string, unknown>;
}

export interface BuilderExtractResponse {
  facts: {
    section: string;
    text: string;
    source_url: string;
    source_title: string;
  }[];
  dropped: number;
  findings: string[];
}
