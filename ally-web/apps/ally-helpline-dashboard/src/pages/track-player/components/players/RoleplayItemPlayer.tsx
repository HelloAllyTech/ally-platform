import { FC, useEffect, useState } from "react";

import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { DropdownField, RichTextRenderer } from "@ally-ui-mono/ui-shared";
import { useGetScenarioCaseDetailsQuery, useGetScenarioQuery, useGetScenariosQuery } from "@api";
import { ArrowDownFilled, PlayIcon, Refresh, TickGreenBackground } from "@assets";
import { ScenarioCard } from "@components";
import {
  InteractionModePicker,
  useInteractionModePreference,
} from "@components/interaction-mode-picker/InteractionModePicker";
import {
  getRoleplayFailureLines,
  getRoleplayRequirement,
  getRoleplayShortAttemptLine,
} from "@components/track-visuals";
import { useStartSimulation } from "@hooks";
import {
  ACTIVE_TRACK_CONTEXT_KEY,
  ActiveTrackContext,
  LanguageOption,
  StartCaseItemPayload,
  StartRoleplayItemPayload,
  TrackDetailItem,
} from "@types";
import { getFormattedDateTime } from "@utils";

import { RoleplaySessionLogPanel } from "./RoleplaySessionLogPanel";

interface RoleplayItemPlayerProps {
  payload: StartRoleplayItemPayload | StartCaseItemPayload;
  item: TrackDetailItem;
  trackId: string;
  alreadyCompleted: boolean;
  /**
   * Merged into the stashed return-to-track context. Optional: the guided
   * journey passes `returnTo: "guided"` so the summary comes back to Ally.
   */
  trackContextExtras?: Partial<ActiveTrackContext>;
  /** Called just before the simulation or case opens. Optional. */
  onBeforeLaunch?: () => void;
}

/**
 * Persists the return-to-track context so the post-simulation screen can
 * route the learner back into the player when the roleplay/case ends.
 */
const persistTrackContext = (ctx: ActiveTrackContext) => {
  try {
    sessionStorage.setItem(ACTIVE_TRACK_CONTEXT_KEY, JSON.stringify(ctx));
  } catch {
    // sessionStorage may be unavailable (private mode) — non-fatal.
  }
};

/**
 * Pre-launch screen for roleplay and case items. Roleplay items launch a
 * live simulation (linked to the track item progress row); case items open
 * the existing case detail page. Both stash the active-track context first.
 */
