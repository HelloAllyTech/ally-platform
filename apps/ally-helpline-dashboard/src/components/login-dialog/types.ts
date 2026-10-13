import { ReactNode } from "react";

export interface LoginPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /**
   * Show the terms-of-use agreement after the code is verified and only sign
   * in once it is accepted — what the full login page does on every sign-in.
   * Off by default so existing callers keep their flow.
   */
  requireTerms?: boolean;
  /** Extra content under the email step (e.g. who to ask for an account). */
  emailFooter?: ReactNode;
}
