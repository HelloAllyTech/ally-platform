import React, { useState } from "react";

import { useBindConnectorMutation, useCheckWaNumberMutation } from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { WaBusinessNumberStatus } from "@types";
import type { Chatbot, WaBusinessNumber } from "@types";

import { ConnectWhatsAppFlow, useWaNumbers } from "../../WhatsAppBot/NumberTab";
import { HOME, fill } from "../copy";
import { when } from "../dates";
import { LoadFailed } from "./AccessLists";
import { InlineConfirm, ListError, ListRow, ListRows, ListSkeleton } from "../ui/List";
import { Sheet } from "../ui/Sheet";

const t = HOME.lists;

const NumberStatus: React.FC<{ number: WaBusinessNumber }> = ({ number }) =>
  number.status === WaBusinessNumberStatus.ERROR ? (
    <span className="ally-badge ally-badge--warn">{t.numbers.problem}</span>
  ) : number.status === WaBusinessNumberStatus.AWAITING_WEBHOOK ? (
    <span className="ally-badge ally-badge--muted">{t.numbers.waiting}</span>
  ) : (
    <span className="ally-badge ally-badge--good">{t.numbers.connected}</span>
  );

/**
 * The assistant's WhatsApp numbers (chunk 20d-2, Share → On WhatsApp): each with its status in a
 * word and when it last heard from someone; Check it, Stop using it here, and Connect. Connecting
 * is the existing step-by-step flow with Meta, opened in a sheet.
 */
export const WhatsAppNumbers: React.FC<{ bot: Chatbot; canManage: boolean }> = ({
  bot,
  canManage,
}) => {
  const { data: numbers = [], isLoading, isError, refetch } = useWaNumbers(bot.id);
  const [bind, { isLoading: moving }] = useBindConnectorMutation();
  const [check] = useCheckWaNumberMutation();
  const [connecting, setConnecting] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const runCheck = async (number: WaBusinessNumber) => {
    try {
      const result = await check({ id: number.id }).unwrap();
      setNotes(n => ({
        ...n,
        [number.id]: result.check.ok
          ? t.numbers.checkOk
          : (result.check.error ?? t.numbers.problem),
      }));
    } catch {
      setNotes(n => ({ ...n, [number.id]: t.numbers.problem }));
    }
  };

  const stop = async (number: WaBusinessNumber) => {
    if (!number.connectorId) return;
    try {
      await bind({ id: number.connectorId, chatbotId: null }).unwrap();
      setError(null);
    } catch {
      setError(HOME.saving.failed);
    } finally {
      setStopping(null);
    }
  };

  if (isLoading) return <ListSkeleton rows={1} />;
  if (isError) return <LoadFailed onRetry={() => void refetch()} />;
  return (
    <div className="ally-home__list-block" data-testid="whatsapp-numbers">
      <h4 className="ally-home__subhead">{HOME.share.numbers}</h4>
      {numbers.length ? (
        <ListRows label={HOME.share.numbers}>
          {numbers.map(number => {
            const name = number.displayPhoneNumber ?? number.phoneNumberId;
            return (
              <ListRow
                key={number.id}
                title={name}
                badge={<NumberStatus number={number} />}
                meta={[
                  number.verifiedName,
                  number.lastInboundAt
                    ? fill(t.numbers.lastMessage, { when: when(number.lastInboundAt) })
                    : t.numbers.noMessages,
                  notes[number.id],
                ]
                  .filter(Boolean)
                  .join(" · ")}
                actions={
                  canManage &&
                  (stopping === number.id ? (
                    <InlineConfirm
                      question={fill(t.numbers.stopQuestion, { number: name })}
                      confirmLabel={t.numbers.stopConfirm}
                      cancelLabel={t.numbers.keep}
                      onConfirm={() => void stop(number)}
                      onCancel={() => setStopping(null)}
                    />
                  ) : (
                    <>
                      {number.status === WaBusinessNumberStatus.AWAITING_WEBHOOK ? (
                        <Button
                          variant={ButtonVariant.TERTIARY}
                          size="sm"
                          type="button"
                          onClick={() => setConnecting(true)}
                        >
                          {t.numbers.finish}
                        </Button>
                      ) : (
                        <Button
                          variant={ButtonVariant.TERTIARY}
                          size="sm"
                          type="button"
                          onClick={() => void runCheck(number)}
                        >
                          {t.numbers.check}
                        </Button>
                      )}
                      <Button
                        variant={ButtonVariant.TEXT}
                        size="sm"
                        type="button"
                        disabled={moving}
                        onClick={() => setStopping(number.id)}
                      >
                        {t.numbers.stop}
                      </Button>
                    </>
                  ))
                }
              />
            );
          })}
        </ListRows>
      ) : (
        <p className="ally-small">
          {t.numbers.empty} {!canManage && t.numbers.ownerOnly}
        </p>
      )}
      {canManage && (
        <div>
          <Button
            variant={ButtonVariant.TERTIARY}
            type="button"
            onClick={() => setConnecting(true)}
          >
            {t.numbers.connect}
          </Button>
        </div>
      )}
      <ListError error={error} />
      {connecting && (
        <Sheet label={t.numbers.connectTitle} onClose={() => setConnecting(false)}>
          <header className="ally-sheet__head">
            <h2 className="ally-heading">{t.numbers.connectTitle}</h2>
            <Button
              variant={ButtonVariant.TERTIARY}
              type="button"
              onClick={() => setConnecting(false)}
            >
              {t.documents.close}
            </Button>
          </header>
          {/* Meta's steps are still the classic flow, inside the v2 sheet (a redraw is a follow-up). */}
          <div className="ally-home__classic">
            <ConnectWhatsAppFlow chatbotId={bot.id} onClose={() => setConnecting(false)} />
          </div>
        </Sheet>
      )}
    </div>
  );
};
