/** What a refused request says: its `errorCode` and the server's own words. */
export const errorInfo = (failure: unknown): { code: string | null; message: string | null } => {
  const data = (failure as { data?: { errorCode?: unknown; message?: unknown } } | null)?.data;
  return {
    code: typeof data?.errorCode === "string" ? data.errorCode : null,
    message: typeof data?.message === "string" ? data.message : null,
  };
};

/** The responder agreement is needed before this (take over, reply, read a chat). */
export const AGREEMENT_REQUIRED = "responder_agreement_required";

export const needsAgreement = (failure: unknown): boolean =>
  errorInfo(failure).code === AGREEMENT_REQUIRED;
