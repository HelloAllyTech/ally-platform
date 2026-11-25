import React, { useMemo, useState } from "react";

import { Tabs } from "@ally-ui-mono/ui-shared";

import { BasicsForm } from "./BasicsForm";
import { CheckupsForm } from "./CheckupsForm";
import { TEMPLATES_ADMIN_COPY as C } from "./copy";
import { buttonClass, dangerClass, errorCode, issuesOfError, secondaryClass } from "./fields";
import { HistoryPanel } from "./HistoryPanel";
import { ListsForm } from "./ListsForm";
import { NewTemplateForm } from "./NewTemplateForm";
import { SetupForm } from "./SetupForm";
import {
  useCreateTemplateDraftMutation,
  useDiscardTemplateDraftMutation,
  useGetTemplateAdminQuery,
  useGetTemplatesAdminMetaQuery,
  usePublishTemplateMutation,
  useSaveTemplateDraftMutation,
  useUnpublishTemplateMutation,
} from "./templatesAdminApi";

import type {
  TemplateDetail,
  TemplateDraft,
  TemplateIssue,
  TemplateManifest,
  TemplatesMeta,
} from "./templatesAdminApi";

const E = C.editor;

type TabId = "basics" | "lists" | "setup" | "checkups" | "history";

/** Which tab a problem's path belongs to. */
export const tabOf = (path: string): TabId =>
  path.startsWith("lists")
    ? "lists"
    : path.startsWith("setup")
      ? "setup"
      : path.startsWith("checkups")
        ? "checkups"
        : "basics";

const Banner: React.FC<{ ok: boolean; text: string; testId?: string }> = ({ ok, text, testId }) => (
  <p
    role={ok ? "status" : "alert"}
    className={ok ? "text-sm" : "text-sm text-red-700"}
    data-testid={testId}
  >
    {text}
  </p>
);

