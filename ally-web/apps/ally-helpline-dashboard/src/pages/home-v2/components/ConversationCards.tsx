import { FunctionComponent } from "react";

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useGetPublicBlogsQuery } from "@api";
import { ALLY_URL, HELPLINE_DEFAULT_EMERGENCY_NUMBERS, ROUTES } from "@constants";

import type { Card } from "../conversation";

const cardShell = "rounded-2xl border border-gray-200 bg-white px-5 py-4";
const textLink =
  "text-md font-semibold text-primary-500 underline-offset-4 hover:text-primary-600 hover:underline";

const ProductsCard = () => {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <Link
        to={ROUTES.LEARN}
        className={`${cardShell} flex flex-col gap-1.5 hover:border-gray-300`}
      >
        <span className="text-sm font-semibold text-primary-500">
          {t("homeV2.cards.skillsLab.title")}
        </span>
        <span className="text-md leading-relaxed text-gray-900">
          {t("homeV2.cards.skillsLab.body")}
        </span>
      </Link>
      <div className={`${cardShell} flex flex-col gap-1.5`}>
        <span className="text-sm font-semibold text-ai-700">{t("homeV2.cards.assist.title")}</span>
        <span className="text-md leading-relaxed text-gray-900">
          {t("homeV2.cards.assist.body")}
        </span>
      </div>
    </div>
  );
};

const OrgCard = () => {
  const { t } = useTranslation();
  return (
    <div className={`${cardShell} flex flex-col gap-2.5`}>
      <ul className="flex flex-col gap-2 text-md leading-relaxed">
        <li>{t("homeV2.cards.org.creator")}</li>
        <li>{t("homeV2.cards.org.review")}</li>
        <li>{t("homeV2.cards.org.courses")}</li>
      </ul>
      <a href={ALLY_URL} target="_blank" rel="noopener noreferrer" className={textLink}>
        {t("homeV2.links.partner")} →
      </a>
    </div>
  );
};

const PrivacyCard = () => {
  const { t } = useTranslation();
  return (
    <div className={`${cardShell} flex flex-col gap-4`}>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ai-700">
          {t("homeV2.cards.privacy.assistTitle")}
        </span>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-md leading-relaxed">
          <li>{t("homeV2.cards.privacy.assistAudio")}</li>
          <li>{t("homeV2.cards.privacy.assistPii")}</li>
          <li>{t("homeV2.cards.privacy.assistTraining")}</li>
          <li>{t("homeV2.cards.privacy.assistTranscripts")}</li>
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-primary-500">
          {t("homeV2.cards.privacy.practiceTitle")}
        </span>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-md leading-relaxed">
          <li>{t("homeV2.cards.privacy.practiceStored")}</li>
        </ul>
      </div>
      <p className="m-0 text-md">{t("homeV2.cards.privacy.encrypted")}</p>
      <a href={ROUTES.PRIVACY} target="_blank" rel="noopener noreferrer" className={textLink}>
        {t("homeV2.links.privacyPolicy")} →
      </a>
    </div>
  );
};

const postDate = (post: { publishedAt?: string | null; createdAt: string }) =>
  post.publishedAt ?? post.createdAt;

const NewsCard = () => {
  const { t } = useTranslation();
  // Mounted only once a visitor asks what's new, so the homepage itself makes no blog request.
  const { data } = useGetPublicBlogsQuery({ limit: 5 });
  const latest = [...(data?.blogs ?? [])].sort(
    (a, b) => new Date(postDate(b)).getTime() - new Date(postDate(a)).getTime(),
  )[0];

  return (
    <div className="flex flex-col gap-2.5">
      <Link
        to={latest ? ROUTES.BLOG_POST.replace(":slug", latest.slug) : ROUTES.BLOG}
        className="flex flex-col gap-1.5 rounded-2xl bg-gray-900 px-5 py-4 text-gray-50 hover:bg-gray-800"
      >
        <span className="text-sm text-gray-400">{t("homeV2.cards.news.blogLabel")}</span>
        <span className="font-secondary text-2xl leading-snug">
          {latest?.title ?? t("homeV2.cards.news.blogFallback")}
        </span>
      </Link>
      <Link to={ROUTES.CHANGELOG} className={`${cardShell} text-md hover:border-gray-300`}>
        {t("homeV2.cards.news.changelog")} →
      </Link>
      <Link to={ROUTES.ROADMAP} className={`${cardShell} text-md hover:border-gray-300`}>
        {t("homeV2.cards.news.roadmap")} →
      </Link>
    </div>
  );
};

/** Fixed, reviewed copy and real numbers — never generated, whatever led here. */
const SupportCard = () => {
  const { t } = useTranslation();
  const { TELE_MANAS_SHORT, TELE_MANAS_LONG, EMERGENCY } = HELPLINE_DEFAULT_EMERGENCY_NUMBERS;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-status-sageDot/40 bg-status-sageBg p-5">
      <span className="font-secondary text-2xl leading-snug text-status-sageFg">
        {t("homeV2.cards.support.title")}
      </span>
      <div className="flex flex-wrap gap-2">
        <a
          href={`tel:${TELE_MANAS_SHORT}`}
          className="flex min-h-12 items-center rounded-full bg-tone-sage px-5 text-lg font-semibold text-white hover:bg-status-sageFg"
        >
          {t("homeV2.cards.support.call", { number: TELE_MANAS_SHORT })}
        </a>
        <a
          href={`tel:${TELE_MANAS_LONG.replace(/-/g, "")}`}
          className="flex min-h-12 items-center rounded-full border-[1.5px] border-tone-sage px-5 text-lg text-status-sageFg hover:bg-white/60"
        >
          {TELE_MANAS_LONG}
        </a>
      </div>
      <a
        href={`tel:${EMERGENCY}`}
        className="text-md text-status-sageFg underline underline-offset-4"
      >
        {t("homeV2.cards.support.danger", { number: EMERGENCY })}
      </a>
    </div>
  );
};

export const ConversationCard: FunctionComponent<{ card: Card }> = ({ card }) => {
  switch (card) {
    case "products":
      return <ProductsCard />;
    case "org":
      return <OrgCard />;
    case "privacy":
      return <PrivacyCard />;
    case "news":
      return <NewsCard />;
    case "support":
      return <SupportCard />;
    default:
      return null;
  }
};
