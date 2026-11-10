import React, { useId } from "react";

import { useSelector } from "react-redux";

import { useGetBotPageQuery } from "@api";
import type { BotPageAccess } from "@types";

import { COPY } from "../../Onboarding/copy";
import { HOME } from "../copy";
import { Collapsed, Group, SectionHead, TextField } from "../fields";
import { useHomeField } from "../useHomeField";
import { PageAccessList, WhatsAppAudience } from "./AccessLists";
import { HandoverSettingsGroup } from "./HandoverSettings";
import { TeamList, WhatsAppNumbers } from "./PeopleLists";
import { WebsiteGroup } from "./Website";

import type { SectionProps } from "./props";
import type { RootState } from "../../../store";

const useMyUserId = () =>
  useSelector((state: RootState) => (state.user.user as { id?: number } | null)?.id);

const t = HOME.share;
const ACCESS: { id: BotPageAccess; label: string; help: string }[] = [
  { id: "public", label: COPY.share.public, help: COPY.share.publicHelp },
  { id: "organisation", label: COPY.share.organisation, help: COPY.share.organisationHelp },
  { id: "invite", label: COPY.share.invite, help: COPY.share.inviteHelp },
];

/**
 * Who can use the assistant, and where (chunk 20d). Two separate lists, clearly labelled: who can
 * open the page, and which numbers can message it on WhatsApp (a page list never widens WhatsApp,
 * 12b). WhatsApp's own messages and numbers sit in its card; the team that can change the
 * assistant comes last.
 */
export const ShareSection: React.FC<SectionProps> = ({ bot, home, canEdit, canManage }) => {
  const { data: page } = useGetBotPageQuery(bot.id);
  const failed = HOME.saving.failed;
  const access = useHomeField(bot.id, "pageAccess", home.fields.pageAccess, failed);
  const handover = useHomeField(bot.id, "handover", home.fields.handover, failed);
  const whatsappAccess = useHomeField(bot.id, "whatsappAccess", home.fields.whatsappAccess, failed);
  const myUserId = useMyUserId();
  const widget = useHomeField(bot.id, "widget", home.fields.widget, failed);
  const unknown = useHomeField(bot.id, "unknownNumberText", home.fields.unknownNumberText, failed);
  const media = useHomeField(
    bot.id,
    "unsupportedMediaText",
    home.fields.unsupportedMediaText,
    failed,
  );
  const name = useId();
  const publicAllowed = Boolean(page?.publicAllowed);
  // WhatsApp's own controls mean nothing until a number is connected.
  const connected = bot.connectors.length > 0;

  return (
    <>
      <SectionHead title={HOME.sections.share} subtitle={HOME.subtitles.share} />

      <Group title={t.onPage} hint={t.onPageHint} testId="share-page">
        <fieldset className="ally-home__choices" disabled={!canEdit}>
          <legend className="ally-sr-only">{t.onPage}</legend>
          {ACCESS.map(option => {
            const blocked = option.id === "public" && !publicAllowed;
            return (
              <label
                key={option.id}
                className={`ally-home__choice${access.value === option.id ? " is-on" : ""}`}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.id}
                  checked={access.value === option.id}
                  disabled={blocked}
                  onChange={() => access.set(option.id, { now: true })}
                />
                <span>
                  <span className="ally-home__strong">{option.label}</span>
                  <span className="ally-field__hint">
                    {blocked ? COPY.share.publicDisabled : option.help}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {access.error && (
          <p className="ally-error" role="alert">
            {access.error}
          </p>
        )}
        {access.value !== "public" && (
          <PageAccessList botId={bot.id} canEdit={canEdit} mode={access.value} />
        )}
      </Group>

      {page && (
        <WebsiteGroup
          field={widget}
          slug={page.slug}
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

      <HandoverSettingsGroup field={handover} disabled={!canEdit} />

      <Group title={t.team} hint={t.teamHint} testId="share-team">
        <TeamList botId={bot.id} canManage={canManage} myUserId={myUserId} />
      </Group>
    </>
  );
};
