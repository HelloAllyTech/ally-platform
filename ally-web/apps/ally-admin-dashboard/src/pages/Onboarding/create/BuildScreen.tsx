import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Link } from "react-router-dom";

import {
  useApplyBotTemplateMutation,
  useApplyDraftTemplateMutation,
  useGetBotDraftQuery,
  usePatchBotDraftMutation,
  useSetBuildModeMutation,
} from "@api";
import type { BotTemplateCard, BuildMode, StartPath } from "@api";
import { Button, Orb, SplitBuild } from "@components/v2";
import { ROUTES } from "@constants";
import type { TemplateAnswers } from "@types";

import { Copilot } from "./Copilot";
import { BUILD_COPY } from "./copy";
import { DirectForm } from "./DirectForm";
import {
  asList,
  asText,
  codeOf,
  crawlFailureText,
  defaultMode,
  isCreditsRequired,
  messageOf,
  modeAfterStart,
  showsStart,
  suggestionsFor,
} from "./logic";
import { PendingBar } from "./PendingBar";
import { StartPanel } from "./StartPanel";
import { useDraftEvents } from "./useDraftEvents";
import { useSources } from "./useSources";
import { useWorkingCopy } from "./useWorkingCopy";
import { SPLIT_COPY, fill } from "../copy";
import { DraftTestPane } from "../DraftTestPane";
import { createSplitBridge } from "../splitBridge";

import type { Narration } from "./useDraftEvents";
import type { FixTools } from "../FixThis";
import type { BotDraftView, PatchOp } from "../types";

import "./build.css";

const B = BUILD_COPY;

const snapshotKey = (draftId: string) => `ally.build.template.${draftId}`;
const readSnapshot = (draftId: string): Record<string, string> | null => {
  try {
    const raw = window.localStorage.getItem(snapshotKey(draftId));
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  } catch {
    return null;
  }
};
const writeSnapshot = (draftId: string, value: Record<string, string>) => {
  try {
    window.localStorage.setItem(snapshotKey(draftId), JSON.stringify(value));
  } catch {
    // no storage: the "From template" tags last until the page closes
  }
};

/**
 * The Create and Build screen (stage 3): one screen for a new chatbot and an existing one. The test
 * chatbot is on the right from the first moment. On the left, a blank chatbot offers Pick a
 * template or Start from scratch (website, documents, interview); after that, Copilot or the form
 * (an icon toggle), both editing the same working copy. After go-live, edits stage and a pending
 * bar applies them.
 */
