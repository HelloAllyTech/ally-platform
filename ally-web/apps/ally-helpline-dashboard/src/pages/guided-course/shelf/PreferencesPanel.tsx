import { FC, useId, useState } from "react";

import { useTranslation } from "react-i18next";

import { useGetGuidePrefsQuery, usePutGuidePrefsMutation } from "@api";

import { SettingSwitch, ShelfLoadFailed, ShelfLoading, UtilityPage } from "./shelfParts";
import { GuidanceDial } from "../header/JourneyHeader";

import type { GuidanceLevel } from "../contract/bootstrap";
import type { GuidePrefsUpdate } from "../contract/wire";

const OUTREACH = ["off", "in_app", "in_app_email"] as const;

/**
 * The learner's settings for Ally (plan §2, config layer 3): how much Ally
 * guides, optional practice and how hard it is, and whether Ally reaches out.
 * Each change saves at once; the server's answer is what the panel shows.
 */
export const PreferencesPanel: FC<{
  guidance: GuidanceLevel;
  onGuidanceChange: (level: GuidanceLevel) => void;
}> = ({ guidance, onGuidanceChange }) => {
  const { t } = useTranslation();
  const name = useId();
  const { data: prefs, isLoading, isError, refetch } = useGetGuidePrefsQuery();
  const [putPrefs, { isLoading: saving }] = usePutGuidePrefsMutation();
  const [failed, setFailed] = useState(false);

  const save = async (patch: GuidePrefsUpdate) => {
    setFailed(false);
    try {
      await putPrefs(patch).unwrap();
    } catch {
      setFailed(true);
    }
  };

  return (
    <UtilityPage testId="preferences-panel">
      <GuidanceDial value={guidance} onChange={onGuidanceChange} />
      {isLoading ? (
        <ShelfLoading />
      ) : isError || !prefs ? (
        <ShelfLoadFailed onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="border-t border-[var(--g-line)] pt-4">
            <SettingSwitch
              label={t("guide.prefs.sideQuests")}
              hint={t("guide.prefs.sideQuestsHint")}
              checked={prefs.sideQuests}
              disabled={saving}
              onChange={sideQuests => void save({ sideQuests })}
              testId="side-quests-switch"
            />
          </div>
          {/* How hard the practice is only means something while practice is on. */}
          {prefs.sideQuests && (
            <SettingSwitch
              label={t("guide.prefs.challenge")}
              hint={t("guide.prefs.challengeHint")}
              checked={prefs.challenge === "more"}
              disabled={saving}
              onChange={more => void save({ challenge: more ? "more" : "normal" })}
              testId="challenge-switch"
            />
          )}
          {/* The rule goes on a wrapper: a fieldset's legend sits on its own top border. */}
          <div className="border-t border-[var(--g-line)] pt-4">
            <fieldset data-testid="outreach">
              <legend className="font-primary text-[15px] font-semibold text-[var(--g-ink)]">
                {t("guide.prefs.outreach")}
              </legend>
              <p className="mb-2 font-primary text-sm text-[var(--g-ink-soft)]">
                {t("guide.prefs.outreachHint")}
              </p>
              {OUTREACH.map(option => (
                <label
                  key={option}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-2 hover:bg-[var(--g-ground)]"
                >
                  <input
                    type="radio"
                    name={name}
                    value={option}
                    checked={prefs.outreach === option}
                    disabled={saving}
                    onChange={() => void save({ outreach: option })}
                    className="accent-[var(--g-progress)]"
                  />
                  <span className="font-primary text-[15px] text-[var(--g-ink)]">
                    {t(`guide.prefs.outreach_${option}`)}
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
          {failed && (
            <p className="font-secondary text-sm text-[var(--g-ink)]" role="status">
              {t("guide.prefs.failed")}
            </p>
          )}
        </>
      )}
    </UtilityPage>
  );
};
