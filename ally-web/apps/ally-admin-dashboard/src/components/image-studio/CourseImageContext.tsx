import { createContext, useContext } from "react";

/**
 * What every image slot inside the course builder needs to know about the
 * course: its id (sent with accept), its visual style and style example (every
 * generator starts on them), and its title (context for descriptions).
 * Outside the builder the defaults apply and slots fall back to their own.
 */
export interface CourseImageContextValue {
  trackId?: string | null;
  courseStyleId?: string | null;
  courseStyleAnchorId?: string | null;
  courseTitle?: string;
  /** The author used a generated image somewhere in the course. */
  onImageAccepted?: (imageId: string) => void;
}

export const CourseImageContext = createContext<CourseImageContextValue>({});

export const useCourseImage = (): CourseImageContextValue => useContext(CourseImageContext);

/** `track:<id>` (or `track:new`), the prefix of every slotKey in a course. */
export const courseSlotPrefix = (trackId?: string | null) => `track:${trackId || "new"}`;
