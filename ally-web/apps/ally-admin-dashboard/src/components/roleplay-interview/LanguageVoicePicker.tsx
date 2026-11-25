import React from "react";

import { useGetAvailableLanguageVoicesQuery } from "@api";
import { en } from "@constants";
// By module, not the `@hooks` barrel: the barrel reaches `@store` at module load.
import { useVoicePreview } from "@hooks/useVoicePreview";

/** languageId → voiceId; "" = the agent picks a voice to match the client. */
export type LanguageVoiceChoice = Record<string, string>;

interface CatalogVoice {
  id: string;
  name: string;
  provider?: string;
  gender?: string | null;
}
interface CatalogLanguage {
  language_id: number;
  value: string;
  label: string;
  voices?: CatalogVoice[];
}

interface LanguageVoicePickerProps {
  value: LanguageVoiceChoice;
  onChange: (next: LanguageVoiceChoice) => void;
  disabled?: boolean;
}

/**
 * The roleplay's languages and the voice in each, chosen by the trainer: tick a language, then pick
 * a voice (with a sample to listen to) or leave it to the agent, which casts one to match the client.
 */
export const LanguageVoicePicker: React.FC<LanguageVoicePickerProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const strings = en.roleplayInterview.voices;
  const { data } = useGetAvailableLanguageVoicesQuery({ active: true, voicesNeeded: true });
  const catalog = (Array.isArray(data) ? data : []) as CatalogLanguage[];
  const { playingVoiceId, isLoading, play, pause } = useVoicePreview();

  const toggle = (id: string) => {
    const next = { ...value };
    if (id in next) delete next[id];
    else next[id] = "";
    onChange(next);
  };

  return (
    <section className="flex flex-col gap-2 text-sm" data-testid="language-voice-picker">
      <div>
        <h4 className="font-medium text-typography-900">{strings.title}</h4>
        <p className="text-xs text-typography-600">{strings.help}</p>
      </div>
      <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 [&>*]:min-w-0">
        {catalog.map(language => {
          const id = String(language.language_id);
          const checked = id in value;
          const voiceId = value[id] ?? "";
          const playing = playingVoiceId === voiceId && Boolean(voiceId);
          return (
            <div
              key={id}
              // A card is a column: the language, then its voice row. A select is as wide as its
              // longest option, so it is held to the card's width or it spills into the next card.
              className={`flex min-w-0 flex-col gap-2 rounded border px-3 py-2 ${
                checked ? "border-primary bg-primary-50" : "border-border-light"
              }`}
            >
              <label className="flex cursor-pointer items-center gap-2 text-typography-900">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(id)}
                  className="accent-primary"
                />
                {language.label}
              </label>
              {checked && (
                <div className="flex min-w-0 items-center gap-2">
                  <select
                    aria-label={strings.voiceFor(language.label)}
                    value={voiceId}
                    disabled={disabled}
                    onChange={event => onChange({ ...value, [id]: event.target.value })}
                    className="w-full min-w-0 flex-1 truncate rounded border border-border-light bg-white px-2 py-1 text-xs"
                  >
                    <option value="">{strings.agentPicks}</option>
                    {(language.voices ?? []).map(voice => (
                      <option key={voice.id} value={voice.id}>
                        {[voice.name, voice.gender, voice.provider?.toLowerCase()]
                          .filter(Boolean)
                          .join(" · ")}
                      </option>
                    ))}
                  </select>
                  {voiceId && (
                    <button
                      type="button"
                      onClick={() => (playing ? pause() : void play(voiceId))}
                      className="shrink-0 rounded border border-border-light bg-white px-2 py-1 text-xs text-primary-700 hover:bg-primary-50"
                    >
                      {playing && isLoading
                        ? strings.loading
                        : playing
                          ? strings.stop
                          : strings.play}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
