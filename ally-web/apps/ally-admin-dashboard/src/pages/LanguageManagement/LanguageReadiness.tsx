import React, { useMemo } from "react";

import { Link } from "react-router-dom";

import { useGetAvailableLanguageVoicesQuery, useGetI18nStatusQuery } from "@api";
import { ROUTES } from "@constants";
import { ScenarioLanguage } from "@types";

import { computeReadiness, ReadinessState } from "./readinessChips";

const STATE_CLASS: Record<ReadinessState, string> = {
  ok: "bg-green-50 text-green-800 border-green-200",
  default: "bg-neutral-50 text-typography-700 border-neutral-200",
  missing: "bg-amber-50 text-amber-800 border-amber-300",
};

const STATE_PREFIX: Record<ReadinessState, string> = { ok: "✓", default: "·", missing: "!" };

const ROUTE_SET = {
  providersSpeech: `${ROUTES.MANAGE_STT_CONFIGS}?tab=speech`,
  providersModels: `${ROUTES.MANAGE_LLM_MODEL_CATALOG}?tab=models`,
  providersVoices: `${ROUTES.MANAGE_SCENARIO_VOICES}?tab=voices`,
  translations: ROUTES.MANAGE_TRANSLATIONS,
  glossary: (id: number) => ROUTES.MANAGE_LANGUAGE_GLOSSARY(id),
};

/**
 * One row of chips per active language: what is still missing before the
 * language is fully usable, each chip linking to the screen that fixes it.
 */
export const LanguageReadiness: React.FC<{ languages: ScenarioLanguage[] }> = ({ languages }) => {
  const { data: withVoices = [] } = useGetAvailableLanguageVoicesQuery({
    active: true,
    voicesNeeded: true,
  });
  const { data: i18nStatus } = useGetI18nStatusQuery();

  const voiceIds = useMemo(
    () => new Set(withVoices.map(l => l.id).filter((id): id is number => id != null)),
    [withVoices],
  );
  const active = languages.filter(l => l.active !== false && l.id != null);
  if (active.length === 0) return null;

  return (
    <details className="mb-4 max-w-[100ch] text-sm" open data-testid="language-readiness">
      <summary className="cursor-pointer select-none font-medium text-typography-900">
        Readiness
      </summary>
      <p className="py-1 text-typography-600">
        Adding a language touches four screens. <span aria-hidden>!</span> means something is
        missing; “·” means the platform default is used. Click a chip to fix it.
      </p>
      <ul className="flex flex-col gap-1">
        {active.map(language => (
          <li key={language.id} className="flex flex-wrap items-center gap-2">
            <span className="w-32 truncate font-medium">{language.label}</span>
            {computeReadiness({
              language,
              languageIdsWithVoices: voiceIds,
              i18nLanguages: i18nStatus?.languages ?? [],
              routes: ROUTE_SET,
            }).map(chip => {
              const className = `rounded-full border px-2 py-0.5 text-xs ${STATE_CLASS[chip.state]}`;
              const text = `${STATE_PREFIX[chip.state]} ${chip.label}`;
              return chip.to ? (
                <Link key={chip.id} to={chip.to} title={chip.hint} className={className}>
                  {text}
                </Link>
              ) : (
                <span key={chip.id} title={chip.hint} className={className}>
                  {text}
                </span>
              );
            })}
          </li>
        ))}
      </ul>
    </details>
  );
};
