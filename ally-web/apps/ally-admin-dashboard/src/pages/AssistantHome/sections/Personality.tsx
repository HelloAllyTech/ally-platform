import React from "react";

import { Segmented } from "@components/v2";
import type { BotPageLanguage } from "@types";

import { TONES, toneOf } from "../../Onboarding/MakeItYours";
import { HOME } from "../copy";
import { Collapsed, Group, LinesField, SectionHead, TextField } from "../fields";
import { useHomeField } from "../useHomeField";
import { QuickReplies } from "./QuickReplies";

import type { SectionProps } from "./props";

const t = HOME.personality;
const LANGUAGES: { id: BotPageLanguage; label: string }[] = [
  { id: "en", label: t.languageOptions.en },
  { id: "hi", label: t.languageOptions.hi },
  { id: "auto", label: t.languageOptions.auto },
];

/**
 * How the assistant introduces itself and talks (chunk 20d): name, introduction, tone, languages,
 * suggested questions, quick replies, what it says when it doesn't know, and — collapsed — the
 * owner's extra instructions, which the safety rules always come before.
 */
export const PersonalitySection: React.FC<SectionProps> = ({ bot, home, canEdit }) => {
  const f = home.fields;
  const failed = HOME.saving.failed;
  const name = useHomeField(bot.id, "assistantName", f.assistantName, failed);
  const introduction = useHomeField(bot.id, "introduction", f.introduction, failed);
  const tone = useHomeField(bot.id, "tone", f.tone, failed);
  const language = useHomeField(bot.id, "language", f.language, failed);
  const suggested = useHomeField(bot.id, "suggestedQuestions", f.suggestedQuestions, failed);
  const decline = useHomeField(bot.id, "declineText", f.declineText, failed);
  const instructions = useHomeField(bot.id, "instructions", f.instructions, failed);
  const readOnly = !canEdit;

  return (
    <>
      <SectionHead
        title={HOME.sections.personality}
        subtitle={HOME.subtitles.personality}
        help={HOME.help.personality}
      />

      <Group testId="personality-voice">
        <TextField
          label={t.name}
          hint={t.nameHint}
          field={name}
          disabled={readOnly}
          maxLength={60}
        />
        <TextField
          label={t.introduction}
          hint={t.introductionHint}
          field={introduction}
          disabled={readOnly}
          multiline
          maxLength={600}
        />
        <div className="ally-field">
          <span className="ally-field__label">{t.tone}</span>
          {readOnly ? (
            <p className="ally-body">{TONES.find(x => x.id === toneOf(tone.value))?.label}</p>
          ) : (
            <Segmented
              label={t.tone}
              options={TONES.map(x => ({ id: x.id, label: x.label }))}
              value={toneOf(tone.value)}
              onChange={id => tone.set(TONES.find(x => x.id === id)!.value, { now: true })}
            />
          )}
          {tone.error && (
            <p className="ally-error" role="alert">
              {tone.error}
            </p>
          )}
        </div>
        <div className="ally-field">
          <span className="ally-field__label">{t.languages}</span>
          {readOnly ? (
            <p className="ally-body">{LANGUAGES.find(x => x.id === language.value)?.label}</p>
          ) : (
            <Segmented
              label={t.languages}
              options={LANGUAGES}
              value={language.value}
              onChange={id => language.set(id, { now: true })}
            />
          )}
          {language.error && (
            <p className="ally-error" role="alert">
              {language.error}
            </p>
          )}
        </div>
      </Group>

      <Group testId="personality-questions">
        <LinesField
          label={t.suggested}
          hint={t.suggestedHint}
          addLabel={t.addQuestion}
          removeLabel={HOME.safety.remove}
          field={suggested}
          max={4}
          maxLength={120}
          disabled={readOnly}
        />
      </Group>

      {bot.connectors.length > 0 && (
        <Group title={t.quickReplies} hint={t.quickRepliesHint} testId="personality-quick-replies">
          <QuickReplies botId={bot.id} canEdit={canEdit} />
        </Group>
      )}

      <Group testId="personality-decline">
        <TextField
          label={t.decline}
          hint={t.declineHint}
          field={decline}
          disabled={readOnly}
          multiline
          maxLength={500}
        />
        <Collapsed summary={t.instructions}>
          <TextField
            label={t.instructions}
            hint={t.instructionsHint}
            field={instructions}
            disabled={readOnly}
            multiline
            rows={8}
            maxLength={4000}
          />
        </Collapsed>
      </Group>
    </>
  );
};
