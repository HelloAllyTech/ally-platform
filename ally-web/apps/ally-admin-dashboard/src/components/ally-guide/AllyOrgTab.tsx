import React, { useEffect, useMemo, useState } from "react";

import { useSelector } from "react-redux";
import { toast } from "sonner";

import { Button, CarbonToggle, TextArea, TextInput } from "@ally-ui-mono/ui-shared";
import {
  useGetAllyGuideOrgCrisisResponsesQuery,
  useGetAllyGuideOrgProfileQuery,
  useSaveAllyGuideOrgCrisisResponseMutation,
  useSaveAllyGuideOrgProfileMutation,
} from "@api";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { RootState } from "@store";
import { AllyGuideLanguage, AllyGuideSupportLine } from "@types";
import { formatDateTime, getErrorMessage } from "@utils";

import { ALLY_GUIDE_LANGUAGES, approverLabel } from "./allyGuideFormat";
import { AddItemInput, ChipList } from "./ChipList";
import { ErrorPanel, LoadingBlock, ViewOnlyNote } from "./ConsoleStates";
import { CrisisCopyEditor } from "./CrisisCopyEditor";
import { InfoTip } from "./InfoTip";
import {
  draftFromProfile,
  isDraftDirty,
  LIMITS,
  MAX_AVOID_TOPICS,
  OrgProfileDraft,
  profileFromDraft,
  validateDraft,
} from "./orgProfileDraft";
import { SupportLinesEditor } from "./SupportLinesEditor";

interface AllyOrgTabProps {
  /** The organisation's id: the route id on Organization detail, which is the tenant id ally-be keys by. */
  tenantId: string;
}

const Section: React.FC<{
  id: string;
  heading: string;
  description?: string;
  children: React.ReactNode;
}> = ({ id, heading, description, children }) => (
  <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
    <div>
      <h3 id={`${id}-heading`} className="text-xl font-normal text-typography-900">
        {heading}
      </h3>
      {description && <p className="mt-1 max-w-3xl text-sm text-typography-700">{description}</p>}
    </div>
    {children}
  </section>
);

const FieldLabel: React.FC<{ htmlFor: string; text: string; help?: string }> = ({
  htmlFor,
  text,
  help,
}) => (
  <div className="mb-1 flex items-center gap-1">
    <label htmlFor={htmlFor} className="text-xs tracking-wide text-typography-700">
      {text}
    </label>
    {help && <InfoTip label={help} ariaLabel={`About ${text}`} />}
  </div>
);

/**
 * The Ally tab on Organization detail: how Ally behaves for one organisation's learners.
 *
 * Two kinds of save live here on purpose. The profile (support lines, supervisor, protocols, tone,
 * topics, outreach) is ONE document the server replaces whole, so it has one Save bar and every
 * field always travels with it. Crisis messages are versioned per language and need a clinician's
 * sign-off each time, so they keep their own per-language save. Gated by `ally_guide_org` plus the
 * Ally guide permissions (see `useAllyGuideAccess`); the route that mounts it decides who sees the tab.
 */
