import { FORM_FIELD_IDS } from "../constants/SimulationCreator";
import type { CharacterData } from "../types/simulation";
import { asList } from "./characterData";

/**
 * Putting a Character Library character on the roleplay form, shared by the editor's character
 * picker (CharacterProfileSelector) and the Agent Builder wizard, so both fill exactly the same
 * fields the same way.
 */

/** The character's scalar fields, by form field id (the picker also compares these). */
export const CHARACTER_FORM_FIELD_IDS = {
  NAME: "name",
  AGE: "age",
  GENDER: "gender",
  PROFESSION: "profession",
  CURRENT_LOCATION: "currentLocation",
  GENDER_IDENTITY: "genderIdentity",
  SEXUAL_ORIENTATION: "sexualOrientation",
  COVER_IMAGE_URL: "coverImageUrl",
  COVER_VIDEO_URL: "coverVideoUrl",
  CHARACTER_PROFILE_TEXT: "characterProfileText",
};

export const CHARACTER_MEDIA_FIELD_IDS = [
  CHARACTER_FORM_FIELD_IDS.COVER_IMAGE_URL,
  CHARACTER_FORM_FIELD_IDS.COVER_VIDEO_URL,
];

/** The form field holding the picked character's id (the picker's own field). */
export const CHARACTER_SELECTOR_FIELD_ID = "characterProfileSelector";

interface FormLike {
  getValues: (field?: any) => any;
  setValue: (field: any, value: any, options?: Record<string, boolean>) => void;
}

/**
 * Voice, language characteristics and linguistic style samples are keyed by language on BOTH
 * sides, so they merge across every language the character speaks rather than only English.
 * Merging, not replacing: a trainer may have already filled languages this character says
 * nothing about, and picking a character should not wipe them. Knowledge sources are reshaped:
 * the simulation stores {id, title, content} rows where the character has {id, title, text}.
 */
export const applyCharacterComplexFields = (form: FormLike, character: CharacterData): void => {
  const mergeByLanguage = <T>(field: string, incoming?: Record<string, T>) => {
    const entries = Object.entries(incoming ?? {}).filter(
      ([languageId, value]) =>
        /^\d+$/.test(languageId) && value !== undefined && value !== null && value !== "",
    );
    if (entries.length === 0) return;
    const current = (form.getValues(field) ?? {}) as Record<string, T>;
    form.setValue(
      field,
      { ...current, ...Object.fromEntries(entries) },
      { shouldDirty: true, shouldTouch: true },
    );
  };

  mergeByLanguage(FORM_FIELD_IDS.LANGUAGES_VOICES, character.voices);
  mergeByLanguage("languageCharacteristics", character.languageCharacteristics);
  mergeByLanguage(FORM_FIELD_IDS.LINGUISTIC_STYLE_SAMPLES, character.linguisticStyleSamples);

  // `?.length` alone lets a non-empty string through and `.map` then throws, taking the whole
  // page down on character select — see asList.
  const knowledgeSources = asList(character.knowledgeSources);
  if (knowledgeSources.length) {
    const rows = knowledgeSources.map(source => ({
      id: source.id,
      title: source.title,
      content: source.text ?? "",
    }));
    form.setValue(FORM_FIELD_IDS.KNOWLEDGE_SOURCE, rows, { shouldDirty: true, shouldTouch: true });
  }
};

/**
 * The character's scalar fields onto the form. Media fields are only written when the character
 * has one, so a simulation's own cover stays as the fallback.
 */
export const applyCharacterScalarFields = (form: FormLike, character: CharacterData): void => {
  Object.values(CHARACTER_FORM_FIELD_IDS).forEach(fieldId => {
    const value = character[fieldId as keyof CharacterData];
    if (CHARACTER_MEDIA_FIELD_IDS.includes(fieldId) && !value) return;
    // Never set null or undefined: an empty string is the form's "no value".
    form.setValue(fieldId, value ?? "", {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    });
  });
};

/** Everything a picked character fills, plus the picker's own field so it shows the character. */
export const applyCharacterToForm = (form: FormLike, character: CharacterData): void => {
  if (character.id) form.setValue(CHARACTER_SELECTOR_FIELD_ID, character.id);
  applyCharacterScalarFields(form, character);
  applyCharacterComplexFields(form, character);
};
