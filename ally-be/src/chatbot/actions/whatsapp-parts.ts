import {
  WHATSAPP_INTERACTIVE_LIMITS as L,
  whatsappInteractiveFits,
  type WhatsAppInteractive,
} from '../../whatsapp/type/whatsapp-provider.interface';
import type { ReplyLanguage } from '../engine/reply-language';
import { WHATSAPP } from './action-copy';
import type { PartCard, ReplyParts, TapButton } from './action-parts.service';

/**
 * A reply's parts on WhatsApp (BT1 §3): chips become a list message (up to 10 rows), a card's
 * buttons become reply buttons (up to 3), and a card's details are text. Alongside, the same
 * choices as numbered text ("Reply with a number:"), sent when the interactive message can't be:
 * outside the 24-hour window, beyond Meta's limits, or when its send fails. A typed number then
 * counts as the tap.
 */
export interface WhatsAppReply {
  /** The reply's text with any card's details. */
  text: string;
  interactive: WhatsAppInteractive | null;
  /** The numbered fallback, and the token each number stands for. */
  numbered: { text: string; tokens: string[] } | null;
}

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** A card as WhatsApp text: its title in bold, then "Label: value" lines. */
export function cardText(card: PartCard): string {
  return [
    `*${card.title}*`,
    ...card.details.map((d) => `${d.label}: ${d.value}`),
  ].join('\n');
}

export function whatsappReplyFor(
  body: string,
  parts: ReplyParts | null | undefined,
  language: ReplyLanguage,
): WhatsAppReply {
  const copy = WHATSAPP[language];
  const card = parts?.offer?.card ?? parts?.entry;
  const text = card ? `${body.trim()}\n\n${cardText(card)}` : body;
  const taps: TapButton[] =
    parts?.offer?.buttons ??
    (parts?.done?.buttons.length ? parts.done.buttons : undefined) ??
    parts?.choices?.options ??
    parts?.suggestions ??
    [];
  if (!taps.length) return { text, interactive: null, numbered: null };

  const listed = taps.slice(0, L.rows);
  const numbered = {
    text: `${text.trim()}\n\n${copy.replyWithNumber}\n${listed
      .map((t, i) => `${i + 1}. ${t.label}`)
      .join('\n')}`,
    tokens: listed.map((t) => t.token),
  };

  // Buttons for a card (Confirm / Change, Cancel / Move) and for up to 3 short choices.
  const asButtons =
    listed.length <= L.buttons &&
    (Boolean(parts?.offer || parts?.done) ||
      listed.every((t) => t.label.length <= L.buttonTitle));
  const interactive: WhatsAppInteractive = asButtons
    ? {
        type: 'button',
        body: text,
        buttons: listed.map((t) => ({
          id: t.token,
          title: clip(t.label, L.buttonTitle),
        })),
      }
    : {
        type: 'list',
        body: text,
        button: clip(copy.listButton, L.listButton),
        sections: [
          {
            title: clip(parts?.choices?.list || copy.section, L.sectionTitle),
            rows: listed.map((t) => ({
              id: t.token,
              title: clip(t.label, L.rowTitle),
              // A long label (a starter question) keeps its words in the description.
              ...(t.label.length > L.rowTitle
                ? { description: clip(t.label, L.rowDescription) }
                : {}),
            })),
          },
        ],
      };
  return {
    text,
    interactive: whatsappInteractiveFits(interactive) ? interactive : null,
    numbered,
  };
}

/** The number a person typed (1 to 10), when the whole message is one. */
export function typedNumber(text: string): number | null {
  const match = /^\s*(\d{1,2})\s*\.?\s*$/.exec(text ?? '');
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= L.rows ? n : null;
}
