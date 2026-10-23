import React, { useState } from "react";

import { useSelector } from "react-redux";
import { toast } from "sonner";

import { Button, Checkbox, ContentSwitcher, Switch, TextArea } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { RootState } from "@store";
import { AllyGuideCrisisResponse, AllyGuideLanguage, AllyGuideSupportLine } from "@types";
import { formatDateTime, getErrorMessage } from "@utils";

import { ALLY_GUIDE_LANGUAGES, approverLabel } from "./allyGuideFormat";
import { ConfirmDialog } from "./ConfirmDialog";
import { CrisisCardPreview } from "./CrisisCardPreview";

/** Bounds the server enforces (`GuideAdminService.saveCrisisResponse`); checked here so a save never 400s. */
export const CRISIS_COPY_MIN = 40;
export const CRISIS_COPY_MAX = 1500;

interface CrisisCopyEditorProps {
  /** The active version per language; a language with none is simply absent. */
  rows: AllyGuideCrisisResponse[];
  canEdit: boolean;
  /** The organisation's lines by language (drafts included), for the card preview. Undefined on the platform tab. */
  supportLines?: Partial<Record<string, AllyGuideSupportLine[]>>;
  /** Saves a new version; rejects with the RTK error so the server's message can be shown. */
  onSave: (language: AllyGuideLanguage, body: string) => Promise<AllyGuideCrisisResponse>;
  /** Withdraws a version. Omitted where the API has no such route (the organisation layer). */
  onWithdraw?: (row: AllyGuideCrisisResponse) => Promise<void>;
  /**
   * Show one language at a time behind a switcher instead of five cards stacked, for a page that
   * already has a lot on it (an organisation's tab). The platform tab stacks them.
   */
  switcher?: boolean;
}

interface CardProps extends Omit<CrisisCopyEditorProps, "rows" | "switcher"> {
  language: AllyGuideLanguage;
  row: AllyGuideCrisisResponse | undefined;
}

