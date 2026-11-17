import React, { useState } from "react";

import {
  Button,
  CarbonToggle,
  NumberInput,
  Select,
  SelectItem,
  TextInput,
  Tooltip,
} from "@ally-ui-mono/ui-shared";
import { useCreateDebriefAgentsChangesMutation, useGetDebriefAgentsConfigQuery } from "@api";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import {
  DebriefAgentAuthor,
  DebriefAgentsChange,
  DebriefAgentsChangesResult,
  DebriefAgentsConfig,
  DebriefAgentsRefusals,
} from "@types";

const NONE = "";

const Help: React.FC<{ label: string }> = ({ label }) => (
  <Tooltip label={label} align="top">
    <button type="button" className="inline-flex cursor-pointer items-center" aria-label={label}>
      <TooltipIcon />
    </button>
  </Tooltip>
);

/** Tool names arrive as codes; show the plain label, falling back by what the name says. */
const toolLabel = (name: string): string => {
  const labels = en.debriefs.settingsPage.agents.guidance.tools;
  if (labels[name]) return labels[name];
  if (/index|list/i.test(name)) return labels.guidance_index;
  if (/search/i.test(name)) return labels.guidance_search;
  if (/fetch|get/i.test(name)) return labels.guidance_fetch;
  return name;
};

type ModelEdit = { model: string; backupModel: string | null };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));

/** The pending edits as the exact change list ally-be takes; an edit equal to the live value is dropped. */
export const buildChanges = (
  data: DebriefAgentsConfig,
  models: Record<string, ModelEdit>,
  limit: number | null,
  tools: Record<string, string[]>,
  planner: Record<string, boolean>,
): DebriefAgentsChange[] => {
  const changes: DebriefAgentsChange[] = [];
  for (const r of data.recipes) {
    for (const st of r.steps) {
      const e = models[`${r.key}/${st.step}`];
      if (!e || st.model === null) continue;
      if (e.model === st.model && e.backupModel === st.backupModel) continue;
      changes.push({
        kind: "model",
        recipe: r.key,
        step: st.step,
        model: e.model,
        backupModel: e.backupModel,
      });
    }
  }
  if (limit !== null && limit !== data.settings.guidanceAgentMaxCalls) {
    changes.push({ kind: "setting", key: "guidanceAgentMaxCalls", value: limit });
  }
  const merged = { ...data.settings.guidanceTools, ...tools };
  const toolsChanged = data.limits.guidanceToolSteps.some(
    step => !sameSet(merged[step] ?? [], data.settings.guidanceTools[step] ?? []),
  );
  if (toolsChanged) changes.push({ kind: "setting", key: "guidanceTools", value: merged });
  for (const a of data.orchestratorAgents) {
    if (a.id in planner && planner[a.id] !== a.enabled) {
      changes.push({ kind: "orchestrator_agent", id: a.id, enabled: planner[a.id] });
    }
  }
  return changes;
};

const describe = (c: DebriefAgentsChange): string => {
  const b = en.debriefs.settingsPage.agents.bar;
  if (c.kind === "model") return b.model(c.recipe, c.step, c.model, c.backupModel);
  if (c.kind === "orchestrator_agent") return b.planner(c.id, c.enabled);
  return c.key === "guidanceAgentMaxCalls" ? b.limit(c.value as number) : b.tools;
};

const authorName = (a: DebriefAgentAuthor | undefined): string | null => {
  if (!a) return null;
  if (a.kind === "pm_agent") return en.debriefs.settingsPage.agents.pmAgent;
  if (a.kind === "system") return en.debriefs.settingsPage.agents.system;
  return a.name;
};

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

const errorStatus = (e: unknown): number | undefined => (e as { status?: number })?.status;

/**
 * Settings › Agents: the live release's recipes, models and guidance tools. Read-only for
 * everyone; with `canEdit`, edits pile up locally and become one draft release (never a live edit).
 */
