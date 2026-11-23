import React, { useState } from "react";

import { Copy, KeyRound, PlugZap, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  BlogAuthoringKeyCreated,
  useCreateBlogAuthoringKeyMutation,
  useGetBlogAuthoringKeysQuery,
  useRevokeBlogAuthoringKeyMutation,
} from "@api";
import { ApiEndpoints, en } from "@constants";

import { Sheet } from "../../pages/Builder/room/Sheet";
import { errorReason } from "../../pages/ContextLibrary/contextLibraryFormat";
import {
  ConnectionOutcome,
  CONNECTION_TEST_TIMEOUT_MS,
  connectionOutcome,
  formatDay,
  keyHint,
  mcpEndpoint,
} from "../../pages/ContextLibrary/insightsFormat";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500";
const quietButton = `inline-flex min-h-[32px] items-center gap-1.5 rounded border border-border-light bg-white px-3 text-sm hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

/** Read when the sheet opens, never at module load. */
const endpointUrl = (): string =>
  mcpEndpoint(
    import.meta.env.VITE_API_BASE_URL,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
    ApiEndpoints.BLOG_AUTHORING.MCP,
  );

export const blogShellLines = (url: string, key: string): string =>
  [`export ALLY_BLOG_URL="${url}"`, `export ALLY_BLOG_KEY="${key}"`].join("\n");

/**
 * Ask the blog endpoint for its tools with the new key, as Claude Code would. A plain `fetch`, not
 * an RTK Query call: the app's API slice signs every call with the admin's own session, and this
 * must carry the key and nothing else. Never throws.
 */
export const testBlogConnection = async (
  url: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = CONNECTION_TEST_TIMEOUT_MS,
): Promise<ConnectionOutcome> => {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      credentials: "omit",
      signal: controller?.signal,
    });
    const body = await response.json().catch(() => null);
    return connectionOutcome(response.status, body);
  } catch {
    return "unreachable";
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const copyText = async (text: string, done: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast.error(en.blogClaudeConnect.copyFailed);
  }
};

/**
 * Connect Claude (Blog page): a new key is shown once, here; the server keeps only its hash, which
 * is why Test connection is offered only while this page still holds the key.
 */
export const BlogClaudeConnectSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const strings = en.blogClaudeConnect;
  const [url] = useState(endpointUrl);
  const keysQuery = useGetBlogAuthoringKeysQuery();
  const [createKey, { isLoading: creating }] = useCreateBlogAuthoringKeyMutation();
  const [revokeKey] = useRevokeBlogAuthoringKeyMutation();

  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<BlogAuthoringKeyCreated | null>(null);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<ConnectionOutcome | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const created = await createKey({ label: label.trim() }).unwrap();
      setFresh(created);
      setOutcome(null);
      setLabel("");
    } catch (error) {
      const reason = errorReason(error);
      toast.error(reason ? `${strings.createFailed} ${reason}` : strings.createFailed);
    }
  };

  const test = async () => {
    if (!fresh) return;
    setTesting(true);
    setOutcome(null);
    try {
      setOutcome(await testBlogConnection(url, fresh.key));
    } finally {
      setTesting(false);
    }
  };

  const revoke = async (id: string, keyLabel: string) => {
    try {
      await revokeKey(id).unwrap();
      if (fresh?.id === id) {
        setFresh(null);
        setOutcome(null);
      }
      toast(strings.revoked(keyLabel));
    } catch {
      toast.error(strings.revokeFailed);
    }
  };

  const keys = keysQuery.data ?? [];
  const commands = blogShellLines(url, fresh?.key ?? strings.keyPlaceholder);

  return (
    <Sheet title={strings.title} placement="side" onClose={onClose}>
      <div className="space-y-6 text-sm" data-testid="blog-connect">
        <div className="space-y-1 text-typography-700">
          <p>{strings.intro}</p>
          <p>{strings.introKeys}</p>
        </div>

        <section aria-labelledby="blog-connect-create" className="space-y-2">
          <h3 id="blog-connect-create" className="font-semibold text-typography-900">
            {strings.createHeading}
          </h3>
          {fresh ? (
            <div
              className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3"
              role="status"
              data-testid="blog-connect-fresh"
            >
              <p className="font-medium text-typography-900">
                {strings.newKeyHeading(fresh.label)}
              </p>
              <p className="text-amber-800">{strings.newKeyWarning}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code
                  className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs"
                  data-testid="blog-connect-key"
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
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={quietButton}
                  disabled={testing}
                  title={strings.testHelp}
                  onClick={() => void test()}
                  data-testid="blog-connect-test"
                >
                  <PlugZap size={14} aria-hidden />{" "}
                  {testing ? strings.testing : strings.testConnection}
                </button>
                <button
                  type="button"
                  className={quietButton}
                  onClick={() => {
                    setFresh(null);
                    setOutcome(null);
                  }}
                >
                  {strings.done}
                </button>
              </div>
              <p
                aria-live="polite"
                data-testid="blog-connect-test-result"
                data-outcome={outcome ?? undefined}
                className={
                  outcome === "reachable" ? "text-green-700" : outcome ? "text-red-700" : "sr-only"
                }
              >
                {outcome ? strings.testResult[outcome] : ""}
              </p>
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
                  data-testid="blog-connect-label"
                />
              </label>
              <button
                type="submit"
                disabled={creating}
                className={`inline-flex h-10 items-center gap-2 rounded bg-primary-600 px-4 font-medium text-white hover:bg-primary-700 disabled:opacity-60 ${focusRing}`}
                data-testid="blog-connect-create"
              >
                <KeyRound size={14} aria-hidden /> {creating ? strings.creating : strings.create}
              </button>
            </form>
          )}
        </section>

        <section aria-labelledby="blog-connect-shell" className="space-y-2">
          <h3 id="blog-connect-shell" className="font-semibold text-typography-900">
            {strings.shellHeading}
          </h3>
          <p className="text-typography-600">{strings.shellHelp}</p>
          <pre
            className="overflow-x-auto rounded bg-neutral-100 p-3 font-mono text-xs"
            data-testid="blog-connect-shell"
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

        <section aria-labelledby="blog-connect-keys" className="space-y-2">
          <h3 id="blog-connect-keys" className="font-semibold text-typography-900">
            {strings.keysHeading}
          </h3>
          {keysQuery.isLoading ? (
            <p className="text-typography-600">…</p>
          ) : keysQuery.isError ? (
            <p className="text-red-700">{errorReason(keysQuery.error) || strings.noKeys}</p>
          ) : keys.length === 0 ? (
            <p className="text-typography-600">{strings.noKeys}</p>
          ) : (
            <ul className="divide-y divide-border-light border-y border-border-light">
              {keys.map(key => (
                <li
                  key={key.id}
                  className="flex items-center gap-3 py-2"
                  data-testid="blog-key-row"
                >
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
                    onClick={() => void revoke(key.id, key.label)}
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
