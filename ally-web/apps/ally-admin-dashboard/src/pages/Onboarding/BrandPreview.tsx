import React, { useMemo } from "react";

import { BotPagePreview } from "../../botPage/BotPagePreview";
import { readableAccent } from "../../utils/colourPicks";

import type { PublicBotPage } from "../../botPage/types";
import type { BotPageBrand } from "../../types/botPage";

const DEFAULT_ACCENT = "#3B3BD9";

/**
 * The bot page as visitors will see it, from settings not yet published (chunk 20d): the draft's
 * words and the brand being edited, drawn by the real bot page screens (`BotPagePreview`). Used
 * inside the phone frame on "Make it yours" and Look and feel.
 */
export const BrandPreview: React.FC<{
  name: string;
  brand: BotPageBrand;
  logoSrc: string | null;
  coverSrc: string | null;
  screen: "cover" | "chat";
  introduction?: string;
  suggestedQuestions?: string[];
  disclaimer?: string;
  statusLine?: string;
}> = ({
  name,
  brand,
  logoSrc,
  coverSrc,
  screen,
  introduction = "",
  suggestedQuestions = [],
  disclaimer = "",
  statusLine,
}) => {
  const page = useMemo<PublicBotPage>(() => {
    const accent = readableAccent(brand.accent ?? DEFAULT_ACCENT);
    return {
      slug: "preview",
      access: "invite",
      branding: {
        logoUrl: logoSrc,
        accentColour: accent,
        title: name,
        subtitle: introduction,
        assistantName: name,
        avatarUrl: null,
        disclaimer,
        footerLink: null,
        look: {
          headingStyle: brand.headingStyle,
          theme: brand.theme,
          accent,
          logo: logoSrc ? { src: logoSrc, srcset: "", width: 256, height: 256, alt: "" } : null,
          cover: coverSrc ? { src: coverSrc, srcset: "", width: 768, height: 432, alt: "" } : null,
        },
      },
      suggestedQuestions,
      prechat: [],
      maxMessageChars: 1000,
      language: "en",
      turnstileSiteKey: null,
    };
  }, [brand, coverSrc, disclaimer, introduction, logoSrc, name, suggestedQuestions]);
  return (
    <BotPagePreview
      page={page}
      screen={screen}
      sampleReply={introduction}
      statusLine={statusLine}
    />
  );
};
