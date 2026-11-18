/**
 * Image Studio — AI images for every authoring slot. Mirrors ally-be's
 * `/v1/image-studio` contract (ally-be `docs/image-studio.md`).
 */

/** Every place an author sets an image. */
export type ImageSlotKind =
  | "course_cover"
  | "roleplay_cover"
  | "case_cover"
  | "path_cover"
  | "character_portrait"
  | "persona_portrait"
  | "article_cover"
  | "article_inline"
  | "quiz_question"
  | "scene"
  | "badge_icon"
  | "cast_sheet";

export type ImageAspectRatio = "16:9" | "1:1" | "3:2";

/** `GET /config`. `enabled: false` hides Generate everywhere. */
export interface ImageStudioConfig {
  enabled: boolean;
  maxVariants: number;
  maxReferences: number;
  maxBatch: number;
}

/** `GET /styles` — one card in the style gallery. */
export interface ImageStyle {
  id: string;
  name: string;
  description: string;
  kind: "photo" | "illustration";
  /** May 404 until the backend's thumbnail script has run — fall back to `swatch`. */
  thumbnailUrl: string;
  /** Two hex colours for a placeholder gradient. */
  swatch: [string, string];
  recommendedSlots: ImageSlotKind[];
}

/** `GET /slots` — the shape and defaults of each slot kind. */
export interface ImageSlotProfile {
  kind: ImageSlotKind;
  label: string;
  width: number;
  height: number;
  aspectRatio: ImageAspectRatio;
  allowsReferences: boolean;
  defaultStyleId: string;
  defaultVariants: 1 | 2;
}

export interface ImagePersonaContext {
  name?: string;
  age?: number | string;
  gender?: string;
  profession?: string;
  currentLocation?: string;
  appearance?: string;
}

/** What the slot knows about its content. Everything optional; send what the slot has. */
export interface ImageContext {
  /** Course / item / scene title. */
  title?: string;
  /** Body, question stem or scene text — plain text. */
  text?: string;
  courseTitle?: string;
  audience?: string;
  persona?: ImagePersonaContext;
}

export interface ImageSafety {
  ok: boolean;
  reason?: string;
  suggestion?: string;
}

/** `POST /describe` — "Suggest from content". */
export interface DescribeImageRequest {
  slotKind: ImageSlotKind;
  styleId?: string;
  context: ImageContext;
}

export interface DescribeImageResponse {
  description: string;
  altText: string;
  safety: ImageSafety;
}

export type ImageReferenceRole = "character" | "setting" | "style" | "previous";

export interface ImageReferenceInput {
  role: ImageReferenceRole;
  /** e.g. 'Ravi', 'the counselling room'. */
  label?: string;
  /** A generated_images id, or… */
  imageId?: string;
  /** …an image already in our S3 buckets (an uploaded scene). */
  url?: string;
}

/** `POST /jobs`. */
export interface GenerateImageRequest {
  slotKind: ImageSlotKind;
  /** Stable id of this slot instance for history, e.g. `track:<id>:item:<id>:node:<id>`. */
  slotKey?: string;
  styleId: string;
  /** 3..2000 chars — what is in the picture. */
  description: string;
  /** 1..4; defaults from the slot. */
  variants?: number;
  references?: ImageReferenceInput[];
  castCharacterIds?: string[];
  refine?: { imageId: string; instruction: string };
  context?: ImageContext;
}

export type GeneratedImageStatus = "queued" | "running" | "succeeded" | "failed";

export interface GeneratedImageCheck {
  passed: boolean;
  issues: string[];
}

export interface GeneratedImage {
  id: string;
  batchId: string;
  slotKind: ImageSlotKind;
  /** Not in the documented shape; read when the backend echoes it (batch results). */
  slotKey?: string;
  styleId: string;
  description: string;
  altText: string;
  status: GeneratedImageStatus;
  imageUrl?: string;
  width?: number;
  height?: number;
  /** Author-facing. */
  error?: string;
  /** Vision judge, when it ran. */
  check?: GeneratedImageCheck;
  referenceIds: string[];
  refinedFromId?: string;
  costUsd?: number;
  createdAt: string;
  finishedAt?: string;
  acceptedAt?: string;
}

/** `201` from `POST /jobs` and `POST /jobs/batch`. */
export interface GenerateImageResponse {
  batchId: string;
  images: GeneratedImage[];
}

/** `POST /jobs/batch` — "Fill empty scenes". Each item's `variants` is forced to 1. */
export interface GenerateImageBatchRequest {
  items: GenerateImageRequest[];
}

/** `POST /estimate`. */
export interface ImageEstimate {
  images: number;
  perImageUsd: number;
  totalUsd: number;
}

export interface AcceptGeneratedImageRequest {
  id: string;
  /** Lets the first accepted image in a course with no style example become it. */
  trackId?: string;
}

export interface GetImageHistoryParams {
  slotKey: string;
  limit?: number;
}

export interface GetCastSheetsParams {
  characterIds: string[];
  styleId?: string;
}

/** `GET /cast-sheets` — the latest accepted `cast_sheet` per character for a style. */
export interface CastSheet {
  characterId: string;
  styleId: string;
  image: GeneratedImage;
}

/* ---- Editor-side shapes --------------------------------------------------- */

/** A reference image the caller offers in the modal's References tray. */
export interface ImageReferenceOption {
  /** Stable key for the chip. */
  key: string;
  role: ImageReferenceRole;
  label: string;
  /** Shown on the chip. */
  thumbnailUrl: string;
  imageId?: string;
  url?: string;
  /** Pre-selected when the modal opens. Off unless the caller says so. */
  selected?: boolean;
}

export interface ImageReferenceOptions {
  /** Shown as toggleable chips, e.g. the previous scene, cast, setting. */
  suggested?: ImageReferenceOption[];
  /** "Add from this course's images". */
  available?: ImageReferenceOption[];
}

/** A cast member the author can tick for one generation ("In this scene: ☑ Ravi"). */
export interface ImageCastOption {
  characterId: string;
  name: string;
  /** Ticked when the modal opens. Defaults to true. */
  selected?: boolean;
}

/** What a slot receives when the author picks a generated image. */
export interface AcceptedImage {
  url: string;
  altText: string;
  imageId: string;
}

/** A request the backend refused, worded for the author. */
export interface ImageStudioError {
  status?: number | string;
  message: string;
  /** Present on 422: the description was blocked. */
  safety?: ImageSafety;
}