export const AllyOrgTab: React.FC<AllyOrgTabProps> = ({ tenantId }) => {
  const strings = en.allyConsole.org;
  const { canEditOrg } = useAllyGuideAccess();
  const currentUserId = useSelector((state: RootState) => state.user?.user?.id);

  const profileQuery = useGetAllyGuideOrgProfileQuery(tenantId);
  const crisisQuery = useGetAllyGuideOrgCrisisResponsesQuery(tenantId);
  const [saveProfile, { isLoading: isSaving }] = useSaveAllyGuideOrgProfileMutation();
  const [saveCrisis] = useSaveAllyGuideOrgCrisisResponseMutation();

  const baseline = useMemo(() => draftFromProfile(profileQuery.data?.profile), [profileQuery.data]);
  const [draft, setDraft] = useState<OrgProfileDraft>(baseline);
  // Rows the admin has edited. A brand-new empty row is not an error until it has been touched or a
  // save was attempted.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [showErrors, setShowErrors] = useState(false);

  // A fresh server profile (first load, a save, another organisation) replaces the draft.
  useEffect(() => {
    setDraft(baseline);
    setTouched(new Set());
    setShowErrors(false);
  }, [baseline]);

  const errors = useMemo(() => validateDraft(draft), [draft]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = isDraftDirty(draft, baseline);

  const patch = (next: Partial<OrgProfileDraft>) => setDraft(current => ({ ...current, ...next }));
  const touch = (key: string) =>
    setTouched(current => (current.has(key) ? current : new Set(current).add(key)));

  const effectiveTouched = useMemo(
    () => (showErrors ? new Set(Object.keys(errors)) : touched),
    [showErrors, errors, touched],
  );

  // The preview shows lines as drafted, minus half-typed rows that would render as blank cards.
  const previewLines = useMemo(() => {
    const lines: Partial<Record<AllyGuideLanguage, AllyGuideSupportLine[]>> = {};
    const profile = profileFromDraft(draft);
    for (const language of ALLY_GUIDE_LANGUAGES) {
      const complete = (profile.supportLines?.[language] ?? []).filter(
        line => line.name && line.phone,
      );
      if (complete.length > 0) lines[language] = complete;
    }
    return lines;
  }, [draft]);

  const handleSave = async () => {
    if (hasErrors) {
      setShowErrors(true);
      return;
    }
    try {
      await saveProfile({ tenantId, profile: profileFromDraft(draft) }).unwrap();
      toast.success(strings.saved);
    } catch (error) {
      toast.error(getErrorMessage(error, strings.saveFailed));
    }
  };

  if (profileQuery.isLoading) return <LoadingBlock lines={6} />;
  if (profileQuery.isError || !profileQuery.data) {
    return (
      <ErrorPanel
        what={strings.loadFailedWhat}
        error={profileQuery.error}
        onRetry={() => void profileQuery.refetch()}
        forbiddenMessage={en.allyConsole.states.noAccessToOrg}
      />
    );
  }

  const { version, updatedBy, updatedAt } = profileQuery.data;
  const who =
    version === 0
      ? null
      : approverLabel(updatedBy, currentUserId, {
          you: en.allyConsole.crisisCopy.approverYou,
          user: en.allyConsole.crisisCopy.approverUser,
          unknown: en.allyConsole.crisisCopy.approverUnknown,
        });

  const disabled = !canEditOrg;

  return (
    <div className="flex max-w-5xl flex-col gap-8 pb-6" data-testid="ally-org-tab">
      <div>
        <p className="max-w-3xl text-sm text-typography-800">{strings.intro}</p>
        <p className="mt-2 text-xs text-typography-700" data-testid="ally-org-version">
          {strings.versionLine(version, who, updatedAt ? formatDateTime(updatedAt) : null)}
        </p>
      </div>

      {!canEditOrg && <ViewOnlyNote message={strings.viewOnly} />}

      <div className="flex flex-col gap-8" data-testid="ally-org-profile">
        <Section id="ally-org-lines" heading={strings.supportLines.heading}>
          <SupportLinesEditor
            value={draft.supportLines}
            onChange={supportLines => patch({ supportLines })}
            disabled={disabled}
            errors={errors}
            touched={effectiveTouched}
            onTouch={touch}
          />
        </Section>

        <Section id="ally-org-supervisor" heading={strings.supervisor.heading}>
          <div className="grid max-w-3xl grid-cols-1 gap-4">
            <div>
              <FieldLabel
                htmlFor="ally-org-supervisor-contact"
                text={strings.supervisor.contact}
                help={strings.supervisor.contactHelp}
              />
              <TextInput
                id="ally-org-supervisor-contact"
                labelText={strings.supervisor.contact}
                hideLabel
                size="md"
                placeholder={strings.supervisor.contactPlaceholder}
                value={draft.supervisorContact}
                maxLength={LIMITS.supervisorContact}
                disabled={disabled}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  patch({ supervisorContact: event.target.value })
                }
              />
            </div>
            <div>
              <FieldLabel
                htmlFor="ally-org-supervisor-wording"
                text={strings.supervisor.wording}
                help={strings.supervisor.wordingHelp}
              />
              <TextArea
                id="ally-org-supervisor-wording"
                labelText={strings.supervisor.wording}
                hideLabel
                rows={3}
                placeholder={strings.supervisor.wordingPlaceholder}
                value={draft.supervisorWording}
                maxCount={LIMITS.supervisorWording}
                enableCounter
                disabled={disabled}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  patch({ supervisorWording: event.target.value })
                }
              />
            </div>
          </div>
        </Section>

        <Section id="ally-org-guidance" heading={strings.guidance.heading}>
          <div className="grid max-w-3xl grid-cols-1 gap-4">
            <div>
              <FieldLabel
                htmlFor="ally-org-protocols"
                text={strings.guidance.protocols}
                help={strings.guidance.protocolsHelp}
              />
              <TextArea
                id="ally-org-protocols"
                labelText={strings.guidance.protocols}
                hideLabel
                rows={6}
                placeholder={strings.guidance.protocolsPlaceholder}
                value={draft.protocols}
                maxCount={LIMITS.protocols}
                enableCounter
                disabled={disabled}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  patch({ protocols: event.target.value })
                }
              />
            </div>
            <div>
              <FieldLabel
                htmlFor="ally-org-tone"
                text={strings.guidance.tone}
                help={strings.guidance.toneHelp}
              />
              <TextArea
                id="ally-org-tone"
                labelText={strings.guidance.tone}
                hideLabel
                rows={3}
                placeholder={strings.guidance.tonePlaceholder}
                value={draft.toneNotes}
                maxCount={LIMITS.toneNotes}
                enableCounter
                disabled={disabled}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  patch({ toneNotes: event.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel
                htmlFor="ally-org-avoid"
                text={strings.guidance.avoid}
                help={strings.guidance.avoidHelp}
              />
              <ChipList
                items={draft.avoidTopics}
                removeLabel={strings.guidance.avoidRemove}
                onRemove={topic =>
                  patch({ avoidTopics: draft.avoidTopics.filter(item => item !== topic) })
                }
                disabled={disabled}
                emptyText={strings.guidance.avoidPlaceholder}
                testId="ally-org-avoid-list"
              />
              {!disabled && (
                <AddItemInput
                  id="ally-org-avoid"
                  label={strings.guidance.avoid}
                  placeholder={strings.guidance.avoidPlaceholder}
                  addLabel={strings.guidance.avoidAdd}
                  maxLength={LIMITS.topic}
                  validate={value => {
                    if (!value) return en.allyConsole.settings.lists.blank;
                    if (draft.avoidTopics.length >= MAX_AVOID_TOPICS) {
                      return strings.guidance.avoidCap(MAX_AVOID_TOPICS);
                    }
                    if (
                      draft.avoidTopics.some(topic => topic.toLowerCase() === value.toLowerCase())
                    ) {
                      return strings.guidance.avoidDuplicate;
                    }
                    return null;
                  }}
                  onAdd={value => patch({ avoidTopics: [...draft.avoidTopics, value] })}
                />
              )}
            </div>
          </div>
        </Section>

        <Section id="ally-org-outreach" heading={strings.outreach.heading}>
          <div className="flex max-w-3xl flex-col gap-4">
            <div className="flex items-start gap-1">
              <CarbonToggle
                id="ally-org-outreach-enabled"
                size="sm"
                labelText={strings.outreach.outreach}
                toggled={draft.outreachEnabled}
                disabled={disabled}
                onToggle={(checked: boolean) => patch({ outreachEnabled: checked })}
              />
              <InfoTip label={strings.outreach.outreachHelp} ariaLabel="About outreach" />
            </div>
            <div className="flex items-start gap-1">
              <CarbonToggle
                id="ally-org-email-enabled"
                size="sm"
                labelText={strings.outreach.email}
                toggled={draft.emailEnabled}
                disabled={disabled || !draft.outreachEnabled}
                onToggle={(checked: boolean) => patch({ emailEnabled: checked })}
              />
              <InfoTip label={strings.outreach.emailHelp} ariaLabel="About email outreach" />
            </div>
          </div>
        </Section>

        {canEditOrg && (
          <div
            className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-border-light bg-white py-3"
            data-testid="ally-org-save-bar"
          >
            <Button
              kind="primary"
              size="md"
              disabled={!dirty || isSaving}
              onClick={() => void handleSave()}
            >
              {isSaving ? strings.saving : strings.save}
            </Button>
            {dirty && (
              <Button
                kind="ghost"
                size="md"
                disabled={isSaving}
                onClick={() => {
                  setDraft(baseline);
                  setTouched(new Set());
                  setShowErrors(false);
                }}
              >
                {strings.discard}
              </Button>
            )}
            <span
              className={`text-sm ${showErrors && hasErrors ? "text-destructive-600" : "text-typography-700"}`}
              role="status"
            >
              {showErrors && hasErrors ? strings.invalid : dirty ? strings.dirty : strings.clean}
            </span>
          </div>
        )}
      </div>

      <Section
        id="ally-org-crisis"
        heading={strings.crisis.heading}
        description={`${en.allyConsole.crisisCopy.orgIntro} ${strings.crisis.note}`}
      >
        {crisisQuery.isLoading ? (
          <LoadingBlock lines={4} />
        ) : crisisQuery.isError ? (
          <ErrorPanel
            what={strings.crisis.loadFailed}
            error={crisisQuery.error}
            onRetry={() => void crisisQuery.refetch()}
          />
        ) : (
          <CrisisCopyEditor
            rows={crisisQuery.data ?? []}
            canEdit={canEditOrg}
            supportLines={previewLines}
            switcher
            onSave={(languageCode, body) => saveCrisis({ tenantId, languageCode, body }).unwrap()}
          />
        )}
      </Section>
    </div>
  );
};

export default AllyOrgTab;
