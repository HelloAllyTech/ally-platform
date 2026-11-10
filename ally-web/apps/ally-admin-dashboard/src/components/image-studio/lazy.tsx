import { FC, lazy, Suspense } from "react";

import { useCourseImage } from "./CourseImageContext";
import { useImageStudioEnabled } from "./useImageStudioEnabled";

import type { CastSheetsSectionProps } from "./CastSheetsSection";
import type { CourseStylePickerProps } from "./CourseStylePicker";
import type { GenerateImageModalProps } from "./GenerateImageModal";

/*
 * On-demand entry points. Editors that host an image slot import only these
 * thin wrappers; the API slice and the modal load when Image Studio is on and
 * the author gets near it. That keeps the course builder's first load light,
 * and keeps editor tests that mock `@api` / `@constants` wholesale unaffected.
 */

const Modal = lazy(() =>
  import("./GenerateImageModal").then(module => ({ default: module.GenerateImageModal })),
);
const StylePicker = lazy(() => import("./CourseStylePicker"));
const CastSheets = lazy(() => import("./CastSheetsSection"));

/** The Generate dialog on its own (for triggers that are not an ImageSourceField). */
export const LazyGenerateImageModal: FC<GenerateImageModalProps> = props => {
  const course = useCourseImage();
  return (
    <Suspense fallback={null}>
      <Modal
        {...props}
        courseStyleId={
          props.courseStyleId !== undefined ? props.courseStyleId : course.courseStyleId
        }
        courseStyleAnchorId={
          props.courseStyleAnchorId !== undefined
            ? props.courseStyleAnchorId
            : course.courseStyleAnchorId
        }
        trackId={props.trackId !== undefined ? props.trackId : course.trackId}
        context={{
          ...(course.courseTitle ? { courseTitle: course.courseTitle } : {}),
          ...props.context,
        }}
      />
    </Suspense>
  );
};

/** Renders nothing while Image Studio is off. */
export const LazyCourseStylePicker: FC<CourseStylePickerProps> = props => {
  const enabled = useImageStudioEnabled();
  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <StylePicker {...props} />
    </Suspense>
  );
};

/** Renders nothing while Image Studio is off. */
export const LazyCastSheetsSection: FC<CastSheetsSectionProps> = props => {
  const enabled = useImageStudioEnabled();
  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <CastSheets {...props} />
    </Suspense>
  );
};
