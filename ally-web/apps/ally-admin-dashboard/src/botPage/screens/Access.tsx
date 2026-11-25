import { useEffect, useState } from "react";

import {
  ErrorText,
  PageHeader,
  PrimaryButton,
  ScreenHeading,
  TextButton,
} from "../components/parts";
import { fill, type BotPageCopy } from "../copy";

import type { BotPageBranding, PublicBotPage } from "../types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_AFTER_SECONDS = 30;

/**
 * Crisis information for every visitor, before any code is requested (stage 6): the chatbot's own
 * numbers first when the public view has them, then the findahelpline.com link. It says nothing
 * about who is on the invite list: the invited line (TF1 F17) is the same for
 * everyone, and nothing here changes with the address typed.
 */
export function CrisisInfo({
  copy,
  crisis,
}: {
  copy: BotPageCopy;
  crisis?: PublicBotPage["crisis"];
}) {
  const numbers = crisis?.numbers?.trim();
  const url = crisis?.helplineUrl?.trim() || copy.crisis.linkUrl;
  return (
    <aside className="bp-stack" aria-labelledby="bp-crisis-title" data-testid="bp-crisis-info">
      <p id="bp-crisis-title" className="ally-body" style={{ margin: 0, fontWeight: 600 }}>
        {copy.crisis.title}
      </p>
      {numbers && (
        <p className="ally-body" style={{ margin: 0 }} data-testid="bp-crisis-numbers">
          {fill(copy.crisis.numbers, { numbers })}
        </p>
      )}
      <p className="ally-body" style={{ margin: 0 }}>
        <a href={url} target="_blank" rel="noopener noreferrer">
          {copy.crisis.link}
        </a>
      </p>
      <p className="bp-small bp-muted" style={{ margin: 0 }} data-testid="bp-invited-line">
        {copy.crisis.invited}
      </p>
    </aside>
  );
}

export function AccessEmail({
  branding,
  copy,
  crisis,
  onSubmit,
  busy = false,
  error,
  initialEmail = "",
}: {
  branding: BotPageBranding;
  copy: BotPageCopy;
  crisis?: PublicBotPage["crisis"];
  onSubmit(email: string): void;
  busy?: boolean;
  error?: string | null;
  initialEmail?: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [invalid, setInvalid] = useState(false);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = email.trim();
    if (!EMAIL.test(value)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSubmit(value);
  };
  return (
    <div className="bp-screen">
      <PageHeader branding={branding} />
      <form onSubmit={submit} className="bp-pad bp-stack bp-grow ally-slide" noValidate>
        <CrisisInfo copy={copy} crisis={crisis} />
        <ScreenHeading>{copy.access.emailTitle}</ScreenHeading>
        <p className="ally-body bp-muted" style={{ margin: 0 }}>
          {copy.access.emailHelp}
        </p>
        <label htmlFor="bp-email" className="bp-label">
          {copy.access.emailLabel}
        </label>
        <input
          id="bp-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder={copy.access.emailPlaceholder}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "bp-email-error" : undefined}
          className="ally-input"
        />
        {invalid && (
          <p id="bp-email-error" className="bp-error">
            {copy.access.invalidEmail}
          </p>
        )}
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? copy.loading : copy.access.sendCode}
        </PrimaryButton>
        <ErrorText>{error}</ErrorText>
      </form>
    </div>
  );
}

export function AccessCode({
  branding,
  copy,
  email,
  onSubmit,
  onResend,
  onChangeEmail,
  busy = false,
  error,
}: {
  branding: BotPageBranding;
  copy: BotPageCopy;
  email: string;
  onSubmit(code: string): void;
  onResend(): void;
  onChangeEmail(): void;
  busy?: boolean;
  error?: string | null;
}) {
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(RESEND_AFTER_SECONDS);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait(w => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (/^\d{6}$/.test(code)) onSubmit(code);
  };
  return (
    <div className="bp-screen">
      <PageHeader branding={branding} />
      <form onSubmit={submit} className="bp-pad bp-stack bp-grow ally-slide">
        <ScreenHeading>{copy.access.codeTitle}</ScreenHeading>
        <p className="ally-body bp-muted" style={{ margin: 0 }}>
          {fill(copy.access.codeHelp, { email })}
        </p>
        <label htmlFor="bp-code" className="bp-label">
          {copy.access.codeLabel}
        </label>
        <input
          id="bp-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="ally-input bp-code"
        />
        <PrimaryButton type="submit" disabled={busy || code.length !== 6}>
          {busy ? copy.loading : copy.access.verify}
        </PrimaryButton>
        <ErrorText>{error}</ErrorText>
        <p className="bp-small bp-muted" style={{ margin: 0 }}>
          {copy.access.noCode}
        </p>
        <div className="bp-links">
          <TextButton
            onClick={() => {
              setWait(RESEND_AFTER_SECONDS);
              onResend();
            }}
            disabled={busy || wait > 0}
          >
            {wait > 0 ? fill(copy.access.resendIn, { seconds: wait }) : copy.access.resend}
          </TextButton>
          <TextButton onClick={onChangeEmail} disabled={busy}>
            {copy.access.changeEmail}
          </TextButton>
        </div>
      </form>
    </div>
  );
}
