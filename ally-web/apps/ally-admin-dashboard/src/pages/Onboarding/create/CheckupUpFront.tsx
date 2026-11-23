import React, { useState } from "react";

import { useRunCrisisCheckMutation } from "@api";
import type { GoLiveLanguageRow } from "@api";
import { Button } from "@components/v2";

import { BUILD_COPY } from "./copy";
import { isCreditsRequired } from "./logic";
import { SPLIT_COPY } from "../copy";
import { LikelyQuestions } from "../LikelyQuestions";

const K = BUILD_COPY.checkup;
const G = BUILD_COPY.goLive;

/**
 * Check-up up front (stage 3, "Same screen as Build"; stage 7 shape): the crisis check (stage 4's
 * per-language suite, `POST /v1/chatbots/:id/crisis-check`) and ten likely questions on the
 * working copy. The saved tests sit under "Advanced" below this, in the Build section.
 */
export const CheckupUpFront: React.FC<{ chatbotId: string; draftId: string; canEdit: boolean }> = ({
  chatbotId,
  draftId,
  canEdit,
}) => {
  const [runCheck, { isLoading }] = useRunCrisisCheckMutation();
  const [crisis, setCrisis] = useState<GoLiveLanguageRow[] | "failed" | "credits" | null>(null);
  const [likelyRun, setLikelyRun] = useState(0);
  const [likelyBusy, setLikelyBusy] = useState(false);

  const runCrisis = async () => {
    setCrisis(null);
    try {
      const result = await runCheck({ chatbotId }).unwrap();
      setCrisis(result.checklist?.languages ?? []);
    } catch (error) {
      setCrisis(isCreditsRequired(error) ? "credits" : "failed");
    }
  };

  const passed =
    Array.isArray(crisis) && crisis.length > 0 && crisis.every(r => r.status === "pass");

  return (
    <div className="ally-build__checkup" data-testid="checkup-upfront">
      <section className="ally-build__section" aria-labelledby="checkup-crisis">
        <h3 className="ally-build__section-title" id="checkup-crisis">
          {K.crisisTitle}
        </h3>
        <p className="ally-small">{K.crisisBody}</p>
        {canEdit ? (
          <Button variant="secondary" disabled={isLoading} onClick={() => void runCrisis()}>
            {isLoading ? K.crisisRunning : K.crisisRun}
          </Button>
        ) : (
          <p className="ally-small">{K.viewerNote}</p>
        )}
        {crisis && (
          <div role="status" data-testid="crisis-result">
            {crisis === "failed" ? (
              <p className="ally-error">{K.crisisFailed}</p>
            ) : crisis === "credits" ? (
              <p className="ally-error">{BUILD_COPY.credits.body}</p>
            ) : (
              <>
                <p className={passed ? "ally-small" : "ally-error"}>
                  {passed ? K.crisisOk : K.crisisBad}
                </p>
                <ul className="ally-build__list">
                  {crisis.map(row => (
                    <li key={row.language}>
                      <span>{BUILD_COPY.form.languageNames[row.language] ?? row.language}</span>
                      <span className="ally-small">
                        {G.languageStatus[row.status] ?? row.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>
      <section className="ally-build__section" aria-labelledby="checkup-likely">
        <h3 className="ally-build__section-title" id="checkup-likely">
          {K.likelyTitle}
        </h3>
        <p className="ally-small">{K.likelyBody}</p>
        {canEdit && (
          <Button
            variant="secondary"
            disabled={likelyBusy}
            onClick={() => {
              setLikelyBusy(true);
              setLikelyRun(n => n + 1);
            }}
          >
            {SPLIT_COPY.likely.button}
          </Button>
        )}
        {likelyRun > 0 && (
          <LikelyQuestions
            key={likelyRun}
            draftId={draftId}
            disabled={false}
            onFinished={() => setLikelyRun(0)}
            onBusy={setLikelyBusy}
            onClose={() => setLikelyRun(0)}
          />
        )}
      </section>
    </div>
  );
};
