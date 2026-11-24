import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { ListConsentService } from '../agent-tools/list-consent.service';
import { questionIn, type OfferCard } from '../agent-tools/list-consent';
import { isPreviewConversation } from '../agent-tools/list-tools.service';
import { abilityFor, parseListToolName } from '../agent-tools/list-tools';
import { ListFieldType } from '../enum/list.enum';
import { ToolRunStatus } from '../entity/tool-run.entity';
import { relationTarget, selectValues } from '../lists/list-fields';
import { ListDefinitionsService } from '../lists/list-definitions.service';
import type { ListDefinitionView } from '../lists/list-definitions.service';
import type { ReplyLanguage } from '../engine/reply-language';
import type { ChatbotSettingsOverride } from '../type/chatbot.type';
import { BUTTONS, TAPPED, TEST_ONLY, fillCopy } from './action-copy';
import {
  ActionTokenService,
  type ActionClaims,
  type ActionKind,
} from './action-token.service';

/** One tappable thing (BT1): a chip, a card's button, a quick reply. */
export interface TapButton {
  kind: ActionKind;
  label: string;
  token: string;
}

/** A card for one entry: an offer to confirm, or one entry of a reference list. */
export interface PartCard {
  list: string;
  title: string;
  details: { label: string; value: string }[];
}

/**
 * What a reply carries beside its text (BT1, UI1 §2), built in ally-be from this run's tool
 * results, never from the reply's words. Every button carries a signed, single-use token.
 */
export interface ReplyParts {
  /** Entries to pick from a list lookup: slots with their day and time, services, centres… */
  choices?: { list: string; options: TapButton[] };
  /** One entry of a list (a service, a way to give, the latest update). */
  entry?: PartCard;
  /** A write waiting for the person's yes: the card built from the dry-run entry, Confirm and Change. */
  offer?: {
    question: string;
    action: OfferCard['action'];
    card: PartCard;
    buttons: TapButton[];
    /** Try it: "Test only, not saved". */
    testOnly?: string;
  };
  /** On the done card: Cancel and Move, where the list allows them. */
  done?: { buttons: TapButton[]; testOnly?: string };
  /** Up to 3 starter questions after an answer, or the language choice. */
  suggestions?: TapButton[];
}

/** How many chips a lookup shows (BT1 §1); WhatsApp's list takes 10. */
export const MAX_CHOICES = 8;
export const MAX_SUGGESTIONS = 3;

interface ToolRunRow {
  tool: string;
  status: string;
  error_code: string | null;
  result: {
    list?: { key: string; name: string };
    passages?: { record_id?: string; record_title?: string; text?: string }[];
    preview?: boolean;
  } | null;
}

export interface PartsInput {
  chatbotId: string;
  conversationId: string;
  contactId: string | null;
  /** The agent run behind the reply; none for a fixed reply. */
  runId?: string | null;
  language: ReplyLanguage;
  /** No parts at all: a crisis, blocked, held or off reply. */
  suppressed: boolean;
  /** The reply answered a question (not a decline, a hand-over or a refusal). */
  answered: boolean;
  /** The page's starter questions, and what this chat has asked already. */
  starters?: string[];
  asked?: string[];
}

/**
 * Builds a reply's parts (BT1 §2). Reads only what this run's tools did:
 * - a write the gateway held for a yes (`needs_confirmation`): the stored offer's card, with
 *   Confirm and Change (Confirm and Keep it for a cancel);
 * - a write it made: Cancel and Move for the done card, where the list allows them;
 * - a lookup: chips for its entries, or one entry's card;
 * - otherwise, after an answer: up to 3 starter questions not asked yet.
 * A crisis, blocked or held reply never carries any.
 */
@Injectable()
export class ActionPartsService {
  private readonly logger = LoggerService.getInstance(ActionPartsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokens: ActionTokenService,
    private readonly definitions: ListDefinitionsService,
    @Optional() private readonly consent?: ListConsentService,
  ) {}

