import React, { useContext, useState } from "react";

import {
  useAddCheckupCaseMutation,
  useEditCheckupCaseMutation,
  useGetCheckupCasesQuery,
  useKeepCheckupSuggestionsMutation,
  useRemoveCheckupCaseMutation,
  useRestoreCheckupCaseMutation,
  useSuggestCheckupQuestionsMutation,
  useTryCheckupCaseMutation,
} from "@api";
import { Button, Segmented } from "@components/v2";

import { COPY } from "../../Onboarding/copy";
import {
  CaseFilter,
  CaseRow,
  byConcern,
  keeps,
  passagesOf,
  reasonOf,
  resultOf,
  rowsOf,
} from "../checkupCases";
import { HOME, fill } from "../copy";
import { ListSkeleton } from "../ui/List";
import { HomeSavesContext } from "../useHomeField";
import { CheckupCaseEditor } from "./CheckupCaseEditor";

import type {
  CheckupCaseInput,
  CheckupResult,
  CheckupRunView,
  CheckupSuggestion,
} from "../../../types/checkup";

const t = HOME.checkupControls;

const message = (failure: unknown, fallback: string) => {
  const data = (failure as { data?: { message?: unknown; code?: string } })?.data;
  if (data?.code === "try_limit") return t.tryLimit;
  return typeof data?.message === "string" ? data.message : fallback;
};

const ResultPill: React.FC<{ result: CaseRow["result"] }> = ({ result }) => (
  <span className={`ally-badge ally-checkup__result ally-checkup__result--${result ?? "none"}`}>
    {result ? t.results[result] : t.results.notAsked}
  </span>
);