export const RoleplayItemPlayer: FC<RoleplayItemPlayerProps> = ({
  payload,
  item,
  trackId,
  alreadyCompleted,
  trackContextExtras,
  onBeforeLaunch,
}) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { startSimulation, isStarting } = useStartSimulation();
  const [logExpanded, setLogExpanded] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageOption | null>(null);
  const [preferredMode, setPreferredMode] = useInteractionModePreference();

  const isCase = payload.type === "CASE";
  const scenarioId = payload.type === "ROLEPLAY" ? payload.scenarioId : 0;
  const lastScenarioSessionId = payload.type === "ROLEPLAY" ? payload.lastScenarioSessionId : null;
  // Assessment mode: one attempt, so once it is submitted the item can only be
  // reviewed, never relaunched. The server refuses a second start either way.
  const assessment = payload.type === "ROLEPLAY" ? (payload.assessment ?? null) : null;
  const isAssessment =
    payload.type === "ROLEPLAY" &&
    (!!payload.completionCriteria?.assessmentMode ||
      assessment != null ||
      payload.roleplayGate?.roleplayType === "ASSESSMENT");
  const requiredTurns =
    payload.type === "ROLEPLAY" && isAssessment
      ? (assessment?.requiredTurns ??
        payload.roleplayGate?.minLearnerTurns ??
        payload.completionCriteria?.minLearnerTurns ??
        null)
      : null;
  // Submitted and results withheld: "Submitted" only, never a score or report.
  const resultsHidden = assessment?.resultsHidden === true;
  // A post can't start until its paired pre is submitted.
  const postLocked = !!assessment?.preAssessment && !assessment.preAssessment.submitted;
  const assessmentSubmittedAt =
    payload.type === "ROLEPLAY" ? (payload.assessmentSubmittedAt ?? null) : null;
  const assessmentLocked = isAssessment && !!assessmentSubmittedAt;
  const requirement =
    payload.type === "ROLEPLAY" ? getRoleplayRequirement(payload.roleplayGate, t) : null;
  // Why the last attempt didn't count. The server drops it once the item is
  // complete; the alreadyCompleted check covers a just-finished replay.
  const lastAttempt =
    payload.type === "ROLEPLAY" && !alreadyCompleted ? (payload.lastRoleplayAttempt ?? null) : null;
  const failureLines = lastAttempt ? getRoleplayFailureLines(lastAttempt, t) : [];
  const shortAttemptLine = lastAttempt ? getRoleplayShortAttemptLine(lastAttempt, t) : null;

  const { data: scenario } = useGetScenarioQuery({ scenarioId, isPrivate: true }, { skip: isCase });
  const { data: caseDetails } = useGetScenarioCaseDetailsQuery(
    { caseId: payload.type === "CASE" ? payload.caseId : "" },
    { skip: !isCase },
  );

  // A roleplay's enabled languages are carried by the scenarios list (v2)
  // response — the same source the standalone scenario page reads — so fall
  // back to it when the detail payload doesn't include them.
  const { catalogLanguages } = useGetScenariosQuery(
    { isPrivate: true, languageCode: i18n.language },
    {
      skip: isCase,
      selectFromResult: ({ data }) => ({
        catalogLanguages: data?.data?.find(s => s.id === scenarioId)?.availableLanguages ?? [],
      }),
    },
  );
  const availableLanguages = scenario?.availableLanguages?.length
    ? scenario.availableLanguages
    : catalogLanguages;

  // Default to the first offered language, but only while there is no valid
  // selection: `availableLanguages` is a fresh array on every render, so an
  // unconditional reset would silently revert a learner's pick to English on
  // the next refetch (the same trap already fixed on the scenario page).
  useEffect(() => {
    if (!availableLanguages?.length) return;
    const isSelectionStillOffered =
      selectedLanguage != null &&
      availableLanguages.some(lang => lang.label === selectedLanguage.label);
    if (!isSelectionStillOffered) {
      setSelectedLanguage(availableLanguages[0]);
    }
  }, [availableLanguages, selectedLanguage]);

  const handleLanguageChange = (label: string) => {
    setSelectedLanguage(availableLanguages?.find(lang => lang.label === label) || null);
  };

  // Same rule as the standalone scenario page: a choice only where the org and
  // this roleplay both offer text chat, otherwise the voice start it always was.
  const textChatAvailable = !isCase && scenario?.textChatAvailable === true;

  const coverImage = isCase ? caseDetails?.coverImageUrl : scenario?.coverImageUrl;
  // The full brief, rendered under the card. The card itself clamps its blurb
  // to two lines and drops it entirely when trigger warnings are present, so
  // it can't be the only place the challenge description lives. The item's
  // own description is the player header's job (PlayerTopBar), not this one.
  const challengeDescription = isCase ? caseDetails?.description : scenario?.description;

  const launch = async () => {
    onBeforeLaunch?.();
    persistTrackContext({
      ...trackContextExtras,
      trackId,
      itemId: item.id,
      // So the live session can show "Turn k of n". Display only.
      ...(payload.type === "ROLEPLAY" &&
        isAssessment &&
        requiredTurns != null && {
          assessmentRequiredTurns: requiredTurns,
          assessmentScenarioId: payload.scenarioId,
        }),
    });

    if (payload.type === "CASE") {
      navigate(`/case/${payload.caseId}`);
      return;
    }

    await startSimulation({
      params: {
        scenarioId: payload.scenarioId,
        trackItemProgressId: payload.trackItemProgressId,
        languageId: selectedLanguage?.language_id,
        ...(textChatAvailable && { interactionMode: preferredMode }),
      },
      metadata: { title: item.title, coverImageUrl: undefined },
    });
  };

  const primaryLabel = isCase ? t("tracks2.roleplay.openCase") : t("tracks2.roleplay.start");

  return (
    <div className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-4 py-6 text-center sm:px-6 sm:py-10">
      {/* Centred with auto margins, not justify-center: justify-center pushes
          overflow above the scroll origin where it can't be scrolled to, so a
          screen taller than the viewport (a long brief, the taller header)
          clipped the card's top and opened scrolled away from the language
          picker and start button. Auto margins collapse to 0 on overflow. */}
      <div className={`flex w-full flex-col items-center ${logExpanded ? "" : "my-auto"}`}>
        <div className="w-full max-w-sm">
          <ScenarioCard
            coverImage={coverImage || ""}
            title={item.title}
            description=""
            triggerWarnings={isCase ? undefined : scenario?.triggerWarnings}
            onClick={assessmentLocked || postLocked ? () => undefined : launch}
          />
        </div>

        <p className="mt-5 max-w-md text-sm text-typography-700">
          {isAssessment
            ? requiredTurns != null
              ? t("tracks2.roleplay.assessmentIntroTurns", { n: requiredTurns })
              : t("tracks2.roleplay.assessmentIntro")
            : t("tracks2.roleplay.intro")}
        </p>

        {requirement && !alreadyCompleted && !assessmentLocked && (
          <p
            className="mt-2 max-w-md text-sm font-medium text-typography-900"
            data-testid="roleplay-requirement"
          >
            {requirement}
          </p>
        )}

        {failureLines.length > 0 && (
          <div
            className="mt-4 w-full max-w-sm rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3 text-left text-sm text-typography-800"
            role="status"
            data-testid="roleplay-last-attempt"
          >
            <p className="font-medium text-typography-900">
              {t("tracks2.roleplay.lastAttempt.title")}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {failureLines.map(line => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {!assessmentLocked && <p className="mt-1">{t("tracks2.roleplay.lastAttempt.retry")}</p>}
          </div>
        )}

        {shortAttemptLine && !assessmentLocked && (
          <div
            className="mt-4 w-full max-w-sm rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3 text-left text-sm text-typography-800"
            role="status"
            data-testid="roleplay-short-attempt"
          >
            {shortAttemptLine}
          </div>
        )}

        {isAssessment && !assessmentLocked && requiredTurns == null && (
          <div
            className="mt-4 w-full max-w-sm rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3 text-left text-sm text-typography-800"
            data-testid="roleplay-assessment-notice"
          >
            {t("tracks2.roleplay.assessmentNotice")}
          </div>
        )}

        {challengeDescription && (
          <div className="mt-5 w-full max-w-sm text-left">
            <div className="text-base font-semibold text-typography-900">
              {t("learn.scenario.scenarioLabel")}
            </div>
            <RichTextRenderer content={challengeDescription} />
          </div>
        )}

        {resultsHidden ? (
          <div
            className="mt-4 flex w-full max-w-sm items-center gap-2 rounded-2xl border border-border-light bg-neutral-50 px-4 py-2.5 text-left"
            data-testid="roleplay-assessment-results-hidden"
          >
            <TickGreenBackground className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium text-typography-900">
              {t("tracks2.roleplay.assessmentSubmittedHidden")}
            </span>
          </div>
        ) : alreadyCompleted && lastScenarioSessionId && item.completedAt ? (
          <button
            type="button"
            onClick={() => setLogExpanded(prev => !prev)}
            aria-expanded={logExpanded}
            className="mt-4 flex w-full max-w-sm items-center justify-between gap-3 rounded-2xl border border-success-100 bg-success-50 px-4 py-2.5 text-left transition-colors hover:bg-success-100"
          >
            <span className="flex min-w-0 items-center gap-2">
              <TickGreenBackground className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-success-800">
                  {item.title}
                </span>
                <span className="block text-xs text-success-700">
                  {t("tracks2.roleplay.completedOn", {
                    date: getFormattedDateTime(item.completedAt, "MMM d, yyyy"),
                  })}
                </span>
              </span>
            </span>
            <ArrowDownFilled
              className={`h-3 w-3 shrink-0 text-success-700 transition-transform ${
                logExpanded ? "rotate-180" : ""
              }`}
            />
          </button>
        ) : assessmentLocked && assessmentSubmittedAt && !alreadyCompleted ? (
          <button
            type="button"
            onClick={() => lastScenarioSessionId && setLogExpanded(prev => !prev)}
            aria-expanded={logExpanded}
            disabled={!lastScenarioSessionId}
            className="mt-4 flex w-full max-w-sm items-center justify-between gap-3 rounded-2xl border border-border-light bg-neutral-50 px-4 py-2.5 text-left transition-colors enabled:hover:bg-neutral-100"
            data-testid="roleplay-assessment-submitted"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-typography-900">
                {t("tracks2.roleplay.assessmentSubmitted", {
                  date: getFormattedDateTime(assessmentSubmittedAt, "MMM d, yyyy"),
                })}
              </span>
              <span className="block text-xs text-typography-600">
                {t("tracks2.roleplay.assessmentNotPassed")}
              </span>
            </span>
            {lastScenarioSessionId && (
              <ArrowDownFilled
                className={`h-3 w-3 shrink-0 text-typography-600 transition-transform ${
                  logExpanded ? "rotate-180" : ""
                }`}
              />
            )}
          </button>
        ) : (
          alreadyCompleted && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-success-50 px-4 py-1.5 text-sm font-medium text-success-800">
              <TickGreenBackground className="h-4 w-4" />
              {t("tracks2.roleplay.completed")}
            </div>
          )
        )}

        {logExpanded && lastScenarioSessionId && !resultsHidden && (
          <RoleplaySessionLogPanel sessionId={lastScenarioSessionId} />
        )}

        {assessmentLocked ? (
          <p
            className="mt-6 max-w-sm text-sm text-typography-700"
            data-testid="roleplay-assessment-locked"
          >
            {t("tracks2.roleplay.assessmentLocked")}
          </p>
        ) : (
          <>
            {postLocked && (
              <p
                className="mt-6 max-w-sm text-sm font-medium text-typography-800"
                data-testid="roleplay-post-locked"
              >
                {t("tracks2.roleplay.postLocked", { title: assessment?.preAssessment?.title })}
              </p>
            )}
            {availableLanguages.length > 0 && (
              <div className="mt-6 w-full max-w-sm text-left">
                <DropdownField
                  label={t("tracks2.roleplay.language")}
                  options={availableLanguages.map(lang => lang.label)}
                  value={selectedLanguage?.label || ""}
                  onChange={handleLanguageChange}
                  valueClassName="text-typography-900 font-primary"
                />
              </div>
            )}

            {textChatAvailable && (
              <InteractionModePicker
                className="mt-6 w-full max-w-sm text-left"
                value={preferredMode}
                onChange={setPreferredMode}
                disabled={isStarting}
              />
            )}

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={launch}
                disabled={isStarting || postLocked}
                className="inline-flex items-center gap-2 rounded-full bg-primary-500 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-50 max-md:min-h-11"
              >
                {alreadyCompleted && !isCase ? (
                  <>
                    <Refresh className="h-4 w-4" />
                    {t("tracks2.roleplay.replay")}
                  </>
                ) : (
                  <>
                    <PlayIcon className="h-4 w-4" />
                    {primaryLabel}
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
