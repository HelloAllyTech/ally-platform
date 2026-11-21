import { FC } from "react";

import { V2_BACKEND } from "./v2Backend";
import { BugHunter } from "../BugHunter/BugHunter";
import { BugHunterBackendProvider } from "../BugHunter/bugHunterBackend";

/**
 * Bug Hunter v2's page: the old Bug Hunter's page itself, on v2's data (chunk 11, the
 * user asked for an exact match of the old UI). See `v2Backend.ts` for what maps to what.
 */
export const BugHunterV2Page: FC = () => (
  <BugHunterBackendProvider value={V2_BACKEND}>
    <BugHunter />
  </BugHunterBackendProvider>
);

export default BugHunterV2Page;
