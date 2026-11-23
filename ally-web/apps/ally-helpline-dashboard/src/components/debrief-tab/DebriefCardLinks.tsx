import { FC } from "react";

import { Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ACTIVE_TRACK_CONTEXT_KEY, DebriefSupportLine, SupervisorDebriefFlag } from "@types";

/**
 * `ROUTES.SCENARIO` for one roleplay. Built here rather than imported: the
 * routes module loads icons at import time, which this card list must not.
 */
export const scenarioPath = (id: number) => `/scenario/${id}`;

/** `ROUTES.LEARN`, the learner's roleplays; built here for the same reason. */
export const ROLEPLAYS_PATH = "/learn";

/**
 * Inside a course a practice roleplay opens as its course item, in the course
 * player (`/track/:trackId/item/:itemId`, as `buildTrackItemRoute`), when the
 * learner came from that course; otherwise the roleplay's own page.
 */
export const practicePath = (scenario: { id: number; trackItemId?: string }) => {
  if (scenario.trackItemId) {
    try {
      const raw = sessionStorage.getItem(ACTIVE_TRACK_CONTEXT_KEY);
      const trackId = raw ? (JSON.parse(raw) as { trackId?: string })?.trackId : null;
      if (trackId) return `/track/${trackId}/item/${scenario.trackItemId}`;
    } catch {
      // sessionStorage unavailable: the roleplay's own page.
    }
  }
  return scenarioPath(scenario.id);
};

/**
 * "Practise this next" / "Practise this": opens the roleplay's own page, so
 * its language choice and trigger warnings come first. Rendered only for a
 * roleplay the server says the learner can still open. `again`: a course
 * session's "Practise this again", which opens this same course item.
 */
export const PractiseLink: FC<{
  scenario: { id: number; title: string; trackItemId?: string };
  primary?: boolean;
  again?: boolean;
  onClick?: () => void;
}> = ({ scenario, primary, again, onClick }) => {
  const { t } = useTranslation();
  return (
    <Link
      to={practicePath(scenario)}
      onClick={onClick}
      data-testid={primary ? "debrief-practise-next" : "debrief-practise-this"}
      aria-label={t("postSim.debriefCards.practise.label", { title: scenario.title })}
      className={
        primary
          ? "inline-flex min-h-[44px] items-center justify-center self-start rounded-md bg-primary-600 px-4 font-primary text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          : "inline-flex min-h-[44px] items-center gap-1 self-start rounded-md px-2 font-primary text-sm font-semibold text-primary-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
      }
    >
      {again
        ? t("postSim.debriefCards.practise.again")
        : primary
          ? t("postSim.debriefCards.practise.next")
          : t("postSim.debriefCards.practise.this")}
    </Link>
  );
};

/** The organisation's support lines, each number a tap-to-call link. */
export const SupportLines: FC<{ lines: DebriefSupportLine[] }> = ({ lines }) => (
  <ul className="flex flex-col gap-2" data-testid="debrief-support-lines">
    {lines.map(line => (
      <li key={`${line.name}-${line.phone}`} className="flex flex-col font-primary text-sm">
        <a
          href={`tel:${line.phone.replace(/[^\d+]/g, "")}`}
          className="inline-flex min-h-[44px] items-center gap-2 font-semibold text-typography-900 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
        >
          <Phone aria-hidden="true" className="h-4 w-4 shrink-0 text-primary-600" />
          {line.name} · {line.phone}
        </a>
        {line.hours && <span className="pl-6 text-xs text-typography-700">{line.hours}</span>}
      </li>
    ))}
  </ul>
);

/** What the learner said about one card, and the outcome — for a supervisor. */
export const SupervisorFlag: FC<{ flag?: SupervisorDebriefFlag }> = ({ flag }) => {
  const { t } = useTranslation();
  if (!flag) return null;
  const outcome =
    flag.status === "kept"
      ? t("postSim.debriefCards.supervisor.kept", { note: flag.resolutionNote ?? "" })
      : flag.status === "corrected"
        ? t("postSim.debriefCards.supervisor.corrected", { note: flag.resolutionNote ?? "" })
        : flag.status === "removed"
          ? t("postSim.debriefCards.supervisor.removed")
          : t("postSim.debriefCards.supervisor.waiting");
  return (
    <div
      data-testid="debrief-supervisor-flag"
      className="flex flex-col gap-1 rounded-md border-l-4 border-warning-400 bg-warning-50 px-3 py-2 font-primary text-xs text-typography-900"
    >
      <span>
        {t("postSim.debriefCards.supervisor.flagged", {
          reason: flag.reason ? t(`postSim.debriefCards.flag.reasons.${flag.reason}`) : "",
        })}
      </span>
      {flag.note && <span>{t("postSim.debriefCards.supervisor.note", { note: flag.note })}</span>}
      <span>{outcome}</span>
    </div>
  );
};
