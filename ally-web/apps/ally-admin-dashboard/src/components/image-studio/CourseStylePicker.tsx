import { FC } from "react";

import { CustomImage } from "@ally-ui-mono/ui-shared";
import { useGetImageJobsQuery, useGetImageStylesQuery } from "@api";

import { IMAGE_STUDIO_COPY as copy } from "./copy";
import { StyleGallery } from "./StyleGallery";

export interface CourseStylePickerProps {
  value: string | null | undefined;
  onChange: (styleId: string | null) => void;
  /** `generated_images.id` of the course's style example. */
  anchorId?: string | null;
  onClearAnchor: () => void;
  disabled?: boolean;
}

/**
 * Track settings → Visual style: the course's style (every generator in the
 * course starts on it) and its style example. Loaded on demand.
 */
const CourseStylePicker: FC<CourseStylePickerProps> = ({
  value,
  onChange,
  anchorId,
  onClearAnchor,
  disabled = false,
}) => {
  const { data: styles = [], isLoading } = useGetImageStylesQuery();
  const { data: anchorImages } = useGetImageJobsQuery(anchorId ? [anchorId] : [], {
    skip: !anchorId,
  });
  const anchor = anchorImages?.find(image => image.id === anchorId && image.imageUrl);

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="course-style-picker">
      {isLoading && styles.length === 0 ? (
        <p className="text-xs text-typography-500">{copy.stylesLoading}</p>
      ) : (
        <StyleGallery
          name="course-visual-style"
          label={copy.coursePickerLabel}
          styles={styles}
          value={value ?? null}
          onChange={onChange}
          compact
          disabled={disabled}
        />
      )}
      <p className="text-xs text-typography-500">{copy.coursePickerHelp}</p>
      {value ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          className="self-start text-xs text-typography-500 hover:text-typography-700"
        >
          No course style
        </button>
      ) : (
        <p className="text-xs text-typography-500">{copy.coursePickerNone}</p>
      )}
      {anchorId && (
        <div className="flex items-center gap-3">
          <div className="h-14 w-24 overflow-hidden rounded-md bg-gray-100">
            {anchor?.imageUrl && (
              <CustomImage
                src={anchor.imageUrl}
                alt={copy.courseAnchorAlt}
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-typography-800">
              {copy.courseAnchorLabel}
            </span>
            <span className="text-xs text-typography-500">{copy.courseAnchorHelp}</span>
            <button
              type="button"
              onClick={onClearAnchor}
              disabled={disabled}
              className="self-start text-xs text-destructive-500 hover:text-destructive-600"
            >
              {copy.courseAnchorClear}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CourseStylePicker;
