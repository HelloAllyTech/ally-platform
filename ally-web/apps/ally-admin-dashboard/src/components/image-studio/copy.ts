/**
 * Image Studio UI copy. Kept beside the components (like the course builder's
 * inline copy) rather than in `en.ts`: these components are rendered inside
 * editors whose tests mock `@constants` wholesale, and this file has no imports.
 */
export const IMAGE_STUDIO_COPY = {
  generate: "✨ Generate",
  generateAria: "Generate an image with AI",
  generateTooltip:
    "Make an image with AI: pick a style, describe the picture, and choose from a few options. Nothing changes until you pick one.",
  modalTitle: "Generate an image",
  close: "Close",
  cancel: "Cancel",

  styleLabel: "Style",
  styleMismatch: "Doesn't match this course's style",
  courseStyleBadge: "Course style",
  stylesLoading: "Loading styles…",

  descriptionLabel: "Description",
  descriptionPlaceholder:
    "e.g. A young woman sitting on the edge of her bed at night, phone in hand",
  descriptionHint: "Describe the picture. Don't include real client details.",
  suggest: "✨ Suggest from content",
  suggesting: "Suggesting…",
  suggestFailed: "Couldn't suggest a description. Write your own, or try again.",

  referencesLabel: "Keep consistent with",
  referencesHelp:
    "Images the new one should match — the same person, the same room, the previous scene. Off unless you turn them on.",
  referencesMax: (max: number) => `Up to ${max}.`,
  addFromCourse: "Add from this course's images",
  hideCourseImages: "Hide course images",
  noCourseImages: "No other images in this course yet.",

  castLabel: "In this scene",
  castHelp:
    "Ticked characters are drawn from their Appearance line and cast sheet, so they look the same in every scene.",

  variationsLabel: "Variations",

  generateButton: "Generate",
  generatingButton: "Generating…",
  generatingStatus: "Generating — usually under a minute. You can close this and keep working.",
  descriptionTooShort: "Describe the picture in a few words first.",

  resultsLabel: "Results",
  resultAlt: (index: number) => `Generated option ${index}`,
  resultPending: "Generating…",
  resultFailed: "Couldn't make this one.",
  checkWarning: "May not match — check closely",
  useThis: "Use this",
  using: "Using…",
  refine: "Refine",
  refineLabel: "What should change?",
  refinePlaceholder: "e.g. Make her look more worried",
  refineSubmit: "Refine",
  refineCancel: "Cancel",
  dismiss: "Dismiss",

  historyLabel: "Earlier tries",
  historyAlt: (index: number) => `Earlier try ${index}`,

  acceptFailed: "Couldn't use that image. Try again.",
  safetySuggestionPrefix: "Try:",

  chipGenerating: "Generating…",
  chipReady: (count: number) => `${count} image${count === 1 ? "" : "s"} ready — review`,
  chipFailed: "Generation stopped — review",

  coursePickerLabel: "Visual style",
  coursePickerHelp:
    "Every image generator in this course starts on this style, so covers, scenes and pictures look like one set.",
  coursePickerNone: "No course style yet — each image picks its own.",
  courseAnchorLabel: "Style example",
  courseAnchorHelp:
    "An image from this course that new images copy the look of. The first image you use becomes it.",
  courseAnchorClear: "Clear",
  courseAnchorAlt: "This course's style example",

  castSheetsLabel: "Cast sheets",
  castSheetsHelp:
    "A reference sheet of this character in one style. Scenes they appear in use it to keep their face the same.",
  castSheetsSaveFirst: "Save the character to create cast sheets.",
  castSheetCreate: "Create cast sheet",
  castSheetReplace: "New sheet",
  castSheetAlt: (name: string, style: string) => `${name} — ${style} cast sheet`,
  castSheetGenerating: "Generating…",

  appearanceLabel: "Appearance",
  appearanceHelper: "One line on how they look — used to keep them consistent in AI images",
  appearancePlaceholder: "e.g. early 30s, short beard, blue kurta",
} as const;
