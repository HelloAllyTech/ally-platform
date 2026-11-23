import React, { useRef } from "react";

import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import type { BotPageView } from "@types";

import { Qr } from "../../Onboarding/Screens";
import { copyToClipboard } from "../../WhatsAppBot/shared";
import { HOME } from "../copy";
import { CHANNELS_COPY } from "../copy/channels";
import { Group } from "../fields";

const t = HOME.overview;

/**
 * The page's link and QR code, with Copy and Download (the Overview's until stage 2, then
 * Channels'). Draws nothing until the page has been saved.
 */
export const LinkQr: React.FC<{ page: BotPageView | null | undefined }> = ({ page }) => {
  const qr = useRef<HTMLDivElement>(null);
  if (!page?.saved) return null;

  const downloadQr = () => {
    const img = qr.current?.querySelector("img");
    if (!img) return;
    const a = document.createElement("a");
    a.href = img.src;
    a.download = `${page.publicId ?? page.slug}-qr.png`;
    a.click();
  };

  return (
    <Group title={t.link} hint={CHANNELS_COPY.address.note} testId="overview-link">
      <div className="ally-home__link">
        <div ref={qr} className="ally-home__qr">
          <Qr link={page.link} />
        </div>
        <div className="ally-home__link-body">
          <a className="ally-link ally-home__url" href={page.link} target="_blank" rel="noreferrer">
            {page.link}
          </a>
          <div className="ally-btn-row">
            <Button
              variant={ButtonVariant.TERTIARY}
              type="button"
              onClick={() => void copyToClipboard(page.link)}
            >
              {t.copy}
            </Button>
            <Button variant={ButtonVariant.TERTIARY} type="button" onClick={downloadQr}>
              {t.qr}
            </Button>
          </div>
        </div>
      </div>
    </Group>
  );
};