/** One question: what it asks, how it did, and (opened) everything about it. */
const CaseCard: React.FC<{
  botId: string;
  row: CaseRow;
  canEdit: boolean;
  onEdit: () => void;
}> = ({ botId, row, canEdit, onEdit }) => {
  const { item } = row;
  const [open, setOpen] = useState(false);
  const [tried, setTried] = useState<CheckupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saves = useContext(HomeSavesContext);
  const [edit, editing] = useEditCheckupCaseMutation();
  const [remove, removing] = useRemoveCheckupCaseMutation();
  const [restore] = useRestoreCheckupCaseMutation();
  const [tryOne, trying] = useTryCheckupCaseMutation();
  const tries = tried ? [tried] : row.tries;
  const result = tried ? resultOf([tried.verdict]) : row.result;
  const latest = tries[tries.length - 1];
  const reason = reasonOf(tries);
  const passages = passagesOf(tries);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(message(failure, HOME.saving.failed));
    }
  };

  return (
    <li
      className={`ally-card ally-checkup__case${item.active ? "" : " is-off"}`}
      data-testid="checkup-case"
    >
      <div className="ally-checkup__case-top">
        <div className="ally-checkup__case-main">
          <p className="ally-body ally-checkup__question">“{item.question}”</p>
          <p className="ally-checkup__tags">
            <ResultPill result={result} />
            <span className="ally-badge ally-badge--muted">{t.badges[item.badge]}</span>
            {item.mustPass && <span className="ally-badge ally-badge--muted">{t.mustPass}</span>}
            {!item.active && <span className="ally-badge ally-badge--warn">{t.off}</span>}
          </p>
          {reason && <p className="ally-small ally-checkup__reason">{reason}</p>}
        </div>
        <Button
          variant="ghost"
          className="ally-btn--sm"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          {open ? t.actions.less : t.actions.more}
        </Button>
      </div>

      {open && (
        <div className="ally-checkup__case-body">
          {item.outcome && <p className="ally-small">{t.outcomes[item.outcome]}</p>}
          <dl className="ally-checkup__facts">
            <dt>{t.card.includes}</dt>
            <dd>{item.facts.length ? item.facts.join(" · ") : t.card.nothing}</dd>
            {item.mustNot.length > 0 && (
              <>
                <dt>{t.card.mustNot}</dt>
                <dd>{item.mustNot.join(" · ")}</dd>
              </>
            )}
            <dt>{t.card.reply}</dt>
            <dd className="ally-checkup__reply">{latest?.reply || t.results.notAsked}</dd>
            {passages.length > 0 && (
              <>
                <dt>{t.card.passages}</dt>
                <dd>
                  {passages.map((p, n) => (
                    <React.Fragment key={p.url || p.title}>
                      {n > 0 && " · "}
                      {p.url ? (
                        <a className="ally-link" href={p.url} target="_blank" rel="noreferrer">
                          {p.title || p.url}
                        </a>
                      ) : (
                        p.title
                      )}
                    </React.Fragment>
                  ))}
                </dd>
              </>
            )}
            {latest?.ms ? (
              <>
                <dt className="ally-sr-only">{t.card.time}</dt>
                <dd className="ally-small">
                  {fill(t.card.time, { s: (latest.ms / 1000).toFixed(1) })}
                </dd>
              </>
            ) : null}
          </dl>
          {item.history.length > 0 && (
            <p className="ally-small ally-checkup__history">
              <span>{t.card.history}</span>
              {item.history.map(h => (
                <span
                  key={h.runId}
                  className={`ally-checkup__dot ally-checkup__dot--${h.result}`}
                  title={t.results[h.result]}
                >
                  <span className="ally-sr-only">{t.results[h.result]}</span>
                </span>
              ))}
            </p>
          )}
          {item.safety && <p className="ally-small">{t.locked}</p>}
          {canEdit && (
            <div className="ally-btn-row">
              <Button
                className="ally-btn--sm"
                disabled={trying.isLoading}
                onClick={() =>
                  void run(async () => {
                    const { result: fresh } = await tryOne({ id: botId, caseId: item.id }).unwrap();
                    setTried(fresh);
                  })
                }
              >
                {trying.isLoading ? t.actions.trying : t.actions.tryOne}
              </Button>
              <Button className="ally-btn--sm" onClick={onEdit}>
                {t.actions.edit}
              </Button>
              {!item.safety && (
                <>
                  <Button
                    variant="ghost"
                    className="ally-btn--sm"
                    disabled={editing.isLoading}
                    onClick={() =>
                      void run(() =>
                        edit({
                          id: botId,
                          caseId: item.id,
                          version: item.version,
                          input: { active: !item.active },
                        }).unwrap(),
                      )
                    }
                  >
                    {item.active ? t.actions.turnOff : t.actions.turnOn}
                  </Button>
                  <Button
                    variant="ghost"
                    className="ally-btn--sm ally-btn--danger"
                    disabled={removing.isLoading}
                    onClick={() =>
                      void run(async () => {
                        await remove({
                          id: botId,
                          caseId: item.id,
                          version: item.version,
                        }).unwrap();
                        saves.changed(
                          () =>
                            void restore({ id: botId, caseId: item.id })
                              .unwrap()
                              .catch((failure: unknown) =>
                                setError(message(failure, HOME.saving.failed)),
                              ),
                        );
                      })
                    }
                  >
                    {t.actions.delete}
                  </Button>
                </>
              )}
            </div>
          )}
          {error && (
            <p className="ally-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
};

/** "Suggest more questions": written from the pages, kept only when ticked. */
const Suggestions: React.FC<{ botId: string; onDone: (note: string) => void }> = ({
  botId,
  onDone,
}) => {
  const [suggest, suggesting] = useSuggestCheckupQuestionsMutation();
  const [keep, keeping] = useKeepCheckupSuggestionsMutation();
  const [list, setList] = useState<CheckupSuggestion[] | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());

  if (!list) {
    return (
      <Button
        disabled={suggesting.isLoading}
        onClick={() =>
          void suggest(botId)
            .unwrap()
            .then(out => {
              setList(out.suggestions);
              setTicked(new Set(out.suggestions.map((_, n) => n)));
            })
            .catch(() => onDone(HOME.saving.failed))
        }
      >
        {suggesting.isLoading ? t.suggest.working : t.suggest.button}
      </Button>
    );
  }
  if (!list.length) return <p className="ally-small">{t.suggest.none}</p>;
  const chosen = list.filter((_, n) => ticked.has(n));
  return (
    <section className="ally-card ally-checkup__suggest" data-testid="checkup-suggestions">
      <p className="ally-small">{t.suggest.pick}</p>
      <ul className="ally-list">
        {list.map((s, n) => (
          <li key={s.question} className="ally-list__row">
            <label className="ally-home__check">
              <input
                type="checkbox"
                checked={ticked.has(n)}
                onChange={() =>
                  setTicked(current => {
                    const next = new Set(current);
                    if (next.has(n)) next.delete(n);
                    else next.add(n);
                    return next;
                  })
                }
              />
              <span>“{s.question}”</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="ally-btn-row">
        <Button
          variant="primary"
          disabled={!chosen.length || keeping.isLoading}
          onClick={() =>
            void keep({ id: botId, questions: chosen })
              .unwrap()
              .then(out => {
                setList(null);
                onDone(fill(t.suggest.kept, { n: out.added }));
              })
              .catch(() => onDone(HOME.saving.failed))
          }
        >
          {chosen.length === 1 ? t.suggest.keepOne : fill(t.suggest.keep, { n: chosen.length })}
        </Button>
        <Button variant="ghost" onClick={() => setList(null)}>
          {t.suggest.cancel}
        </Button>
      </div>
    </section>
  );
};

/**
 * Every question the checkup asks (chunk 20d-2), with how each did, filters, and the owner's
 * controls: add, edit, turn off, delete with Undo, try one on its own, and suggest more.
 */
export const CheckupCases: React.FC<{
  botId: string;
  canEdit: boolean;
  run: CheckupRunView | null;
}> = ({ botId, canEdit, run }) => {
  const { data, isLoading } = useGetCheckupCasesQuery(botId);
  const [add, adding] = useAddCheckupCaseMutation();
  const [edit, editing] = useEditCheckupCaseMutation();
  const [filter, setFilter] = useState<CaseFilter>("all");
  const [editor, setEditor] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (isLoading) return <ListSkeleton rows={4} />;
  const rows = rowsOf(data?.cases ?? [], run).sort(byConcern);
  const shown = rows.filter(keeps(filter));
  const editingRow = rows.find(r => r.item.id === editor);

  const save = async (input: CheckupCaseInput) => {
    setError(null);
    try {
      if (editor === "new") await add({ id: botId, input }).unwrap();
      else if (editingRow) {
        await edit({
          id: botId,
          caseId: editingRow.item.id,
          version: editingRow.item.version,
          input,
        }).unwrap();
      }
      setEditor(null);
    } catch (failure) {
      setError(message(failure, HOME.saving.failed));
    }
  };

  return (
    <section className="ally-checkup__cases" data-testid="checkup-cases">
      <div className="ally-home__row">
        <h3 className="ally-heading">{COPY.checkup.sections.asked}</h3>
        {canEdit && editor === null && (
          <Button onClick={() => setEditor("new")}>{t.editor.add}</Button>
        )}
      </div>
      <Segmented<CaseFilter>
        label={COPY.checkup.sections.asked}
        value={filter}
        onChange={setFilter}
        options={(
          ["all", "failed", "partly", "passed", "mustPass", "byYou", "byAlly"] as CaseFilter[]
        ).map(id => ({ id, label: t.filters[id] }))}
      />
      {editor === "new" && (
        <CheckupCaseEditor
          title={t.editor.add}
          busy={adding.isLoading}
          error={error}
          onSave={input => void save(input)}
          onCancel={() => setEditor(null)}
        />
      )}
      {editingRow && (
        <CheckupCaseEditor
          title={t.editor.edit}
          safety={editingRow.item.safety}
          initial={{
            question: editingRow.item.question,
            outcome: editingRow.item.outcome ?? "answer",
            facts: editingRow.item.facts,
            mustNot: editingRow.item.mustNot,
            mustPass: editingRow.item.mustPass,
            language: editingRow.item.language ?? "",
          }}
          busy={editing.isLoading}
          error={error}
          onSave={input => void save(input)}
          onCancel={() => setEditor(null)}
        />
      )}
      <ul className="ally-checkup__case-list">
        {shown.map(row => (
          <CaseCard
            key={row.item.id}
            botId={botId}
            row={row}
            canEdit={canEdit}
            onEdit={() => setEditor(row.item.id)}
          />
        ))}
      </ul>
      {note && (
        <p className="ally-small" role="status">
          {note}
        </p>
      )}
      {canEdit && <Suggestions botId={botId} onDone={setNote} />}
    </section>
  );
};