const CrisisCopyCard: React.FC<CardProps> = ({
  language,
  row,
  canEdit,
  supportLines,
  onSave,
  onWithdraw,
}) => {
  const strings = en.allyConsole.crisisCopy;
  const languageName = en.allyConsole.languages[language];
  const currentUserId = useSelector((state: RootState) => state.user?.user?.id);

  const saved = row?.body ?? "";
  const [draft, setDraft] = useState(saved);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [approved, setApproved] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);

  const trimmed = draft.trim();
  const dirty = trimmed !== saved.trim();
  const tooShort = trimmed.length < CRISIS_COPY_MIN;
  const tooLong = trimmed.length > CRISIS_COPY_MAX;
  // Only complain once there is something typed: an untouched empty card is not an error.
  const showInvalid = dirty && (tooShort || tooLong);
  const invalidText = tooLong
    ? strings.tooLong(CRISIS_COPY_MAX)
    : strings.tooShort(CRISIS_COPY_MIN);
  const textAreaId = `ally-crisis-copy-${language}`;
  const counter = strings.counter(trimmed.length, CRISIS_COPY_MIN, CRISIS_COPY_MAX);
  // A language with no copy says what learners get instead, right where the admin is about to write it.
  const helperText = row ? counter : `${strings.noCopyFallback} ${counter}`;

  const approver = row
    ? approverLabel(row.approvedBy, currentUserId, {
        you: strings.approverYou,
        user: strings.approverUser,
        unknown: strings.approverUnknown,
      })
    : null;

  const closeSave = () => {
    setSaveOpen(false);
    setApproved(false);
  };

  const confirmSave = async () => {
    setIsWorking(true);
    try {
      const result = await onSave(language, trimmed);
      toast.success(strings.saved(languageName, result.version));
      closeSave();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.saveFailed));
    } finally {
      setIsWorking(false);
    }
  };

  const confirmWithdraw = async () => {
    if (!row || !onWithdraw) return;
    setIsWorking(true);
    try {
      await onWithdraw(row);
      toast.success(strings.withdrawn(languageName));
      setWithdrawOpen(false);
      setDraft("");
    } catch (error) {
      toast.error(getErrorMessage(error, strings.withdrawFailed));
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <section
      className="border border-border-light p-4"
      aria-labelledby={`${textAreaId}-heading`}
      data-testid={`crisis-copy-${language}`}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${textAreaId}-heading`} className="text-lg font-normal text-typography-900">
          {languageName}
        </h3>
        <p className="text-xs text-typography-700" data-testid={`crisis-copy-${language}-meta`}>
          {row && approver
            ? `${strings.version(row.version)} · ${strings.approval(
                approver,
                row.approvedAt ? formatDateTime(row.approvedAt) : null,
              )}`
            : strings.noCopy}
        </p>
      </div>

      <TextArea
        id={textAreaId}
        labelText={strings.bodyLabel(languageName)}
        hideLabel
        rows={5}
        value={draft}
        disabled={!canEdit}
        invalid={showInvalid}
        invalidText={invalidText}
        helperText={helperText}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value)}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canEdit && (
          <>
            <Button
              kind="primary"
              size="sm"
              disabled={!dirty || tooShort || tooLong || isWorking}
              onClick={() => setSaveOpen(true)}
            >
              {strings.save}
            </Button>
            {dirty && (
              <Button kind="ghost" size="sm" onClick={() => setDraft(saved)}>
                {strings.reset}
              </Button>
            )}
            {row && onWithdraw && (
              <Button kind="danger--tertiary" size="sm" onClick={() => setWithdrawOpen(true)}>
                {strings.withdraw}
              </Button>
            )}
          </>
        )}
        <Button
          kind="ghost"
          size="sm"
          aria-expanded={previewOpen}
          onClick={() => setPreviewOpen(open => !open)}
        >
          {previewOpen ? strings.previewHide : strings.previewShow}
        </Button>
        {canEdit && !dirty && row && (
          <span className="text-xs text-typography-600">{strings.unchanged}</span>
        )}
      </div>

      {previewOpen && (
        <div className="mt-4 max-w-xl">
          <CrisisCardPreview message={draft} language={language} supportLines={supportLines} />
        </div>
      )}

      <ConfirmDialog
        isOpen={saveOpen}
        title={strings.saveDialog.title(languageName)}
        cancelLabel={strings.saveDialog.cancel}
        confirmLabel={isWorking ? strings.saveDialog.working : strings.saveDialog.confirm}
        confirmDisabled={!approved}
        isWorking={isWorking}
        onConfirm={() => void confirmSave()}
        onClose={closeSave}
      >
        <p>{strings.saveDialog.body}</p>
        <blockquote className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-l-4 border-border-light pl-3 text-typography-900">
          {trimmed}
        </blockquote>
        <div>
          <Checkbox
            id={`${textAreaId}-approved`}
            labelText={strings.saveDialog.approvalLabel}
            checked={approved}
            onChange={(_event: unknown, { checked }: { checked: boolean }) => setApproved(checked)}
          />
          <p className="mt-1 pl-7 text-xs text-typography-700">{strings.saveDialog.approvalHelp}</p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={withdrawOpen}
        title={strings.withdrawDialog.title(languageName)}
        cancelLabel={strings.withdrawDialog.cancel}
        confirmLabel={isWorking ? strings.withdrawDialog.working : strings.withdrawDialog.confirm}
        danger
        isWorking={isWorking}
        onConfirm={() => void confirmWithdraw()}
        onClose={() => setWithdrawOpen(false)}
      >
        <p>{strings.withdrawDialog.body}</p>
      </ConfirmDialog>
    </section>
  );
};

/**
 * One text area per language, each with its version and approver, a card preview, and a save that
 * asks for a clinician's sign-off. Shared by the platform's Crisis copy tab and an organisation's
 * Ally tab: the data and the rules are the same, only the scope differs.
 *
 * Each card is keyed by the version it holds, so a successful save remounts it onto the new version
 * rather than leaving a stale draft beside a fresh "Version N" line.
 */
export const CrisisCopyEditor: React.FC<CrisisCopyEditorProps> = ({
  rows,
  canEdit,
  supportLines,
  onSave,
  onWithdraw,
  switcher = false,
}) => {
  const strings = en.allyConsole.crisisCopy;
  const byLanguage = new Map(rows.map(row => [row.languageCode, row]));
  const [shown, setShown] = useState<AllyGuideLanguage>("en");
  return (
    <div className="flex flex-col gap-4">
      {switcher && (
        <div data-testid="crisis-language-switcher">
          <ContentSwitcher
            size="md"
            selectedIndex={ALLY_GUIDE_LANGUAGES.indexOf(shown)}
            onChange={(event: { name?: string | number }) =>
              setShown(String(event.name) as AllyGuideLanguage)
            }
            className="max-w-2xl"
          >
            {ALLY_GUIDE_LANGUAGES.map(language => (
              <Switch
                key={language}
                name={language}
                text={strings.switchLabel(
                  en.allyConsole.languages[language],
                  byLanguage.get(language)?.version ?? null,
                )}
              />
            ))}
          </ContentSwitcher>
        </div>
      )}
      {ALLY_GUIDE_LANGUAGES.map(language => {
        const row = byLanguage.get(language);
        return (
          // A language that is not shown stays mounted (hidden, not removed), so a half-written
          // message in one language survives a look at another.
          <div key={`${language}:${row?.id ?? "none"}`} hidden={switcher && language !== shown}>
            <CrisisCopyCard
              language={language}
              row={row}
              canEdit={canEdit}
              supportLines={supportLines}
              onSave={onSave}
              onWithdraw={onWithdraw}
            />
          </div>
        );
      })}
    </div>
  );
};
