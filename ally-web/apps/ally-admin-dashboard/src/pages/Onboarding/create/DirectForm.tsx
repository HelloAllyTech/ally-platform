import React from "react";

import { AccessSection } from "./AccessSection";
import { BUILD_COPY } from "./copy";
import { LanguagesInput, LinesInput, TextInput, ToneInput } from "./Fields";
import { GoLiveSection } from "./GoLive";
import { SAFETY_RELEVANT, SUGGESTION_FIELD } from "./logic";
import { SourcesSection } from "./Sources";

import type { FieldCommon } from "./Fields";
import type { SuggestionId } from "./logic";
import type { WorkingCopy } from "./useWorkingCopy";

const T = BUILD_COPY.form;

/** Focus a field of the form (a suggestion, or Copilot handing over). */
export const focusField = (name: string): void => {
  const box = document.querySelector<HTMLElement>(
    `[data-field="${name}"] input, [data-field="${name}"] textarea`,
  );
  box?.scrollIntoView?.({ block: "center" });
  box?.focus();
};

const Section: React.FC<{
  id: string;
  title: string;
  children: React.ReactNode;
  marker?: string;
}> = ({ id, title, children, marker }) => (
  <section
    className="ally-build__section"
    aria-labelledby={`build-${id}`}
    data-testid={`form-${id}`}
  >
    <h3 className="ally-build__section-title" id={`build-${id}`}>
      {title}
      {marker && <span className="ally-build__tag">{marker}</span>}
    </h3>
    {children}
  </section>
);

/**
 * Direct mode: one scrolling form over the working copy. Before go-live each field applies as the
 * builder leaves it or pauses typing; after go-live it stages (the pending bar applies it). At $0
 * the safety-relevant fields are off with the contact-Ally line; name and greeting still work.
 */
export const DirectForm: React.FC<{
  copy: WorkingCopy;
  draftId: string;
  chatbotId: string | null;
  canEdit: boolean;
  /** Field versions right after a template applied: unchanged ones show "From template". */
  templateSnapshot: Record<string, string> | null;
  suggestions: SuggestionId[];
  addAddress: (address: string) => Promise<unknown>;
  addFiles: (files: File[]) => Promise<unknown>;
  /** Show the go-live section (the create screen; a live chatbot's Build keeps it off). */
  goLive: boolean;
}> = ({
  copy,
  draftId,
  chatbotId,
  canEdit,
  templateSnapshot,
  suggestions,
  addAddress,
  addFiles,
  goLive,
}) => {
  const credits = copy.creditsOut;
  const common = (name: string): Omit<FieldCommon, "label"> => {
    const off = !canEdit || (credits && SAFETY_RELEVANT.has(name));
    const version = copy.wc?.fields[name]?.version;
    const code = copy.applyState.notApplied[name];
    const conflict =
      (copy.applyState.status === "conflict" || copy.applyState.status === "failed") &&
      copy.applyState.field === name
        ? copy.applyState.reason
        : null;
    return {
      name,
      copy,
      disabled: off,
      disabledReason: credits && SAFETY_RELEVANT.has(name) ? BUILD_COPY.credits.field : null,
      fromTemplate: Boolean(
        templateSnapshot?.[name] && version === templateSnapshot[name] && !copy.field(name).dirty,
      ),
      applyReason: code === "credits_required" ? BUILD_COPY.credits.field : conflict,
    };
  };

  return (
    <div className="ally-build__form" role="form" aria-label={T.label} data-testid="direct-form">
      {suggestions.length > 0 && (
        <div className="ally-build__ideas" data-testid="form-suggestions">
          <p className="ally-field__label">{BUILD_COPY.suggestions.heading}</p>
          <ul>
            {suggestions.map(id => (
              <li key={id}>
                <button
                  type="button"
                  className="ally-link"
                  onClick={() => {
                    const field = SUGGESTION_FIELD[id];
                    if (field) focusField(field);
                    else document.getElementById("build-sources")?.scrollIntoView?.();
                  }}
                >
                  {BUILD_COPY.suggestions[id]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section id="sources" title={T.sections.sources}>
        <SourcesSection
          draftId={draftId}
          chatbotId={chatbotId}
          pending={copy.pending}
          creditsOut={credits}
          disabled={!canEdit}
          addAddress={addAddress}
          addFiles={addFiles}
          onCreditsOut={copy.markCreditsOut}
        />
      </Section>

      <Section id="identity" title={T.sections.identity}>
        <TextInput {...common("name")} label={T.name} hint={T.nameHint} maxLength={80} />
        <TextInput {...common("assistantName")} label={T.assistantName} maxLength={60} />
        <TextInput
          {...common("introduction")}
          label={T.greeting}
          hint={T.greetingHint}
          multiline
          maxLength={600}
        />
      </Section>

      <Section id="tone" title={T.sections.tone}>
        <ToneInput {...common("tone")} label={T.tone} />
      </Section>

      <Section id="instructions" title={T.sections.instructions}>
        <TextInput
          {...common("instructions")}
          label={T.instructions}
          hint={T.instructionsHint}
          multiline
        />
      </Section>

      <Section id="languages" title={T.sections.languages}>
        <LanguagesInput {...common("languages")} label={T.languages} />
      </Section>

      <Section id="questions" title={T.sections.questions}>
        <LinesInput {...common("suggestedQuestions")} label={T.questions} hint={T.questionsHint} />
      </Section>

      <Section id="decline" title={T.sections.decline}>
        <TextInput {...common("declineText")} label={T.decline} hint={T.declineHint} multiline />
      </Section>

      {goLive && (
        <Section id="golive" title={T.sections.goLive}>
          <GoLiveSection
            draftId={draftId}
            chatbotId={chatbotId}
            live={copy.live}
            disabled={!canEdit}
            onLive={() => void copy.refresh()}
            onCreditsOut={copy.markCreditsOut}
            field={common}
          />
        </Section>
      )}

      <Section id="access" title={T.sections.access}>
        <AccessSection chatbotId={chatbotId} canEdit={canEdit} />
      </Section>
    </div>
  );
};
