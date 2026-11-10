import { FC, useState } from "react";

import { ImageStyle } from "@types";

import { IMAGE_STUDIO_COPY as copy } from "./copy";
import { swatchGradient } from "./utils";

interface StyleThumbnailProps {
  style: ImageStyle;
  className?: string;
}

/** The style's example picture; its swatch gradient until (or instead of) the file loading. */
export const StyleThumbnail: FC<StyleThumbnailProps> = ({ style, className = "" }) => {
  const [failed, setFailed] = useState(!style.thumbnailUrl);
  return (
    <span
      aria-hidden="true"
      className={`block overflow-hidden bg-gray-100 ${className}`}
      style={{ backgroundImage: swatchGradient(style.swatch) }}
      data-testid={`style-thumb-${style.id}`}
    >
      {!failed && (
        <img
          src={style.thumbnailUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
};

interface StyleGalleryProps {
  /** Unique per gallery on the page: names the radio group. */
  name: string;
  styles: ImageStyle[];
  value: string | null;
  onChange: (styleId: string) => void;
  /** Smaller cards, for the course settings picker. */
  compact?: boolean;
  /** Marks this style "Course style". */
  courseStyleId?: string | null;
  label?: string;
  disabled?: boolean;
}

/**
 * A horizontal, scrollable row of style cards. Native radio inputs carry the
 * semantics, so Tab enters the group and the arrow keys move the selection.
 */
export const StyleGallery: FC<StyleGalleryProps> = ({
  name,
  styles,
  value,
  onChange,
  compact = false,
  courseStyleId,
  label = copy.styleLabel,
  disabled = false,
}) => {
  const labelId = `${name}-label`;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span id={labelId} className="text-sm font-medium text-typography-800">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="-mx-1 flex min-w-0 snap-x gap-3 overflow-x-auto px-1 pb-2 pt-1 custom-scrollbar"
      >
        {styles.map(style => {
          const checked = style.id === value;
          return (
            <label
              key={style.id}
              title={style.description}
              className={`relative flex shrink-0 snap-start cursor-pointer flex-col overflow-hidden rounded-md border bg-white transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-400 ${
                compact ? "w-24" : "w-32"
              } ${
                checked
                  ? "border-primary-500 ring-1 ring-primary-500"
                  : "border-border-light hover:bg-secondary-50"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name={name}
                value={style.id}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(style.id)}
                className="sr-only"
              />
              <StyleThumbnail style={style} className={compact ? "h-16 w-full" : "h-20 w-full"} />
              <span className="flex flex-col gap-0.5 px-2 py-1.5">
                <span className="text-xs font-semibold leading-tight text-typography-900">
                  {style.name}
                </span>
                {courseStyleId === style.id && (
                  <span className="text-[11px] leading-tight text-primary-600">
                    {copy.courseStyleBadge}
                  </span>
                )}
              </span>
              {checked && (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary-500 text-[11px] text-white"
                >
                  ✓
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
};
