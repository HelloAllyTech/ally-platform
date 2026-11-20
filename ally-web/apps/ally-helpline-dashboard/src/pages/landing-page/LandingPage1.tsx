import { FC, useEffect, useState } from "react";

import { Route, Routes, useLocation } from "react-router-dom";

import { DropdownField } from "@ally-ui-mono/ui-shared";

import logo from "./agatsu-logo.png";
import elevenLabsLogo from "./elevenlabs-logo.svg";
import { LANDING_COPY, LandingLang } from "./landingCopy";
import { LandingHome } from "./LandingHome";
import { LandingSection } from "./LandingSection";
import { LoginDrawer } from "./LoginDrawer";
import AllyLogo from "../../assets/icons/ally.svg?react";

import "./landing.css";

const LANGUAGE_LABELS: Record<LandingLang, string> = { en: "English", hi: "हिन्दी" };

const labelToLang = (label: string): LandingLang =>
  (Object.keys(LANGUAGE_LABELS) as LandingLang[]).find(code => LANGUAGE_LABELS[code] === label) ??
  "en";

/**
 * Non-functional prototype of the parent-campaign landing page, served at
 * /landingpage1 and the section pages under it. Public, no nav, no API calls.
 * This is the shell every page shares (header, helpline strip, footer, login
 * drawer, language), so the language survives moving between pages.
 *
 * The real thing will be driven by a tenant-owned landing page record (user
 * group, starting credits, template); none of that exists yet.
 */
export const LandingPage1: FC = () => {
  const [lang, setLang] = useState<LandingLang>("en");
  const [loginOpen, setLoginOpen] = useState(false);

  const copy = LANDING_COPY[lang];
  const { pathname } = useLocation();

  // A new page opens at the top, not wherever the last one was scrolled to.
  useEffect(() => {
    document.documentElement.scrollTop = 0;
  }, [pathname]);

  return (
    <div className="lp1" lang={lang}>
      <header className="lp1-top">
        <img className="lp1-logo" src={logo} alt="Agatsu Foundation" />
        <div className="lp1-actions">
          <button type="button" className="lp1-btn" onClick={() => setLoginOpen(true)}>
            {copy.logIn}
          </button>
          <div className="lp1-lang" aria-label="Language">
            <DropdownField
              value={LANGUAGE_LABELS[lang]}
              options={Object.values(LANGUAGE_LABELS)}
              onChange={label => setLang(labelToLang(label))}
              valueClassName="text-sm font-medium"
              hideSearch
            />
          </div>
        </div>
      </header>

      <div className="lp1-helpline" role="note">
        {copy.helpline}
      </div>

      <Routes>
        <Route index element={<LandingHome copy={copy} />} />
        <Route path=":section" element={<LandingSection copy={copy} />} />
      </Routes>

      <footer className="lp1-foot">
        <p>{copy.disclaimer}</p>
        <div className="lp1-foot-logos">
          <AllyLogo className="lp1-foot-ally" role="img" aria-label="Ally" />
          <img className="lp1-foot-eleven" src={elevenLabsLogo} alt="ElevenLabs" />
        </div>
      </footer>

      <LoginDrawer open={loginOpen} onClose={() => setLoginOpen(false)} copy={copy.login} />
    </div>
  );
};
