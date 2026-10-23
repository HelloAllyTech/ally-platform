import { CSSProperties, FC } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "still" | "waiting";

interface AllyPresenceProps {
  state: OrbState;
  /** Core diameter in px (presence spec §2: header 32, Theatre corner 28, margin glyph 14). */
  size?: number;
  /** Accessible name; omit for a decorative copy of the mark. */
  label?: string;
  className?: string;
}

/**
 * Ally's mark: an abstract clay orb whose motion carries its state (plan
 * §5.3). It never gets a face. Under reduced motion only shape and colour
 * change (guided.css), and every state also has a caption elsewhere, so
 * nothing depends on the animation.
 */
export const AllyPresence: FC<AllyPresenceProps> = ({ state, size = 32, label, className }) => (
  <span
    className={`g-orb ${className ?? ""}`}
    data-state={state}
    style={{ "--orb-size": `${size}px` } as CSSProperties}
    {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
  >
    <span className="g-orb__halo" />
    <span className="g-orb__core" />
    <span className="g-orb__sheen" />
  </span>
);
