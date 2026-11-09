import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import {
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  SkeletonText,
  TextArea,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useAddChatbotAudienceMutation,
  useGetChatbotAudienceQuery,
  useGetChatbotMembersQuery,
  useRemoveChatbotAudienceMutation,
  useSetChatbotMembersMutation,
  useUpdateChatbotMutation,
} from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import {
  Chatbot,
  ChatbotAccessMode,
  ChatbotAudienceKind,
  ChatbotMember,
  ChatbotMemberRole,
} from "@types";

import { Card, errorMessage, fill, LoadError } from "./shared";

const t = en.whatsappBot.bots.people;
/** One empty list for every render while loading, so effects keyed on the list don't loop. */
const NO_MEMBERS: ChatbotMember[] = [];

const KIND_LABEL: Record<ChatbotAudienceKind, string> = {
  [ChatbotAudienceKind.USER]: t.kindUser,
  [ChatbotAudienceKind.ORGANISATION]: t.kindOrganisation,
  [ChatbotAudienceKind.PHONE]: t.kindPhone,
  [ChatbotAudienceKind.EMAIL]: t.kindEmail,
};

const ROLE_LABEL: Record<ChatbotMemberRole, string> = {
  [ChatbotMemberRole.VIEWER]: t.roleViewer,
  [ChatbotMemberRole.EDITOR]: t.roleEditor,
  [ChatbotMemberRole.OWNER]: t.roleOwner,
};

/** The two lists of people a bot has: who manages it, and who it answers. */
export const PeopleTab: React.FC<{ bot: Chatbot; canEdit: boolean; canManage: boolean }> = ({
  bot,
  canEdit,
  canManage,
}) => (
  <div className="flex flex-col gap-6 max-w-3xl">
    <WhoCanChat bot={bot} canEdit={canEdit} />
    <Team bot={bot} canManage={canManage} />
  </div>
);

