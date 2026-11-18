import { FC, lazy, ReactNode, Suspense } from "react";

import {
  AcceptedImage,
  ImageCastOption,
  ImageContext,
  ImageReferenceOptions,
  ImageSlotKind,
} from "@types";

import { useCourseImage } from "./CourseImageContext";
import { useImageStudioEnabled } from "./useImageStudioEnabled";

const ImageSourceControls = lazy(() => import("./ImageSourceControls"));

export interface ImageSourceFieldProps {
  slotKind: ImageSlotKind;
  /** Stable id of this slot instance, e.g. `track:<id>:item:<id>:node:<id>`. */
  slotKey: string;
  context?: ImageContext;
  /** Default: the course's, when inside the course builder. */
  courseStyleId?: string | null;
  courseStyleAnchorId?: string | null;
  trackId?: string | null;
  referenceOptions?: ImageReferenceOptions;
  castOptions?: ImageCastOption[];
  castCharacterIds?: string[];
  initialStyleId?: string | null;
  disabled?: boolean;
  /**
   * The author picked a generated image. It is already in our S3, cropped to
   * the slot's shape (WebP): store `url` exactly as an upload's result.
   */
  onAccept: (image: AcceptedImage) => void;
  /** The slot's existing upload / library UI, rendered unchanged. */
  children?: ReactNode;
  className?: string;
}

/**
 * Upload · Library · ✨ Generate for one image slot: renders the slot's own
 * upload UI as-is and adds a Generate button (and an "images ready" chip)
 * beside it. Generate is left out entirely when Image Studio is off, or when
 * the editor is rendered without the app store.
 */
export const ImageSourceField: FC<ImageSourceFieldProps> = ({
  children,
  className = "flex flex-col gap-2",
  courseStyleId,
  courseStyleAnchorId,
  trackId,
  ...rest
}) => {
  const course = useCourseImage();
  const enabled = useImageStudioEnabled();
  return (
    <div className={className}>
      {children}
      {enabled && (
        <Suspense fallback={null}>
          <ImageSourceControls
            {...rest}
            courseStyleId={courseStyleId !== undefined ? courseStyleId : course.courseStyleId}
            courseStyleAnchorId={
              courseStyleAnchorId !== undefined ? courseStyleAnchorId : course.courseStyleAnchorId
            }
            trackId={trackId !== undefined ? trackId : course.trackId}
            context={{
              ...(course.courseTitle ? { courseTitle: course.courseTitle } : {}),
              ...rest.context,
            }}
          />
        </Suspense>
      )}
    </div>
  );
};
