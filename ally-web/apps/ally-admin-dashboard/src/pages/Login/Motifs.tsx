import React, { useId } from "react";

/** The colours the assistants login is drawn in. */
export const PALETTE = {
  /** Warm espresso ink: text and the few solid shapes. */
  ink: "#2B2520",
  /** The page: a lavender-tinted white. */
  cream: "#FAF6EE",
  /** White: panels, bubbles, text on the accent. */
  ivory: "#FFFDF9",
  /** Clay: the accent. */
  accent: "#C4532D",
  peach: "#F8D9C0",
  butter: "#F6E3A8",
  mint: "#CFE3CF",
  lilac: "#E3D8EE",
  pink: "#F5CFD0",
  sky: "#4F7C8A",
  rose: "#C95F6E",
  /** The sun in the helpline motif. */
  sun: "#E8794A",
  /** A quiet tile fill. */
  sand: "#EDE5D6",
} as const;

export interface Tone {
  /** Card and panel-header background. */
  bg: string;
  /** Text on `bg`. */
  fg: string;
  /** Blurb text on `bg`: `fg` a little softer. */
  soft: string;
}

const onPastel = (bg: string): Tone => ({ bg, fg: PALETTE.ink, soft: "rgba(43,37,32,0.75)" });

export const TONES: Record<string, Tone> = {
  helpline: onPastel(PALETTE.peach),
  services: { bg: PALETTE.accent, fg: PALETTE.ivory, soft: "rgba(255,255,255,0.85)" },
  supporters: onPastel(PALETTE.butter),
  training: onPastel(PALETTE.mint),
  languages: onPastel(PALETTE.lilac),
  updates: onPastel(PALETTE.pink),
};

export const DEFAULT_TONE: Tone = TONES.helpline;

const { ivory, accent, butter, sky, rose, sun, mint } = PALETTE;

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

/* Business templates, keyed by template id. Same rules as above: flat fills from the palette. */

/** A cross in a circle with a pulse dot: a clinic. */
const Cross: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <circle cx="80" cy="50" r="38" fill={ivory} />
    <rect x="70" y="26" width="20" height="48" rx="3" fill={accent} />
    <rect x="56" y="40" width="48" height="20" rx="3" fill={accent} />
    <circle cx="128" cy="22" r="8" fill={sky} />
  </svg>
);

/** Three waves of hair: a salon. */
const Waves: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    {[
      { y: 30, color: rose },
      { y: 50, color: accent },
      { y: 70, color: sky },
    ].map(({ y, color }) => (
      <path
        key={y}
        d={`M22 ${y} q14.5 -16 29 0 t29 0 t29 0 t29 0`}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
      />
    ))}
  </svg>
);

/** A plate between a fork and a knife: a restaurant. */
const Plate: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <circle cx="80" cy="50" r="38" fill={ivory} />
    <circle cx="80" cy="50" r="24" fill={butter} />
    <rect x="24" y="14" width="8" height="72" rx="4" fill={accent} />
    <rect x="18" y="14" width="20" height="22" rx="4" fill={accent} />
    <path d="M128 14 h8 v72 h-8 Z M128 14 q-10 20 0 40 Z" fill={accent} />
  </svg>
);

/** A house with a door: homes and property. */
const House: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <rect x="46" y="46" width="68" height="48" fill={ivory} />
    <path d="M36 50 L80 12 L124 50 Z" fill={accent} />
    <rect x="72" y="64" width="16" height="30" fill={sky} />
    <circle cx="132" cy="20" r="8" fill={ivory} />
  </svg>
);

/** A shopping bag with a tag: a store. */
const Bag: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <path
      d="M64 38 v-10 a16 16 0 0 1 32 0 v10"
      fill="none"
      stroke={accent}
      strokeWidth="6"
      strokeLinecap="round"
    />
    <rect x="48" y="36" width="64" height="58" rx="4" fill={ivory} />
    <rect x="98" y="58" width="30" height="18" rx="3" fill={rose} transform="rotate(-12 113 67)" />
    <circle cx="104" cy="66" r="3" fill={ivory} />
  </svg>
);

/** A mortarboard with a tassel: coaching and classes. */
const Cap: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <path d="M54 52 v22 q26 14 52 0 v-22 Z" fill={ivory} />
    <path d="M80 14 L138 38 L80 62 L22 38 Z" fill={accent} />
    <line x1="126" y1="43" x2="126" y2="74" stroke={butter} strokeWidth="4" strokeLinecap="round" />
    <circle cx="126" cy="80" r="6" fill={butter} />
  </svg>
);

