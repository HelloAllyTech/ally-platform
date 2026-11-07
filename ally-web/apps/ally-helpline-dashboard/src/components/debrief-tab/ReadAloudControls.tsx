import { FC, createContext, useContext } from "react";

import { Pause, Play, Square, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { READ_ALOUD_SPEEDS, ReadAloud, ReadAloudSpeed } from "./useDebriefReadAloud";

/** The debrief's read-aloud, shared by the header bar and every card. */
export const ReadAloudContext = createContext<ReadAloud | null>(null);

const iconButton =
  "inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 font-primary text-sm text-typography-800 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600";

/**
 * "Listen all" in the header strip: plays every card in order, with pause,
 * stop and speed (0.75 / 1 / 1.25×). Audio is never the only way to the
 * content; on an error the cards stay as they are.
 */
export const ListenAllBar: FC<{ sections: string[] }> = ({ sections }) => {
  const { t } = useTranslation();
  const ra = useContext(ReadAloudContext);
  if (!ra || !sections.length) return null;
  const active = ra.status === "playing" || ra.status === "paused" || ra.status === "loading";
  return (
    <div data-testid="debrief-listen-all" className="flex flex-wrap items-center gap-1">
      {!active && (
        <button
          type="button"
          className={`${iconButton} text-white`}
          onClick={() => ra.play(sections)}
        >
          <Volume2 aria-hidden="true" className="h-4 w-4" />
          {t("postSim.debriefCards.listen.all")}
        </button>
      )}
      {ra.status === "playing" && (
        <button type="button" className={`${iconButton} text-white`} onClick={ra.pause}>
          <Pause aria-hidden="true" className="h-4 w-4" />
          {t("postSim.debriefCards.listen.pause")}
        </button>
      )}
      {ra.status === "paused" && (
        <button type="button" className={`${iconButton} text-white`} onClick={ra.resume}>
          <Play aria-hidden="true" className="h-4 w-4" />
          {t("postSim.debriefCards.listen.resume")}
        </button>
      )}
      {active && (
        <button type="button" className={`${iconButton} text-white`} onClick={ra.stop}>
          <Square aria-hidden="true" className="h-4 w-4" />
          {t("postSim.debriefCards.listen.stop")}
        </button>
      )}
      <label className="flex items-center gap-1 font-primary text-xs text-white">
        {t("postSim.debriefCards.listen.speed")}
        <select
          value={ra.speed}
          onChange={e => ra.setSpeed(Number(e.target.value) as ReadAloudSpeed)}
          className="min-h-[32px] rounded-md bg-white/90 px-1 text-typography-900"
        >
          {READ_ALOUD_SPEEDS.map(s => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
    </div>
  );
};

/** The live status line: getting audio ready, or why it stopped. */
export const ReadAloudStatusLine: FC = () => {
  const { t } = useTranslation();
  const ra = useContext(ReadAloudContext);
  if (!ra || (ra.status !== "loading" && ra.status !== "error")) return null;
  return (
    <p
      role={ra.status === "error" ? "alert" : "status"}
      data-testid="debrief-listen-status"
      className="font-primary text-sm text-typography-700"
    >
      {ra.status === "error"
        ? t("postSim.debriefCards.listen.error")
        : t("postSim.debriefCards.listen.loading")}
    </p>
  );
};

/** "Listen" on one card. */
export const ListenButton: FC<{ section: string; cardLabel: string }> = ({
  section,
  cardLabel,
}) => {
  const { t } = useTranslation();
  const ra = useContext(ReadAloudContext);
  if (!ra) return null;
  const reading = ra.current === section && ra.status === "playing";
  return (
    <button
      type="button"
      data-testid="debrief-listen-card"
      className={`${iconButton} self-start`}
      aria-label={
        reading
          ? t("postSim.debriefCards.listen.pause")
          : t("postSim.debriefCards.listen.cardLabel", { card: cardLabel })
      }
      onClick={() => (reading ? ra.pause() : ra.play([section]))}
    >
      {reading ? (
        <Pause aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <Volume2 aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      {reading ? t("postSim.debriefCards.listen.pause") : t("postSim.debriefCards.listen.card")}
    </button>
  );
};

/** A ring on the card being read, so the eye can follow the voice. */
export const useIsBeingRead = (section: string) => {
  const ra = useContext(ReadAloudContext);
  return !!ra && ra.current === section && ra.status !== "idle" && ra.status !== "error";
};
