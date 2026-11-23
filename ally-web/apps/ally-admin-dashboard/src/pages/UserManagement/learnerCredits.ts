/** Every learner is created with at least this many simulation credits. */
export const MIN_LEARNER_CREDITS = 20;

/** The limit actually sent, and whether we had to raise what the admin typed. */
export const resolveLearnerCreditLimit = (entered: unknown) => {
  const asked = Number(entered || 0);
  return { limit: Math.max(asked, MIN_LEARNER_CREDITS), raised: asked < MIN_LEARNER_CREDITS };
};
