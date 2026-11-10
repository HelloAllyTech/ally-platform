import React, { useRef, useState } from "react";

import { useNavigate } from "react-router-dom";

import {
  useArchiveChatbotMutation,
  useGetHomeNumbersQuery,
  useSetChatbotStatusMutation,
} from "@api";
import { Button, Segmented } from "@components/v2";
import { ROUTES } from "@constants";
import { BotPageView, ChatbotStatus } from "@types";

import { Qr } from "../../Onboarding/Screens";
import { copyToClipboard } from "../../WhatsAppBot/shared";
import { fill, HOME } from "../copy";
import { Group, SectionHead } from "../fields";
import { AllNumbers } from "./AllNumbers";
import { Scorecard } from "./Scorecard";

import type { SectionProps } from "./props";

const t = HOME.overview;

/**
 * How the assistant is doing (chunk 20d): whether it's live, with the one switch; its link and QR
 * code; the last 7 or 30 days in four numbers (all of them under "All numbers", opened in place); and
 * what needs the owner. Owners can remove it here.
 */
export const OverviewSection: React.FC<
  SectionProps & {
    page: BotPageView | null;
    /** An old link to the classic usage tab (`?tab=usage`) opens with All numbers open. */
    openAllNumbers?: boolean;
  }
> = ({ bot, page, openAllNumbers = false, canEdit, canManage, go }) => {
  const [setStatus, statusState] = useSetChatbotStatusMutation();
  const [archive, archiveState] = useArchiveChatbotMutation();
  const [days, setDays] = useState<7 | 30>(30);
  const [allNumbers, setAllNumbers] = useState(openAllNumbers);
  // The list already counted the last 30 days; 7 days is asked for when chosen.
  const week = useGetHomeNumbersQuery({ id: bot.id, days: 7 }, { skip: days !== 7 });
  const stats = days === 7 ? week.data : bot.stats;
  const navigate = useNavigate();
  const qr = useRef<HTMLDivElement>(null);
  const live = bot.status === ChatbotStatus.LIVE;

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
      <SectionHead
        title={HOME.sections.overview}
        subtitle={HOME.subtitles.overview}
        help={HOME.help.overview}
      />

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

      <Group title={t.numbersTitle} testId="overview-numbers">
        <Segmented
          label={t.numbersPeriod}
          options={[
            { id: "7", label: t.last7 },
            { id: "30", label: t.last30 },
          ]}
          value={String(days) as "7" | "30"}
          onChange={id => setDays(id === "7" ? 7 : 30)}
        />
        <dl className="ally-home__stats" aria-busy={!stats || undefined}>
          {(
            [
              [t.people, stats?.people],
              [t.messages, stats?.messages],
              [t.answered, stats?.answered],
              [t.unanswered, stats?.declined],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="ally-home__stat">
              <dt className="ally-small">{label}</dt>
              {/* Held at its final size while the 7 days load. */}
              <dd>{value === undefined ? "–" : value.toLocaleString("en-IN")}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          className="ally-link ally-small"
          aria-expanded={allNumbers}
          aria-controls="all-numbers"
          onClick={() => setAllNumbers(open => !open)}
        >
          {allNumbers ? HOME.allNumbers.hide : t.seeAllNumbers}
        </button>
        {/* Loads only once opened. */}
        <div id="all-numbers">{allNumbers && <AllNumbers botId={bot.id} />}</div>
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