export const WhoCanChat: React.FC<{ bot: Chatbot; canEdit: boolean }> = ({ bot, canEdit }) => {
  const [updateBot] = useUpdateChatbotMutation();
  const { data: entries = [], isLoading, isError, refetch } = useGetChatbotAudienceQuery(bot.id);
  const [add, { isLoading: isAdding }] = useAddChatbotAudienceMutation();
  const [remove] = useRemoveChatbotAudienceMutation();
  const [kind, setKind] = useState<ChatbotAudienceKind>(ChatbotAudienceKind.PHONE);
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [bulk, setBulk] = useState("");

  const setMode = async (accessMode: ChatbotAccessMode) => {
    try {
      await updateBot({ id: bot.id, accessMode }).unwrap();
      toast.success(t.modeSaved);
    } catch (err) {
      toast.error(errorMessage(err, t.addFailed));
    }
  };

  const addEntries = async (
    list: { kind: ChatbotAudienceKind; value: string; label?: string }[],
  ) => {
    if (!list.length) return;
    try {
      const result = await add({ id: bot.id, entries: list }).unwrap();
      toast.success(fill(t.added, { added: result.added, skipped: result.skipped }));
      setValue("");
      setLabel("");
      setBulk("");
    } catch (err) {
      toast.error(errorMessage(err, t.addFailed));
    }
  };

  return (
    <Card title={t.chatTitle} subtitle={t.chatIntro}>
      <RadioButtonGroup
        name="who-can-chat"
        orientation="vertical"
        valueSelected={bot.accessMode}
        disabled={!canEdit}
        onChange={mode => void setMode(mode as ChatbotAccessMode)}
      >
        <RadioButton id="mode-anyone" value={ChatbotAccessMode.ANYONE} labelText={t.modeAnyone} />
        <RadioButton
          id="mode-recognised"
          value={ChatbotAccessMode.RECOGNISED}
          labelText={t.modeRecognised}
        />
        <RadioButton id="mode-listed" value={ChatbotAccessMode.LISTED} labelText={t.modeListed} />
      </RadioButtonGroup>

      {bot.accessMode === ChatbotAccessMode.LISTED && (
        <div className="flex flex-col gap-4">
          {isLoading ? (
            <SkeletonText paragraph lineCount={3} />
          ) : isError ? (
            <LoadError title={t.listLoadFailed} onRetry={() => void refetch()} />
          ) : entries.length === 0 ? (
            <p className="text-sm text-warning-700">{t.listEmpty}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-light">
              {entries.map(entry => (
                <li key={entry.id} className="flex items-center gap-3 py-2">
                  <span className="text-xs text-typography-500 w-36 shrink-0">
                    {KIND_LABEL[entry.kind]}
                  </span>
                  <span className="flex-1 min-w-0 text-sm text-typography-900 truncate">
                    {entry.label ? `${entry.label} · ${entry.value}` : entry.value}
                  </span>
                  {canEdit && (
                    <Button
                      variant={ButtonVariant.SECONDARY}
                      onClick={() =>
                        void remove({ id: bot.id, entryId: entry.id })
                          .unwrap()
                          .then(() => toast.success(t.removed))
                          .catch(err => toast.error(errorMessage(err, t.addFailed)))
                      }
                    >
                      {t.removeMember}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr_1fr_auto] gap-2 items-end">
                <Select
                  id="audience-kind"
                  labelText=""
                  hideLabel
                  value={kind}
                  onChange={e => setKind(e.target.value as ChatbotAudienceKind)}
                >
                  {Object.values(ChatbotAudienceKind).map(k => (
                    <SelectItem key={k} value={k} text={KIND_LABEL[k]} />
                  ))}
                </Select>
                <TextInput
                  id="audience-value"
                  labelText=""
                  hideLabel
                  placeholder={t.valuePlaceholder}
                  value={value}
                  onChange={e => setValue(e.target.value)}
                />
                <TextInput
                  id="audience-label"
                  labelText=""
                  hideLabel
                  placeholder={t.labelPlaceholder}
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                />
                <Button
                  variant={ButtonVariant.SECONDARY}
                  disabled={!value.trim() || isAdding}
                  onClick={() =>
                    void addEntries([
                      { kind, value: value.trim(), label: label.trim() || undefined },
                    ])
                  }
                >
                  {t.addEntry}
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                <TextArea
                  id="audience-bulk"
                  labelText={t.bulkLabel}
                  rows={3}
                  value={bulk}
                  onChange={e => setBulk(e.target.value)}
                />
                <div>
                  <Button
                    variant={ButtonVariant.SECONDARY}
                    disabled={!bulk.trim() || isAdding}
                    onClick={() =>
                      void addEntries(
                        bulk
                          .split(/\r?\n/)
                          .map(line => line.trim())
                          .filter(Boolean)
                          .map(phone => ({ kind: ChatbotAudienceKind.PHONE, value: phone })),
                      )
                    }
                  >
                    {t.bulkAdd}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
};

export const Team: React.FC<{ bot: Chatbot; canManage: boolean }> = ({ bot, canManage }) => {
  const {
    data: members = NO_MEMBERS,
    isLoading,
    isError,
    refetch,
  } = useGetChatbotMembersQuery(bot.id);
  const [save, { isLoading: isSaving }] = useSetChatbotMembersMutation();
  const [draft, setDraft] = useState(members);
  useEffect(() => {
    setDraft(members);
  }, [members]);
  const [newId, setNewId] = useState("");
  const [newRole, setNewRole] = useState<ChatbotMemberRole>(ChatbotMemberRole.EDITOR);

  const commit = async (next: { userId: number; role: ChatbotMemberRole }[]) => {
    try {
      await save({ id: bot.id, members: next }).unwrap();
      toast.success(t.teamSaved);
      setNewId("");
    } catch (err) {
      toast.error(errorMessage(err, t.teamFailed));
    }
  };
  const asInput = draft.map(m => ({ userId: m.userId, role: m.role }));

  return (
    <Card title={t.teamTitle} subtitle={t.teamIntro}>
      {isLoading ? (
        <SkeletonText paragraph lineCount={3} />
      ) : isError ? (
        <LoadError title={t.teamLoadFailed} onRetry={() => void refetch()} />
      ) : draft.length === 0 ? (
        <p className="text-sm text-typography-600">{t.teamEmpty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-light">
          {draft.map(member => (
            <li key={member.userId} className="flex flex-wrap items-center gap-3 py-2">
              <div className="flex-1 min-w-0 flex flex-col">
                <span className="text-sm text-typography-900 truncate">
                  {member.name ?? `#${member.userId}`}
                </span>
                <span className="text-xs text-typography-500 truncate">{member.email}</span>
              </div>
              <Select
                id={`member-role-${member.userId}`}
                labelText=""
                hideLabel
                disabled={!canManage || isSaving}
                value={member.role}
                onChange={e =>
                  void commit(
                    asInput.map(m =>
                      m.userId === member.userId
                        ? { ...m, role: e.target.value as ChatbotMemberRole }
                        : m,
                    ),
                  )
                }
              >
                {Object.values(ChatbotMemberRole).map(role => (
                  <SelectItem key={role} value={role} text={ROLE_LABEL[role]} />
                ))}
              </Select>
              {canManage && (
                <Button
                  variant={ButtonVariant.SECONDARY}
                  disabled={isSaving}
                  onClick={() => void commit(asInput.filter(m => m.userId !== member.userId))}
                >
                  {t.removeMember}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* Adding sends the whole team, so it waits until the team is known. */}
      {canManage && !isLoading && !isError && (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_16rem_auto] gap-2 items-end">
          <TextInput
            id="member-id"
            labelText={t.memberIdLabel}
            helperText={t.memberIdHelp}
            placeholder={t.memberIdPlaceholder}
            value={newId}
            onChange={e => setNewId(e.target.value.replace(/\D/g, ""))}
          />
          <Select
            id="member-new-role"
            labelText=""
            hideLabel
            value={newRole}
            onChange={e => setNewRole(e.target.value as ChatbotMemberRole)}
          >
            {Object.values(ChatbotMemberRole).map(role => (
              <SelectItem key={role} value={role} text={ROLE_LABEL[role]} />
            ))}
          </Select>
          <Button
            variant={ButtonVariant.SECONDARY}
            disabled={!newId || isSaving}
            onClick={() =>
              void commit([
                ...asInput.filter(m => m.userId !== Number(newId)),
                { userId: Number(newId), role: newRole },
              ])
            }
          >
            {t.addMember}
          </Button>
        </div>
      )}
    </Card>
  );
};
