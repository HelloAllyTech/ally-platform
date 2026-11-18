# Image Studio — AI image generation for authors

Every place an author sets an image while building a course, a roleplay, a case, a path, a
character or a badge offers **Upload · Library · Generate**. Generate opens one shared modal:
pick a style from a gallery, describe the picture (or let AI draft the description from the
content), optionally keep characters and places consistent with reference images, and get back
1–4 candidates. Nothing is applied until the author picks one; the form's own Save persists the
URL exactly like an upload.

Code: `src/image-studio/` (this feature) on top of `src/image-generation/` (the provider
adapters). Frontend: `ally-web/apps/ally-admin-dashboard/src/components/image-studio/`.

## How a generation works

```
POST /jobs ──► compose (1 fast LLM call: scene spec + safety screen + alt text)
           │      └─ blocked? → 422 with a reason and a rewording suggestion, nothing queued
           └─► N rows in generated_images (status queued)  ──► response with ids
worker (every API task, claim with FOR UPDATE SKIP LOCKED, heartbeat):
   resolve references from our own S3 (never a URL fetch)
   → route: references? reference model : text model   (outage → other provider)
   → generate → vision judge (optional) → one silent retry on a failed check
   → original PNG + cropped WebP to S3 → row succeeded (+ usage row with cost)
editor polls GET /jobs?ids=… every 3 s; the author accepts one → POST /images/:id/accept
```

- **Compiled prompt.** The image prompt is compiled in code from the slot's framing, the
  style's fragment, the scene spec, labelled references ("Image 2 is Ravi — keep his face…")
  and the guardrails. The guardrails are appended in code, so editing a prompt in the Skills
  Store cannot remove them.
- **Durable.** A job is a row; a deploy mid-run leaves it `running` with a stale heartbeat and
  the 5-minute reconcile requeues it (two attempts) or fails it.
- **Two copies.** `image-studio/originals/<id>.png` is the full-quality original, used when the
  image is later a reference. `image-studio/<id>.webp` is cropped to the slot's exact shape and
  is the URL the form stores.
- **Never deleted by an editor.** Shared files (generated, library, or used by more than one
  record) are skipped by the scenario-cover and track-media delete paths. Unaccepted generated
  images that nothing uses are removed by the daily cleanup after 30 days.

## Safety (mental-health content)

The guardrails follow safe-messaging practice for suicide and self-harm content. Every image:
no text, letters, logos or watermarks; no identifiable real person; never a method of self-harm
or suicide, an injury, blood, a weapon or pills held by someone at risk — the emotion is shown
through posture, expression and setting instead; nothing sexual; respectful, non-stereotyped
people. The compose step screens the description first (and a keyword backstop runs when the
model is unavailable); the judge checks the result. Descriptions must not contain real client
details — the modal says so, and the compose step blocks text that looks like it does.
The policy text lives in `src/image-studio/constants/image-safety.constants.ts` and needs a
clinical lead's sign-off before it changes.

## Configuration

| Env | Default | What |
|---|---|---|
| `IMAGE_STUDIO_ENABLED` | `true` | Off hides Generate (GET /config says so) and refuses jobs |
| `IMAGE_STUDIO_TEXT_PROVIDER` / `IMAGE_STUDIO_TEXT_MODEL` | `CHARACTER_IMAGE_DEFAULT_PROVIDER` / provider default | Text-only images (covers, icons) |
| `IMAGE_STUDIO_REFERENCE_PROVIDER` / `IMAGE_STUDIO_REFERENCE_MODEL` | `gemini` / `GEMINI_IMAGE_MODEL` | Images with references (scenes, cast sheets, refine) |
| `IMAGE_STUDIO_QUALITY` | `medium` | OpenAI quality tier |
| `IMAGE_STUDIO_JUDGE_ENABLED` / `IMAGE_STUDIO_JUDGE_MODEL` | `true` / `gpt-4o-mini` | Vision check of every result |
| `IMAGE_STUDIO_WORKER_CONCURRENCY` | `3` | Images generated at once per API task |
| `IMAGE_STUDIO_MAX_ACTIVE_PER_USER` | `12` | Queued + running per author |
| `IMAGE_STUDIO_MAX_REFERENCES` | `5` | References sent per image |

Model ids move fast: check a candidate with Bug Hunter's image probe before switching, then run
the eval (`src/image-studio/scripts/eval.ts`) and compare scorecards.

## API — `/v1/image-studio` (JWT; any of `edit:admin:track`, `edit:scenario`, `edit:scenario-character`, `edit:admin:badges`, `edit:admin:case`, `edit:admin:scenario-path`)

### `GET /config`
`{ enabled, maxVariants: 4, maxReferences: 5, maxBatch: 20 }`