/** The live (or built-in) template as a summary, with the way into editing it. */
const LiveView: React.FC<{
  detail: TemplateDetail;
  onChanged: () => void;
  onCopy: () => void;
}> = ({ detail, onChanged, onCopy }) => {
  const [create, { isLoading: creating }] = useCreateTemplateDraftMutation();
  const [unpublish, { isLoading: unpublishing }] = useUnpublishTemplateMutation();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const shown = detail.live?.manifest ?? detail.built_in ?? detail.last_retired?.manifest;

  const edit = async () => {
    setMessage(null);
    try {
      await create({ key: detail.key, from: { key: detail.key } }).unwrap();
      onChanged();
    } catch (error) {
      setMessage({
        ok: false,
        text: C.create.failed[errorCode(error) ?? "default"] ?? C.create.failed.default,
      });
    }
  };

  const takeDown = async () => {
    const confirmText =
      detail.origin === "built_in" ? E.unpublishConfirmBuiltIn : E.unpublishConfirmCustom;
    if (!window.confirm(confirmText)) return;
    setMessage(null);
    try {
      await unpublish(detail.key).unwrap();
      setMessage({ ok: true, text: E.unpublished });
    } catch {
      setMessage({ ok: false, text: E.publishFailed });
    }
  };

  return (
    <div className="space-y-3 max-w-3xl" data-testid="template-live">
      <div className="rounded-md border border-border-light p-4 space-y-2">
        <p className="font-medium">{E.noDraftTitle}</p>
        <p className="text-sm text-typography-600">
          {detail.origin === "built_in" && !detail.live ? E.noDraftBuiltIn : E.noDraftBody}
        </p>
        {shown && (
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-typography-600">{C.basics.oneLiner}</dt>
              <dd>{shown.one_liner}</dd>
            </div>
            <div>
              <dt className="text-xs text-typography-600">{C.basics.audience}</dt>
              <dd>{shown.for}</dd>
            </div>
            <div>
              <dt className="text-xs text-typography-600">{C.editor.tabs.lists}</dt>
              <dd>{shown.lists.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-typography-600">{C.editor.tabs.checkups}</dt>
              <dd>{shown.checkups.length}</dd>
            </div>
          </dl>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className={buttonClass}
            disabled={creating}
            onClick={edit}
            data-testid="template-edit"
          >
            {E.edit}
          </button>
          <button
            type="button"
            className={secondaryClass}
            onClick={onCopy}
            data-testid="template-copy"
          >
            {E.copy}
          </button>
          {detail.live && (
            <button
              type="button"
              className={dangerClass}
              disabled={unpublishing}
              onClick={takeDown}
            >
              {E.unpublish}
            </button>
          )}
        </div>
      </div>
      {message && <Banner {...message} />}
    </div>
  );
};

/** The open draft: edit, save, publish. Keyed by its id so a new draft starts fresh. */
const DraftEditor: React.FC<{
  detail: TemplateDetail;
  draft: TemplateDraft;
  meta: TemplatesMeta;
  tab: TabId;
  setTab: (tab: TabId) => void;
  onChanged: () => void;
}> = ({ detail, draft, meta, tab, setTab, onChanged }) => {
  const [manifest, setManifest] = useState<TemplateManifest>(draft.manifest);
  const [saved, setSaved] = useState(() => JSON.stringify(draft.manifest));
  const [issues, setIssues] = useState<TemplateIssue[]>(draft.issues);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [save, { isLoading: saving }] = useSaveTemplateDraftMutation();
  const [publish, { isLoading: publishing }] = usePublishTemplateMutation();
  const [discard] = useDiscardTemplateDraftMutation();

  const dirty = JSON.stringify(manifest) !== saved;
  const errors = issues.filter(i => i.severity === "error");
  const notes = issues.filter(i => i.severity === "warning");
  const errorsIn = (id: TabId) => errors.filter(i => tabOf(i.path) === id).length;

  const doSave = async (): Promise<boolean> => {
    setMessage(null);
    try {
      const next = await save({ key: detail.key, manifest }).unwrap();
      setSaved(JSON.stringify(next.manifest));
      setIssues(next.issues);
      setMessage({ ok: true, text: E.saved });
      return true;
    } catch {
      setMessage({ ok: false, text: E.saveFailed });
      return false;
    }
  };

  const doPublish = async () => {
    if (!window.confirm(E.publishConfirm(manifest.name, detail.installs))) return;
    if (dirty && !(await doSave())) return;
    setMessage(null);
    try {
      await publish({ key: detail.key }).unwrap();
      setMessage({ ok: true, text: E.published });
      onChanged();
    } catch (error) {
      const found = issuesOfError(error);
      if (found.length) setIssues(found);
      setMessage({
        ok: false,
        text: found.length ? E.publishRefused : E.publishFailed,
      });
    }
  };

  const doDiscard = async () => {
    if (!window.confirm(E.discardConfirm)) return;
    try {
      await discard(detail.key).unwrap();
      onChanged();
    } catch {
      setMessage({ ok: false, text: E.saveFailed });
    }
  };

  const tabs = (Object.keys(E.tabs) as TabId[]).map(id => ({
    id,
    label: errorsIn(id) ? `${E.tabs[id]} (${errorsIn(id)})` : E.tabs[id],
  }));
  const form = { value: manifest, onChange: setManifest, issues, meta };

  return (
    <div className="space-y-4" data-testid="template-draft-editor">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={!dirty || saving}
          onClick={doSave}
          data-testid="template-save"
        >
          {saving ? E.saving : E.save}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={publishing || saving}
          onClick={doPublish}
          data-testid="template-publish"
        >
          {publishing ? E.publishing : E.publish}
        </button>
        <button type="button" className={dangerClass} onClick={doDiscard}>
          {E.discard}
        </button>
        {dirty && (
          <span className="text-xs text-typography-600" data-testid="template-unsaved">
            {E.unsaved}
          </span>
        )}
      </div>

      {message && <Banner {...message} testId="template-message" />}

      <section aria-label="Checks" data-testid="template-issues" className="space-y-1">
        {errors.length === 0 ? (
          <Banner ok text={E.ready} />
        ) : (
          <>
            <Banner ok={false} text={E.publishBlocked(errors.length)} />
            <ul className="text-sm space-y-1">
              {errors.slice(0, 6).map((i, n) => (
                <li key={n}>
                  <button
                    type="button"
                    className="underline text-left text-red-700"
                    onClick={() => setTab(tabOf(i.path))}
                  >
                    {E.tabs[tabOf(i.path)]}: {i.message}
                  </button>
                </li>
              ))}
              {errors.length > 6 && <li className="text-xs">+{errors.length - 6}</li>}
            </ul>
          </>
        )}
        {notes.length > 0 && (
          <ul className="text-xs text-typography-600">
            {notes.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        )}
      </section>

      <Tabs items={tabs} activeId={tab} onChange={id => setTab(id as TabId)} showCount={false} />

      {tab === "basics" && <BasicsForm {...form} />}
      {tab === "lists" && <ListsForm {...form} />}
      {tab === "setup" && <SetupForm {...form} />}
      {tab === "checkups" && <CheckupsForm {...form} />}
      {tab === "history" && <HistoryPanel detail={detail} onRestored={onChanged} />}
    </div>
  );
};

/** One template: its live version, or the open draft being edited. */
export const TemplateEditor: React.FC<{
  templateKey: string;
  onBack: () => void;
  onOpen: (key: string) => void;
}> = ({ templateKey, onBack, onOpen }) => {
  const {
    data: detail,
    isLoading,
    isError,
    refetch,
  } = useGetTemplateAdminQuery(templateKey, {
    refetchOnMountOrArgChange: true,
  });
  const { data: meta, isError: metaError } = useGetTemplatesAdminMetaQuery();
  const [tab, setTab] = useState<TabId>("basics");
  const [copying, setCopying] = useState(false);
  const draftId = detail?.draft?.id;

  const title = useMemo(
    () =>
      detail?.draft?.manifest.name ??
      detail?.live?.manifest.name ??
      detail?.built_in?.name ??
      templateKey,
    [detail, templateKey],
  );

  if (isLoading) return <p className="text-sm">{C.loading}</p>;
  if (isError || metaError || !detail || !meta) {
    return (
      <div className="space-y-2">
        <Banner ok={false} text={C.loadFailed} />
        <button type="button" className={secondaryClass} onClick={() => refetch()}>
          {C.tryAgain}
        </button>
      </div>
    );
  }

  const live = detail.live;
  return (
    <div className="space-y-4" data-testid="template-editor">
      <div className="space-y-1">
        <button type="button" className="text-sm underline" onClick={onBack}>
          ← {E.back}
        </button>
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="text-xs text-typography-600" data-testid="template-status">
          <code>{detail.key}</code> · {detail.origin === "built_in" ? E.builtIn : E.custom} ·{" "}
          {live ? E.live(live.version) : E.notLive}
          {detail.draft ? ` · ${E.draftOpen(detail.draft.version)}` : ""}
        </p>
      </div>

      {copying ? (
        <NewTemplateForm
          from={{ key: detail.key, name: title }}
          onCancel={() => setCopying(false)}
          onCreated={onOpen}
        />
      ) : detail.draft ? (
        <DraftEditor
          key={draftId}
          detail={detail}
          draft={detail.draft}
          meta={meta}
          tab={tab}
          setTab={setTab}
          onChanged={() => refetch()}
        />
      ) : (
        <>
          <LiveView detail={detail} onChanged={() => refetch()} onCopy={() => setCopying(true)} />
          <HistoryPanel detail={detail} onRestored={() => refetch()} />
        </>
      )}
    </div>
  );
};
