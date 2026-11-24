import React, { useId, useState } from "react";

import {
  useCreateChatbotInviteMutation,
  useGetChatbotInvitesQuery,
  useGetChatbotMembersQuery,
  useLeaveChatbotMutation,
  useRemoveChatbotMemberMutation,
  useRevokeChatbotInviteMutation,
  useSetChatbotMembersMutation,
  useTransferChatbotMutation,
} from "@api";
import type { TeamMember } from "@api";
import { Button } from "@components/button";
import { Input } from "@components/input";
import { ButtonVariant } from "@components/types";
import { ChatbotMemberRole } from "@types";

import "../ui/team.css";
import { LoadFailed } from "./AccessLists";
import { rolesOfMember } from "../access";
import { fill } from "../copy";
import { PEOPLE } from "../copy/people";
import { when } from "../dates";
import { errorInfo } from "../teamErrors";
import {
  InlineConfirm,
  ListError,
  ListRow,
  ListRows,
  ListSkeleton,
  RemoveButton,
} from "../ui/List";
import { RoleBadges } from "../ui/RoleBadges";
import { RoleChecks } from "../ui/RoleChecks";

const nameOf = (member: TeamMember) => member.name ?? member.email ?? String(member.userId);

/** The words for a refused team change, by its code; `self` picks the "you" wording. */
export const teamError = (failure: unknown, self = false): string => {
  const { code, message } = errorInfo(failure);
  const errors = PEOPLE.errors as Record<string, string>;
  const key = code && self && `${code}_leave` in errors ? `${code}_leave` : code;
  return (key && errors[key]) || message || PEOPLE.saveFailed;
};

const inviteError = (failure: unknown): string => {
  const { code, message } = errorInfo(failure);
  const errors = PEOPLE.invite.errors as Record<string, string>;
  return (code && errors[code]) || message || PEOPLE.invite.failed;
};

