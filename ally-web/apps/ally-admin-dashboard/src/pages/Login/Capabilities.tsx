import React from "react";

import { en } from "@constants";

import { PALETTE } from "./Motifs";

type GlyphProps = { className?: string };

const { accent, sky, rose, sun, ivory } = PALETTE;
const teal = "#14B8A6";

/** The tile colour behind each icon: saturated, so the white drawing on it reads at a glance. */
const TILES: Record<string, string> = {
  knowledge: sky,
  voice: rose,
  rules: accent,
  handover: sun,
  lists: teal,
  brand: rose,
  test: sky,
  access: teal,
  learn: sun,
};

const SOFT = 0.55;

/** The white drawing inside an icon tile (24 x 24); `tile` is the tile colour, for cut-outs. */
const Drawing: React.FC<{ id: string; tile: string }> = ({ id, tile }) => {
  switch (id) {
    case "knowledge":
      return (
        <>
          <rect x="6.5" y="3" width="12" height="15" rx="1.5" fill={ivory} opacity={SOFT} />
          <rect x="4.5" y="6" width="12" height="15" rx="1.5" fill={ivory} />
          <rect x="7" y="9.5" width="7" height="1.8" fill={tile} />
          <rect x="7" y="13" width="7" height="1.8" fill={tile} />
          <rect x="7" y="16.5" width="4" height="1.8" fill={tile} />
        </>
      );
    case "voice":
      return (
        <>
          {[
            [4, 6],
            [8, 12],
            [12, 18],
            [16, 10],
            [20, 5],
          ].map(([x, h]) => (
            <rect key={x} x={x - 1.1} y={12 - h / 2} width="2.2" height={h} rx="1.1" fill={ivory} />
          ))}
        </>
      );
    case "rules":
      return (
        <>
          <path
            d="M12 2.5 L19.5 5.5 V11 C19.5 15.8 16.4 19.4 12 21.5 C7.6 19.4 4.5 15.8 4.5 11 V5.5 Z"
            fill={ivory}
          />
          <path
            d="M8.6 11.8 l2.6 2.6 l4.4 -5"
            stroke={tile}
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "handover":
      return (
        <>
          <circle cx="6.5" cy="8.5" r="2.6" fill={ivory} opacity={SOFT} />
          <path d="M2 17 a4.5 4.5 0 0 1 9 0 Z" fill={ivory} opacity={SOFT} />
          <path
            d="M11.5 12 h5 m-2 -2.6 l2.6 2.6 l-2.6 2.6"
            stroke={ivory}
            strokeWidth="1.9"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="18.5" cy="8.5" r="2.6" fill={ivory} />
          <path d="M14 18 a4.5 4.5 0 0 1 9 0 Z" fill={ivory} />
        </>
      );
    case "lists":
      return (
        <>
          {[6, 12, 18].map((y, index) => (
            <g key={y} opacity={index === 1 ? SOFT : 1}>
              <circle cx="5.5" cy={y} r="1.8" fill={ivory} />
              <rect x="9.5" y={y - 1.2} width="10" height="2.4" rx="1.2" fill={ivory} />
            </g>
          ))}
        </>
      );
    case "brand":
      return (
        <>
          <circle cx="9" cy="10" r="5.5" fill={ivory} />
          <circle cx="15" cy="10" r="5.5" fill={ivory} opacity={0.7} />
          <circle cx="12" cy="15" r="5.5" fill={ivory} opacity={0.45} />
        </>
      );
    case "test":
      return (
        <>
          <circle cx="12" cy="12" r="9" fill={ivory} />
          <path d="M10 7.8 L16.4 12 L10 16.2 Z" fill={tile} />
        </>
      );
    case "access":
      return (
        <>
          <path
            d="M7.5 11 V8 a4.5 4.5 0 0 1 9 0 v3"
            stroke={ivory}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <rect x="4.5" y="11" width="15" height="10" rx="2" fill={ivory} />
          <circle cx="12" cy="15.2" r="1.7" fill={tile} />
          <rect x="11.2" y="15.5" width="1.6" height="3" rx="0.8" fill={tile} />
        </>
      );
    case "learn":
    default:
      return (
        <>
          <path
            d="M3.5 5.5 a2 2 0 0 1 2 -2 h13 a2 2 0 0 1 2 2 v9 a2 2 0 0 1 -2 2 h-8 l-4.5 4 v-4 h-0.5 a2 2 0 0 1 -2 -2 Z"
            fill={ivory}
          />
          <rect x="7" y="7.2" width="10" height="1.8" fill={tile} />
          <rect x="7" y="10.8" width="6" height="1.8" fill={tile} />
        </>
      );
  }
};

/** An icon tile: a saturated rounded square with a white drawing, one per capability. */
const Glyph: React.FC<GlyphProps & { id: string }> = ({ id, className }) => {
  const tile = TILES[id] ?? sky;
  return (
    <span
      className={`flex h-12 w-12 items-center justify-center rounded-xl ${className ?? ""}`}
      style={{ background: tile }}
    >
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true" focusable="false">
        <Drawing id={id} tile={tile} />
      </svg>
    </span>
  );
};

/** What each tile turns into on hover: a palette fill and the text colour that reads on it. */
const HOVERS = [
  { bg: PALETTE.butter, fg: PALETTE.ink },
  { bg: PALETTE.lilac, fg: PALETTE.ink },
  { bg: PALETTE.sand, fg: PALETTE.ink },
  { bg: PALETTE.pink, fg: PALETTE.ink },
  { bg: PALETTE.peach, fg: PALETTE.ink },
];

/**
 * What a builder can do and control, as a bordered grid under a divider. Informational: no data,
 * and nothing in it gets in the way of signing in.
 */
export const Capabilities: React.FC = () => {
  const { heading, items } = en.assistantsShell.login.capabilities;
  if (!items.length) return null;
  return (
    <section
      aria-label={heading}
      data-testid="capabilities"
      className="mt-4 flex flex-col gap-4 border-t border-[#1E1B4B]/20 pt-6"
    >
      <h2 className="text-base font-semibold text-[#1E1B4B]">{heading}</h2>
      <ul className="m-0 grid list-none grid-cols-2 border-l border-t border-[#1E1B4B]/20 p-0 sm:grid-cols-3">
        {items.map((item, index) => {
          const hover = HOVERS[index % HOVERS.length];
          return (
            <li
              key={item.id}
              className="group flex flex-col gap-2 border-b border-r border-[#1E1B4B]/20 p-4 text-[#1E1B4B] transition-colors duration-200 hover:!bg-[var(--hover-bg)] hover:!text-[var(--hover-fg)]"
              style={{ "--hover-bg": hover.bg, "--hover-fg": hover.fg } as React.CSSProperties}
            >
              <Glyph
                id={item.id}
                className="mb-2 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"
              />
              <h3 className="font-secondary text-base font-semibold leading-tight tracking-[-0.01em]">
                {item.title}
              </h3>
              <p className="text-sm leading-snug opacity-70">{item.blurb}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
