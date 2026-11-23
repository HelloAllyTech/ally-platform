import React from "react";

import { useGetPrivacyQuery, useGetTermsQuery } from "@api";
import { sanitizeHtml } from "@components/rich-text-editor/richTextSanitizer";

import { Drawer } from "./Drawer";

export type LegalKind = "terms" | "privacy";

const TITLES: Record<LegalKind, string> = {
  terms: "Terms of Service",
  privacy: "Privacy Policy",
};

interface LegalDrawerProps {
  /** Which document is open; `null` keeps the drawer closed. */
  kind: LegalKind | null;
  onClose: () => void;
}

/**
 * The Terms and the Privacy Policy as a side drawer on the page that links to them, so reading
 * either never leaves the login. Same content as the public `/terms` and `/privacy` pages: the
 * same queries, the same sanitiser. Each document is fetched only once it is opened.
 */
export const LegalDrawer: React.FC<LegalDrawerProps> = ({ kind, onClose }) => {
  const terms = useGetTermsQuery(undefined, { skip: kind !== "terms" });
  const privacy = useGetPrivacyQuery(undefined, { skip: kind !== "privacy" });
  const active = kind === "terms" ? terms : privacy;
  const html = sanitizeHtml(active.data?.html ?? "");

  return (
    <Drawer
      open={kind !== null}
      title={kind ? TITLES[kind] : ""}
      onClose={onClose}
      testId="legal-drawer"
    >
      <div className="px-6 py-6">
        {active.isFetching ? (
          <p className="text-typography-500">Loading…</p>
        ) : html ? (
          <div
            className="prose prose-sm max-w-none break-words text-typography-800 [&_img]:h-auto [&_img]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto [&_h1]:my-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:my-1.5 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:my-1 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5 [&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-[#C4532D] [&_blockquote]:pl-4 [&_blockquote]:italic"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <p className="text-typography-500">This content has not been published yet.</p>
        )}
      </div>
    </Drawer>
  );
};
