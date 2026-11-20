import { FC, FormEvent, useEffect, useState } from "react";

import { ROUTES } from "@constants";

import { LoginCopy } from "./loginCopy";
import { Button, ButtonVariant } from "../../components/button";
import Drawer from "../../components/drawer";
import Input from "../../components/input";

import "./landing-login.css";

type LoginMethod = "email" | "mobile";

interface LoginDrawerProps {
  open: boolean;
  onClose: () => void;
  copy: LoginCopy;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_PATTERN = /^\d{10}$/;

/**
 * The login panel: a side drawer with two ways in, email or mobile number, each
 * followed by a one-time code, and a link to the existing terms and privacy
 * pages. It checks the field and says the flow is not connected yet; nothing
 * is sent anywhere.
 */
export const LoginDrawer: FC<LoginDrawerProps> = ({ open, onClose, copy }) => {
  const [method, setMethod] = useState<LoginMethod>("email");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [error, setError] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      setMethod("email");
      setEmail("");
      setMobile("");
      setError(false);
      setSubmitted(false);
    }
  }, [open]);

  const choose = (next: LoginMethod) => {
    setMethod(next);
    setError(false);
    setSubmitted(false);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const valid =
      method === "email" ? EMAIL_PATTERN.test(email.trim()) : MOBILE_PATTERN.test(mobile);
    setError(!valid);
    setSubmitted(valid);
  };

  return (
    <Drawer open={open} onClose={onClose} title={copy.title} drawerClassName="w-[420px]">
      <div className="lpl">
        <div className="lpl-tabs" role="tablist" aria-label={copy.title}>
          <button
            type="button"
            role="tab"
            id="lpl-tab-email"
            aria-selected={method === "email"}
            aria-controls="lpl-panel"
            className={method === "email" ? "is-on" : ""}
            onClick={() => choose("email")}
          >
            {copy.emailTab}
          </button>
          <button
            type="button"
            role="tab"
            id="lpl-tab-mobile"
            aria-selected={method === "mobile"}
            aria-controls="lpl-panel"
            className={method === "mobile" ? "is-on" : ""}
            onClick={() => choose("mobile")}
          >
            {copy.mobileTab}
          </button>
        </div>

        <form
          id="lpl-panel"
          role="tabpanel"
          aria-labelledby={method === "email" ? "lpl-tab-email" : "lpl-tab-mobile"}
          onSubmit={onSubmit}
          noValidate
        >
          {method === "email" ? (
            <div className="lpl-field">
              <label htmlFor="lpl-email">{copy.emailLabel}</label>
              <Input
                id="lpl-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                placeholder={copy.emailPlaceholder}
                aria-invalid={error}
                onChange={event => setEmail(event.target.value)}
              />
            </div>
          ) : (
            <div className="lpl-field">
              <label htmlFor="lpl-mobile">{copy.mobileLabel}</label>
              <div className="lpl-mobile">
                <span className="lpl-prefix" aria-hidden="true">
                  +91
                </span>
                <Input
                  id="lpl-mobile"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={10}
                  value={mobile}
                  placeholder={copy.mobilePlaceholder}
                  aria-invalid={error}
                  onChange={event => setMobile(event.target.value.replace(/\D/g, ""))}
                />
              </div>
            </div>
          )}

          {error && (
            <p className="lpl-error" role="alert">
              {method === "email" ? copy.emailError : copy.mobileError}
            </p>
          )}

          <p className="lpl-hint">{copy.codeHint}</p>

          <Button type="submit" variant={ButtonVariant.PRIMARY} fullWidth>
            {copy.sendCode}
          </Button>

          <p className="lpl-legal">
            {copy.legalPrefix}
            <a href={ROUTES.TERMS} target="_blank" rel="noreferrer">
              {copy.termsLink}
            </a>
            {copy.legalAnd}
            <a href={ROUTES.PRIVACY} target="_blank" rel="noreferrer">
              {copy.privacyLink}
            </a>
            {copy.legalSuffix}
          </p>

          {submitted && (
            <p className="lpl-note" role="status">
              {copy.prototypeNote}
            </p>
          )}
        </form>
      </div>
    </Drawer>
  );
};
