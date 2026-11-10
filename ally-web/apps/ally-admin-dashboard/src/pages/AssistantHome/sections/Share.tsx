import React, { useId } from "react";

import { useGetBotPageQuery } from "@api";
import type { BotPageAccess } from "@types";

import { COPY } from "../../Onboarding/copy";
import { AccessList } from "../../WhatsAppBot/BotPageTab";
import { BotConnectorsTab } from "../../WhatsAppBot/ConnectorsTab";
import { Team, WhoCanChat } from "../../WhatsAppBot/PeopleTab";
import { HOME } from "../copy";
import { Collapsed, Group, SectionHead, TextField } from "../fields";
import { useHomeField } from "../useHomeField";
import { HandoverSettingsGroup } from "./HandoverSettings";

import type { SectionProps } from "./props";

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
          <div className="ally-home__classic">
            <AccessList botId={bot.id} canEdit={canEdit} mode={access.value} />
          </div>
        )}
      </Group>

      <Group title={t.onWhatsApp} hint={t.onWhatsAppHint} testId="share-whatsapp">
        {connected ? (
          <>
            <div className="ally-home__classic">
              <WhoCanChat bot={bot} canEdit={canEdit} />
            </div>
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
        <div className="ally-home__classic">
          <BotConnectorsTab bot={bot} canManage={canManage} />
        </div>
      </Group>

      <HandoverSettingsGroup field={handover} disabled={!canEdit} />

      <Group title={t.team} hint={t.teamHint} testId="share-team">
        <div className="ally-home__classic">
          <Team bot={bot} canManage={canManage} />
        </div>
      </Group>
    </>
  );
};
