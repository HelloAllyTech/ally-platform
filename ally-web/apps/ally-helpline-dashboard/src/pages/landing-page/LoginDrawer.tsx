import { FC, FormEvent, useEffect, useState } from "react";

import { ROUTES } from "@constants";

import { LandingCopy } from "./landingCopy";
import { Button, ButtonVariant } from "../../components/button";
import Drawer from "../../components/drawer";
import Input from "../../components/input";

type LoginMethod = "email" | "mobile";

interface LoginDrawerProps {
  open: boolean;
  onClose: () => void;
  copy: LandingCopy["login"];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_PATTERN = /^\d{10}$/;

/**
 * Login panel for the landing page: a side drawer with two ways in, email or
 * mobile number, each followed by a one-time code. Prototype only: it checks
 * the field and says the flow isn't connected; nothing is sent anywhere.
 */
export const LoginDrawer: FC<LoginDrawerProps> = ({ open, onClose, copy }) => {
  const [method, setMethod] = useState<LoginMethod>("email");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [error, setError] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Start clean every time the drawer is opened.
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
      <div className="lp1-login">
        <div className="lp1-login-tabs" role="tablist" aria-label={copy.title}>
          <button
            type="button"
            role="tab"
            id="lp1-tab-email"
            aria-selected={method === "email"}
            aria-controls="lp1-panel-login"
            className={method === "email" ? "is-on" : ""}
            onClick={() => choose("email")}
          >
            {copy.emailTab}
          </button>
          <button
            type="button"
            role="tab"
            id="lp1-tab-mobile"
            aria-selected={method === "mobile"}
            aria-controls="lp1-panel-login"
            className={method === "mobile" ? "is-on" : ""}
            onClick={() => choose("mobile")}
          >
            {copy.mobileTab}
          </button>
        </div>

        <form
          id="lp1-panel-login"
          role="tabpanel"
          aria-labelledby={method === "email" ? "lp1-tab-email" : "lp1-tab-mobile"}
          onSubmit={onSubmit}
          noValidate
        >
          {method === "email" ? (
            <div className="lp1-login-field">
              <label htmlFor="lp1-login-email">{copy.emailLabel}</label>
              <Input
                id="lp1-login-email"
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
            <div className="lp1-login-field">
              <label htmlFor="lp1-login-mobile">{copy.mobileLabel}</label>
              <div className="lp1-login-mobile">
                <span className="lp1-login-prefix" aria-hidden="true">
                  +91
                </span>
                <Input
                  id="lp1-login-mobile"
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
            <p className="lp1-login-error" role="alert">
              {method === "email" ? copy.emailError : copy.mobileError}
            </p>
          )}

          <p className="lp1-login-hint">{copy.codeHint}</p>

          <Button type="submit" variant={ButtonVariant.PRIMARY} fullWidth>
            {copy.sendCode}
          </Button>

          <p className="lp1-login-legal">
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
            <p className="lp1-login-note" role="status">
              {copy.prototypeNote}
            </p>
          )}
        </form>
      </div>
    </Drawer>
  );
};