/** A dumbbell: a gym. */
const Dumbbell: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <rect x="40" y="45" width="80" height="10" rx="3" fill={ivory} />
    <rect x="30" y="24" width="16" height="52" rx="3" fill={butter} />
    <rect x="114" y="24" width="16" height="52" rx="3" fill={butter} />
    <rect x="16" y="34" width="12" height="32" rx="3" fill={ivory} />
    <rect x="132" y="34" width="12" height="32" rx="3" fill={ivory} />
  </svg>
);

/** Two leaves on a stem: a wellness practice. */
const Leaves: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <path d="M80 94 V40" stroke={ivory} strokeWidth="5" strokeLinecap="round" />
    <path d="M80 62 C 56 66, 36 52, 32 26 C 58 24, 78 38, 80 62 Z" fill={mint} />
    <path d="M80 48 C 98 50, 122 38, 128 12 C 102 10, 82 24, 80 48 Z" fill={ivory} />
    <circle cx="44" cy="80" r="7" fill={butter} />
  </svg>
);

/** A balance with two pans: finance and law. */
const Scales: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <rect x="77" y="18" width="6" height="68" fill={ivory} />
    <rect x="56" y="84" width="48" height="10" rx="3" fill={ivory} />
    <rect x="30" y="22" width="100" height="6" rx="3" fill={accent} />
    <line x1="40" y1="28" x2="40" y2="50" stroke={accent} strokeWidth="2" />
    <line x1="120" y1="28" x2="120" y2="50" stroke={accent} strokeWidth="2" />
    <path d="M20 50 h40 a20 20 0 0 1 -40 0 Z" fill={sky} />
    <path d="M100 50 h40 a20 20 0 0 1 -40 0 Z" fill={rose} />
    <circle cx="80" cy="16" r="7" fill={accent} />
  </svg>
);

/** A lifebuoy: help for your customers. */
const Lifebuoy: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <circle cx="80" cy="50" r="32" fill="none" stroke={accent} strokeWidth="18" />
    <circle
      cx="80"
      cy="50"
      r="32"
      fill="none"
      stroke={ivory}
      strokeWidth="18"
      strokeDasharray="22 28.27"
      strokeDashoffset="11"
    />
  </svg>
);

/** An open book with a bookmark: a staff handbook. */
const OpenBook: React.FC<MotifProps> = ({ className }) => (
  <svg viewBox="0 0 160 100" className={className} aria-hidden="true" focusable="false">
    <path d="M20 22 L78 30 L78 90 L20 82 Z" fill={ivory} />
    <path d="M82 30 L140 22 L140 82 L82 90 Z" fill={ivory} />
    {[44, 56, 68].map(y => (
      <React.Fragment key={y}>
        <line
          x1="32"
          y1={y - 6}
          x2="66"
          y2={y - 1}
          stroke={sky}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line
          x1="94"
          y1={y - 1}
          x2="112"
          y2={y - 3.5}
          stroke={sky}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </React.Fragment>
    ))}
    <path d="M120 24 v34 l7 -6 l7 6 v-36 Z" fill={accent} />
  </svg>
);

const onDark = (bg: string): Tone => ({ bg, fg: PALETTE.ivory, soft: "rgba(255,255,255,0.85)" });

/** Tile colours for the business templates, keyed by template id. */
export const BUSINESS_TONES: Record<string, Tone> = {
  clinic: onPastel(PALETTE.mint),
  salon: onPastel(PALETTE.lilac),
  restaurant: onPastel(PALETTE.peach),
  real_estate: onPastel(PALETTE.butter),
  store: onPastel(PALETTE.pink),
  coaching: onPastel(PALETTE.sand),
  gym: onDark(PALETTE.accent),
  practice: onDark(PALETTE.sky),
  finance_legal: onPastel(PALETTE.lilac),
  support: onPastel(PALETTE.butter),
  handbook: onPastel(PALETTE.mint),
};

const MOTIFS: Record<string, React.FC<MotifProps>> = {
  helpline: Sunrise,
  services: Steps,
  supporters: Overlap,
  training: Stack,
  languages: Bubbles,
  updates: Rings,
  clinic: Cross,
  salon: Waves,
  restaurant: Plate,
  real_estate: House,
  store: Bag,
  coaching: Cap,
  gym: Dumbbell,
  practice: Leaves,
  finance_legal: Scales,
  support: Lifebuoy,
  handbook: OpenBook,
};

/** Whether a use case has a drawn motif; without one, a card shows its emoji. */
export const hasMotif = (id: string): boolean => id in MOTIFS;

/** The flat shape motif for a use case: bold fills, no outline icon. */
export const Motif: React.FC<MotifProps & { id: string }> = ({ id, className }) => {
  const Shape = MOTIFS[id] ?? Sunrise;
  return <Shape className={className} />;
};
