import { FunctionComponent } from "react";

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Ally } from "@assets";
import { ALLY_URL, HELPLINE_DEFAULT_EMERGENCY_NUMBERS, ROUTES } from "@constants";
import { LANGUAGE_CHANGE_SOURCE } from "@constants/analyticsEvents";

import LanguageSelector from "../../../components/language-selector/LanguageSelector";

const navLink = "text-md text-gray-800 hover:text-primary-500";

export const HomeV2Header: FunctionComponent<{ onSupport: () => void }> = ({ onSupport }) => {
  const { t } = useTranslation();
  return (
    <header className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-6">
      <Link to={ROUTES.HOME_V2} aria-label={t("homeV2.nav.home")} className="text-gray-900">
        <Ally className="h-7 w-14" aria-hidden="true" />
      </Link>
      <nav
        aria-label={t("homeV2.nav.label")}
        className="flex flex-wrap items-center gap-x-5 gap-y-2"
      >
        <Link to={ROUTES.BLOG} className={navLink}>
          {t("homeV2.nav.blog")}
        </Link>
        <Link to={ROUTES.CHANGELOG} className={navLink}>
          {t("homeV2.nav.changelog")}
        </Link>
        <a href={ALLY_URL} target="_blank" rel="noopener noreferrer" className={navLink}>
          {t("homeV2.nav.about")}
        </a>
        <LanguageSelector source={LANGUAGE_CHANGE_SOURCE.HOME_V2} />
        <button
          type="button"
          onClick={onSupport}
          className="flex min-h-10 items-center gap-2 rounded-full bg-status-sageBg px-3.5 text-sm text-status-sageFg hover:bg-status-sageDot/20"
        >
          <span aria-hidden="true" className="size-2 rounded-full bg-status-sageDot" />
          {t("homeV2.nav.support")}
        </button>
      </nav>
    </header>
  );
};

const indexHeading = "text-xs font-semibold uppercase tracking-widest text-gray-600";
const indexLink = "text-md text-primary-500 hover:text-primary-600 hover:underline";

/** Everything the conversation can reach, as plain links: for people who scan, and for search engines. */
export const HomeV2Index: FunctionComponent = () => {
  const { t } = useTranslation();
  const { TELE_MANAS_SHORT, EMERGENCY } = HELPLINE_DEFAULT_EMERGENCY_NUMBERS;
  return (
    <footer aria-label={t("homeV2.index.label")} className="border-t border-gray-200 bg-white">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-5 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <nav aria-label={t("homeV2.index.products")} className="flex flex-col gap-2.5">
          <span className={indexHeading}>{t("homeV2.index.products")}</span>
          <Link to={ROUTES.LEARN} className={indexLink}>
            {t("homeV2.index.skillsLab")}
          </Link>
          <a href={ALLY_URL} target="_blank" rel="noopener noreferrer" className={indexLink}>
            {t("homeV2.index.assist")}
          </a>
          <Link to={ROUTES.LEARN} className={indexLink}>
            {t("homeV2.index.courses")}
          </Link>
          <Link to={ROUTES.SJT1} className={indexLink}>
            {t("homeV2.index.sjt")}
          </Link>
        </nav>
        <nav aria-label={t("homeV2.index.read")} className="flex flex-col gap-2.5">
          <span className={indexHeading}>{t("homeV2.index.read")}</span>
          <Link to={ROUTES.BLOG} className={indexLink}>
            {t("homeV2.index.blog")}
          </Link>
          <Link to={ROUTES.CHANGELOG} className={indexLink}>
            {t("homeV2.index.changelog")}
          </Link>
          <Link to={ROUTES.ROADMAP} className={indexLink}>
            {t("homeV2.index.roadmap")}
          </Link>
        </nav>
        <nav aria-label={t("homeV2.index.ally")} className="flex flex-col gap-2.5">
          <span className={indexHeading}>{t("homeV2.index.ally")}</span>
          <a href={ALLY_URL} target="_blank" rel="noopener noreferrer" className={indexLink}>
            {t("homeV2.index.about")}
          </a>
          <a href={ALLY_URL} target="_blank" rel="noopener noreferrer" className={indexLink}>
            {t("homeV2.index.partner")}
          </a>
          <a
            href="https://tech.helloally.ai"
            target="_blank"
            rel="noopener noreferrer"
            className={indexLink}
          >
            {t("homeV2.index.docs")}
          </a>
        </nav>
        <div className="flex flex-col gap-2.5 text-md text-gray-800">
          <span className={indexHeading}>{t("homeV2.index.support")}</span>
          <a href={`tel:${TELE_MANAS_SHORT}`} className={indexLink}>
            {t("homeV2.index.teleManas", { number: TELE_MANAS_SHORT })}
          </a>
          <a href={`tel:${EMERGENCY}`} className={indexLink}>
            {t("homeV2.index.emergency", { number: EMERGENCY })}
          </a>
        </div>
      </div>
      <div className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-3 border-t border-gray-200 px-5 py-5 text-sm text-gray-600 sm:px-6">
        <span>{t("homeV2.index.copyright", { year: new Date().getFullYear() })}</span>
        <span className="flex gap-5">
          <Link to={ROUTES.PRIVACY} className="hover:text-primary-500">
            {t("homeV2.index.privacy")}
          </Link>
          <Link to={ROUTES.TERMS} className="hover:text-primary-500">
            {t("homeV2.index.terms")}
          </Link>
        </span>
      </div>
    </footer>
  );
};
