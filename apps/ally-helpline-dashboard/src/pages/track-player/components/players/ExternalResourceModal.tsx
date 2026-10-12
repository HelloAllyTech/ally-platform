import { FC, useState } from "react";

import { useTranslation } from "react-i18next";

import Drawer from "@components/drawer";
import { ArticleResource } from "@types";

interface ExternalResourceModalProps {
  resource: ArticleResource;
  onClose: () => void;
}

const openInNewTab = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

/**
 * In-place view of a trainer-curated external resource, opened from an
 * article's Resources list. Embeds the page in an iframe so the learner
 * never leaves the course — but many real sites (Wikipedia, most news sites,
 * many docs) block iframe embedding via X-Frame-Options/CSP, and a blocked
 * frame renders blank with no detectable JS error. Rather than pretend to
 * catch that, the "open in a new tab" action in the header stays visible at
 * all times, not conditional on a failure we cannot reliably observe.
 */
export const ExternalResourceModal: FC<ExternalResourceModalProps> = ({ resource, onClose }) => {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);

  return (
    <Drawer
      open
      onClose={onClose}
      title={resource.title}
      drawerClassName="w-[92vw] max-w-[1100px]"
      bodyClassName="h-full"
      headerButtons={[
        {
          alt: "open-in-new-tab",
          text: t("tracks2.article.openInNewTab"),
          icon: <span className="text-xs font-medium">{t("tracks2.article.openInNewTab")}</span>,
          onClick: () => openInNewTab(resource.url),
          show: true,
        },
      ]}
    >
      <div className="relative h-full w-full">
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-white">
            <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary-500" />
          </div>
        )}
        <iframe
          src={resource.url}
          title={resource.title}
          className="h-full w-full border-0"
          onLoad={() => setLoaded(true)}
        />
      </div>
    </Drawer>
  );
};
