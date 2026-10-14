import { FormEvent, forwardRef } from "react";

import { Trans, useTranslation } from "react-i18next";

import { GoogleSignInButton } from "@ally-ui-mono/ui-shared";
import { OTP } from "@components";
import { ROUTES } from "@constants";
import { cn } from "@utils";

const legalLink = "text-primary-500 underline underline-offset-2 hover:text-primary-600";

interface MessageComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  /** Pulls the eye here when Ally has just asked for an email. */
  highlighted: boolean;
  isSending: boolean;
  signedIn: boolean;
  onGoogleSuccess: (token: { accessToken?: string; credential?: string }) => void;
  onGoogleError: () => void;
}

/** One box for both a question and an email: whatever is typed, the page decides which it was. */
export const MessageComposer = forwardRef<HTMLInputElement, MessageComposerProps>(
  (
    {
      draft,
      onDraftChange,
      onSubmit,
      highlighted,
      isSending,
      signedIn,
      onGoogleSuccess,
      onGoogleError,
    },
    inputRef,
  ) => {
    const { t } = useTranslation();
    const handleSubmit = (event: FormEvent) => {
      event.preventDefault();
      onSubmit();
    };

    return (
      <form
        onSubmit={handleSubmit}
        className={cn(
          "ph-no-capture flex flex-col gap-2 rounded-[22px] border-2 bg-white py-2.5 pl-5 pr-2.5 shadow-md transition-colors",
          highlighted ? "border-primary-500" : "border-gray-200",
        )}
      >
        <label htmlFor="home-v2-message" className="sr-only">
          {t("homeV2.composer.label")}
        </label>
        <div className="flex items-center gap-2">
          <input
            id="home-v2-message"
            ref={inputRef}
            type="text"
            autoComplete="email"
            enterKeyHint="send"
            value={draft}
            onChange={event => onDraftChange(event.target.value)}
            placeholder={t(
              signedIn ? "homeV2.composer.placeholderSignedIn" : "homeV2.composer.placeholder",
            )}
            className="min-h-12 min-w-0 flex-1 border-0 bg-transparent text-xl text-gray-900 placeholder:text-gray-500 focus:outline-none"
          />
          <button
            type="submit"
            aria-label={t("homeV2.composer.send")}
            disabled={!draft.trim() || isSending}
            className="flex size-12 flex-none items-center justify-center rounded-full bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-40"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 19V5M6 11l6-6 6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        {!signedIn && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pr-2 pt-2.5">
            {import.meta.env.VITE_GOOGLE_AUTH_CLIENT_ID ? (
              <div className="w-full sm:w-60">
                <GoogleSignInButton
                  onSuccess={onGoogleSuccess}
                  onError={onGoogleError}
                  text={t("homeV2.composer.google")}
                />
              </div>
            ) : null}
            <p className="m-0 text-xs text-gray-600">
              <Trans
                i18nKey="homeV2.composer.agree"
                components={{
                  terms: (
                    <a
                      href={ROUTES.TERMS}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={legalLink}
                    />
                  ),
                  privacy: (
                    <a
                      href={ROUTES.PRIVACY}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={legalLink}
                    />
                  ),
                }}
              />
            </p>
          </div>
        )}
      </form>
    );
  },
);
MessageComposer.displayName = "MessageComposer";

interface CodeComposerProps {
  email: string;
  code: string;
  onCodeChange: (value: string) => void;
  onVerify: (code: string) => void;
  isVerifying: boolean;
  countdown: number;
  onResend: () => void;
  onDifferentEmail: () => void;
}

export const CodeComposer = ({
  email,
  code,
  onCodeChange,
  onVerify,
  isVerifying,
  countdown,
  onResend,
  onDifferentEmail,
}: CodeComposerProps) => {
  const { t } = useTranslation();
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onVerify(code);
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-labelledby="home-v2-code-label"
      className="ph-no-capture flex flex-col gap-3 rounded-[22px] border-2 border-primary-500 bg-white p-4 shadow-md"
    >
      <p id="home-v2-code-label" className="m-0 text-md text-gray-800">
        {t("homeV2.composer.codeLabel", { email })}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <OTP
          value={code}
          onChange={onCodeChange}
          onComplete={onVerify}
          autoFocus
          aria-labelledby="home-v2-code-label"
          className="gap-2 sm:gap-3"
          inputClassName="w-12 h-12 sm:w-14 sm:h-14 bg-gray-100"
        />
        <button
          type="submit"
          disabled={code.length < 4 || isVerifying}
          className="min-h-12 rounded-xl bg-primary-500 px-5 text-lg font-semibold text-white hover:bg-primary-600 disabled:opacity-40"
        >
          {isVerifying ? t("homeV2.composer.verifying") : t("homeV2.composer.verify")}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-md">
        <button
          type="button"
          onClick={onResend}
          disabled={countdown > 0}
          className="min-h-10 text-primary-500 hover:text-primary-600 disabled:text-gray-500"
        >
          {countdown > 0
            ? t("homeV2.composer.resendIn", { seconds: countdown })
            : t("homeV2.composer.resend")}
        </button>
        <button
          type="button"
          onClick={onDifferentEmail}
          className="min-h-10 text-primary-500 hover:text-primary-600"
        >
          {t("homeV2.composer.differentEmail")}
        </button>
      </div>
    </form>
  );
};
