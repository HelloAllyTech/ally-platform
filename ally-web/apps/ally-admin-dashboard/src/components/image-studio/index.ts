// Static-safe surface only: nothing here imports the API slice at load time.
// The modal, course style picker and cast sheets load on demand (see lazy.tsx).
export { IMAGE_STUDIO_COPY } from "./copy";
export {
  CourseImageContext,
  courseSlotPrefix,
  useCourseImage,
  type CourseImageContextValue,
} from "./CourseImageContext";
export { ImageSourceField, type ImageSourceFieldProps } from "./ImageSourceField";
export { LazyCastSheetsSection, LazyCourseStylePicker, LazyGenerateImageModal } from "./lazy";
export { StyleGallery, StyleThumbnail } from "./StyleGallery";
export { markImageStudioDisabled, useImageStudioEnabled } from "./useImageStudioEnabled";
export { compactContext, toContextText, pageSlotKey } from "./utils";