export const BuildScreen: React.FC<{
  draftId: string;
  canEdit?: boolean;
  /** The chatbot is archived: nothing can be tested. */
  archived?: boolean;
  /** The create screen shows the go-live section; Build shows it until the chatbot is live. */
  surface: "create" | "build";
  /** The working copy is gone (a blank deleted while this tab was open). */
  onGone?: () => void;
}> = ({ draftId, canEdit = true, archived = false, surface, onGone }) => {
  const copy = useWorkingCopy(draftId);
  const wc = copy.wc;
  const draft = useGetBotDraftQuery(draftId);
  const [narration, setNarration] = useState<Narration[]>([]);
  const [mode, setMode] = useState<BuildMode | null>(null);
  const [startedPath, setStartedPath] = useState<StartPath | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [startProblem, setStartProblem] = useState<string | null>(null);
  const [templatesOffered, setTemplatesOffered] = useState(true);
  const [templateNote, setTemplateNote] = useState<{ name: string; indexing: number } | null>(null);
  const [snapshot, setSnapshot] = useState<Record<string, string> | null>(() =>
    readSnapshot(draftId),
  );
  const [bridge] = useState(createSplitBridge);
  const [setBuildMode] = useSetBuildModeMutation();
  const [applyTemplate] = useApplyBotTemplateMutation();
  const [applyUseCase] = useApplyDraftTemplateMutation();
  const [patchDraft] = usePatchBotDraftMutation();
  const sources = useSources(draftId, wc?.chatbotId ?? null);

  useEffect(() => {
    if (copy.gone) onGone?.();
  }, [copy.gone]); // eslint-disable-line react-hooks/exhaustive-deps

  // The remembered mode, once the working copy is read.
  useEffect(() => {
    if (wc && mode === null) setMode(defaultMode(wc));
  }, [wc, mode]);

  const refreshAll = useCallback(() => {
    void copy.refresh();
    void draft.refetch();
  }, [copy, draft]);

  useDraftEvents(draftId, {
    onNarration: n => setNarration(list => [...list, n]),
    onChanged: refreshAll,
  });

  const chooseMode = (next: BuildMode, path?: StartPath) => {
    setMode(next);
    return setBuildMode({ id: draftId, mode: next, ...(path ? { path } : {}) })
      .unwrap()
      .then(() => undefined)
      .catch(() => undefined);
  };

  const begin = async (path: Exclude<StartPath, "scratch">, action: () => Promise<unknown>) => {
    setStartBusy(true);
    setStartProblem(null);
    try {
      await action();
      setStartedPath(path);
      // Stored before the re-read, so a reload straight after a template still opens the form.
      await chooseMode(modeAfterStart(path), path);
      refreshAll();
    } catch (error) {
      if (isCreditsRequired(error)) {
        copy.markCreditsOut();
        setStartProblem(B.credits.body);
      } else if (codeOf(error) === "not_blank") {
        setTemplatesOffered(false);
        setStartProblem(B.templates.notBlank);
      } else if (path === "website") {
        setStartProblem(crawlFailureText(codeOf(error), messageOf(error)));
      } else {
        setStartProblem(messageOf(error) ?? B.templates.failedApply);
      }
    } finally {
      setStartBusy(false);
    }
  };

  const onTemplate = (template: BotTemplateCard, answers: Record<string, unknown>) =>
    void begin("template", async () => {
      const result = await applyTemplate({
        id: draftId,
        templateId: template.id,
        answers,
      }).unwrap();
      const versions = Object.fromEntries(
        Object.entries(result.workingCopy.fields).map(([k, f]) => [k, f.version]),
      );
      writeSnapshot(draftId, versions);
      setSnapshot(versions);
      setTemplateNote({ name: result.template.name, indexing: result.sourcesIndexing });
    });

  // TF1 S6: a use-case template applies whole to the draft (T1 "one click in setup").
  const onUseCase = (templateId: string, answers: TemplateAnswers) =>
    void begin("template", async () => {
      const { result } = await applyUseCase({ draftId, template: templateId, answers }).unwrap();
      setTemplateNote({ name: result.template.name, indexing: 0 });
    });

  const onWebsite = (address: string) =>
    void begin("website", async () => {
      const result = await sources.addAddress(address);
      if (result.failure) {
        throw { data: { errorCode: result.failure.errorCode, message: result.failure.message } };
      }
    });

  const onDocuments = (files: File[]) => void begin("documents", () => sources.addFiles(files));
  const onInterview = () => {
    setStartedPath("interview");
    chooseMode("copilot", "interview");
  };

  // Fix this, Add a fact and the tone/rule fixes from the test pane, through the same field queue.
  const fix: FixTools = useMemo(
    () => ({
      edit: async (target: "draft" | "learned", ops: PatchOp[]) => {
        if (target === "draft") {
          for (const op of ops) {
            if (op.path === "/tone") {
              if ((await copy.commit("tone", op.value)).status !== "saved") return false;
            } else if (op.path === "/extraNever/-") {
              const rules = [...asList(copy.values.extraNever), String(op.value)];
              if ((await copy.commit("extraNever", rules)).status !== "saved") return false;
            } else return false;
          }
          return true;
        }
        const view = draft.data;
        if (view && view.status === "active") {
          try {
            await patchDraft({ id: draftId, target, ops, version: view.version }).unwrap();
            void draft.refetch();
            return true;
          } catch {
            // falls through to the notes below for an added fact
          }
        }
        // A live chatbot's facts: an added answer goes into the owner's notes (staged like any edit).
        const add = ops.find(op => op.op === "add" && op.path === "/facts/-");
        const text = (add?.value as { text?: string } | undefined)?.text;
        if (!text) return false;
        const notes = asText(copy.values.ownerNotes).trim();
        return (
          (await copy.commit("ownerNotes", notes ? `${notes}\n${text}` : text)).status === "saved"
        );
      },
      upload: async (files: File[]) => {
        try {
          await sources.addFiles(files);
          refreshAll();
          return true;
        } catch (error) {
          if (isCreditsRequired(error)) copy.markCreditsOut();
          return false;
        }
      },
    }),
    [copy, draft, draftId, patchDraft, sources, refreshAll],
  );

  if (!wc) {
    return (
      <div className="ally-v2 ally-build ally-build--loading" data-testid="build-screen">
        {copy.failed ? (
          <p className="ally-error" role="alert">
            {B.loadFailed}{" "}
            <Button variant="ghost" onClick={() => void copy.refresh()}>
              {B.retry}
            </Button>
          </p>
        ) : (
          <>
            <Orb size={48} working />
            <p className="ally-small">{B.loading}</p>
          </>
        )}
      </div>
    );
  }

  const knowledge = (draft.data?.draft as { knowledgeDocumentIds?: string[] } | undefined)
    ?.knowledgeDocumentIds;
  const hasSources =
    (knowledge?.length ?? 0) > 0 ||
    Boolean(draft.data?.crawl.domain) ||
    copy.pending.some(p => p.field === "sources");
  const suggestions = suggestionsFor(copy.values, hasSources);
  const start = showsStart(wc) && !startedPath;
  const currentMode = mode ?? defaultMode(wc);

  const paneView = {
    ...(draft.data ?? ({} as BotDraftView)),
    id: draftId,
    chatbotId: wc.chatbotId,
    status: draft.data?.status ?? "active",
    version: draft.data?.version ?? 0,
    draft: {
      ...(draft.data?.draft ?? ({} as BotDraftView["draft"])),
      assistantName: asText(copy.values.assistantName),
      introduction: asText(copy.values.introduction),
      suggestedQuestions: asList(copy.values.suggestedQuestions),
      extraNever: asList(copy.values.extraNever),
    },
    learned: draft.data?.learned ?? { facts: [], dropped: 0 },
    crawl: draft.data?.crawl ?? (undefined as unknown as BotDraftView["crawl"]),
  } as BotDraftView;

  const usable = Boolean(wc.chatbotId) && !archived && draft.data?.status !== "abandoned";

  const left = (
    <div className="ally-build__left" data-testid="build-left">
      {surface === "create" && (
        <Link to={ROUTES.WHATSAPP_BOT} className="ally-link ally-small">
          {B.back}
        </Link>
      )}
      <header className="ally-build__head">
        <h2 className="ally-heading">{asText(copy.values.name) || B.title}</h2>
        {!start && (
          <div className="ally-build__modes" role="group" aria-label={B.modes.label}>
            {(["copilot", "form"] as const).map(m => (
              <button
                key={m}
                type="button"
                className="ally-build__mode ally-press"
                aria-pressed={currentMode === m}
                aria-label={B.modes[m]}
                title={B.modes[`${m}Hint`]}
                data-testid={`mode-${m}`}
                onClick={() => chooseMode(m)}
              >
                <span aria-hidden="true">{m === "copilot" ? "💬" : "☰"}</span>
                <span className="ally-build__mode-label">{B.modes[m]}</span>
              </button>
            ))}
          </div>
        )}
      </header>
      {copy.creditsOut && (
        <div className="ally-build__credits" role="note" data-testid="build-credits">
          <strong>{B.credits.title}.</strong> {B.credits.body}
        </div>
      )}
      <PendingBar copy={copy} disabled={!canEdit} />
      {templateNote && (
        <p className="ally-small" role="status" data-testid="template-applied">
          {templateNote.indexing > 0
            ? fill(templateNote.indexing === 1 ? B.templates.indexingOne : B.templates.indexing, {
                name: templateNote.name,
                n: templateNote.indexing,
              })
            : fill(B.templates.applied, { name: templateNote.name })}
        </p>
      )}
      {start ? (
        <StartPanel
          busy={startBusy}
          problem={startProblem}
          creditsOut={copy.creditsOut}
          templatesOffered={templatesOffered && wc.blank && !wc.template}
          onTemplate={onTemplate}
          onUseCase={onUseCase}
          onWebsite={onWebsite}
          onDocuments={onDocuments}
          onInterview={onInterview}
        />
      ) : (
        <>
          <div hidden={currentMode !== "copilot"}>
            <Copilot
              copy={copy}
              draftId={draftId}
              canEdit={canEdit}
              interview={startedPath === "interview"}
              narration={narration}
              suggestions={suggestions}
              addAddress={sources.addAddress}
              addFiles={sources.addFiles}
            />
          </div>
          <div hidden={currentMode !== "form"}>
            <DirectForm
              copy={copy}
              draftId={draftId}
              chatbotId={wc.chatbotId}
              canEdit={canEdit}
              templateSnapshot={wc.template ? snapshot : null}
              suggestions={suggestions}
              addAddress={sources.addAddress}
              addFiles={sources.addFiles}
              goLive={surface === "create" || !copy.live}
              accessMode={draft.data?.draft?.access?.mode}
            />
          </div>
        </>
      )}
    </div>
  );

  return (
    <div
      className="ally-v2 ally-build"
      data-testid="build-screen"
      data-live={copy.live ? "1" : "0"}
    >
      <SplitBuild
        build={left}
        test={
          <DraftTestPane
            draftId={draftId}
            view={paneView}
            fix={canEdit ? fix : undefined}
            bridge={bridge}
            settingsHash={copy.settingsHash}
            usable={usable}
            placeholder={archived ? B.archived : undefined}
            aiOff={copy.creditsOut ? B.credits.body : null}
            onReplyHash={copy.noteReplyHash}
            onCreditsRequired={copy.markCreditsOut}
          />
        }
        labels={SPLIT_COPY.layout}
      />
    </div>
  );
};
