import React, { useState } from "react";

import {
  listRefusalOf,
  useAddListRuleMutation,
  useDeleteListRuleMutation,
  useLazyGetListEntryQuery,
} from "@api";
import { Button, Chip, Segmented, Select } from "@components/v2";
import type { Chatbot, ListEntry, ListRefusal, ListRule, ListWhere, UserList } from "@types";

import { HOME, fill } from "../copy";
import { EntryForm } from "./EntryForm";
import { human, liveFields, ruleSentence } from "./format";
import { PHONE, useMedia } from "./useMedia";

const t = () => HOME.userLists;

type Kind = "unique" | "capacity" | "limit_per_person" | "transitions";

/**
 * A list's rules, as sentences (chunk 5b), each with what it's for underneath. Add a rule offers
 * the four kinds as sentences to fill in. A rule that entries already break is refused, and those
 * entries are listed, each opening its form.
 */
export const RulesBlock: React.FC<{
  bot: Chatbot;
  list: UserList;
  lists: UserList[];
  canEdit: boolean;
}> = ({ bot, list, lists, canEdit }) => {
  const [adding, setAdding] = useState(false);
  const [remove, removing] = useDeleteListRuleMutation();
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<ListEntry | null>(null);
  const [getEntry] = useLazyGetListEntryQuery();
  const phone = useMedia(PHONE);

  const openEntry = async (recordId: string) => {
    const entry = await getEntry({ id: bot.id, key: list.key, recordId }).unwrap();
    setOpened(entry);
  };

  return (
    <div className="ally-rules" data-testid="rules-block">
      {list.rules.length ? (
        <ul className="ally-rules__list">
          {list.rules.map(rule => {
            const sentence = ruleSentence(list, rule, lists);
            return (
              <li key={rule.id} className="ally-rules__item">
                <div className="ally-rules__text">
                  <p className="ally-rules__sentence">{sentence.text}</p>
                  {sentence.lines.map(line => (
                    <p key={line} className="ally-rules__line">
                      {line}
                    </p>
                  ))}
                  <p className="ally-rules__example">{sentence.example}</p>
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    aria-label={`${t().rules.remove}: ${sentence.text}`}
                    disabled={removing.isLoading}
                    onClick={async () => {
                      setError(null);
                      try {
                        await remove({ id: bot.id, key: list.key, ruleId: rule.id }).unwrap();
                      } catch (failure) {
                        setError(listRefusalOf(failure)?.message ?? t().form.failed);
                      }
                    }}
                  >
                    {t().rules.remove}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ally-small">{t().rules.none}</p>
      )}
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
      {canEdit &&
        (adding ? (
          <RuleEditor
            bot={bot}
            list={list}
            lists={lists}
            onDone={() => setAdding(false)}
            onOpenEntry={id => void openEntry(id)}
          />
        ) : (
          <div>
            <Button onClick={() => setAdding(true)}>
              <span aria-hidden="true">+ </span>
              {t().rules.add}
            </Button>
          </div>
        ))}
      {opened && (
        <EntryForm
          bot={bot}
          list={list}
          lists={lists}
          entry={opened}
          canEdit={canEdit}
          side={phone ? "bottom" : "right"}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  );
};

/** "Not counting entries whose {status} is {cancelled}": optional on three kinds. */
const NotCounting: React.FC<{
  list: UserList;
  value: ListWhere | null;
  onChange: (where: ListWhere | null) => void;
}> = ({ list, value, onChange }) => {
  const r = t().rules.form;
  const choices = liveFields(list).filter(f => f.type === "select");
  if (!choices.length) return null;
  const field = choices.find(f => f.key === value?.field) ?? null;
  return (
    <div className="ally-rules__not-counting">
      <Select
        label={r.notCounting}
        value={value?.field ?? ""}
        options={[
          { value: "", label: t().details.nothing },
          ...choices.map(f => ({ value: f.key, label: f.label })),
        ]}
        onChange={key => onChange(key ? { field: key, not_in: [] } : null)}
      />
      {field && (
        <fieldset className="ally-field">
          <legend className="ally-field__label">{r.is}</legend>
          <div className="ally-chips">
            {(field.options.values ?? []).map(v => {
              const on = value?.not_in?.includes(v) ?? false;
              return (
                <Chip
                  key={v}
                  selected={on}
                  onToggle={() =>
                    onChange({
                      field: field.key,
                      not_in: on
                        ? (value?.not_in ?? []).filter(x => x !== v)
                        : [...(value?.not_in ?? []), v],
                    })
                  }
                >
                  {human(v)}
                </Chip>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
};

const RuleEditor: React.FC<{
  bot: Chatbot;
  list: UserList;
  lists: UserList[];
  onDone: () => void;
  onOpenEntry: (recordId: string) => void;
}> = ({ bot, list, lists, onDone, onOpenEntry }) => {
  const r = t().rules;
  const fields = liveFields(list);
  const linked = fields.filter(f => f.type === "relation" && f.options.to !== "contact");
  const choices = fields.filter(f => f.type === "select");
  const hasPerson = Boolean(list.settings.person_field);
  const kinds: { id: Kind; label: string }[] = [
    { id: "unique" as const, label: r.kinds.unique },
    ...(linked.length ? [{ id: "capacity" as const, label: r.kinds.capacity }] : []),
    ...(hasPerson ? [{ id: "limit_per_person" as const, label: r.kinds.limit }] : []),
    ...(choices.length ? [{ id: "transitions" as const, label: r.kinds.moves }] : []),
  ];
  const [kind, setKind] = useState<Kind>("unique");
  const [detail, setDetail] = useState(fields[0]?.key ?? "");
  const [linkedKey, setLinkedKey] = useState(linked[0]?.key ?? "");
  const [howMany, setHowMany] = useState<"fixed" | "from">("fixed");
  const [n, setN] = useState("1");
  const [fromKey, setFromKey] = useState("");
  const [where, setWhere] = useState<ListWhere | null>(null);
  const [status, setStatus] = useState(choices[0]?.key ?? "");
  const [moves, setMoves] = useState<Record<string, string[]>>({});
  const [starts, setStarts] = useState<string[]>([]);
  const [refusal, setRefusal] = useState<ListRefusal | null>(null);
  const [failed, setFailed] = useState(false);
  const [add, { isLoading }] = useAddListRuleMutation();

  const statusValues = choices.find(f => f.key === status)?.options.values ?? [];
  const target = lists.find(l => l.key === fields.find(f => f.key === linkedKey)?.options.to);
  const numbers = target ? liveFields(target).filter(f => f.type === "number") : [];
  const cleanWhere = where?.not_in?.length ? where : undefined;

  const rule = (): Omit<ListRule, "id"> => {
    switch (kind) {
      case "unique":
        return { kind, config: { fields: [detail], ...(cleanWhere ? { where: cleanWhere } : {}) } };
      case "capacity":
        return {
          kind,
          config: {
            field: linkedKey,
            ...(howMany === "fixed" ? { max: Number(n) } : { max_from: fromKey }),
            ...(cleanWhere ? { where: cleanWhere } : {}),
          },
        };
      case "limit_per_person":
        return {
          kind,
          config: {
            field: list.settings.person_field ?? "",
            max: Number(n),
            ...(cleanWhere ? { where: cleanWhere } : {}),
          },
        };
      case "transitions":
        return { kind, config: { field: status, initial: starts, allowed: moves } };
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setRefusal(null);
    setFailed(false);
    try {
      await add({ id: bot.id, key: list.key, rule: rule() }).unwrap();
      onDone();
    } catch (failure) {
      const found = listRefusalOf(failure);
      if (found) setRefusal(found);
      else setFailed(true);
    }
  };

  const broken = refusal?.conflict?.records ?? [];

  return (
    <form className="ally-rules__editor" onSubmit={save} data-testid="rule-editor">
      <Select
        label={r.which}
        value={kind}
        options={kinds.map(k => ({ value: k.id, label: k.label }))}
        onChange={value => {
          setKind(value as Kind);
          setRefusal(null);
        }}
      />

      {kind === "unique" && (
        <Select
          label={r.form.detail}
          value={detail}
          options={fields.map(f => ({ value: f.key, label: f.label }))}
          onChange={setDetail}
        />
      )}

      {kind === "capacity" && (
        <>
          <Select
            label={r.form.detail}
            value={linkedKey}
            options={linked.map(f => ({ value: f.key, label: f.label }))}
            onChange={setLinkedKey}
          />
          <div className="ally-field">
            <span className="ally-field__label">{r.form.howMany}</span>
            <Segmented
              label={r.form.howMany}
              value={howMany}
              options={[
                { id: "fixed", label: r.form.fixed },
                ...(numbers.length ? [{ id: "from" as const, label: r.form.fromDetail }] : []),
              ]}
              onChange={setHowMany}
            />
          </div>
          {howMany === "from" ? (
            <Select
              label={r.form.fromDetail}
              value={fromKey}
              options={numbers.map(f => ({ value: f.key, label: f.label }))}
              onChange={setFromKey}
            />
          ) : (
            <NumberInput label={r.form.howMany} value={n} onChange={setN} />
          )}
        </>
      )}

      {kind === "limit_per_person" && (
        <NumberInput label={r.form.howMany} value={n} onChange={setN} />
      )}

      {kind !== "transitions" && <NotCounting list={list} value={where} onChange={setWhere} />}

      {kind === "transitions" && (
        <>
          <Select
            label={r.form.detail}
            value={status}
            options={choices.map(f => ({ value: f.key, label: f.label }))}
            onChange={key => {
              setStatus(key);
              setMoves({});
              setStarts([]);
            }}
          />
          <fieldset className="ally-field">
            <legend className="ally-field__label">{r.form.startsAs}</legend>
            <div className="ally-chips">
              {statusValues.map(v => (
                <Chip
                  key={v}
                  selected={starts.includes(v)}
                  onToggle={() =>
                    setStarts(s => (s.includes(v) ? s.filter(x => x !== v) : [...s, v]))
                  }
                >
                  {human(v)}
                </Chip>
              ))}
            </div>
          </fieldset>
          <table className="ally-rules__grid">
            <caption className="sr-only">{fill(r.moves, { detail: status })}</caption>
            <thead>
              <tr>
                <th scope="col">{r.form.from}</th>
                <th scope="col">{r.form.canMoveTo}</th>
              </tr>
            </thead>
            <tbody>
              {statusValues.map(from => (
                <tr key={from}>
                  <th scope="row">{human(from)}</th>
                  <td>
                    <div className="ally-chips">
                      {statusValues
                        .filter(to => to !== from)
                        .map(to => {
                          const on = moves[from]?.includes(to) ?? false;
                          return (
                            <Chip
                              key={to}
                              selected={on}
                              onToggle={() =>
                                setMoves(m => ({
                                  ...m,
                                  [from]: on
                                    ? (m[from] ?? []).filter(x => x !== to)
                                    : [...(m[from] ?? []), to],
                                }))
                              }
                            >
                              {human(to)}
                            </Chip>
                          );
                        })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {refusal && (
        <div className="ally-lists__refusal" role="alert" data-testid="rule-refusal">
          <p>{broken.length ? fill(r.broken, { n: broken.length }) : refusal.message}</p>
          {broken.length > 0 && (
            <ul className="ally-lists__refusal-list">
              {broken.map(record => (
                <li key={record.id}>
                  <button
                    type="button"
                    className="ally-link"
                    onClick={() => onOpenEntry(record.id)}
                  >
                    {fill(r.open, { title: record.title })}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {failed && (
        <p className="ally-error" role="alert">
          {t().form.failed}
        </p>
      )}
      <div className="ally-btn-row">
        <Button variant="primary" type="submit" disabled={isLoading}>
          {isLoading ? t().form.saving : r.save}
        </Button>
        <Button onClick={onDone}>{r.cancel}</Button>
      </div>
    </form>
  );
};

const NumberInput: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({
  label,
  value,
  onChange,
}) => (
  <div className="ally-field ally-rules__number">
    <label htmlFor="rule-number">{label}</label>
    <input
      id="rule-number"
      className="ally-input"
      inputMode="numeric"
      value={value}
      onChange={e => onChange(e.target.value.replace(/\D/g, ""))}
    />
  </div>
);