  async partsFor(input: PartsInput): Promise<ReplyParts> {
    if (input.suppressed) return {};
    try {
      const rows = input.runId ? await this.toolRuns(input.runId) : [];
      const last = rows[rows.length - 1];
      const testOnly = isPreviewConversation(input.conversationId)
        ? TEST_ONLY[input.language]
        : undefined;
      if (last && last.error_code === 'needs_confirmation') {
        const offer = await this.offerPart(input, testOnly);
        if (offer) return { offer };
      }
      const wrote = [...rows]
        .reverse()
        .find(
          (r) =>
            r.status === ToolRunStatus.OK &&
            /^(create|update)_/.test(r.tool) &&
            r.result?.passages?.[0]?.record_id,
        );
      if (wrote && wrote === last) {
        const done = await this.donePart(input, wrote, testOnly);
        return done ? { done } : {};
      }
      // A lookup, or a write refused with the free entries it found (BT1: "That time was just
      // taken"): chips for them.
      if (
        last &&
        ((last.status === ToolRunStatus.OK && last.tool.startsWith('find_')) ||
          (last.status === ToolRunStatus.ERROR &&
            last.error_code !== 'needs_confirmation' &&
            (last.result?.passages?.length ?? 0) > 0))
      ) {
        const found = await this.foundPart(input, last);
        if (found) return found;
      }
      if (input.answered) {
        const suggestions = await this.suggestions(input);
        if (suggestions.length) return { suggestions };
      }
      return {};
    } catch (error) {
      // Parts are extra: a failure leaves the reply as it was.
      this.logger.warn(
        `Could not build reply parts: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return {};
    }
  }

  private async toolRuns(runId: string): Promise<ToolRunRow[]> {
    return (await this.dataSource.query(
      `SELECT tool, status, error_code, result FROM tool_runs
        WHERE run_id = $1 ORDER BY step`,
      [runId],
    )) as ToolRunRow[];
  }

  private claims(
    input: PartsInput,
    rest: Pick<ActionClaims, 'kind' | 'text'> & Partial<ActionClaims>,
  ): ActionClaims {
    return {
      chatbotId: input.chatbotId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      ...rest,
    };
  }

  private async button(
    input: PartsInput,
    label: string,
    claims: Pick<ActionClaims, 'kind' | 'text'> & Partial<ActionClaims>,
  ): Promise<TapButton | null> {
    const token = await this.tokens.issue(this.claims(input, claims));
    return token ? { kind: claims.kind, label, token } : null;
  }

  /** The stored offer this run made: its card, Confirm and Change (or Keep it). */
  private async offerPart(
    input: PartsInput,
    testOnly: string | undefined,
  ): Promise<ReplyParts['offer'] | null> {
    const offer = await this.consent?.current(
      input.chatbotId,
      input.conversationId,
    );
    if (!offer?.card || !offer.input || offer.runId !== input.runId) {
      return null;
    }
    const words = BUTTONS[input.language];
    const tapped = TAPPED[input.language];
    const confirm = await this.button(input, words.confirm, {
      kind: 'confirm',
      text: fillCopy(tapped.confirmed, { title: offer.card.title }),
      offer,
    });
    if (!confirm) return null;
    const second =
      offer.card.action === 'cancel'
        ? await this.button(input, words.keep, {
            kind: 'keep',
            text: tapped.keep,
          })
        : await this.button(input, words.change, {
            kind: 'change',
            text: tapped.change,
          });
    return {
      question: questionIn(offer.questions, input.language),
      action: offer.card.action,
      card: {
        list: offer.card.list,
        title: offer.card.title,
        details: offer.card.details,
      },
      buttons: [confirm, ...(second ? [second] : [])],
      ...(testOnly ? { testOnly } : {}),
    };
  }

  /** Cancel and Move on the done card, where the person may change the entry. */
  private async donePart(
    input: PartsInput,
    wrote: ToolRunRow,
    testOnly: string | undefined,
  ): Promise<ReplyParts['done'] | null> {
    const parsed = parseListToolName(wrote.tool);
    const passage = wrote.result?.passages?.[0];
    if (!parsed || !passage?.record_id) return null;
    // Try it's entries were never saved: nothing to cancel or move.
    if (testOnly) return { buttons: [], testOnly };
    const list = await this.definitions
      .getList(input.chatbotId, parsed.key)
      .catch(() => null);
    if (!list) return null;
    const stored = await this.storedSettings(input.chatbotId);
    if (abilityFor(stored, `update_${list.key}`) !== 'do_it') return null;
    const title = passage.record_title ?? '';
    // A cancelled entry gets no Cancel or Move.
    if (/cancel|withdraw/i.test(passage.text ?? '')) return null;
    const words = BUTTONS[input.language];
    const tapped = TAPPED[input.language];
    const values = { list: list.name.toLowerCase(), title };
    const buttons: TapButton[] = [];
    if (cancellable(list)) {
      const b = await this.button(input, words.cancel, {
        kind: 'cancel',
        text: fillCopy(tapped.cancel, values),
        entryId: passage.record_id,
      });
      if (b) buttons.push(b);
    }
    if (movable(list)) {
      const b = await this.button(input, words.move, {
        kind: 'move',
        text: fillCopy(tapped.move, values),
        entryId: passage.record_id,
      });
      if (b) buttons.push(b);
    }
    return buttons.length ? { buttons } : null;
  }

  /** A lookup's entries as chips, or one entry's card. */
  private async foundPart(
    input: PartsInput,
    row: ToolRunRow,
  ): Promise<ReplyParts | null> {
    const passages = (row.result?.passages ?? []).filter(
      (p) => p.record_id && p.record_title,
    );
    const listName = row.result?.list?.name ?? '';
    if (passages.length === 1) {
      return { entry: entryCard(listName, passages[0]) };
    }
    if (passages.length < 2) return null;
    // Every chip names its day and time, never only the entry's name (BT1: four identical
    // "Saturday kitchen shift" options); the name too only when the options' names differ.
    const shown = passages.slice(0, MAX_CHOICES).map((p) => {
      const title = p.record_title!;
      const when = DATED.test(title) ? title : dateIn(p.text);
      return { p, title, when, where: detailOf(p.text, PLACE) };
    });
    const oneName = new Set(shown.map((x) => x.title)).size === 1;
    const options: TapButton[] = [];
    for (const { p, title, when, where } of shown) {
      const label = !when
        ? title
        : when === title || oneName
          ? shortWhen(when)
          : `${title} · ${shortWhen(when)}`;
      // What the tap stands for: the entry's name, its day and time, and its place.
      const text = [title, when, where]
        .filter(
          (x, i): x is string => Boolean(x) && (i === 0 || !title.includes(x!)),
        )
        .join(', ');
      const b = await this.button(input, label, {
        kind: 'choose',
        text,
        entryId: p.record_id,
      });
      if (b) options.push(b);
    }
    return options.length ? { choices: { list: listName, options } } : null;
  }

  /** Up to 3 of the page's starter questions this chat hasn't asked. */
  private async suggestions(input: PartsInput): Promise<TapButton[]> {
    const asked = new Set((input.asked ?? []).map(norm));
    const out: TapButton[] = [];
    for (const q of input.starters ?? []) {
      if (out.length >= MAX_SUGGESTIONS) break;
      if (!q.trim() || asked.has(norm(q))) continue;
      const b = await this.button(input, q, { kind: 'ask', text: q });
      if (b) out.push(b);
    }
    return out;
  }

  private async storedSettings(
    chatbotId: string,
  ): Promise<ChatbotSettingsOverride | null> {
    const [row] = (await this.dataSource.query(
      `SELECT settings FROM chatbots WHERE id = $1`,
      [chatbotId],
    )) as { settings: ChatbotSettingsOverride | null }[];
    return row?.settings ?? null;
  }
}

const PLACE = /venue|location|place|address|where|centre|center|branch|hub/i;

/** A day and time as the lists display them: "Sun 29 Nov 2026, 10:00". */
const DATED = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+\d{1,2}\s+\w{3}/;

/** The first detail in a passage that is a day and time. */
function dateIn(text: string | undefined): string | undefined {
  for (const line of (text ?? '').split('\n')) {
    const at = line.indexOf(': ');
    if (at > 0 && DATED.test(line.slice(at + 2)))
      return line.slice(at + 2).trim();
  }
  return undefined;
}

/** "Sun 29 Nov 2026, 10:00" → "Sun 29 Nov · 10:00" (the year goes; the page's own short form). */
export function shortWhen(when: string): string {
  return when
    .replace(/\s+\d{4},?\s*/, ' · ')
    .replace(/\s+·\s+$/, '')
    .trim();
}

const norm = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** A detail from a passage's "Label: value" lines, by its label. */
function detailOf(text: string | undefined, label: RegExp): string | undefined {
  for (const line of (text ?? '').split('\n')) {
    const at = line.indexOf(': ');
    if (at > 0 && label.test(line.slice(0, at))) {
      return line.slice(at + 2).trim() || undefined;
    }
  }
  return undefined;
}

/** One entry as a card: its title and up to four of its details (never its id). */
export function entryCard(
  list: string,
  passage: { record_title?: string; text?: string },
): PartCard {
  const details = (passage.text ?? '')
    .split('\n')
    .map((line) => {
      const at = line.indexOf(': ');
      return at > 0
        ? { label: line.slice(0, at), value: line.slice(at + 2).trim() }
        : null;
    })
    .filter(
      (d): d is { label: string; value: string } =>
        Boolean(d) &&
        d!.label !== 'id' &&
        d!.value !== '' &&
        d!.value !== passage.record_title,
    )
    .slice(0, 4);
  return { list, title: passage.record_title ?? '', details };
}

/** A list whose entries end by a status ("cancelled"): Cancel goes through an update. */
function cancellable(list: ListDefinitionView): boolean {
  return list.fields.some(
    (f) =>
      !f.archived_at &&
      (f.type === ListFieldType.SELECT || f.type === ListFieldType.TEXT) &&
      /status/i.test(`${f.key} ${f.label}`) &&
      selectValues(f).some((v) => /cancel|withdraw/i.test(String(v))),
  );
}

/** A list whose entries point at a dated entry (a slot, a shift): Move picks another one. */
function movable(list: ListDefinitionView): boolean {
  return list.fields.some(
    (f) =>
      !f.archived_at &&
      f.type === ListFieldType.RELATION &&
      relationTarget(f) !== 'contact',
  );
}
