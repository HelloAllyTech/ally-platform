import { FC, useState } from "react";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { ButtonVariant } from "@components/types";
import { useSlotImageJobs } from "@hooks/useImageStudioJobs";

import { IMAGE_STUDIO_COPY as copy } from "./copy";
import { GenerateImageModal, GenerateImageModalProps } from "./GenerateImageModal";
import { Button } from "../button";

export type ImageSourceControlsProps = Omit<GenerateImageModalProps, "onClose"> & {
  disabled?: boolean;
};

/**
 * The "✨ Generate" button beside a slot's own upload control, plus a chip
 * that says when this slot has images in flight or waiting for review. Loaded
 * on demand by `ImageSourceField`.
 */
const ImageSourceControls: FC<ImageSourceControlsProps> = ({ disabled = false, ...modalProps }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { pendingCount, readyCount, error } = useSlotImageJobs(modalProps.slotKey);

  const chip =
    pendingCount > 0
      ? copy.chipGenerating
      : readyCount > 0
        ? copy.chipReady(readyCount)
        : error
          ? copy.chipFailed
          : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip label={copy.generateTooltip} align="top">
        <Button
          type="button"
          variant={ButtonVariant.SECONDARY}
          className="!h-9 text-sm whitespace-nowrap"
          onClick={() => setIsOpen(true)}
          disabled={disabled}
          aria-label={copy.generateAria}
          aria-haspopup="dialog"
        >
          {copy.generate}
        </Button>
      </Tooltip>
      {chip && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-secondary-50 px-2.5 py-1 text-xs text-primary-700 hover:bg-primary-50"
        >
          {pendingCount > 0 && (
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 animate-spin rounded-full border-b-2 border-primary-500"
            />
          )}
          {chip}
        </button>
      )}
      {isOpen && (
        <GenerateImageModal
          {...modalProps}
          onAccept={image => {
            setIsOpen(false);
            modalProps.onAccept(image);
          }}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
};

export default ImageSourceControls;
