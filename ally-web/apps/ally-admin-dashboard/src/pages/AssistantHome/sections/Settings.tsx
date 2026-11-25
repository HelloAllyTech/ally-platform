import React, { useState } from "react";

import { useNavigate } from "react-router-dom";

import { ROUTES } from "@constants";

import { HOME } from "../copy";
import { SAFETY_PRIVACY_COPY } from "../copy/safetyPrivacy";
import { Group, SectionHead, TextField } from "../fields";
import { BudgetLimits } from "./BudgetLimits";
import { HowItWorksSection } from "./HowItWorks";
import { QuickReplies } from "./QuickReplies";
import { HelplineConfirm, SafetySection } from "./Safety";
import { TeamGroups } from "./Share";
import { StaffAccess } from "./StaffAccess";
import { STRUCTURE } from "../copy/structure";
import { DuplicateChatbot } from "../safety/DuplicateChatbot";
import { SafetyPrivacy } from "../safety/SafetyPrivacy";
import { RemoveDialog } from "../ui/RemoveDialog";
import { useHomeField } from "../useHomeField";
import { BuiltInPanel } from "../userLists/ListsSection";

import type { SectionProps } from "./props";

const s = STRUCTURE.settings;

/** What an archived chatbot says to anyone who messages it; saves itself (`PATCH :id/home`). */
export const ArchivedMessage: React.FC<Pick<SectionProps, "bot" | "home" | "canEdit">> = ({
  bot,
  home,
  canEdit,
}) => {
  const field = useHomeField(
    bot.id,
    "archivedMessage",
    home.fields.archivedMessage ?? { value: "", version: "" },
    SAFETY_PRIVACY_COPY.archived.failed,
  );
  return (
    <Group title={s.archivedTitle} hint={s.archivedHint} testId="settings-archived-message">
      <TextField
        label={s.archivedTitle}
        field={field}
        disabled={!canEdit}
        multiline
        rows={3}
        maxLength={600}
        placeholder={s.archivedPlaceholder}
      />
    </Group>
  );
};

/**
 * Settings (stage 2): everything about how the assistant behaves and who runs it, by pure
 * relocation — Safety, Quick replies (carved out of Personality), How it works, Hand over and
 * Memory (the old tools), people and seats (from Share), what an archived chatbot says, and
 * removing it (from Overview).
 */
export const SettingsSection: React.FC<SectionProps> = props => {
  const { bot, canEdit, canManage } = props;
  const navigate = useNavigate();
  const [removing, setRemoving] = useState(false);
  return (
    <div className="ally-home__stack" data-testid="settings">
      <SectionHead title={STRUCTURE.sections.settings} subtitle={STRUCTURE.subtitles.settings} />
      <SafetySection {...props} />
      {/* TF1 S4: the helpline number a template wrote, waiting for the owner's confirm. */}
      <HelplineConfirm botId={props.bot.id} canEdit={props.canEdit} />
      <SafetyPrivacy botId={bot.id} canEdit={canEdit} />
      {bot.connectors.length > 0 && (
        <Group title={s.repliesTitle} hint={s.repliesHint} testId="settings-quick-replies">
          <QuickReplies botId={bot.id} canEdit={canEdit} />
        </Group>
      )}
      <HowItWorksSection {...props} />
      <BuiltInPanel
        tool="@memory"
        bot={bot}
        home={props.home}
        canEdit={canEdit}
        canManage={canManage}
        go={props.go}
        standalone
      />
      <BuiltInPanel
        tool="@handover"
        bot={bot}
        home={props.home}
        canEdit={canEdit}
        canManage={canManage}
        go={props.go}
        standalone
      />
      <TeamGroups {...props} />
      <BudgetLimits {...props} />
      <StaffAccess {...props} />
      <ArchivedMessage bot={bot} home={props.home} canEdit={canEdit} />
      <DuplicateChatbot botId={bot.id} canEdit={canEdit} />
      {canManage && (
        <Group title={s.archiveTitle} testId="settings-remove">
          <div>
            <button
              type="button"
              className="ally-link ally-home__danger"
              onClick={() => setRemoving(true)}
            >
              {HOME.overview.remove}
            </button>
            {removing && (
              <RemoveDialog
                bot={bot}
                onClose={() => setRemoving(false)}
                onRemoved={() => navigate(ROUTES.WHATSAPP_BOT)}
              />
            )}
          </div>
        </Group>
      )}
    </div>
  );
};
