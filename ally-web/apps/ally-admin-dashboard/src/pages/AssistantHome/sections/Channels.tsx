import React from "react";

import { useGetBotPageQuery } from "@api";

import { HOME } from "../copy";
import { STRUCTURE } from "../copy/structure";
import { SectionHead } from "../fields";
import { CustomDomain } from "./CustomDomain";
import { LinkQr } from "./LinkQr";
import { PageSection } from "./Page";
import { ShareGroups } from "./Share";
import { WhoMayChat } from "./WhoMayChat";
import { WidgetSites } from "./WidgetSites";
import { BuiltInPanel } from "../userLists/ListsSection";

import type { SectionProps } from "./props";

/**
 * Channels (stage 2): where people reach the assistant. The page (Look and feel, questions
 * before a chat, limits), its link and QR code, who can open it, the website widget, WhatsApp
 * numbers, and the "pages" tool. Pure relocation of the old Page and Share sections.
 */
export const ChannelsSection: React.FC<SectionProps> = props => {
  const { data: page } = useGetBotPageQuery(props.bot.id);
  return (
    <div className="ally-home__stack" data-testid="channels">
      <div>
        <SectionHead
          title={STRUCTURE.sections.channels}
          subtitle={STRUCTURE.subtitles.channels}
          help={HOME.help.share}
        />
        <LinkQr page={page} />
      </div>
      {/* Stage 7: the page's own web address, and where the website widget has loaded. */}
      <CustomDomain botId={props.bot.id} canEdit={props.canEdit} />
      <PageSection {...props} />
      <ShareGroups {...props} />
      <WidgetSites botId={props.bot.id} canEdit={props.canEdit} />
      <WhoMayChat {...props} />
      <BuiltInPanel
        tool="@pages"
        bot={props.bot}
        home={props.home}
        canEdit={props.canEdit}
        canManage={props.canManage}
        go={props.go}
        standalone
      />
    </div>
  );
};
