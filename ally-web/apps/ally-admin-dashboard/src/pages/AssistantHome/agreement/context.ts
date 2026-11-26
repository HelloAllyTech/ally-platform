import { createContext, useContext } from "react";

/**
 * What a conversation does when the server says the responder agreement is needed first (take
 * over, reply, or open a chat): ask the section around it to show the agreement. The default
 * does nothing, so an inbox drawn alone behaves as before.
 */
export const AgreementGateContext = createContext<{
  /** TF1 round 2 (Saathi B-11): `then` runs once they accept (the take-over they asked for). */
  require: (then?: () => void) => void;
}>({ require: () => {} });

export const useAgreementGate = () => useContext(AgreementGateContext);
