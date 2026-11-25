import React, { useState } from "react";

import { useNavigate } from "react-router-dom";

import {
  useGetAccessListQuery,
  useReadSourceAgainMutation,
  useSetChatbotStatusMutation,
} from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { Permissions } from "@constants";
import { useUser } from "@hooks";
import { ChatbotStatus } from "@types";

import { AllNumbers } from "./AllNumbers";
import { HowItsDoing } from "./HowItsDoing";
import { Scorecard } from "./Scorecard";
import { messageOf } from "../../Onboarding/create/logic";
import { TemplateOriginLine } from "../../Templates/TemplateOriginLine";
import { fill, HOME } from "../copy";
import { LIVE_ACCESS_COPY as la, OVERVIEW_COPY as o } from "../copy/overview";
import { TF1_COPY } from "../copy/tf1";
import { Group, SectionHead } from "../fields";

import type { SectionProps } from "./props";

const t = HOME.overview;

/**
 * How the assistant is doing (chunk 20d, stage 7): whether it's live, with the one switch; how it's
 * doing over 7, 30 or 90 days (counts only, small groups held back by the server); the 30-day
 * "read your sources again" nudge; and what needs the owner. Reply time, languages and document
 * use stay under "See all numbers", for Ally staff only. The link and QR code moved to Channels, and Remove to Settings (stage 2).
 */
export const OverviewSection: React.FC<
  SectionProps & {
    /** An old link to the classic usage tab (`?tab=usage`) opens with All numbers open. */
    openAllNumbers?: boolean;
  }
> = ({ bot, home, openAllNumbers = false, canEdit, go }) => {
  const [setStatus, statusState] = useSetChatbotStatusMutation();
  const { permissions } = useUser();
  // The full numbers (reply time, languages, document use) are for Ally staff only.
  const isStaff = Boolean(permissions?.includes(Permissions.SYSTEM_ACCESS));
  const [allNumbers, setAllNumbers] = useState(openAllNumbers && isStaff);
  const navigate = useNavigate();
  const live = bot.status === ChatbotStatus.LIVE;
  // Never published: going live is Build's checklist and Go live (TF1 S1), not the status switch.
  const neverLive = bot.status === ChatbotStatus.DRAFT;
  const [statusError, setStatusError] = useState<string | null>(null);
  const toggle = async () => {
    if (neverLive) {
      go("build", "personality");
      return;
    }
    setStatusError(null);
    try {
      await setStatus({
        id: bot.id,
        status: live ? ChatbotStatus.PAUSED : ChatbotStatus.LIVE,
      }).unwrap();
    } catch (error) {
      const reason = messageOf(error);
      setStatusError(
        reason
          ? fill(TF1_COPY.overview.turnOnFailed, { reason })
          : TF1_COPY.overview.turnOnFailedNoReason,
      );
    }
  };
  // The one access list decides who can chat, so the live line says so (nobody listed = nobody).
  const access = useGetAccessListQuery(bot.id, { skip: !live });
  const nobody = live && access.data !== undefined && access.data.length === 0;

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
            {live
              ? nobody
                ? la.nobody
                : la.live
              : bot.status === ChatbotStatus.PAUSED
                ? t.paused
                : t.draft}
          </p>
          {live && (
            <button type="button" className="ally-link ally-small" onClick={() => go("channels")}>
              {la.link}
            </button>
          )}
          {canEdit && (
            <Button
              variant={live ? ButtonVariant.TERTIARY : ButtonVariant.PRIMARY}
              type="button"
              disabled={statusState.isLoading}
              onClick={() => void toggle()}
            >
              {live ? t.pause : neverLive ? TF1_COPY.overview.finishToGoLive : t.turnOn}
            </Button>
          )}
        </div>
        {statusError && (
          <p className="ally-small" role="alert">
            {statusError}
          </p>
        )}
        <TemplateOriginLine
          botId={bot.id}
          onReplace={key =>
            navigate(`?section=knowledge&part=lists&tool=${encodeURIComponent(key)}`)
          }
        />
      </Group>

      <HowItsDoing botId={bot.id} />

      {canEdit && home.knowledgeStaleNudge && home.knowledgeStaleDocumentId && (
        <StaleNudge
          botId={bot.id}
          days={home.knowledgeStaleDays ?? 0}
          documentId={home.knowledgeStaleDocumentId}
        />
      )}

      <Scorecard botId={bot.id} canEdit={canEdit} go={go} />

      {/* Latency, languages and document use: Ally staff only. */}
      {isStaff && (
        <Group testId="overview-numbers">
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
      )}
    </>
  );
};

/** The 30-day nudge: the sources were last read a while ago; one button reads the oldest again. */
const StaleNudge: React.FC<{ botId: string; days: number; documentId: string }> = ({
  botId,
  days,
  documentId,
}) => {
  const [readAgain, state] = useReadSourceAgainMutation();
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <Group title={o.staleTitle} testId="overview-stale">
      <div className="ally-home__row">
        <p className="ally-body">{fill(o.staleBody, { n: days })}</p>
        <Button
          variant={ButtonVariant.SECONDARY}
          type="button"
          disabled={state.isLoading}
          onClick={async () => {
            setFailed(false);
            setNote(null);
            try {
              const done = await readAgain({ id: botId, documentId }).unwrap();
              setNote(done.changed ? o.readChanged : o.readDone);
            } catch {
              setFailed(true);
            }
          }}
        >
          {state.isLoading ? o.reading : o.readAgain}
        </Button>
      </div>
      {note && (
        <p className="ally-small" role="status">
          {note}
        </p>
      )}
      {failed && (
        <p className="ally-error" role="alert">
          {o.readFailed}
        </p>
      )}
    </Group>
  );
};
