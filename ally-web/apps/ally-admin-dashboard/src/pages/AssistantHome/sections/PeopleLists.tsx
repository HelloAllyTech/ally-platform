import React, { useId, useState } from "react";

import { useBindConnectorMutation, useCheckWaNumberMutation } from "@api";
import { Button } from "@components/v2";
import { ChatbotMemberRole, WaBusinessNumberStatus } from "@types";
import type { Chatbot, HomeTeamMember, WaBusinessNumber } from "@types";

import { ConnectWhatsAppFlow, useWaNumbers } from "../../WhatsAppBot/NumberTab";
import { HOME, fill } from "../copy";
import { when } from "../dates";
import {
  AddRow,
  InlineConfirm,
  ListError,
  ListRow,
  ListRows,
  ListSkeleton,
  RemoveButton,
} from "../ui/List";
import { Sheet } from "../ui/Sheet";
import { useHomeList } from "../useHomeList";
import { LoadFailed } from "./AccessLists";

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
                        <Button className="ally-btn--sm" onClick={() => setConnecting(true)}>
                          {t.numbers.finish}
                        </Button>
                      ) : (
                        <Button className="ally-btn--sm" onClick={() => void runCheck(number)}>
                          {t.numbers.check}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        className="ally-btn--sm"
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
          <Button onClick={() => setConnecting(true)}>{t.numbers.connect}</Button>
        </div>
      )}
      <ListError error={error} />
      {connecting && (
        <Sheet label={t.numbers.connectTitle} onClose={() => setConnecting(false)}>
          <header className="ally-sheet__head">
            <h2 className="ally-heading">{t.numbers.connectTitle}</h2>
            <Button onClick={() => setConnecting(false)}>{t.documents.close}</Button>
          </header>
          {/* Meta's steps are the classic flow, unchanged (CL1 redraws it). */}
          <div className="ally-home__classic">
            <ConnectWhatsAppFlow chatbotId={bot.id} onClose={() => setConnecting(false)} />
          </div>
        </Sheet>
      )}
    </div>
  );
};

const ROLES: { id: ChatbotMemberRole; label: string }[] = [
  { id: ChatbotMemberRole.VIEWER, label: t.team.viewer },
  { id: ChatbotMemberRole.EDITOR, label: t.team.editor },
  { id: ChatbotMemberRole.OWNER, label: t.team.owner },
];

const RoleSelect: React.FC<{
  value: string;
  label: string;
  disabled?: boolean;
  onChange: (role: ChatbotMemberRole) => void;
}> = ({ value, label, disabled, onChange }) => (
  <select
    className="ally-input ally-input--compact"
    aria-label={label}
    value={value}
    disabled={disabled}
    onChange={event => onChange(event.target.value as ChatbotMemberRole)}
  >
    {ROLES.map(role => (
      <option key={role.id} value={role.id}>
        {role.label}
      </option>
    ))}
  </select>
);

/**
 * Who can change the assistant (chunk 20d-2, Share → Team): the same three roles as before, now
 * added by email. Owners change it; everyone else sees it.
 */
export const TeamList: React.FC<{ botId: string; canManage: boolean; myUserId?: number }> = ({
  botId,
  canManage,
  myUserId,
}) => {
  const list = useHomeList(botId, "team");
  const [role, setRole] = useState<ChatbotMemberRole>(ChatbotMemberRole.EDITOR);
  const roleId = useId();
  const label = (member: HomeTeamMember) => member.name ?? member.email ?? String(member.userId);

  if (list.loading) return <ListSkeleton />;
  if (list.failed) return <LoadFailed onRetry={list.refetch} />;
  return (
    <div className="ally-home__list-block" data-testid="team-list">
      <ListRows label={HOME.share.team}>
        {list.items.map(member => (
          <ListRow
            key={member.id}
            title={label(member)}
            badge={
              member.userId === myUserId ? (
                <span className="ally-badge ally-badge--muted">{t.team.you}</span>
              ) : undefined
            }
            meta={member.name ? (member.email ?? undefined) : undefined}
            actions={
              <>
                <RoleSelect
                  label={`${t.team.roleLabel}: ${label(member)}`}
                  value={member.role}
                  disabled={!canManage || list.saving}
                  onChange={next =>
                    void list.change({ op: "edit", id: member.id, item: { role: next } }, () => ({
                      op: "edit",
                      id: member.id,
                      item: { role: member.role },
                    }))
                  }
                />
                {canManage && (
                  <RemoveButton
                    label={fill(t.remove, { item: label(member) })}
                    disabled={list.saving}
                    onClick={() =>
                      void list.change({ op: "remove", id: member.id }, () =>
                        member.email
                          ? { op: "add", item: { email: member.email, role: member.role } }
                          : null,
                      )
                    }
                  />
                )}
              </>
            }
          />
        ))}
      </ListRows>
      {canManage ? (
        <AddRow
          label={t.team.emailLabel}
          type="email"
          addLabel={t.add}
          disabled={list.saving}
          extra={
            <>
              <label htmlFor={roleId} className="ally-sr-only">
                {t.team.roleLabel}
              </label>
              <select
                id={roleId}
                className="ally-input ally-input--compact"
                value={role}
                onChange={event => setRole(event.target.value as ChatbotMemberRole)}
              >
                {ROLES.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </>
          }
          onAdd={email => list.change({ op: "add", item: { email, role } })}
        />
      ) : (
        <p className="ally-small">{t.team.ownerOnly}</p>
      )}
      <ListError error={list.error} />
    </div>
  );
};
