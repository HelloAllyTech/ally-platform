import React, { useRef, useState } from "react";

export interface ImageSlotLabels {
  /** "Add image" */
  empty: string;
  /** "Change" */
  replace: string;
  /** "Remove" */
  remove: string;
}

/**
 * An image slot and drop zone (DESIGN.md §4): dashed when empty, the image and its file name when
 * set. Click or drop a file to upload; Replace and Remove when filled. Shows upload progress and
 * an error line. Uploading itself is the caller's: `onFile` gets the file.
 */
export const ImageSlot: React.FC<{
  name: string;
  labels: ImageSlotLabels;
  src?: string | null;
  fileName?: string | null;
  alt?: string;
  accept?: string;
  progress?: number | null;
  error?: string | null;
  disabled?: boolean;
  height?: number;
  onFile: (file: File) => void;
  onRemove?: () => void;
}> = ({
  name,
  labels,
  src,
  fileName,
  alt = "",
  accept = "image/png,image/jpeg,image/webp",
  progress = null,
  error = null,
  disabled = false,
  height = 140,
  onFile,
  onRemove,
}) => {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = () => input.current?.click();
  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };
  return (
    <div>
      <div
        className="ally-slot"
        style={{ minHeight: height }}
        data-over={over}
        data-filled={Boolean(src)}
        onDragOver={event => {
          if (disabled) return;
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={event => {
          event.preventDefault();
          setOver(false);
          if (!disabled) take(event.dataTransfer.files);
        }}
      >
        {src ? <img src={src} alt={alt} /> : <span aria-hidden="true">{labels.empty}</span>}
        <button
          type="button"
          className="ally-slot__pick"
          aria-label={src ? `${labels.replace}: ${name}` : `${labels.empty}: ${name}`}
          disabled={disabled}
          onClick={pick}
        />
        {progress !== null && (
          <span
            className="ally-slot__progress"
            style={{ width: `${progress}%` }}
            aria-hidden="true"
          />
        )}
        <input
          ref={input}
          type="file"
          accept={accept}
          hidden
          data-testid={`slot-input-${name}`}
          onChange={event => {
            take(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {src && (
        <div className="ally-slot__bar">
          <span className="ally-slot__name">{fileName ?? ""}</span>
          <span style={{ display: "flex", gap: 10 }}>
            <button type="button" className="ally-link" disabled={disabled} onClick={pick}>
              {labels.replace}
            </button>
            {onRemove && (
              <button type="button" className="ally-link" disabled={disabled} onClick={onRemove}>
                {labels.remove}
              </button>
            )}
          </span>
        </div>
      )}
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
