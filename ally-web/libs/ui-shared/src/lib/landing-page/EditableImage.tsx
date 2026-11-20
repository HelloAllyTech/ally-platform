import { ChangeEvent, FC, useRef, useState } from "react";

import { LandingImageUploader } from "./types";

interface EditableImageProps {
  src: string | null;
  alt: string;
  editable: boolean;
  /** Called with the new address, or null when the image is removed. */
  onChange: (next: string | null) => void;
  onUpload?: LandingImageUploader;
  /** What the empty slot says while editing, for example "Add a hero image". */
  emptyLabel: string;
  className?: string;
  /** The image as the page shows it, so a wider or rounder frame can be styled. */
  imageClassName?: string;
  /** Hide the cross: for an image the page cannot do without. */
  removable?: boolean;
}

const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

/**
 * An image with its own controls. Hover shows a cross (remove) and an upload
 * (replace) button; an empty slot becomes an "add" target while editing. As a
 * visitor sees the page it is just the image, or nothing.
 */
export const EditableImage: FC<EditableImageProps> = ({
  src,
  alt,
  editable,
  onChange,
  onUpload,
  emptyLabel,
  className,
  imageClassName,
  removable = true,
}) => {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editable) {
    return src ? (
      <span className={className}>
        <img className={imageClassName} src={src} alt={alt} />
      </span>
    ) : null;
  }

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onUpload) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await onUpload(file));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The upload did not work");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span
      className={`lp-image ${src ? "" : "is-empty"} ${className ?? ""}`.trim()}
      data-busy={busy}
    >
      {src ? (
        <img className={imageClassName} src={src} alt={alt} />
      ) : (
        <button
          type="button"
          className="lp-image-add"
          onClick={() => input.current?.click()}
          disabled={busy || !onUpload}
        >
          {busy ? "Uploading…" : emptyLabel}
        </button>
      )}
      {src && (
        <span className="lp-image-controls">
          <button
            type="button"
            className="lp-image-btn"
            aria-label={`Replace image: ${emptyLabel}`}
            title="Replace"
            onClick={() => input.current?.click()}
            disabled={busy || !onUpload}
          >
            {busy ? "…" : "↑"}
          </button>
          {removable && (
            <button
              type="button"
              className="lp-image-btn"
              aria-label={`Remove image: ${emptyLabel}`}
              title="Remove"
              onClick={() => onChange(null)}
              disabled={busy}
            >
              ×
            </button>
          )}
        </span>
      )}
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={pick} />
      {error && (
        <span className="lp-image-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
};
