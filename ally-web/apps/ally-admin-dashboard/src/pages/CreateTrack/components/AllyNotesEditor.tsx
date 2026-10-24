import { FC, useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import { Button, InlineNotification, Select, SelectItem, TextArea } from "@ally-ui-mono/ui-shared";
import {
  useDraftAllyGuideNotesMutation,
  useGetAllyGuideNotesQuery,
  useSaveAllyGuideNotesMutation,
} from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { lazyCopy } from "@components/ally-guide/lazyCopy";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { AllyGuideNotes, AllyGuideNotesTension } from "@types";
import { getErrorMessage } from "@utils";

const strings = lazyCopy(() => en.allyConsole.courseNotes);
const LEVELS: AllyGuideNotesTension[] = ["low", "medium", "high"];

interface NotesDraft {
  notes: string;
  tension: Record<string, AllyGuideNotesTension>;
  /** What Copilot drafted, kept to tell an untouched draft from an edited one at save time. */
  drafted: { notes: string; tension: Record<string, AllyGuideNotesTension> } | null;
}

/**
 * Unsaved edits per course, kept outside the component: the builder swaps this editor out when the
 * trainer clicks another node in the outline, and notes typed a minute ago should not vanish with it.
 */
const UNSAVED = new Map<string, NotesDraft>();

export const clearUnsavedAllyNotes = () => UNSAVED.clear();

const sameTension = (
  a: Record<string, AllyGuideNotesTension>,
  b: Record<string, AllyGuideNotesTension>,
) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(key => a[key] === b[key]);
};

const savedDraft = (saved: AllyGuideNotes): NotesDraft => ({
  notes: saved.notes ?? "",
  tension: Object.fromEntries(
    saved.items
      .filter(item => item.tension)
      .map(item => [item.id, item.tension as AllyGuideNotesTension]),
  ),
  drafted: null,
});

interface AllyNotesEditorProps {
  /** Null until a brand-new course is first saved. */
  trackId: string | null;
  /** Course Copilot is on for this admin: offers "Draft with Copilot". */
  canDraft: boolean;
}

