import { FC, ReactNode, useState } from "react";

import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import {
  LANDING_CARD_KEYS,
  LandingCardKey,
  LandingLanguage,
  LandingPageConfig,
  LandingPageView,
} from "@ally-ui-mono/ui-shared";

import { loginCopyFor } from "./loginCopy";
import { LoginDrawer } from "./LoginDrawer";
import { isReservedFirstSegment } from "./reserved";
import { PublicLandingPage, useGetPublicLandingPageQuery } from "../../api/landingPages";
import { usePageMeta } from "../blog/usePageMeta";

interface LandingPublicPageProps {
  /**
   * What to render when the address is not a landing page (an app page, or a
   * page nobody published). The route layout passes the signed-in app here, so
   * this page needs no import of it.
   */
  fallback: ReactNode;
}

const isCardKey = (value: string | undefined): value is LandingCardKey =>
  LANDING_CARD_KEYS.some(key => key === value);

/**
 * The language a visitor first sees: `?lang=` if the page offers it, else the
 * first of their browser's languages the page offers, else the page's default.
 */
export const chooseInitialLanguage = (
  config: LandingPageConfig,
  search: string,
  browserLanguages: readonly string[],
): LandingLanguage => {
  const offered = config.languages.enabled;
  const asked = new URLSearchParams(search).get("lang");
  const fromQuery = offered.find(code => code === asked);
  if (fromQuery) return fromQuery;
  for (const tag of browserLanguages) {
    const match = offered.find(code => tag.toLowerCase().split("-")[0] === code);
    if (match) return match;
  }
  return config.languages.default;
};

/** How long an address that turned out not to be a landing page is not asked about again. */
const MISSING_TTL_MS = 60_000;
const missing = new Map<string, number>();

const isKnownMissing = (key: string): boolean => {
  const since = missing.get(key);
  if (since === undefined) return false;
  if (Date.now() - since > MISSING_TTL_MS) {
    missing.delete(key);
    return false;
  }
  return true;
};

/** Forgets every remembered address. For tests. */
export const forgetMissingLandingPages = () => missing.clear();

/**
 * `/<tenant code>/<slug>` and, under it, a block's own page. Looks up the
 * published page; if the address is an app page, or no such page is live, it
 * hands over to `fallback` so the app's own two-segment routes keep working.
 */
export const LandingPublicPage: FC<LandingPublicPageProps> = ({ fallback }) => {
  const { tenantCode = "", slug = "" } = useParams();
  const reserved = isReservedFirstSegment(tenantCode);
  const key = `${tenantCode}/${slug}`.toLowerCase();
  const knownMissing = isKnownMissing(key);
  const { data, isLoading, isError, error, refetch } = useGetPublicLandingPageQuery(
    { tenantCode, slug },
    { skip: reserved || knownMissing },
  );

  if (reserved || knownMissing) return <>{fallback}</>;

  if (isLoading) {
    return <div className="min-h-screen" role="status" aria-label="Loading" aria-busy="true" />;
  }

  if (!data) {
    const notFound = isError && (error as { status?: number } | undefined)?.status === 404;
    if (notFound) {
      // Written while rendering, on purpose. The screen handed over to can suspend on first
      // load, and React then throws this whole tree away and mounts it again from scratch;
      // an effect would never run, and every restart would ask the server the same question.
      // The write is idempotent, so a repeated render does no harm.
      missing.set(key, Date.now());
      return <>{fallback}</>;
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p>Couldn&apos;t load this page. Try again.</p>
        <p>यह पेज लोड नहीं हो सका। दोबारा कोशिश करें।</p>
        <button type="button" className="underline" onClick={() => refetch()}>
          Try again · दोबारा कोशिश करें
        </button>
      </div>
    );
  }

  return <LivePage page={data} tenantCode={tenantCode} slug={slug} />;
};

interface LivePageProps {
  page: PublicLandingPage;
  tenantCode: string;
  slug: string;
}

const LivePage: FC<LivePageProps> = ({ page, tenantCode, slug }) => {
  const navigate = useNavigate();
  const { search } = useLocation();
  const rest = useParams()["*"]?.split("/").filter(Boolean)[0];

  const { config, branding } = page;
  const [language, setLanguage] = useState<LandingLanguage>(() =>
    chooseInitialLanguage(config, search, navigator.languages ?? [navigator.language]),
  );
  const [loginOpen, setLoginOpen] = useState(false);

  const base = `/${tenantCode}/${slug}`;
  const section = isCardKey(rest) ? rest : null;
  const pathFor = (target: LandingCardKey | null) => (target ? `${base}/${target}` : base);

  const heading =
    config.headings.first[language] ?? config.headings.first[config.languages.default];
  const description =
    config.headings.second[language] ?? config.headings.second[config.languages.default];
  usePageMeta({
    title: heading || branding.displayName,
    description: description ?? "",
    url: pathFor(section),
  });

  // An unknown block address goes back to the landing page.
  if (rest && !section) return <Navigate to={base} replace />;

  return (
    <LandingPageView
      config={config}
      branding={branding}
      language={language}
      onLanguageChange={setLanguage}
      section={section}
      onSectionChange={target => navigate(pathFor(target))}
      sectionHref={pathFor}
      onLogIn={() => setLoginOpen(true)}
      fillScreen
    >
      <LoginDrawer
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        copy={loginCopyFor(language)}
      />
    </LandingPageView>
  );
};
