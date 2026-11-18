import React from "react";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import { DebriefAgentRow, DebriefDataAccess, DebriefDataItem } from "@types";

const GROUP_ORDER: DebriefDataItem["group"][] = [
  "this session",
  "the roleplay",
  "the learner",
  "other learners",
  "the library",
  "other agents",
];

/** The optional roleplay fields the release reads once the pending edit is applied, in registry order. */
export const enabledOptionalFields = (
  access: DebriefDataAccess,
  live: string[] | undefined,
  edit: string[] | null,
): string[] => {
  const optional = access.roleplayFields.filter(f => !f.alwaysOn);
  const base = live ?? optional.filter(f => f.enabled).map(f => f.key);
  const picked = edit ?? base;
  return optional.map(f => f.key).filter(k => picked.includes(k));
};

/**
 * Settings › Agents › "What each agent can read": the declared data access as a matrix, the
 * roleplay fields a person may switch (the edit joins the page's pending changes), and what the
 * Debrief PM agent can read and do. The declaration is checked against the real wiring by tests.
 */
export const AgentDataAccess: React.FC<{
  access: DebriefDataAccess;
  /** The live release's optional fields (`settings.roleplayFields`). */
  liveFields?: string[];
  /** The fields as edited on this page (null: not edited). */
  editedFields: string[] | null;
  /** All agents of the system, to name the ones the matrix does not cover yet. */
  allAgents: DebriefAgentRow[];
  canEdit: boolean;
  onToggleField: (key: string, on: boolean) => void;
}> = ({ access, liveFields, editedFields, allAgents, canEdit, onToggleField }) => {
  const s = en.debriefs.settingsPage.agents.dataAccess;
  const on = new Set(enabledOptionalFields(access, liveFields, editedFields));
  const declared = new Set(access.agents.map(a => a.key));
  const undeclared = allAgents.filter(a => !declared.has(a.id)).map(a => a.name);
  const reads = (agent: string, data: string) =>
    access.agents.find(a => a.key === agent)?.reads.find(r => r.data === data);
  const groups = GROUP_ORDER.filter(g => access.data.some(d => d.group === g));
  const colCount = access.agents.length + 2;
  const pmReads = access.pmAgent.filter(t => t.kind === "read");
  const pmActs = access.pmAgent.filter(t => t.kind === "act");
  const anyConditional = access.agents.some(a => a.reads.some(r => r.when));

  return (
    <section className="flex flex-col gap-4" data-testid="agents-data-access">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        {s.title}
        <Tooltip label={s.help} align="top">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center"
            aria-label={s.help}
          >
            <TooltipIcon />
          </button>
        </Tooltip>
      </h3>

      <table className="w-full table-fixed border-collapse text-sm" data-testid="access-matrix">
        <thead>
          <tr className="border-b border-neutral-100 text-left text-[13px] text-neutral-600">
            <th className="w-[26%] py-2 font-normal">{s.data}</th>
            <th className="w-[13%] py-2 font-normal">{s.control}</th>
            {access.agents.map(a => (
              <th
                key={a.key}
                className="py-2 text-center font-normal"
                data-testid={`access-agent-${a.key}`}
              >
                <span className="block truncate" title={a.label}>
                  {a.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <React.Fragment key={group}>
              <tr className="bg-neutral-50" data-testid={`access-group-${group}`}>
                <th
                  colSpan={colCount}
                  className="py-1.5 pl-1 text-left text-[13px] font-semibold text-neutral-700"
                >
                  {s.groups[group] ?? group}
                </th>
              </tr>
              {access.data
                .filter(d => d.group === group)
                .map(d => (
                  <tr
                    key={d.key}
                    className="border-b border-neutral-100"
                    data-testid={`access-row-${d.key}`}
                  >
                    <td className="min-w-0 py-2 pr-2">
                      <div className="flex min-w-0 flex-nowrap items-center gap-2">
                        <span className="truncate" title={d.description}>
                          {d.label}
                        </span>
                        {d.personal && (
                          <span
                            className="shrink-0 rounded-sm bg-neutral-100 px-1.5 text-xs text-neutral-700"
                            data-testid={`access-personal-${d.key}`}
                          >
                            {s.personal}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="min-w-0 py-2 pr-2 text-[13px] text-neutral-700">
                      <span className="block truncate" data-testid={`access-control-${d.key}`}>
                        {s.controls[d.control] ?? d.control}
                      </span>
                    </td>
                    {access.agents.map(a => {
                      const r = reads(a.key, d.key);
                      return (
                        <td
                          key={a.key}
                          className="py-2 text-center"
                          data-testid={`access-cell-${a.key}-${d.key}`}
                          aria-label={r ? s.reads : s.doesNotRead}
                        >
                          {r ? (
                            <>
                              ✓
                              {r.when && (
                                <span
                                  className="cursor-help text-xs text-neutral-600"
                                  title={s.onlyWhen(r.when)}
                                  data-testid={`access-when-${a.key}-${d.key}`}
                                >
                                  {" *"}
                                </span>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {anyConditional && <p className="m-0 text-[13px] text-neutral-600">{s.onlyWhenNote}</p>}
      {undeclared.length > 0 && (
        <p className="m-0 text-[13px] text-neutral-600" data-testid="access-undeclared">
          {s.undeclared(undeclared.join(", "))}
        </p>
      )}

      <div
        className="flex flex-col gap-2 rounded-sm border border-neutral-100 px-4 py-3"
        data-testid="access-roleplay-card"
      >
        <h4 className="m-0 text-sm font-semibold">{s.roleplay.title}</h4>
        <p className="m-0 text-[13px] text-neutral-600">{s.roleplay.note}</p>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {access.roleplayFields.map(f => {
            const checked = f.alwaysOn || on.has(f.key);
            return (
              <li key={f.key} className="min-w-0" data-testid={`access-field-${f.key}`}>
                <label className="flex min-w-0 flex-nowrap items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    id={`access-field-input-${f.key}`}
                    className="mt-1 shrink-0"
                    aria-label={s.roleplay.toggle(f.label)}
                    checked={checked}
                    disabled={f.alwaysOn || !canEdit}
                    onChange={e => onToggleField(f.key, e.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate" title={f.label}>
                      {f.label}
                      {f.alwaysOn ? ` (${s.roleplay.alwaysOn})` : ""}
                    </span>
                    <span className="block truncate text-xs text-neutral-600" title={f.description}>
                      {f.description}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div
        className="flex flex-col gap-2 rounded-sm border border-neutral-100 px-4 py-3"
        data-testid="access-pm-agent"
      >
        <h4 className="m-0 text-sm font-semibold">{s.pm.title}</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <p className="m-0 mb-1 text-[13px] text-neutral-600">{s.pm.canRead}</p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" data-testid="pm-reads">
              {pmReads.map(t => (
                <li key={t.tool} className="truncate" title={t.reads}>
                  {t.reads}
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <p className="m-0 mb-1 text-[13px] text-neutral-600">{s.pm.canDo}</p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" data-testid="pm-acts">
              {pmActs.map(t => (
                <li key={t.tool} className="truncate" title={t.reads}>
                  {t.reads}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="m-0 text-[13px] text-neutral-600">{s.pm.note}</p>
      </div>
    </section>
  );
};
