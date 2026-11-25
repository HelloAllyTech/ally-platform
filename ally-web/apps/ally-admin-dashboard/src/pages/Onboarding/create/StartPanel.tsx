import React, { useRef, useState } from "react";

import { useGetTemplateCatalogueQuery } from "@api";
import type { BotTemplateCard } from "@api";
import { Button, PrimaryButton } from "@components/v2";
import type { TemplateAnswers } from "@types";

import { BUILD_COPY } from "./copy";
import { TemplateCatalog } from "./TemplateCatalog";
import { SOURCE_ACCEPT, filesOk } from "./useSources";
import { TF1_COPY } from "../../AssistantHome/copy/tf1";
import { TemplateSetup } from "../../Templates/TemplateSetup";
import { fill } from "../copy";

const S = BUILD_COPY.start;

type View = "choose" | "template" | "library" | "scratch" | "website" | "documents";

/**
 * The left panel of a new, blank chatbot: Pick a template, or Start from scratch with a website,
 * documents or an interview. The test chatbot is already on the right.
 */
export const StartPanel: React.FC<{
  busy: boolean;
  problem: string | null;
  /** $0: the scratch paths need AI, so they show the contact-Ally line; a template still works. */
  creditsOut: boolean;
  /** Hidden once the chatbot is no longer blank (409 `not_blank`). */
  templatesOffered: boolean;
  onTemplate: (
    template: BotTemplateCard,
    answers: Record<string, string | boolean | string[]>,
  ) => void;
  /**
   * TF1 S6: a use-case template (T1: For organisations, For businesses), applied whole to the
   * draft: purpose, pack, instructions, languages, lists, checkup questions and the answers.
   */
  onUseCase?: (templateId: string, answers: TemplateAnswers) => void;
  onWebsite: (address: string) => void;
  onDocuments: (files: File[]) => void;
  onInterview: () => void;
}> = ({
  busy,
  problem,
  creditsOut,
  templatesOffered,
  onTemplate,
  onUseCase,
  onWebsite,
  onDocuments,
  onInterview,
}) => {
  const [view, setView] = useState<View>("choose");
  const [address, setAddress] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const useCases = useGetTemplateCatalogueQuery(undefined, {
    skip: view !== "template" || !onUseCase,
  });

  const error = (problem || fileProblem) && (
    <p className="ally-error" role="alert">
      {problem ?? fileProblem}
    </p>
  );

  if (view === "template" && templatesOffered && onUseCase) {
    return (
      <div className="ally-build__start" data-testid="start-use-cases">
        <TemplateSetup
          catalogue={useCases.data}
          loading={useCases.isLoading}
          failed={useCases.isError}
          onRetry={() => void useCases.refetch()}
          busy={busy}
          error={problem}
          onBack={() => setView("choose")}
          onSubmit={(template, answers) => onUseCase(template.id, answers)}
        />
        <button type="button" className="ally-link ally-small" onClick={() => setView("library")}>
          {TF1_COPY.create.moreStartingPoints}
        </button>
      </div>
    );
  }

  if ((view === "library" || view === "template") && templatesOffered) {
    return (
      <TemplateCatalog
        busy={busy}
        problem={problem}
        onApply={onTemplate}
        onBack={() => setView(onUseCase ? "template" : "choose")}
      />
    );
  }

  if (view === "website") {
    return (
      <form
        className="ally-build__start"
        onSubmit={event => {
          event.preventDefault();
          if (address.trim() && !busy) onWebsite(address);
        }}
      >
        <Button variant="ghost" onClick={() => setView("scratch")}>
          {S.back}
        </Button>
        <label className="ally-field__label" htmlFor="build-start-address">
          {S.addressLabel}
        </label>
        <input
          id="build-start-address"
          className="ally-input"
          inputMode="url"
          placeholder={S.addressPlaceholder}
          value={address}
          onChange={e => setAddress(e.target.value)}
          autoFocus
        />
        <PrimaryButton type="submit" disabled={!address.trim() || busy}>
          {S.read}
        </PrimaryButton>
        {error}
      </form>
    );
  }

  if (view === "documents") {
    return (
      <div className="ally-build__start">
        <Button variant="ghost" onClick={() => setView("scratch")}>
          {S.back}
        </Button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept={SOURCE_ACCEPT}
          data-testid="start-upload"
          onChange={event => {
            const next = [...files, ...Array.from(event.target.files ?? [])];
            event.target.value = "";
            if (!filesOk(next)) {
              setFileProblem(S.fileLimits);
              return;
            }
            setFileProblem(null);
            setFiles(next);
          }}
        />
        <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
          {S.chooseFiles}
        </Button>
        {files.length > 0 && (
          <ul className="ally-build__list">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`}>
                <span>{file.name}</span>
                <button
                  type="button"
                  className="ally-frame__close"
                  aria-label={fill(S.removeFile, { name: file.name })}
                  onClick={() => setFiles(files.filter((_, i) => i !== index))}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="ally-small">{S.fileLimits}</p>
        <PrimaryButton disabled={!files.length || busy} onClick={() => onDocuments(files)}>
          {S.upload}
        </PrimaryButton>
        {error}
      </div>
    );
  }

  const scratch = view === "scratch";
  const options = scratch
    ? [
        { id: "website", title: S.website, hint: S.websiteHint, go: () => setView("website") },
        {
          id: "documents",
          title: S.documents,
          hint: S.documentsHint,
          go: () => setView("documents"),
        },
        { id: "interview", title: S.interview, hint: S.interviewHint, go: onInterview },
      ]
    : [
        ...(templatesOffered
          ? [
              {
                id: "template",
                title: S.template,
                hint: S.templateHint,
                go: () => setView("template"),
              },
            ]
          : []),
        { id: "scratch", title: S.scratch, hint: S.scratchHint, go: () => setView("scratch") },
      ];

  return (
    <div className="ally-build__start" data-testid="start-panel">
      {scratch && (
        <Button variant="ghost" onClick={() => setView("choose")}>
          {S.back}
        </Button>
      )}
      {/* Right under the screen's title: it says where the test chatbot is, before the choices. */}
      {!scratch && <p className="ally-small">{S.starterNote}</p>}
      <h2 className="ally-heading">{scratch ? S.scratch : S.heading}</h2>
      {scratch && creditsOut && <p className="ally-small">{BUILD_COPY.credits.body}</p>}
      <ul
        className="ally-methods"
        data-testid="start-methods"
        // The two ways to begin sit side by side; the ways to start from scratch stay a list. Narrow
        // halves (the build area in tabs) drop back to one column on their own.
        style={{
          gridTemplateColumns: scratch ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        {options.map(o => (
          <li key={o.id}>
            <button
              type="button"
              className="ally-method ally-press"
              data-testid={`start-${o.id}`}
              disabled={busy || (scratch && creditsOut)}
              onClick={o.go}
            >
              <span className="ally-method__title">{o.title}</span>
              <span className="ally-method__hint">{o.hint}</span>
            </button>
          </li>
        ))}
      </ul>
      {error}
    </div>
  );
};