const Editor: FC<{ saved: AllyGuideNotes; canDraft: boolean }> = ({ saved, canDraft }) => {
  const { trackId } = saved;
  const [save, { isLoading: isSaving }] = useSaveAllyGuideNotesMutation();
  const [draftNotes, { isLoading: isDrafting }] = useDraftAllyGuideNotesMutation();
  const [draft, setDraft] = useState<NotesDraft>(() => UNSAVED.get(trackId) ?? savedDraft(saved));
  const [leak, setLeak] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<NotesDraft | null>(null);

  const baseline = useMemo(() => savedDraft(saved), [saved]);
  const dirty =
    draft.notes.trim() !== baseline.notes.trim() || !sameTension(draft.tension, baseline.tension);
  const tooLong = draft.notes.length > saved.notesMaxChars;

  useEffect(() => {
    if (dirty) UNSAVED.set(trackId, draft);
    else UNSAVED.delete(trackId);
  }, [dirty, draft, trackId]);

  const edit = (patch: Partial<NotesDraft>) => {
    setLeak(null);
    setDraft(previous => ({ ...previous, ...patch }));
  };

  const setTension = (itemId: string, value: string) =>
    edit({
      tension: (() => {
        const next = { ...draft.tension };
        if (value === "") delete next[itemId];
        else next[itemId] = value as AllyGuideNotesTension;
        return next;
      })(),
    });

  const applyDraft = (next: NotesDraft) => {
    setLeak(null);
    setDraft(next);
    toast.success(strings.draftReady);
  };

  const handleDraft = async () => {
    try {
      const result = await draftNotes(trackId).unwrap();
      const next: NotesDraft = {
        notes: result.draft.notes,
        tension: result.draft.tension ?? {},
        drafted: { notes: result.draft.notes, tension: result.draft.tension ?? {} },
      };
      // A trainer's own words are never replaced without asking.
      if (dirty || baseline.notes.trim() !== "") setPendingDraft(next);
      else applyDraft(next);
    } catch (error) {
      toast.error(getErrorMessage(error, strings.draftFailed));
    }
  };

  const handleSave = async () => {
    if (tooLong) return;
    const untouchedDraft =
      draft.drafted !== null &&
      draft.notes === draft.drafted.notes &&
      sameTension(draft.tension, draft.drafted.tension);
    try {
      await save({
        trackId,
        notes: draft.notes.trim() || null,
        tension: draft.tension,
        draftedByCopilot: untouchedDraft,
      }).unwrap();
      UNSAVED.delete(trackId);
      toast.success(strings.saved);
    } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error
          ? (error as { status?: unknown }).status
          : undefined;
      // 422: the notes carry a quiz answer. The message names it; nothing was saved.
      if (status === 422) setLeak(getErrorMessage(error, strings.leakHelp));
      else toast.error(getErrorMessage(error, strings.failed));
    }
  };

  const discard = () => {
    UNSAVED.delete(trackId);
    setLeak(null);
    setDraft(baseline);
  };

  const sections = useMemo(() => {
    const bySection = new Map<string, { title: string; items: AllyGuideNotes["items"] }>();
    for (const item of saved.items) {
      const section = bySection.get(item.sectionId) ?? { title: item.sectionTitle, items: [] };
      section.items.push(item);
      bySection.set(item.sectionId, section);
    }
    return [...bySection.entries()];
  }, [saved.items]);

  const showDraftedBadge =
    draft.drafted !== null
      ? draft.notes === draft.drafted.notes && sameTension(draft.tension, draft.drafted.tension)
      : saved.draftedByCopilot && !dirty;

  return (
    <div className="flex max-w-4xl flex-col gap-8" data-testid="ally-notes-editor">
      <div>
        <h2 className="text-xl font-semibold text-typography-900">{strings.heading}</h2>
        <p className="mt-1 text-sm text-typography-700">{strings.intro}</p>
      </div>

      <section className="flex flex-col gap-3">
        <TextArea
          id="ally-notes-text"
          labelText={strings.notesLabel}
          placeholder={strings.notesPlaceholder}
          rows={8}
          invalid={tooLong}
          invalidText={strings.tooLong(saved.notesMaxChars)}
          helperText={strings.counter(draft.notes.length, saved.notesMaxChars)}
          value={draft.notes}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            edit({ notes: event.target.value })
          }
        />
        {showDraftedBadge && (
          <span className="inline-flex items-center gap-1" data-testid="ally-notes-drafted">
            <Pill tone="info">{strings.drafted}</Pill>
            <InfoTip label={strings.draftedHelp} ariaLabel="About drafted notes" />
          </span>
        )}
        {canDraft && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              kind="tertiary"
              size="md"
              disabled={isDrafting}
              onClick={() => void handleDraft()}
            >
              {isDrafting ? strings.drafting : strings.draft}
            </Button>
            <span className="text-xs text-typography-700">{strings.draftHint}</span>
          </div>
        )}
        {leak && (
          <div data-testid="ally-notes-leak">
            <InlineNotification
              kind="error"
              lowContrast
              hideCloseButton
              title={strings.leakTitle}
              subtitle={leak}
            />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="ally-notes-tension-heading">
        <div className="flex items-center gap-1">
          <h3 id="ally-notes-tension-heading" className="text-lg font-semibold text-typography-900">
            {strings.tensionHeading}
          </h3>
          <InfoTip label={strings.tensionHelp} ariaLabel="About pacing" />
        </div>
        {saved.items.length === 0 ? (
          <p className="text-sm text-typography-700">{strings.itemsEmpty}</p>
        ) : (
          sections.map(([sectionId, section]) => (
            <div key={sectionId} className="flex flex-col gap-1">
              <h4 className="text-sm font-semibold text-typography-800">{section.title}</h4>
              <ul className="flex flex-col divide-y divide-border-light border-y border-border-light">
                {section.items.map(item => (
                  <li
                    key={item.id}
                    className="grid grid-cols-1 items-center gap-2 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]"
                    data-testid={`ally-notes-item-${item.id}`}
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-sm text-typography-900">
                        {item.title}
                      </span>
                      <span className="block text-xs text-typography-700">
                        {item.type.toLowerCase()} · {strings.levels[item.defaultTension]}
                      </span>
                      {item.triggerWarnings.length > 0 && (
                        <span className="block text-xs text-warning-text">
                          {strings.triggerWarnings(item.triggerWarnings.join(", "))}
                        </span>
                      )}
                    </div>
                    <Select
                      id={`ally-notes-tension-${item.id}`}
                      labelText={`${item.title}: ${strings.tensionColumns.yours}`}
                      hideLabel
                      value={draft.tension[item.id] ?? ""}
                      onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                        setTension(item.id, event.target.value)
                      }
                    >
                      <SelectItem
                        value=""
                        text={`${strings.useDefault} (${strings.levels[item.defaultTension]})`}
                      />
                      {LEVELS.map(level => (
                        <SelectItem key={level} value={level} text={strings.levels[level]} />
                      ))}
                    </Select>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <div
        className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-border-light bg-white py-3"
        data-testid="ally-notes-save-bar"
      >
        <Button
          kind="primary"
          size="md"
          disabled={!dirty || tooLong || isSaving}
          onClick={() => void handleSave()}
        >
          {isSaving ? strings.saving : strings.save}
        </Button>
        {dirty && (
          <Button kind="ghost" size="md" disabled={isSaving} onClick={discard}>
            {strings.discard}
          </Button>
        )}
        <span className="text-sm text-typography-700" role="status">
          {dirty ? strings.dirty : strings.clean}
        </span>
      </div>

      <ConfirmDialog
        isOpen={pendingDraft !== null}
        title={strings.draftReplace}
        cancelLabel={en.allyConsole.library.archiveDialog.cancel}
        confirmLabel={strings.draft}
        onConfirm={() => {
          if (pendingDraft) applyDraft(pendingDraft);
          setPendingDraft(null);
        }}
        onClose={() => setPendingDraft(null)}
      >
        <p>{strings.draftKeeps}</p>
      </ConfirmDialog>
    </div>
  );
};

/**
 * The course builder's notes for Ally (plan §4.4, §10.5): what the trainer tells Ally about this
 * course, and per-item pacing tension. Notes are Ally's instructions, so the server refuses any that
 * quote a quiz answer, and says which. "Draft with Copilot" writes a draft from the saved course for
 * the trainer to edit; it saves nothing, and a draft saved unedited is marked as one. Edits survive
 * clicking to another node in the outline until saved or discarded.
 */
export const AllyNotesEditor: FC<AllyNotesEditorProps> = ({ trackId, canDraft }) => {
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideNotesQuery(trackId ?? "", {
    skip: !trackId,
  });

  if (!trackId) {
    return (
      <p className="text-sm text-typography-700" data-testid="ally-notes-unsaved">
        {strings.unsaved}
      </p>
    );
  }
  if (isLoading) return <LoadingBlock lines={6} />;
  if (isError || !data) {
    return <ErrorPanel what={strings.loadFailed} error={error} onRetry={() => void refetch()} />;
  }
  return (
    <Editor
      key={`${data.trackId}-${data.notes ?? ""}-${data.draftedByCopilot}`}
      saved={data}
      canDraft={canDraft}
    />
  );
};
