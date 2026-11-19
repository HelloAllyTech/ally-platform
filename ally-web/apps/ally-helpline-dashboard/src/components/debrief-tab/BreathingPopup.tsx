import { type FC, useState } from "react";

import { useTranslation } from "react-i18next";

import { ComposedModal, ModalBody } from "@ally-ui-mono/ui-shared";

import { BreathingPacer } from "./BreathingPacer";

/**
 * "Take a breath while you wait": a quiet link under the debrief box, at its bottom right. It opens
 * the breathing pacer in a popup above the whole page, so nothing inside the card has to make room.
 * The learner starts it and closes it; nothing starts for them.
 */
export const BreathingPopup: FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex w-full justify-end">
      <button
        type="button"
        data-testid="debrief-breathe-start"
        onClick={() => setOpen(true)}
        className="flex min-h-[44px] items-center px-1 font-primary text-sm text-typography-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
      >
        {t("postSim.debriefCards.working.breatheStart")}
      </button>
      <ComposedModal open={open} onClose={() => setOpen(false)} size="sm">
        <ModalBody className="p-0">
          <div
            data-testid="debrief-breathe-popup"
            className="flex w-[min(380px,92vw)] flex-col items-center gap-4 rounded-lg bg-white p-6"
          >
            {/* Mounted only while open: nothing keeps animating once it is closed. */}
            {open && <BreathingPacer />}
            <button
              type="button"
              data-testid="debrief-breathe-stop"
              onClick={() => setOpen(false)}
              className="flex min-h-[44px] items-center px-4 font-primary text-sm text-typography-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
            >
              {t("postSim.debriefCards.working.breatheStop")}
            </button>
          </div>
        </ModalBody>
      </ComposedModal>
    </div>
  );
};