export const AgentsSection: React.FC = () => {
  const s = en.debriefs.settingsPage.agents;
  const q = useGetDebriefAgentsConfigQuery();
  const [create, creating] = useCreateDebriefAgentsChangesMutation();
  const [models, setModels] = useState<Record<string, ModelEdit>>({});
  const [limit, setLimit] = useState<number | null>(null);
  const [tools, setTools] = useState<Record<string, string[]>>({});
  const [planner, setPlanner] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [refusals, setRefusals] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<DebriefAgentsChangesResult | null>(null);

  if (q.isLoading) return <p className="text-sm text-neutral-600">{s.loading}</p>;
  const data = q.data;
  if (!data) return <p className="text-sm text-neutral-600">{s.loadFailed}</p>;

  const canEdit = data.canEdit;
  const changes = canEdit ? buildChanges(data, models, limit, tools, planner) : [];
  const modelOptions = data.models;
  const merged = { ...data.settings.guidanceTools, ...tools };
  const limitValue = limit ?? data.settings.guidanceAgentMaxCalls;
  const touched = () => {
    setRefusals({});
    setError(null);
    setCreated(null);
  };
  const discard = () => {
    setModels({});
    setLimit(null);
    setTools({});
    setPlanner({});
    setNote("");
    touched();
  };

  const editModel = (key: string, current: ModelEdit, patch: Partial<ModelEdit>) => {
    touched();
    setModels(m => ({ ...m, [key]: { ...(m[key] ?? current), ...patch } }));
  };
  const toggleTool = (step: string, tool: string, on: boolean) => {
    touched();
    const cur = merged[step] ?? [];
    setTools(t => ({
      ...t,
      [step]: on ? [...cur.filter(x => x !== tool), tool] : cur.filter(x => x !== tool),
    }));
  };

  const submit = async () => {
    touched();
    try {
      const result = await create({
        changes,
        ...(note.trim() ? { note: note.trim() } : {}),
      }).unwrap();
      setCreated(result);
      setModels({});
      setLimit(null);
      setTools({});
      setPlanner({});
      setNote("");
    } catch (e) {
      const status = errorStatus(e);
      if (status === 403) setError(s.forbidden);
      else if (status === 400) {
        const body = (e as { data?: DebriefAgentsRefusals }).data;
        const list = body?.refusals ?? [];
        setRefusals(Object.fromEntries(list.map(r => [r.index, r.reason])));
        setError(list.length ? s.refused : (body?.message ?? s.failed));
      } else setError(s.failed);
    }
  };

  const draft = data.pendingDraft;
  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="agents-section">
      <p className="text-sm text-neutral-700" data-testid="agents-release">
        {s.liveRelease(data.release.version, data.release.status)}
      </p>
      {draft && (
        <p
          className="rounded-sm bg-neutral-50 px-4 py-3 text-sm"
          role="status"
          data-testid="agents-draft-banner"
        >
          {s.draftBanner(draft.version, draft.status, authorName(draft.author))}
          {draft.note ? ` “${draft.note}”` : ""}
        </p>
      )}
      {data.canary && (
        <p className="text-[13px] text-neutral-600" data-testid="agents-canary">
          {s.canary(data.canary.version, Math.round(data.canary.share * 100))}
        </p>
      )}
      {created && (
        <div
          className="rounded-sm bg-neutral-50 px-4 py-3 text-sm"
          role="status"
          data-testid="agents-created"
        >
          <p className="font-semibold">{s.success(created.draft.version)}</p>
          {created.waitsForPerson && (
            <p>{created.reason ? s.waits(created.reason) : s.waitsNoReason}</p>
          )}
        </div>
      )}

      {data.recipes.map(r => (
        <section key={r.key} className="flex flex-col gap-2" data-testid={`agents-recipe-${r.key}`}>
          <div className="flex flex-nowrap items-baseline gap-3">
            <h3 className="shrink-0 text-base font-semibold">{s.recipeNames[r.key] ?? r.key}</h3>
            <span className="truncate text-[13px] text-neutral-600">
              {s.revisionRounds(r.maxRevisionRounds)}
            </span>
          </div>
          {r.usedWhen && (
            <p
              className="m-0 text-[13px] text-neutral-600"
              title={r.usedWhen}
              data-testid={`agents-recipe-used-when-${r.key}`}
            >
              {r.usedWhen}
            </p>
          )}
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[13px] text-neutral-600">
                <th className="w-[28%] py-2 font-normal">{s.columns.step}</th>
                <th className="w-[16%] py-2 font-normal">{s.columns.prompt}</th>
                <th className="w-[28%] py-2 font-normal">{s.columns.model}</th>
                <th className="w-[28%] py-2 font-normal">{s.columns.backup}</th>
              </tr>
            </thead>
            <tbody>
              {r.steps.map(st => {
                const key = `${r.key}/${st.step}`;
                const cur: ModelEdit = { model: st.model ?? NONE, backupModel: st.backupModel };
                const e = models[key] ?? cur;
                const editable = canEdit && st.model !== null;
                const label = (id: string | null) =>
                  id === null ? s.noModel : (modelOptions.find(m => m.id === id)?.label ?? id);
                return (
                  <tr
                    key={st.step}
                    className="border-b border-neutral-100 align-middle"
                    data-testid={`agents-step-${r.key}-${st.step}`}
                  >
                    <td className="min-w-0 py-2 pr-2">
                      <div className="truncate" title={st.label}>
                        {st.label}
                        {st.optional ? ` (${s.optional})` : ""}
                      </div>
                      <div className="truncate text-xs text-neutral-600" title={st.step}>
                        {st.step}
                      </div>
                    </td>
                    <td className="min-w-0 py-2 pr-2">
                      {st.promptCode ? (
                        <a
                          href={`/manage-prompts?prompt=${encodeURIComponent(st.promptCode)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate"
                          title={st.promptCode}
                          data-testid={`agents-prompt-${r.key}-${st.step}`}
                        >
                          {st.promptCode} ↗
                        </a>
                      ) : (
                        s.noModel
                      )}
                    </td>
                    <td className="min-w-0 py-2 pr-2">
                      {editable ? (
                        <Select
                          id={`agents-model-${key}`}
                          labelText={s.modelLabel(st.label)}
                          hideLabel
                          size="sm"
                          value={e.model}
                          onChange={(ev: React.ChangeEvent<HTMLSelectElement>) =>
                            editModel(key, cur, { model: ev.target.value })
                          }
                        >
                          {!modelOptions.some(m => m.id === e.model) && (
                            <SelectItem value={e.model} text={e.model} />
                          )}
                          {modelOptions.map(m => (
                            <SelectItem key={m.id} value={m.id} text={m.label} />
                          ))}
                        </Select>
                      ) : (
                        <span className="block truncate" title={st.model ?? undefined}>
                          {label(st.model)}
                        </span>
                      )}
                    </td>
                    <td className="min-w-0 py-2">
                      {editable ? (
                        <Select
                          id={`agents-backup-${key}`}
                          labelText={s.backupLabel(st.label)}
                          hideLabel
                          size="sm"
                          value={e.backupModel ?? NONE}
                          onChange={(ev: React.ChangeEvent<HTMLSelectElement>) =>
                            editModel(key, cur, { backupModel: ev.target.value || null })
                          }
                        >
                          <SelectItem value={NONE} text={s.noBackup} />
                          {e.backupModel && !modelOptions.some(m => m.id === e.backupModel) && (
                            <SelectItem value={e.backupModel} text={e.backupModel} />
                          )}
                          {modelOptions.map(m => (
                            <SelectItem key={m.id} value={m.id} text={m.label} />
                          ))}
                        </Select>
                      ) : (
                        <span className="block truncate" title={st.backupModel ?? undefined}>
                          {label(st.backupModel)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <section className="flex flex-col gap-3" data-testid="agents-guidance">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          {s.guidance.title}
          <Help label={s.guidance.toolsHelp} />
        </h3>
        <div className="flex flex-nowrap items-center gap-3">
          <span className="shrink-0 text-sm">{s.guidance.limitLabel}</span>
          <Help label={s.guidance.limitHelp} />
          {canEdit ? (
            <div className="w-32">
              <NumberInput
                id="agents-guidance-limit"
                size="md"
                label={s.guidance.limitLabel}
                hideLabel
                min={data.limits.guidanceAgentMaxCalls.min}
                max={data.limits.guidanceAgentMaxCalls.max}
                step={1}
                allowEmpty
                value={limitValue}
                onChange={(_e: unknown, { value }: { value: number | string }) => {
                  const n = Number(value);
                  if (String(value).trim() === "" || !Number.isFinite(n)) return;
                  touched();
                  setLimit(n);
                }}
              />
            </div>
          ) : (
            <span className="font-semibold" data-testid="agents-guidance-limit-value">
              {data.settings.guidanceAgentMaxCalls}
            </span>
          )}
          <span className="truncate text-[13px] text-neutral-600">
            {s.guidance.range(
              data.limits.guidanceAgentMaxCalls.min,
              data.limits.guidanceAgentMaxCalls.max,
            )}
          </span>
        </div>
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-[13px] text-neutral-600">
              <th className="w-[28%] py-2 font-normal" />
              {data.limits.guidanceToolNames.map(t => (
                <th key={t} className="py-2 font-normal">
                  <span className="block truncate" title={t}>
                    {toolLabel(t)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.limits.guidanceToolSteps.map(step => (
              <tr
                key={step}
                className="border-b border-neutral-100"
                data-testid={`agents-tools-${step}`}
              >
                <td className="py-2 pr-2">
                  <div className="truncate" title={step}>
                    {s.guidance.steps[step] ?? step}
                  </div>
                  <div className="truncate text-xs text-neutral-600">{step}</div>
                </td>
                {data.limits.guidanceToolNames.map(t => {
                  const on = (merged[step] ?? []).includes(t);
                  return (
                    <td key={t} className="py-2">
                      {canEdit ? (
                        <CarbonToggle
                          id={`agents-tool-${step}-${t}`}
                          size="sm"
                          labelText=""
                          aria-label={s.guidance.toggleLabel(
                            s.guidance.steps[step] ?? step,
                            toolLabel(t),
                          )}
                          labelA=""
                          labelB=""
                          toggled={on}
                          onToggle={(v: boolean) => toggleTool(step, t, v)}
                        />
                      ) : (
                        <span aria-label={on ? "On" : "Off"}>{on ? "On" : "Off"}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-2" data-testid="agents-planner">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          {s.planner.title}
          <Help label={s.planner.help} />
        </h3>
        {data.orchestratorAgents.length === 0 && (
          <p className="text-sm text-neutral-600">{s.planner.none}</p>
        )}
        {data.orchestratorAgents.map(a => {
          const on = planner[a.id] ?? a.enabled;
          return (
            <div
              key={a.id}
              className="flex flex-nowrap items-center gap-3 border-b border-neutral-100 py-2 text-sm"
              data-testid={`agents-planner-${a.id}`}
            >
              <span className="min-w-0 flex-1 truncate" title={a.id}>
                {a.id}
              </span>
              <span className="shrink-0 text-[13px] text-neutral-600">
                {s.planner.version(a.version)}
              </span>
              {canEdit ? (
                <CarbonToggle
                  id={`agents-planner-toggle-${a.id}`}
                  size="sm"
                  labelText=""
                  aria-label={s.planner.toggleLabel(a.id)}
                  labelA=""
                  labelB=""
                  toggled={on}
                  onToggle={(v: boolean) => {
                    touched();
                    setPlanner(p => ({ ...p, [a.id]: v }));
                  }}
                />
              ) : (
                <span>{a.enabled ? "On" : "Off"}</span>
              )}
            </div>
          );
        })}
      </section>

      {data.recentChanges && (
        <section className="flex flex-col gap-1" data-testid="agents-recent">
          <h3 className="text-base font-semibold">{s.recent.title}</h3>
          {data.recentChanges.length === 0 && (
            <p className="text-sm text-neutral-600">{s.recent.none}</p>
          )}
          {data.recentChanges.map(c => {
            const text = c.summary.join("; ");
            const who = authorName(c.author) ?? s.system;
            return (
              <div
                key={c.releaseId}
                className="flex flex-nowrap items-center gap-3 border-b border-neutral-100 py-2 text-sm"
                data-testid={`agents-recent-${c.releaseId}`}
              >
                <span className="w-44 shrink-0 truncate" title={s.recent.row(c.version, who)}>
                  {s.recent.row(c.version, who)}
                </span>
                <span className="w-40 shrink-0 truncate text-[13px] text-neutral-600" title={c.at}>
                  {when(c.at)}
                </span>
                <span className="min-w-0 flex-1 truncate" title={text}>
                  {text}
                </span>
              </div>
            );
          })}
        </section>
      )}

      {canEdit && (changes.length > 0 || error) && (
        <div
          className="sticky bottom-0 flex flex-col gap-3 rounded-sm border border-neutral-100 bg-white px-4 py-3"
          data-testid="agents-changes-bar"
        >
          {changes.length > 0 && (
            <p className="text-sm font-semibold" data-testid="agents-changes-count">
              {s.bar.ready(changes.length)}
            </p>
          )}
          <ul className="flex flex-col gap-1 text-sm">
            {changes.map((c, i) => (
              <li key={i} data-testid={`agents-change-${i}`}>
                <span className="block truncate" title={describe(c)}>
                  {describe(c)}
                </span>
                {refusals[i] && (
                  <span
                    className="block text-[13px] text-destructive-500"
                    role="alert"
                    data-testid={`agents-refusal-${i}`}
                  >
                    {refusals[i]}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {error && (
            <p className="text-sm text-destructive-500" role="alert" data-testid="agents-error">
              {error}
            </p>
          )}
          {changes.length > 0 && (
            <>
              <TextInput
                id="agents-note"
                labelText={s.bar.note}
                value={note}
                onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setNote(ev.target.value)}
              />
              <div className="flex flex-nowrap items-center gap-2">
                <Button
                  kind="primary"
                  size="md"
                  disabled={creating.isLoading}
                  onClick={() => void submit()}
                >
                  {creating.isLoading ? s.bar.creating : s.bar.create}
                </Button>
                <Button kind="ghost" size="md" disabled={creating.isLoading} onClick={discard}>
                  {s.bar.discard}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
