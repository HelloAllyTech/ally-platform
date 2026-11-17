import { describe, expect, it } from "vitest";

import { computeReadiness } from "../readinessChips";

const routes = {
  providersSpeech: "/s",
  providersModels: "/m",
  providersVoices: "/v",
  translations: "/t",
  glossary: (id: number) => `/g/${id}`,
};

const states = (chips: ReturnType<typeof computeReadiness>) =>
  Object.fromEntries(chips.map(c => [c.id, c.state]));

describe("computeReadiness", () => {
  it("flags a brand-new language as missing voices and UI text, defaults elsewhere", () => {
    const chips = computeReadiness({
      language: { id: 7, label: "Bengali", value: "bn", translationCode: "bn" },
      languageIdsWithVoices: new Set(),
      i18nLanguages: ["en", "hi"],
      routes,
    });
    expect(states(chips)).toEqual({
      speech: "default",
      model: "default",
      voices: "missing",
      uiText: "missing",
      glossary: "ok",
    });
    expect(chips.find(c => c.id === "glossary")?.to).toBe("/g/7");
  });

  it("reads a fully set-up language as ok", () => {
    const chips = computeReadiness({
      language: {
        id: 2,
        label: "Hindi",
        value: "hi",
        translationCode: "hi",
        sttConfigId: "s",
        llmModelId: "m",
      },
      languageIdsWithVoices: new Set([2]),
      i18nLanguages: ["en", "HI"],
      routes,
    });
    expect(Object.values(states(chips))).toEqual(["ok", "ok", "ok", "ok", "ok"]);
  });
});
