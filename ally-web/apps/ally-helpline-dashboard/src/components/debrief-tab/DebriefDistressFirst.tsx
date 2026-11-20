import { FC, ReactNode, useState } from "react";

import { ChevronDown, HeartHandshake } from "lucide-react";
import { useTranslation } from "react-i18next";

import { LearnerDebriefView } from "@types";

import { SupportLines } from "./DebriefCardLinks";
import { Body } from "./DebriefCardPrimitives";

/**
 * When the learner stepped out of the role in distress (plan flow C), care
 * comes before coaching: an acknowledgement and the support lines first, and
 * the debrief collapsed until the learner chooses to open it.
 */
export const DistressFirst: FC<{ view: LearnerDebriefView; children: ReactNode }> = ({
  view,
  children,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <section
        data-testid="debrief-distress"
        aria-labelledby="debrief-distress-title"
        className="flex flex-col gap-3 rounded-lg border border-primary-200 bg-primary-50 p-4"
      >
        <h3
          id="debrief-distress-title"
          className="flex items-center gap-2 font-primary text-base font-semibold text-typography-900"
        >
          <HeartHandshake aria-hidden="true" className="h-5 w-5 text-primary-600" />
          {t("postSim.debriefCards.distress.title")}
        </h3>
        <Body>{t("postSim.debriefCards.distress.body")}</Body>
        {!!view.supportLines?.length && (
          <>
            <Body>{t("postSim.debriefCards.distress.supportLead")}</Body>
            <SupportLines lines={view.supportLines} />
          </>
        )}
      </section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="debrief-when-ready"
        onClick={() => setOpen(o => !o)}
        className="flex min-h-[44px] items-center justify-between gap-2 rounded-md border border-primary-100 px-4 font-primary text-sm font-semibold text-typography-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
      >
        {t("postSim.debriefCards.distress.whenReady")}
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div id="debrief-when-ready" hidden={!open}>
        {children}
      </div>
    </div>
  );
};
