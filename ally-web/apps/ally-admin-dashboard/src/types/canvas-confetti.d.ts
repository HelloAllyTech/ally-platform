/** canvas-confetti ships no types; only what the Roadmap's Shipped card calls. */
declare module "canvas-confetti" {
  interface ConfettiOptions {
    particleCount?: number;
    spread?: number;
    ticks?: number;
    startVelocity?: number;
    origin?: { x?: number; y?: number };
    colors?: string[];
    disableForReducedMotion?: boolean;
    zIndex?: number;
  }
  const confetti: (options?: ConfettiOptions) => Promise<null> | null;
  export default confetti;
}