### `GET /styles`
```ts
ImageStyle {
  id: string;            // 'documentary_photo' | 'cinematic_photo' | 'warm_illustration' | 'watercolour' | 'graphic_novel' | 'line_art' | 'soft_3d'
  name: string; description: string;
  kind: 'photo' | 'illustration';
  thumbnailUrl: string;  // may 404 until src/image-studio/scripts/thumbnails.ts has run — fall back to swatch
  swatch: [string, string]; // two hex colours for a placeholder gradient
  recommendedSlots: ImageSlotKind[];
}
```

### `GET /slots`
```ts
ImageSlotKind = 'course_cover' | 'roleplay_cover' | 'case_cover' | 'path_cover'
  | 'character_portrait' | 'persona_portrait' | 'article_cover' | 'article_inline'
  | 'quiz_question' | 'scene' | 'badge_icon' | 'cast_sheet';
ImageSlotProfile { kind; label; width; height; aspectRatio: '16:9' | '1:1' | '3:2';
  allowsReferences: boolean; defaultStyleId: string; defaultVariants: 1 | 2 }
```

### `POST /describe` — "Suggest from content" (synchronous, a few seconds)
Request `{ slotKind, styleId?, context: ImageContext }` →
`{ description: string; altText: string; safety: ImageSafety }`
```ts
ImageContext {           // everything optional; send what the slot has
  title?: string; text?: string;         // course/item/scene title and body/stem/scene text
  courseTitle?: string; audience?: string;
  persona?: { name?; age?; gender?; profession?; currentLocation?; appearance? };
}
ImageSafety { ok: boolean; reason?: string; suggestion?: string }
```

### `POST /jobs` — generate (returns at once)
```ts
GenerateImageRequest {
  slotKind: ImageSlotKind;
  slotKey?: string;        // stable id of this slot instance for history, e.g. 'track:<id>:item:<id>:node:<id>'
  styleId: string;
  description: string;     // 3..2000 chars, what is in the picture
  variants?: 1..4;         // default from the slot
  references?: ImageReferenceInput[];   // ≤ maxReferences; only for slots with allowsReferences or when refining
  castCharacterIds?: string[];          // scenario_characters ids: their appearance text is added; their
                                        // accepted cast sheet for this style is added as a reference
  refine?: { imageId: string; instruction: string };  // "make her look more worried": edits that image
                                        // (it becomes reference 1; sending it again in `references` is deduplicated)
  context?: ImageContext;
}
ImageReferenceInput {
  role: 'character' | 'setting' | 'style' | 'previous';
  label?: string;              // 'Ravi', 'the counselling room'
  imageId?: string;            // a generated_images id, or
  url?: string;                // an image already in our S3 buckets (an uploaded scene); anything else → 400
}
```
→ `201 { batchId: string; images: GeneratedImage[] }`, or `422 { message, safety: ImageSafety }`
when the request is blocked, `429` when the author already has too many images in flight,
`503` when Image Studio is off.

```ts
GeneratedImage {
  id; batchId; slotKind; slotKey?; styleId; description; altText;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  imageUrl?: string;  width?: number; height?: number;
  error?: string;                         // author-facing
  check?: { passed: boolean; issues: string[] };  // vision judge, when it ran
  referenceIds: string[]; refinedFromId?: string;
  costUsd?: number; createdAt; finishedAt?; acceptedAt?;
}
```

### `POST /jobs/batch` — "Fill all empty scenes"
`{ items: GenerateImageRequest[] }` (≤ 20, each `variants` forced to 1) →
`{ batchId, images }`. `POST /estimate` with the same body (or a single request) returns
`{ images: number, perImageUsd: number, totalUsd: number }` — show it before a batch starts.

### `GET /jobs?ids=a,b,c`
Poll; returns a bare `GeneratedImage[]`. Only images in the caller's tenant.

### `GET /history?slotKey=…&limit=12`
Earlier tries for this slot as a bare `GeneratedImage[]` (caller's tenant, newest first, succeeded only).

### `POST /images/:id/accept`
Marks the image used (protects it from cleanup; the first accepted image in a course with no
style example becomes it when the editor sends `trackId` — see tracks below). `{ trackId? }` →
`GeneratedImage`.

### `GET /cast-sheets?characterIds=a,b[&styleId=x]`
`[{ characterId, styleId, image: GeneratedImage }]` — the latest accepted `cast_sheet` per
character and style (only that style when `styleId` is given). Generate one with `POST /jobs` `{ slotKind: 'cast_sheet', castCharacterIds: [id], styleId }`;
accept it to make it the sheet.

## Related fields

- `tracks.imageStyleId` (nullable): the course's visual style; every generator in the course
  starts on it. `tracks.imageStyleAnchorId` (nullable `generated_images.id`): the course's style
  example, sent as a `style` reference. Both are on the track DTOs (the editor's existing track update, `PUT /v1/learn/admin/tracks/:id`).
- `scenario_characters.appearance` (nullable, ≤ 500): a fixed one-line look ("early 30s, short
  beard, blue kurta") added to every image the character is in. On the character DTOs.

## Tables

`generated_images` — one row per image (job and history in one). See `DATA_SCHEMA.md` §3.21.
