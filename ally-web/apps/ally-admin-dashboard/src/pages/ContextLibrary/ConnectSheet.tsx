import React, { useCallback, useRef, useState } from "react";

import { Copy, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  useCreateContextReaderKeyMutation,
  useGetContextReaderKeysQuery,
  useRestoreContextReaderKeyMutation,
  useRevokeContextReaderKeyMutation,
} from "@api";
import { ApiEndpoints, en } from "@constants";
import { ContextReaderKey, ContextReaderKeyCreated } from "@types";

import { UNDO_MS } from "./ChunkSheet";
import { errorReason } from "./contextLibraryFormat";
import { InlineError, LoadingRows } from "./ContextLibraryUi";
import { formatDay, keyHint, mcpEndpoint, shellLines } from "./insightsFormat";
import { Sheet } from "../Builder/room/Sheet";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500";
const quietButton = `inline-flex min-h-[32px] items-center gap-1.5 rounded border border-border-light bg-white px-3 text-sm hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

/** Read when the sheet opens, never at module load: the API base the whole app talks to. */
const endpointUrl = (): string =>
  mcpEndpoint(
    import.meta.env.VITE_API_BASE_URL,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
    ApiEndpoints.CONTEXT_LIBRARY.MCP,
  );

const copyText = async (text: string, done: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast.error(en.contextLibrary.connect.copyFailed);
  }
};

/**
 * Connect Claude Code (`?sheet=connect`): what it gives, your read-only keys, and the two shell
 * lines to set. A new key is shown once, here, and never again: the server keeps only its hash.
 * Revoking happens at once with an undo.
 */
export const ConnectSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const strings = en.contextLibrary.connect;
  const [url] = useState(endpointUrl);
  const keysQuery = useGetContextReaderKeysQuery();
  const [createKey, { isLoading: creating }] = useCreateContextReaderKeyMutation();
  const [revokeKey] = useRevokeContextReaderKeyMutation();
  const [restoreKey] = useRestoreContextReaderKeyMutation();

  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<ContextReaderKeyCreated | null>(null);
  // Revoked here ahead of the server; back in the list if it refuses or the revoke is undone.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLHeadingElement>(null);

  const setHiddenFor = (id: string, hide: boolean) =>
    setHidden(previous => {
      const next = new Set(previous);
      if (hide) next.add(id);
      else next.delete(id);
      return next;
    });

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const created = await createKey({ label: label.trim() }).unwrap();
      setFresh(created);
      setLabel("");
    } catch (error) {
      const reason = errorReason(error);
      toast.error(reason ? `${strings.createFailed} ${reason}` : strings.createFailed);
    }
  };

  const revoke = useCallback(
    async (key: ContextReaderKey) => {
      setHiddenFor(key.id, true);
      listRef.current?.focus();
      try {
        await revokeKey(key.id).unwrap();
        if (fresh?.id === key.id) setFresh(null);
        toast(strings.revoked(key.label), {
          duration: UNDO_MS,
          action: {
            label: en.contextLibrary.sheet.toasts.undo,
            onClick: () => {
              void restoreKey(key.id)
                .unwrap()
                .then(() => {
                  setHiddenFor(key.id, false);
                  toast(en.contextLibrary.sheet.toasts.undone);
                })
                .catch(() => toast.error(en.contextLibrary.sheet.toasts.failed));
            },
          },
        });
      } catch {
        setHiddenFor(key.id, false);
        toast.error(en.contextLibrary.sheet.toasts.failed);
      }
    },
    [fresh?.id, restoreKey, revokeKey, strings],
  );

  const keys = (keysQuery.data ?? []).filter(key => !hidden.has(key.id));
  const commands = shellLines(url, fresh?.key ?? strings.keyPlaceholder);

  return (
    <Sheet title={strings.title} placement="side" onClose={onClose}>
      <div className="space-y-6 text-sm" data-testid="cl-connect">
        <div className="space-y-1 text-typography-700">
          <p>{strings.intro}</p>
          <p>{strings.introKeys}</p>
        </div>

        <section aria-labelledby="cl-connect-create" className="space-y-2">
          <h3 id="cl-connect-create" className="font-semibold text-typography-900">
            {strings.createHeading}
          </h3>
          {fresh ? (
            <div
              className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3"
              role="status"
              data-testid="cl-connect-fresh"
            >
              <p className="font-medium text-typography-900">
                {strings.newKeyHeading(fresh.label)}
              </p>
              <p className="text-amber-800">{strings.newKeyWarning}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code
                  className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs"
                  data-testid="cl-connect-key"
                >
                  {fresh.key}
                </code>
                <button
                  type="button"
                  className={quietButton}
                  onClick={() => void copyText(fresh.key, strings.copied)}
                >
                  <Copy size={14} aria-hidden /> {strings.copyKey}
                </button>
              </div>
              <button type="button" className={quietButton} onClick={() => setFresh(null)}>
                {strings.done}
              </button>
            </div>
          ) : (
            <form className="flex flex-wrap items-end gap-2" onSubmit={event => void create(event)}>
              <label className="min-w-[12rem] flex-1">
                <span className="mb-1 block text-xs text-typography-700">{strings.labelLabel}</span>
                <input
                  value={label}
                  onChange={event => setLabel(event.target.value)}
                  placeholder={strings.labelPlaceholder}
                  maxLength={80}
                  className="h-10 w-full rounded border border-border-light px-2"
                  data-testid="cl-connect-label"
                />
              </label>
              <button
                type="submit"
                disabled={creating}
                className={`inline-flex h-10 items-center gap-2 rounded bg-primary-600 px-4 font-medium text-white hover:bg-primary-700 disabled:opacity-60 ${focusRing}`}
                data-testid="cl-connect-create"
              >
                <KeyRound size={14} aria-hidden /> {creating ? strings.creating : strings.create}
              </button>
            </form>
          )}
        </section>

        <section aria-labelledby="cl-connect-shell" className="space-y-2">
          <h3 id="cl-connect-shell" className="font-semibold text-typography-900">
            {strings.shellHeading}
          </h3>
          <p className="text-typography-600">{strings.shellHelp}</p>
          <pre
            className="overflow-x-auto rounded bg-neutral-100 p-3 font-mono text-xs"
            data-testid="cl-connect-shell"
          >
            {commands}
          </pre>
          <button
            type="button"
            className={quietButton}
            onClick={() => void copyText(commands, strings.copied)}
          >
            <Copy size={14} aria-hidden /> {strings.copyCommands}
          </button>
        </section>

        <section aria-labelledby="cl-connect-keys" className="space-y-2">
          <h3
            id="cl-connect-keys"
            ref={listRef}
            tabIndex={-1}
            className="font-semibold text-typography-900 focus:outline-none"
          >
            {strings.keysHeading}
          </h3>
          {keysQuery.isLoading ? (
            <LoadingRows rows={2} />
          ) : keysQuery.isError ? (
            <InlineError
              what={strings.keysHeading.toLowerCase()}
              reason={errorReason(keysQuery.error)}
              onRetry={() => void keysQuery.refetch()}
            />
          ) : keys.length === 0 ? (
            <p className="text-typography-600">{strings.noKeys}</p>
          ) : (
            <ul className="divide-y divide-border-light border-y border-border-light">
              {keys.map(key => (
                <li key={key.id} className="flex items-center gap-3 py-2" data-testid="cl-key-row">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-typography-900">{key.label}</p>
                    <p className="text-xs text-typography-600">
                      <span className="font-mono">{keyHint(key.keyPrefix)}</span>
                      {" · "}
                      {[
                        key.createdAt ? strings.created(formatDay(key.createdAt)) : "",
                        key.lastUsedAt
                          ? strings.lastUsed(formatDay(key.lastUsedAt))
                          : strings.neverUsed,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={quietButton}
                    aria-label={strings.revokeLabel(key.label)}
                    onClick={() => void revoke(key)}
                  >
                    <Trash2 size={14} aria-hidden /> {strings.revoke}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  );
};
