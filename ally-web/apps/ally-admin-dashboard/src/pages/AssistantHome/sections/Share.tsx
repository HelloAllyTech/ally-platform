import React from "react";

import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";

import { useGetBotPageQuery } from "@api";
import { ROUTES } from "@constants";

import { COPY } from "../../Onboarding/copy";
import { PLAN } from "../../Plan/copy";
import { HOME } from "../copy";
import { Collapsed, Group, TextField } from "../fields";
import { useHomeField } from "../useHomeField";
import { WhatsAppAudience } from "./AccessLists";
import { HandoverSettingsGroup } from "./HandoverSettings";
import { WhatsAppNumbers } from "./PeopleLists";
import { AssistantSeats } from "./Seats";
import { TeamList } from "./Team";
import { WebsiteGroup } from "./Website";

import type { SectionProps } from "./props";
import type { RootState } from "../../../store";

const useMyUserId = () =>
  useSelector((state: RootState) => (state.user.user as { id?: number } | null)?.id);

const t = HOME.share;
/**
 * Where people reach the assistant (Channels). Who may open the page is the single "Who may chat"
 * list (WhoMayChat); this holds the website widget and which numbers can message it on WhatsApp. WhatsApp's own messages and numbers sit in
 * its card. The team, seats and hand over moved to Settings (`TeamGroups`).
 */
export const ShareGroups: React.FC<SectionProps> = ({ bot, home, canEdit, canManage }) => {
  const { data: page } = useGetBotPageQuery(bot.id);
  const failed = HOME.saving.failed;
  const whatsappAccess = useHomeField(bot.id, "whatsappAccess", home.fields.whatsappAccess, failed);
  const widget = useHomeField(bot.id, "widget", home.fields.widget, failed);
  const unknown = useHomeField(bot.id, "unknownNumberText", home.fields.unknownNumberText, failed);
  const media = useHomeField(
    bot.id,
    "unsupportedMediaText",
    home.fields.unsupportedMediaText,
    failed,
  );
  const publicAllowed = Boolean(page?.publicAllowed);
  // WhatsApp's own controls mean nothing until a number is connected.
  const connected = bot.connectors.length > 0;

  return (
    <>
      {page && (
        <WebsiteGroup
          field={widget}
          slug={page.publicId ?? page.slug}
          pageLink={page.link}
          publicAllowed={publicAllowed}
          disabled={!canEdit}
        />
      )}

      <Group title={t.onWhatsApp} hint={t.onWhatsAppHint} testId="share-whatsapp">
        {connected ? (
          <>
            <WhatsAppAudience botId={bot.id} mode={whatsappAccess} canEdit={canEdit} />
            <Collapsed summary={t.whatsAppMessages}>
              <TextField
                label={HOME.whatsApp.unknownNumber}
                field={unknown}
                disabled={!canEdit}
                multiline
                maxLength={500}
              />
              <TextField
                label={HOME.whatsApp.unsupportedMedia}
                field={media}
                disabled={!canEdit}
                multiline
                maxLength={500}
              />
            </Collapsed>
          </>
        ) : (
          <p className="ally-body">{COPY.share.nextBody}</p>
        )}
        {/* The numbers (and Connect): the only part shown before WhatsApp is connected. */}
        <WhatsAppNumbers bot={bot} canManage={canManage} />
      </Group>
    </>
  );
};

/**
 * Hand over, the team that can change the assistant, and its seats (Settings since stage 2).
 */
export const TeamGroups: React.FC<SectionProps> = ({ bot, home, canEdit, canManage }) => {
  const failed = HOME.saving.failed;
  const handover = useHomeField(bot.id, "handover", home.fields.handover, failed);
  const myUserId = useMyUserId();
  const navigate = useNavigate();
  return (
    <>
      <HandoverSettingsGroup
        field={handover}
        disabled={!canEdit}
        zone={home.fields.timeZone?.value}
      />

      <Group title={t.team} hint={t.teamHint} testId="share-team">
        <TeamList
          botId={bot.id}
          canManage={canManage}
          myUserId={myUserId}
          onLeft={() => navigate(ROUTES.WHATSAPP_BOT)}
        />
      </Group>

      {/* CR1 §C3: who holds this assistant's seats, and this month's counts. Never dollars. */}
      <Group title={PLAN.seats.title} hint={PLAN.seats.hint} testId="share-seats-group">
        <AssistantSeats botId={bot.id} canManage={canManage} />
      </Group>
    </>
  );
};
