import React, { useState } from "react";

import { useSearchParams } from "react-router-dom";

import { TEMPLATES_ADMIN_COPY as C } from "./copy";
import { buttonClass, day, secondaryClass } from "./fields";
import { NewTemplateForm } from "./NewTemplateForm";
import { TemplateEditor } from "./TemplateEditor";
import { useGetTemplatesAdminListQuery } from "./templatesAdminApi";

import type { TemplateRow } from "./templatesAdminApi";

const statusText = (row: TemplateRow): string => {
  switch (row.state) {
    case "overridden":
      return C.status.overridden(row.live_version ?? 0);
    case "published":
      return C.status.published(row.live_version ?? 0);
    case "unpublished":
      return C.status.unpublished;
    default:
      return C.status.built_in;
  }
};

/**
 * Assistants admin → Defaults & library → Templates. The list of every use-case template, and the
 * editor for one. The open template is in `?template=<key>` so a reload and a link land on it.
 */
export const TemplatesAdminPanel: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const open = params.get("template");
  const { data, isLoading, isError, refetch } = useGetTemplatesAdminListQuery();
  const [creating, setCreating] = useState(false);

  const go = (key: string | null) => {
    const next = new URLSearchParams(params);
    if (key) next.set("template", key);
    else next.delete("template");
    setParams(next, { replace: false });
    setCreating(false);
  };

  if (open) {
    return (
      <div className="ally-v2" data-testid="templates-admin">
        <TemplateEditor templateKey={open} onBack={() => go(null)} onOpen={go} />
      </div>
    );
  }

  const rows = data?.templates ?? [];
  return (
    <div className="ally-v2 flex flex-col gap-4" data-testid="templates-admin">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-typography-600 max-w-3xl">{C.intro}</p>
        <button
          type="button"
          className={buttonClass}
          onClick={() => setCreating(true)}
          data-testid="template-new"
        >
          {C.newTemplate}
        </button>
      </div>

      {creating && (
        <NewTemplateForm templates={rows} onCancel={() => setCreating(false)} onCreated={go} />
      )}

      {isLoading && <p className="text-sm">{C.loading}</p>}
      {isError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-red-700">
            {C.loadFailed}
          </p>
          <button type="button" className={secondaryClass} onClick={() => refetch()}>
            {C.tryAgain}
          </button>
        </div>
      )}
      {data && !rows.length && <p className="text-sm">{C.empty}</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="templates-table">
            <thead>
              <tr className="text-left text-xs text-typography-600">
                <th className="py-2 pr-3 font-medium">{C.columns.template}</th>
                <th className="py-2 pr-3 font-medium">{C.columns.group}</th>
                <th className="py-2 pr-3 font-medium">{C.columns.status}</th>
                <th className="py-2 pr-3 font-medium">{C.columns.used}</th>
                <th className="py-2 pr-3 font-medium">{C.columns.updated}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr
                  key={row.key}
                  className="border-t border-border-light align-top"
                  data-testid={`template-row-${row.key}`}
                >
                  <td className="py-2 pr-3">
                    <span aria-hidden="true">{row.icon} </span>
                    <span className="font-medium">{row.name}</span>
                    <span className="block text-xs text-typography-600">{row.one_liner}</span>
                  </td>
                  <td className="py-2 pr-3">{C.groups[row.group] ?? row.group}</td>
                  <td className="py-2 pr-3">
                    {statusText(row)}
                    {row.draft_version !== null && (
                      <span className="block text-xs text-typography-600">
                        {C.draft(row.draft_version)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {row.installs ? C.assistants(row.installs) : C.none}
                  </td>
                  <td className="py-2 pr-3">{day(row.updated_at)}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      className={secondaryClass}
                      onClick={() => go(row.key)}
                      aria-label={`${C.open} ${row.name}`}
                    >
                      {C.open}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
