import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { ReplyLanguage } from '../engine/reply-language';
import { CRISIS_LINK, helpLine } from '../safety/crisis-copy';

export const SAFETY_TEXT_KINDS = [
  'crisis_help',
  'holding',
  'no_one_available',
  'no_answer',
  'blocked_notice',
] as const;
export type SafetyTextKind = (typeof SAFETY_TEXT_KINDS)[number];

export function curatedLanguageOf(
  language: string | null | undefined,
): ReplyLanguage | null {
  const tag = (language ?? '').trim().toLowerCase();
  if (tag === 'en' || tag.startsWith('en-')) return 'en';
  if (tag === 'hi-latn') return 'hi-latn';
  if (tag === 'hi' || tag === 'hi-in' || tag === 'hi-deva') return 'hi';
  return null;
}

export interface SafetyTranslation {
  id: string;
  chatbotId: string | null;
  language: string;
  kind: SafetyTextKind;
  text: string;
  reviewed: boolean;
}

/**
 * Reviewed translations of the fixed safety texts, per language (D5, stage 5). Only a text marked
 * reviewed is ever used for a crisis reply; an unreviewed one is stored for review and ignored.
 * English, Hindi and Hindi in Latin script use the curated texts in `crisis-copy.ts` always. A
 * chatbot's own translation wins over the platform's (chatbot_id NULL).
 */
@Injectable()
export class SafetyTranslationsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async upsert(input: {
    chatbotId: string | null;
    language: string;
    kind: SafetyTextKind;
    text: string;
  }): Promise<SafetyTranslation> {
    if (!(SAFETY_TEXT_KINDS as readonly string[]).includes(input.kind)) {
      throw new BadRequestException(
        `kind is one of ${SAFETY_TEXT_KINDS.join(', ')}`,
      );
    }
    if (curatedLanguageOf(input.language)) {
      throw new BadRequestException(
        'English and Hindi use the curated texts, which cannot be replaced.',
      );
    }
    if (input.kind === 'crisis_help' && !input.text.includes('{link}')) {
      throw new BadRequestException(
        'The crisis text must keep the {link} placeholder for the helpline link.',
      );
    }
    // A changed text needs reviewing again.
    const [row] = (await this.dataSource.query(
      `INSERT INTO safety_translations (chatbot_id, language, kind, text, reviewed)
       VALUES ($1, lower($2), $3, $4, false)
       ON CONFLICT (COALESCE(chatbot_id, '00000000-0000-0000-0000-000000000000'::uuid), language, kind)
       DO UPDATE SET text = EXCLUDED.text,
                     reviewed = safety_translations.reviewed AND safety_translations.text = EXCLUDED.text,
                     "updatedAt" = now()
       RETURNING id, chatbot_id, language, kind, text, reviewed`,
      [input.chatbotId, input.language.trim(), input.kind, input.text.trim()],
    )) as Record<string, unknown>[];
    return this.view(row);
  }

  async markReviewed(id: string, userId: number | null): Promise<void> {
    await this.dataSource.query(
      `UPDATE safety_translations SET reviewed = true, reviewed_by = $2, reviewed_at = now(), "updatedAt" = now() WHERE id = $1`,
      [id, userId],
    );
  }

  /** The reviewed text for a language, the chatbot's own first. Null when none is reviewed. */
  async reviewedText(
    chatbotId: string | null,
    language: string,
    kind: SafetyTextKind,
  ): Promise<string | null> {
    const rows = (await this.dataSource.query(
      `SELECT text FROM safety_translations
        WHERE language = lower($2) AND kind = $3 AND reviewed = true
          AND (chatbot_id = $1 OR chatbot_id IS NULL)
        ORDER BY chatbot_id NULLS LAST LIMIT 1`,
      [chatbotId, language.trim(), kind],
    )) as { text: string }[];
    return rows[0]?.text ?? null;
  }

  /**
   * The crisis help line for a reply in `language`: the curated text for English and Hindi; a
   * reviewed translation for another language; otherwise the English curated text (an unreviewed
   * translation is never used for a crisis reply).
   */
  async crisisHelpFor(
    chatbotId: string | null,
    language: string | null | undefined,
    helplineNumbers?: string | null,
  ): Promise<{ text: string; language: string; reviewed: boolean }> {
    const curated = curatedLanguageOf(language);
    if (curated) {
      return {
        text: helpLine(curated, helplineNumbers),
        language: curated,
        reviewed: true,
      };
    }
    const stored = language
      ? await this.reviewedText(chatbotId, language, 'crisis_help')
      : null;
    if (stored) {
      const numbers = helplineNumbers?.trim();
      return {
        text: stored
          .replace('{numbers}', numbers ?? '')
          .replace('{link}', CRISIS_LINK)
          .replace(/\s{2,}/g, ' ')
          .trim(),
        language: language!.trim().toLowerCase(),
        reviewed: true,
      };
    }
    return {
      text: helpLine('en', helplineNumbers),
      language: 'en',
      reviewed: true,
    };
  }

  async list(chatbotId: string | null): Promise<SafetyTranslation[]> {
    const rows = (await this.dataSource.query(
      `SELECT id, chatbot_id, language, kind, text, reviewed FROM safety_translations
        WHERE chatbot_id IS NOT DISTINCT FROM $1 ORDER BY language, kind`,
      [chatbotId],
    )) as Record<string, unknown>[];
    return rows.map((r) => this.view(r));
  }

  private view(r: Record<string, unknown>): SafetyTranslation {
    return {
      id: String(r.id),
      chatbotId: (r.chatbot_id as string | null) ?? null,
      language: String(r.language),
      kind: r.kind as SafetyTextKind,
      text: String(r.text),
      reviewed: Boolean(r.reviewed),
    };
  }
}
