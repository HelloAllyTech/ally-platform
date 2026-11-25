import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  GENDER_IDENTITY_VALUES,
  GENDER_VALUES,
  SEXUAL_ORIENTATION_VALUES,
} from 'src/scenario-character/constants/character-demographics.constants';
import { ScenarioCharacterRequestDto } from 'src/scenario-character/dto/scenario-character.dto';
import { ScenarioCharacterService } from 'src/scenario-character/service/scenario-character.service';
import { RoleplayInterviewSession } from '../../entity/roleplay-interview-session.entity';

/** The gender identity a gender implies when the roleplay records none. */
const IDENTITY_FOR_GENDER: Record<string, string> = {
  male: 'Male/Man',
  female: 'Female/Woman',
  'non-binary': 'Nonbinary',
};

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const option = (value: unknown, options: readonly string[]): string => {
  const wanted = text(value, 200).toLowerCase();
  return options.find((o) => o.toLowerCase() === wanted) ?? '';
};

/** Per-language maps as the library stores them: language-id keys, non-empty values. */
const byLanguage = <T>(value: unknown): Record<string, T> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const entries = Object.entries(value as Record<string, T>).filter(
    ([languageId, v]) =>
      /^\d+$/.test(languageId) && v !== null && v !== undefined && v !== '',
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
};

/**
 * A character the roleplay agent wrote goes into the Character Library, so the next roleplay
 * can reuse it instead of writing a duplicate. It is copied from the roleplay form once the
 * roleplay is generated (the generated persona and backstory and the cast voices, not the
 * plan's shorter character sheet), and copied again over the same library row whenever the
 * trainer changes the character afterwards ("make him a girl"), so the two stay the same.
 *
 * Never for a roleplay played by a library character already.
 */
@Injectable()
export class RoleplayInterviewCharacterService {
  private readonly logger = LoggerService.getInstance(
    RoleplayInterviewCharacterService.name,
  );

  constructor(private readonly characterService: ScenarioCharacterService) {}

  /**
   * The library character, made or brought up to date from the form's values; null when none
   * is owed (a library character plays the client) or the values lack a name, age or gender.
   */
  async saveCharacter(
    session: RoleplayInterviewSession,
    values: Record<string, unknown>,
  ): Promise<{ id: string; name: string } | null> {
    if (session.brief?.client?.characterId) return null;
    const dto = libraryCharacterFrom(values);
    if (!dto) return null;
    const saved = session.brief?.savedCharacter;
    if (saved) {
      try {
        const updated = await this.characterService.updateScenarioCharacter(
          saved.id,
          dto,
        );
        return { id: updated.id, name: updated.name };
      } catch (error) {
        // Deleted from the library since, or no longer editable: a fresh one replaces it.
        this.logger.warn(
          `[ROLEPLAY_INTERVIEW] library character ${saved.id} of session ${session.id} could not be updated (${
            error instanceof Error ? error.message : String(error)
          }); adding it again`,
        );
      }
    }
    const created = await this.characterService.createScenarioCharacter(dto);
    return { id: created.id, name: created.name };
  }
}

/**
 * The library character in the roleplay form's values, or null when they lack what a character
 * needs (a name, an age, a gender). Values the library's dropdowns do not know are left empty
 * rather than guessed, except the gender identity, which follows from the gender.
 */
export function libraryCharacterFrom(
  values: Record<string, unknown>,
): ScenarioCharacterRequestDto | null {
  const m: Record<string, any> = values ?? {};
  const name = text(m.name, 200);
  const age = Number(m.age);
  const gender = option(m.gender, GENDER_VALUES);
  if (!name || !Number.isFinite(age) || age < 1 || age > 150 || !gender) {
    return null;
  }
  const knowledgeSources = Array.isArray(m.knowledgeSources)
    ? m.knowledgeSources
        .filter((s: any) => s && (s.title || s.content || s.text))
        .map((s: any, index: number) => ({
          id: String(s.id ?? `source-${index + 1}`),
          title: text(s.title, 200),
          text: String(s.content ?? s.text ?? ''),
        }))
    : [];
  return {
    name,
    age: Math.round(age),
    gender,
    profession: text(m.profession, 200),
    currentLocation: text(m.currentLocation, 300),
    genderIdentity:
      option(m.genderIdentity, GENDER_IDENTITY_VALUES) ||
      IDENTITY_FOR_GENDER[gender] ||
      '',
    sexualOrientation: option(m.sexualOrientation, SEXUAL_ORIENTATION_VALUES),
    ...(text(m.characterProfileText, 2500)
      ? { characterProfileText: text(m.characterProfileText, 2500) }
      : {}),
    ...(text(m.coverImageUrl, 2000)
      ? { coverImageUrl: text(m.coverImageUrl, 2000) }
      : {}),
    ...(text(m.coverVideoUrl, 2000)
      ? { coverVideoUrl: text(m.coverVideoUrl, 2000) }
      : {}),
    ...(byLanguage<string>(m.languageVoices)
      ? { voices: byLanguage<string>(m.languageVoices) }
      : {}),
    ...(byLanguage<string>(m.languageCharacteristics)
      ? {
          languageCharacteristics: byLanguage<string>(
            m.languageCharacteristics,
          ),
        }
      : {}),
    ...(byLanguage<string[]>(m.linguisticStyleSamples)
      ? {
          linguisticStyleSamples: byLanguage<string[]>(
            m.linguisticStyleSamples,
          ),
        }
      : {}),
    ...(knowledgeSources.length ? { knowledgeSources } : {}),
  } as ScenarioCharacterRequestDto;
}