const InviteBlock: React.FC<{ botId: string }> = ({ botId }) => {
  const emailId = useId();
  const { data: pending = [] } = useGetChatbotInvitesQuery(botId);
  const [create, { isLoading: sending }] = useCreateChatbotInviteMutation();
  const [revoke, { isLoading: revoking }] = useRevokeChatbotInviteMutation();
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<ChatbotMemberRole[]>([ChatbotMemberRole.VIEWER]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const send = async () => {
    const clean = email.trim();
    if (!clean) return;
    setError(null);
    setNote(null);
    try {
      const result = await create({ id: botId, email: clean, roles }).unwrap();
      setNote(
        result.emailSent === false
          ? PEOPLE.invite.notSent
          : fill(PEOPLE.invite.sent, { email: clean }),
      );
      setEmail("");
    } catch (failure) {
      setError(inviteError(failure));
    }
  };

  const withdraw = async (inviteId: string) => {
    setError(null);
    try {
      await revoke({ id: botId, inviteId }).unwrap();
      setNote(PEOPLE.invite.revoked);
    } catch {
      setError(PEOPLE.invite.revokeFailed);
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="ally-home__list-block" data-testid="team-invites">
      <h4 className="ally-home__subhead">{PEOPLE.invite.title}</h4>
      <p className="ally-small">{PEOPLE.invite.hint}</p>
      <div className="ally-add-row">
        <label htmlFor={emailId} className="ally-sr-only">
          {PEOPLE.invite.emailLabel}
        </label>
        <Input
          id={emailId}
          className="!w-full"
          type="email"
          value={email}
          placeholder={PEOPLE.invite.emailLabel}
          maxLength={254}
          onChange={event => setEmail(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button
          variant={ButtonVariant.TERTIARY}
          type="button"
          disabled={!email.trim() || sending}
          onClick={() => void send()}
        >
          {PEOPLE.invite.send}
        </Button>
      </div>
      <RoleChecks
        legend={PEOPLE.invite.rolesLabel}
        value={roles}
        onChange={setRoles}
        onLast={() => setError(PEOPLE.oneRole)}
        showHelp
      />
      {note && (
        <p className="ally-small" role="status">
          {note}
        </p>
      )}
      <ListError error={error} />
      <h4 className="ally-home__subhead">{PEOPLE.invite.pendingTitle}</h4>
      {pending.length ? (
        <ListRows label={PEOPLE.invite.pendingTitle} testId="pending-invites">
          {pending.map(invite => (
            <ListRow
              key={invite.id}
              title={invite.email}
              badge={<RoleBadges roles={invite.roles} />}
              meta={fill(PEOPLE.invite.expires, { when: when(invite.expiresAt) })}
              actions={
                revokingId === invite.id ? (
                  <InlineConfirm
                    question={fill(PEOPLE.invite.revoke, { email: invite.email })}
                    confirmLabel={PEOPLE.removeConfirm}
                    cancelLabel={PEOPLE.keep}
                    onConfirm={() => void withdraw(invite.id)}
                    onCancel={() => setRevokingId(null)}
                  />
                ) : (
                  <Button
                    variant={ButtonVariant.TEXT}
                    size="sm"
                    type="button"
                    disabled={revoking}
                    aria-label={fill(PEOPLE.invite.revoke, { email: invite.email })}
                    onClick={() => setRevokingId(invite.id)}
                  >
                    {PEOPLE.invite.revokeButton}
                  </Button>
                )
              }
            />
          ))}
        </ListRows>
      ) : (
        <p className="ally-small">{PEOPLE.invite.none}</p>
      )}
    </div>
  );
};

const TransferBlock: React.FC<{ botId: string; others: TeamMember[] }> = ({ botId, others }) => {
  const selectId = useId();
  const [transfer, { isLoading }] = useTransferChatbotMutation();
  const [target, setTarget] = useState<string>("");
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = others.find(member => String(member.userId) === target);

  const run = async () => {
    if (!chosen) return;
    setError(null);
    try {
      await transfer({ id: botId, userId: chosen.userId }).unwrap();
      setNote(fill(PEOPLE.transferDone, { name: nameOf(chosen) }));
      setTarget("");
    } catch (failure) {
      setError(teamError(failure));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="ally-home__list-block" data-testid="team-transfer">
      <h4 className="ally-home__subhead">{PEOPLE.transfer}</h4>
      <p className="ally-small">{others.length ? PEOPLE.transferHint : PEOPLE.transferNobody}</p>
      {others.length > 0 && (
        <div className="ally-add-row">
          <label htmlFor={selectId} className="ally-sr-only">
            {PEOPLE.transferChoose}
          </label>
          <select
            id={selectId}
            className="ally-input ally-input--compact"
            value={target}
            onChange={event => {
              setTarget(event.target.value);
              setConfirming(false);
            }}
          >
            <option value="">{PEOPLE.transferChoose}</option>
            {others.map(member => (
              <option key={member.userId} value={member.userId}>
                {nameOf(member)}
              </option>
            ))}
          </select>
          {confirming && chosen ? (
            <InlineConfirm
              question={fill(PEOPLE.transferQuestion, { name: nameOf(chosen) })}
              confirmLabel={PEOPLE.transferConfirm}
              cancelLabel={PEOPLE.keep}
              onConfirm={() => void run()}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <Button
              variant={ButtonVariant.TERTIARY}
              type="button"
              disabled={!chosen || isLoading}
              onClick={() => setConfirming(true)}
            >
              {PEOPLE.transfer}
            </Button>
          )}
        </div>
      )}
      {note && (
        <p className="ally-small" role="status">
          {note}
        </p>
      )}
      <ListError error={error} />
    </div>
  );
};

/**
 * Who is on the team (Stage 1b): roles as checkboxes (any mix, at least one), remove, leave, hand
 * over ownership (the creator), and invite by email with the pending invites. Owners change it;
 * everyone else sees it and can leave. Refusals are explained from their error codes.
 */
export const TeamList: React.FC<{
  botId: string;
  canManage: boolean;
  myUserId?: number;
  /** After the caller leaves: where to go (they no longer have access here). */
  onLeft?: () => void;
}> = ({ botId, canManage, myUserId, onLeft }) => {
  const { data: members = [], isLoading, isError, refetch } = useGetChatbotMembersQuery(botId);
  const [setMembers, { isLoading: saving }] = useSetChatbotMembersMutation();
  const [removeMember, { isLoading: removing }] = useRemoveChatbotMemberMutation();
  const [leave, { isLoading: leaving }] = useLeaveChatbotMutation();
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [leavingNow, setLeavingNow] = useState(false);

  if (isLoading) return <ListSkeleton />;
  if (isError) return <LoadFailed onRetry={() => void refetch()} />;

  const me = members.find(member => member.userId === myUserId);

  const changeRoles = async (target: TeamMember, roles: ChatbotMemberRole[]) => {
    setError(null);
    try {
      await setMembers({
        id: botId,
        members: members.map(member => ({
          userId: member.userId,
          roles: member.userId === target.userId ? roles : rolesOfMember(member),
        })),
      }).unwrap();
    } catch (failure) {
      setError(teamError(failure));
    }
  };

  const remove = async (target: TeamMember) => {
    setError(null);
    try {
      await removeMember({ id: botId, userId: target.userId }).unwrap();
    } catch (failure) {
      setError(teamError(failure));
    } finally {
      setRemovingId(null);
    }
  };

  const leaveNow = async () => {
    setError(null);
    try {
      await leave({ id: botId }).unwrap();
      onLeft?.();
    } catch (failure) {
      setError(teamError(failure, true));
    } finally {
      setLeavingNow(false);
    }
  };

  return (
    <div className="ally-home__list-block" data-testid="team-list">
      <ListRows label={PEOPLE.title}>
        {members.map(member => {
          const name = nameOf(member);
          return (
            <ListRow
              key={member.userId}
              title={name}
              badge={
                <>
                  {member.userId === myUserId && (
                    <span className="ally-badge ally-badge--muted">{PEOPLE.you}</span>
                  )}
                  {member.isCreator && (
                    <span className="ally-badge ally-badge--muted">{PEOPLE.creator}</span>
                  )}
                </>
              }
              meta={member.name ? (member.email ?? undefined) : undefined}
              actions={
                canManage && removingId === member.userId ? (
                  <InlineConfirm
                    question={fill(PEOPLE.removeQuestion, { name })}
                    confirmLabel={PEOPLE.removeConfirm}
                    cancelLabel={PEOPLE.keep}
                    onConfirm={() => void remove(member)}
                    onCancel={() => setRemovingId(null)}
                  />
                ) : (
                  canManage && (
                    <RemoveButton
                      label={fill(PEOPLE.remove, { name })}
                      disabled={removing || saving}
                      onClick={() => setRemovingId(member.userId)}
                    />
                  )
                )
              }
            >
              {canManage ? (
                <RoleChecks
                  legend={fill(PEOPLE.rolesLabel, { name })}
                  value={rolesOfMember(member)}
                  disabled={saving}
                  onChange={roles => void changeRoles(member, roles)}
                  onLast={() => setError(PEOPLE.oneRole)}
                />
              ) : (
                <RoleBadges roles={member.roles} role={member.role} />
              )}
            </ListRow>
          );
        })}
      </ListRows>

      {!canManage && <p className="ally-small">{PEOPLE.readOnly}</p>}
      <ListError error={error} />

      {me && (
        <div>
          {leavingNow ? (
            <InlineConfirm
              question={PEOPLE.leaveQuestion}
              confirmLabel={PEOPLE.leaveConfirm}
              cancelLabel={PEOPLE.keep}
              onConfirm={() => void leaveNow()}
              onCancel={() => setLeavingNow(false)}
            />
          ) : (
            <Button
              variant={ButtonVariant.TEXT}
              type="button"
              disabled={leaving}
              onClick={() => setLeavingNow(true)}
            >
              {PEOPLE.leave}
            </Button>
          )}
        </div>
      )}

      {canManage && me?.isCreator && (
        <TransferBlock
          botId={botId}
          others={members.filter(member => member.userId !== myUserId)}
        />
      )}
      {canManage && <InviteBlock botId={botId} />}
    </div>
  );
};
