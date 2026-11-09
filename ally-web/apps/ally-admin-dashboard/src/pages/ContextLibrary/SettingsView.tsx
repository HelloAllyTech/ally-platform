import React, { useCallback, useEffect, useRef, useState } from "react";

import { Check, Lock, Minus, ShieldAlert, Users } from "lucide-react";
import { toast } from "sonner";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { useGetContextUseCasesQuery, useSetContextGrantMutation } from "@api";
import { en } from "@constants";
import { ContextCollection } from "@types";

import { UNDO_MS } from "./ChunkSheet";
import { errorReason } from "./contextLibraryFormat";
import { InlineError, LoadingRows, StatusWord } from "./ContextLibraryUi";

const cellKey = (useCase: string, collectionId: string) => `${useCase}::${collectionId}`;

/**
 * Who reads what: use cases down the side, collections across the top. A switch flips at once
 * with an undo; a lock (set in code) shows why it can never be switched on. Read-only without
 * the edit grant.
 */
export const SettingsView: React.FC<{ collections: ContextCollection[]; canEdit: boolean }> = ({
  collections,
  canEdit,
}) => {
  const strings = en.contextLibrary.settings;
  const { data, isLoading, isError, error, refetch } = useGetContextUseCasesQuery();
  const [setGrant] = useSetContextGrantMutation();
  // Flipped here, ahead of the server.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  useEffect(() => setOverrides(previous => (Object.keys(previous).length ? {} : previous)), [data]);

  const nameOf = (id: string) => collections.find(c => c.id === id)?.name ?? id;

  const flipRef =
    useRef<
      (
        useCase: string,
        label: string,
        collectionId: string,
        enabled: boolean,
        undoable: boolean,
      ) => Promise<void>
    >();
  const flip = useCallback(
    async (
      useCase: string,
      label: string,
      collectionId: string,
      enabled: boolean,
      undoable: boolean,
    ) => {
      const key = cellKey(useCase, collectionId);
      setOverrides(previous => ({ ...previous, [key]: enabled }));
      try {
        await setGrant({ useCase, collectionId, enabled }).unwrap();
        const message = strings.toggled(label, nameOf(collectionId), enabled);
        if (undoable) {
          toast(message, {
            duration: UNDO_MS,
            action: {
              label: en.contextLibrary.sheet.toasts.undo,
              onClick: () => void flipRef.current?.(useCase, label, collectionId, !enabled, false),
            },
          });
        } else {
          toast(en.contextLibrary.sheet.toasts.undone);
        }
      } catch {
        setOverrides(previous => {
          const next = { ...previous };
          delete next[key];
          return next;
        });
        toast.error(en.contextLibrary.sheet.toasts.failed);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setGrant, collections],
  );
  flipRef.current = flip;

  if (isLoading) return <LoadingRows />;
  if (isError) {
    return (
      <InlineError
        what={strings.title.toLowerCase()}
        reason={errorReason(error)}
        onRetry={() => void refetch()}
      />
    );
  }
  if (!data?.length) return <p className="text-sm text-typography-600">{strings.empty}</p>;

  const columns = data[0].collections.map(c => c.collectionId);

  return (
    <div className="space-y-3" data-testid="cl-settings">
      <h2 className="text-base font-semibold">{strings.title}</h2>
      <p className="max-w-3xl text-sm text-typography-600">{strings.intro}</p>
      {!canEdit && <p className="text-sm text-typography-700">{strings.readOnly}</p>}
      <div className="overflow-x-auto">
        <table className="text-left text-sm">
          <thead>
            <tr className="border-b border-border-light text-xs text-typography-600">
              <th scope="col" className="sticky left-0 bg-white py-2 pr-4 font-medium">
                {strings.useCase}
              </th>
              {columns.map(id => (
                <th key={id} scope="col" className="min-w-[110px] px-2 py-2 font-medium">
                  {nameOf(id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(row => (
              <tr key={row.useCase} className="border-b border-border-light">
                <th scope="row" className="sticky left-0 bg-white py-2 pr-4 align-top font-normal">
                  <div className="font-medium text-typography-900">{row.label}</div>
                  <div className="flex flex-wrap gap-2">
                    {row.audience === "organisation" && (
                      <StatusWord icon={Users} label={strings.organisation} />
                    )}
                    {row.querySensitive && (
                      <StatusWord icon={ShieldAlert} label={strings.sensitive} />
                    )}
                  </div>
                </th>
                {row.collections.map(cell => {
                  const key = cellKey(row.useCase, cell.collectionId);
                  const enabled = overrides[key] ?? cell.enabled;
                  const name = nameOf(cell.collectionId);
                  if (cell.locked) {
                    return (
                      <td key={key} className="px-2 py-2">
                        <Tooltip label={strings.neverHelp} align="top">
                          <span
                            tabIndex={0}
                            className="inline-flex items-center gap-1 text-xs text-typography-600"
                            aria-label={`${row.label}, ${name}: ${strings.never}`}
                            data-testid="cl-grant-locked"
                          >
                            <Lock size={12} aria-hidden /> {strings.never}
                          </span>
                        </Tooltip>
                      </td>
                    );
                  }
                  if (!canEdit) {
                    return (
                      <td key={key} className="px-2 py-2">
                        <StatusWord
                          icon={enabled ? Check : Minus}
                          tone={enabled ? "good" : "muted"}
                          label={enabled ? strings.on : strings.off}
                        />
                      </td>
                    );
                  }
                  return (
                    <td key={key} className="px-2 py-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={`${row.label} reads ${name}`}
                        onClick={() =>
                          void flip(row.useCase, row.label, cell.collectionId, !enabled, true)
                        }
                        className="inline-flex items-center gap-2 rounded px-1 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                        data-testid="cl-grant-switch"
                      >
                        <span
                          aria-hidden
                          className={`relative inline-block h-4 w-7 rounded-full transition-colors motion-reduce:transition-none ${
                            enabled ? "bg-green-600" : "bg-neutral-300"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all motion-reduce:transition-none ${
                              enabled ? "left-3.5" : "left-0.5"
                            }`}
                          />
                        </span>
                        {enabled ? strings.on : strings.off}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
