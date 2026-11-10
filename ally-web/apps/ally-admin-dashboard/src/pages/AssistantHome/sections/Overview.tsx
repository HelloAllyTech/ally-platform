import React, { useRef } from "react";

import { useNavigate } from "react-router-dom";

import { useArchiveChatbotMutation, useSetChatbotStatusMutation } from "@api";
import { Button } from "@components/v2";
import { ROUTES } from "@constants";
import { BotPageView, ChatbotStatus } from "@types";

import { Qr } from "../../Onboarding/Screens";
import { copyToClipboard } from "../../WhatsAppBot/shared";
import { fill, HOME } from "../copy";
import { Group, SectionHead } from "../fields";
import { Scorecard } from "./Scorecard";

import type { SectionProps } from "./props";

const t = HOME.overview;

/**
 * How the assistant is doing (chunk 20d): whether it's live, with the one switch; its link and QR
 * code; the last 30 days in four numbers (all of them under "All numbers"); and what needs the
 * owner. Owners can remove it here.
 */
export const OverviewSection: React.FC<SectionProps & { page: BotPageView | null }> = ({
  bot,
  page,
  canEdit,
  canManage,
  go,
}) => {
  const [setStatus, statusState] = useSetChatbotStatusMutation();
  const [archive, archiveState] = useArchiveChatbotMutation();
  const navigate = useNavigate();
  const qr = useRef<HTMLDivElement>(null);
  const live = bot.status === ChatbotStatus.LIVE;
  const open = bot.stats.openUnanswered;

  const downloadQr = () => {
    const img = qr.current?.querySelector("img");
    if (!img || !page) return;
    const a = document.createElement("a");
    a.href = img.src;
    a.download = `${page.slug}-qr.png`;
    a.click();
  };

  return (
    <>
      <SectionHead title={HOME.sections.overview} subtitle={HOME.subtitles.overview} />

      <Group testId="overview-status">
        <div className="ally-home__row">
          <p className="ally-body ally-home__strong">
            {live ? t.live : bot.status === ChatbotStatus.PAUSED ? t.paused : t.draft}
          </p>
          {canEdit && (
            <Button
              variant={live ? "secondary" : "primary"}
              disabled={statusState.isLoading}
              onClick={() =>
                void setStatus({
                  id: bot.id,
                  status: live ? ChatbotStatus.PAUSED : ChatbotStatus.LIVE,
                })
              }
            >
              {live ? t.pause : t.turnOn}
            </Button>
          )}
        </div>
      </Group>

      <Scorecard botId={bot.id} canEdit={canEdit} go={go} />

      {page?.saved && (
        <Group title={t.link} testId="overview-link">
          <div className="ally-home__link">
            <div ref={qr} className="ally-home__qr">
              <Qr link={page.link} />
            </div>
            <div className="ally-home__link-body">
              <a
                className="ally-link ally-home__url"
                href={page.link}
                target="_blank"
                rel="noreferrer"
              >
                {page.link}
              </a>
              <div className="ally-btn-row">
                <Button onClick={() => void copyToClipboard(page.link)}>{t.copy}</Button>
                <Button onClick={downloadQr}>{t.qr}</Button>
              </div>
            </div>
          </div>
        </Group>
      )}

      <Group title={t.numbers} testId="overview-numbers">
        <dl className="ally-home__stats">
          {(
            [
              [t.people, bot.stats.people],
              [t.messages, bot.stats.messages],
              [t.answered, bot.stats.answered],
              [t.unanswered, bot.stats.declined],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="ally-home__stat">
              <dt className="ally-small">{label}</dt>
              <dd>{value.toLocaleString("en-IN")}</dd>
            </div>
          ))}
        </dl>
        {/* The classic charts, for now (chunk 20d-2 keeps them; CL1 decides). */}
        <a className="ally-link ally-small" href={`/chatbots/${bot.id}?view=classic&tab=usage`}>
          {t.seeAllNumbers}
        </a>
      </Group>

      <Group title={t.needsYou} testId="overview-needs">
        {open > 0 ? (
          <div className="ally-home__row">
            <p className="ally-body">{open === 1 ? t.needsOne : fill(t.needsMany, { n: open })}</p>
            <Button onClick={() => go("knows")}>{t.review}</Button>
          </div>
        ) : (
          <p className="ally-empty">{t.allClear}</p>
        )}
      </Group>

      {canManage && (
        <div>
          <button
            type="button"
            className="ally-link ally-home__danger"
            disabled={archiveState.isLoading}
            onClick={async () => {
              if (!window.confirm(fill(t.removeConfirm, { name: bot.name }))) return;
              await archive(bot.id).unwrap();
              navigate(ROUTES.WHATSAPP_BOT);
            }}
          >
            {t.remove}
          </button>
        </div>
      )}
    </>
  );
};
