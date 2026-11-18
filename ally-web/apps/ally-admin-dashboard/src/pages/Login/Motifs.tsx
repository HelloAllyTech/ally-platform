import React, { useId } from "react";

/** The colours the assistants login is drawn in. */
export const PALETTE = {
  /** Deep indigo: text and the few solid shapes. */
  ink: "#1E1B4B",
  /** The page: a lavender-tinted white. */
  cream: "#F6F5FF",
  /** White: panels, bubbles, text on the accent. */
  ivory: "#FFFFFF",
  /** Electric violet: the accent. */
  accent: "#5B4BFF",
  peach: "#FFD6BA",
  butter: "#FFE9A8",
  mint: "#BFEBD7",
  lilac: "#D9CCFF",
  pink: "#FFC9DE",
  sky: "#3D8BFF",
  rose: "#FF5E9C",
  /** The sun in the helpline motif. */
  sun: "#FF7A59",
  /** A quiet tile fill. */
  sand: "#E6E4F7",
} as const;

export interface Tone {
  /** Card and panel-header background. */
  bg: string;
  /** Text on `bg`. */
  fg: string;
  /** Blurb text on `bg`: `fg` a little softer. */
  soft: string;
}

const onPastel = (bg: string): Tone => ({ bg, fg: PALETTE.ink, soft: "rgba(30,27,75,0.75)" });

export const TONES: Record<string, Tone> = {
  helpline: onPastel(PALETTE.peach),
  services: { bg: PALETTE.accent, fg: PALETTE.ivory, soft: "rgba(255,255,255,0.85)" },
  supporters: onPastel(PALETTE.butter),
  training: onPastel(PALETTE.mint),
  languages: onPastel(PALETTE.lilac),
  updates: onPastel(PALETTE.pink),
};

export const DEFAULT_TONE: Tone = TONES.helpline;

const { ivory, accent, butter, sky, rose, sun } = PALETTE;

type MotifProps = { className?: string };

/** A sun rising over a horizon: help at any hour. */
const Sunrise: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <path d="M42 72 A38 38 0 0 1 118 72 Z" fill={sun} />
    {[-72, -36, 0, 36, 72].map(angle => (
      <line
        key={angle}
        x1="80"
        y1="72"
        x2="80"
        y2="14"
        stroke={butter}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="0 40 10 100"
        transform={`rotate(${angle} 80 72)`}
      />
    ))}
    <line x1="14" y1="72" x2="146" y2="72" stroke={ivory} strokeWidth="3" strokeLinecap="round" />
    <line
      x1="34"
      y1="84"
      x2="126"
      y2="84"
      stroke={ivory}
      strokeWidth="3"
      strokeLinecap="round"
      opacity="0.5"
    />
    <line
      x1="54"
      y1="96"
      x2="106"
      y2="96"
      stroke={ivory}
      strokeWidth="3"
      strokeLinecap="round"
      opacity="0.25"
    />
  </svg>
);

/** Steps up to a marker: a clear path to the service. */
const Steps: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <rect x="14" y="66" width="38" height="30" fill={ivory} />
    <rect x="58" y="46" width="38" height="50" fill={butter} />
    <rect x="102" y="26" width="38" height="70" fill={ivory} />
    <circle cx="121" cy="13" r="8" fill={ivory} />
  </svg>
);

/** Two circles overlapping: people coming together. */
const Overlap: React.FC<MotifProps> = ({ className }) => {
  const id = useId();
  return (
    <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={id}>
          <circle cx="62" cy="50" r="34" />
        </clipPath>
      </defs>
      <circle cx="62" cy="50" r="34" fill={rose} />
      <circle cx="98" cy="50" r="34" fill={accent} />
      <circle cx="98" cy="50" r="34" fill={ivory} clipPath={`url(#${id})`} />
    </svg>
  );
};

/** Books stacked at an angle: learning from your own pages. */
const Stack: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <rect x="22" y="68" width="116" height="20" fill={ivory} />
    <rect x="34" y="46" width="98" height="20" fill={butter} />
    <rect x="28" y="24" width="84" height="20" fill={ivory} transform="rotate(-7 70 34)" />
    <circle cx="136" cy="30" r="9" fill={accent} />
  </svg>
);

/** Two speech bubbles: many languages, one conversation. */
const Bubbles: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <path
      d="M14 14 h78 a10 10 0 0 1 10 10 v32 a10 10 0 0 1 -10 10 h-50 l-18 14 v-14 h-10 a10 10 0 0 1 -10 -10 v-32 a10 10 0 0 1 10 -10 Z"
      fill={sky}
    />
    <circle cx="38" cy="40" r="4.5" fill={ivory} />
    <circle cx="53" cy="40" r="4.5" fill={ivory} />
    <circle cx="68" cy="40" r="4.5" fill={ivory} />
    <path
      d="M72 44 h74 a10 10 0 0 1 10 10 v26 a10 10 0 0 1 -10 10 h-4 v12 l-16 -12 h-54 a10 10 0 0 1 -10 -10 v-26 a10 10 0 0 1 10 -10 Z"
      fill={accent}
      transform="translate(0 -8)"
    />
    <line x1="90" y1="58" x2="140" y2="58" stroke={ivory} strokeWidth="4" strokeLinecap="round" />
    <line x1="90" y1="70" x2="120" y2="70" stroke={ivory} strokeWidth="4" strokeLinecap="round" />
  </svg>
);

/** Rings spreading out from a point: news reaching everyone. */
const Rings: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <circle cx="80" cy="50" r="11" fill={accent} />
    <circle cx="80" cy="50" r="26" fill="none" stroke={accent} strokeWidth="5" />
    <circle cx="80" cy="50" r="41" fill="none" stroke={accent} strokeWidth="5" opacity="0.6" />
    <circle cx="80" cy="50" r="56" fill="none" stroke={accent} strokeWidth="5" opacity="0.3" />
  </svg>
);

const MOTIFS: Record<string, React.FC<MotifProps>> = {
  helpline: Sunrise,
  services: Steps,
  supporters: Overlap,
  training: Stack,
  languages: Bubbles,
  updates: Rings,
};

/** The flat shape motif for a use case: bold fills, no outline icon. */
export const Motif: React.FC<MotifProps & { id: string }> = ({ id, className }) => {
  const Shape = MOTIFS[id] ?? Sunrise;
  return <Shape className={className} />;
};
