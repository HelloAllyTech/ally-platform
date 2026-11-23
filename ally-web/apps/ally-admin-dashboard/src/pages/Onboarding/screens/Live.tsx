import React, { useEffect, useRef, useState } from "react";

import QRCode from "qrcode";
import { toast } from "sonner";

import { Button, PrimaryButton, Question, useEnterToSubmit } from "@components/v2";

import { COPY, fill } from "../copy";

import type { BotDraftView, PublishResult } from "../types";

// ── Your assistant is live ────────────────────────────────────────────────

const copyLink = async (link: string) => {
  try {
    await navigator.clipboard.writeText(link);
    toast.success(COPY.share.copied);
  } catch {
    toast.error(COPY.problems.generic);
  }
};

export const Qr: React.FC<{ link: string }> = ({ link }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    QRCode.toDataURL(link, { margin: 1, width: 512 })
      .then(url => current && setSrc(url))
      .catch(() => current && setSrc(null));
    return () => {
      current = false;
    };
  }, [link]);
  return src ? (
    <img src={src} alt="" width={160} height={160} data-testid="share-qr" />
  ) : (
    <div style={{ width: 160, height: 160 }} className="ally-card" />
  );
};

export const LiveScreen: React.FC<{
  view: BotDraftView;
  published: PublishResult;
  onConnectWhatsApp: () => void;
}> = ({ view, published, onConnectWhatsApp }) => {
  const qrRef = useRef<HTMLDivElement>(null);
  const share = fill(COPY.share.whatsAppText, { business: view.draft.name, link: published.link });
  useEnterToSubmit(() => void copyLink(published.link));
  const downloadQr = () => {
    const img = qrRef.current?.querySelector("img");
    if (!img) return;
    const a = document.createElement("a");
    a.href = img.src;
    a.download = `${published.slug}-qr.png`;
    a.click();
  };
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span
          className="ally-tick ally-pop"
          aria-hidden="true"
          style={{ width: 40, height: 40, fontSize: 20 }}
        >
          ✓
        </span>
        <Question title={COPY.share.liveTitle} subtitle={COPY.share.liveSubtitle} />
      </div>
      <div
        className="ally-card"
        style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}
      >
        <div ref={qrRef}>
          <Qr link={published.link} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minWidth: 240 }}>
          <code
            className="ally-source"
            style={{
              fontSize: 14,
              padding: "10px 14px",
              whiteSpace: "normal",
              wordBreak: "break-all",
            }}
          >
            {published.link}
          </code>
          <div className="ally-btn-row">
            <PrimaryButton
              enterHint={COPY.frame.enterHint}
              onClick={() => void copyLink(published.link)}
            >
              {COPY.share.copyLink}
            </PrimaryButton>
          </div>
          <div className="ally-btn-row">
            <Button onClick={downloadQr}>{COPY.share.downloadQr}</Button>
            <Button
              onClick={() =>
                window.open(`https://wa.me/?text=${encodeURIComponent(share)}`, "_blank")
              }
            >
              {COPY.share.shareWhatsApp}
            </Button>
            <Button onClick={() => window.open(published.link, "_blank")}>
              {COPY.share.openPage}
            </Button>
          </div>
        </div>
      </div>
      <div
        className="ally-card ally-rise"
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <h2 className="ally-heading">{COPY.share.nextTitle}</h2>
        <p className="ally-body" style={{ margin: 0 }}>
          {COPY.share.nextBody}
        </p>
        <Button style={{ alignSelf: "flex-start" }} onClick={onConnectWhatsApp}>
          {COPY.share.nextButton}
        </Button>
      </div>
    </>
  );
};
