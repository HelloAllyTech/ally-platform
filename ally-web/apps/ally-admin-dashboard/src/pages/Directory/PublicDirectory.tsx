import React, { useEffect, useMemo, useState } from "react";

import { useParams } from "react-router-dom";

import { ApiEndpoints } from "@constants";

import { DIR } from "./copy";
import { placeOf } from "./EntryCard";

interface PublicEntry {
  id: string;
  title: string;
  description: string;
  category: string;
  organization: string;
  websiteUrl: string;
  city: string;
  region: string;
  country: string;
  tags: string[];
  languages: string[];
  phone?: string;
  email?: string;
  address?: string;
}

interface PublicPage {
  name: string;
  description: string;
  slug: string;
  settings: {
    headline: string;
    tagline: string;
    accentColor: string;
    layout: "grid" | "list";
    showSearch: boolean;
    showCategoryFilter: boolean;
    showContactDetails: boolean;
    contactEmail: string;
    footerNote: string;
  };
  entries: PublicEntry[];
}

type State = { kind: "loading" } | { kind: "missing" } | { kind: "ok"; page: PublicPage };

/** A plain fetch: no token, no toasts, no sign-out on a 401. A visitor is not a user. */
async function load(path: string): Promise<State> {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api${path}`);
    if (!res.ok) return { kind: "missing" };
    return { kind: "ok", page: (await res.json()) as PublicPage };
  } catch {
    return { kind: "missing" };
  }
}

const safeHttp = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
};

const Landing: React.FC<{ page: PublicPage }> = ({ page }) => {
  const s = page.settings;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  useEffect(() => {
    document.title = s.headline || page.name;
  }, [page, s.headline]);
  const categories = useMemo(
    () => [...new Set(page.entries.map(e => e.category).filter(Boolean))].sort(),
    [page.entries],
  );
  const rows = page.entries.filter(e => {
    if (category && e.category !== category) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [e.title, e.description, e.organization, e.city, e.region, e.country, ...e.tags]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
  const accent = /^#[0-9a-fA-F]{6}$/.test(s.accentColor) ? s.accentColor : "#4338CA";
  const P = DIR.public;

  return (
    <div className="min-h-dvh bg-[#FAFAF7] text-[#1B1B1B]" data-testid="public-directory">
      <header className="px-4 py-10 text-white" style={{ backgroundColor: accent }}>
        <div className="mx-auto max-w-5xl">
          <h1 className="font-secondary text-3xl md:text-5xl">{s.headline || page.name}</h1>
          {(s.tagline || page.description) && (
            <p className="mt-3 max-w-2xl text-lg opacity-90">{s.tagline || page.description}</p>
          )}
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
        {(s.showSearch || (s.showCategoryFilter && categories.length > 0)) && (
          <div className="flex flex-wrap gap-2">
            {s.showSearch && (
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={P.search}
                aria-label={P.search}
                className="min-h-11 flex-1 border border-[#D4D4D0] bg-white px-3"
              />
            )}
            {s.showCategoryFilter && categories.length > 0 && (
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                aria-label={P.allCategories}
                className="min-h-11 border border-[#D4D4D0] bg-white px-3"
              >
                <option value="">{P.allCategories}</option>
                {categories.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {rows.length === 0 ? (
          <p className="py-8">{page.entries.length === 0 ? P.noEntries : P.empty}</p>
        ) : (
          <ul className={s.layout === "list" ? "flex flex-col gap-3" : "grid gap-4 sm:grid-cols-2"}>
            {rows.map(e => {
              const site = safeHttp(e.websiteUrl);
              const place = placeOf(e);
              return (
                <li key={e.id} className="flex flex-col gap-1 border border-[#E4E4DF] bg-white p-4">
                  {e.category && (
                    <span
                      className="text-xs font-medium uppercase tracking-wide"
                      style={{ color: accent }}
                    >
                      {e.category}
                    </span>
                  )}
                  <h2 className="font-secondary text-xl">{e.title}</h2>
                  {e.organization && <p className="text-[#444]">{e.organization}</p>}
                  {e.description && <p className="text-sm text-[#444]">{e.description}</p>}
                  {place && <p className="text-sm text-[#666]">{place}</p>}
                  {(e.phone || e.email || e.address) && (
                    <p className="text-sm text-[#444]">
                      {[e.phone, e.email, e.address].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {e.tags.length > 0 && (
                    <p className="text-xs text-[#666]">{e.tags.map(t => `#${t}`).join("  ")}</p>
                  )}
                  {site && (
                    <a
                      href={site}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex min-h-11 items-center self-start underline"
                      style={{ color: accent }}
                    >
                      {P.website}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <footer className="mx-auto max-w-5xl px-4 pb-10 text-sm text-[#666]">
        {s.footerNote && <p className="mb-2">{s.footerNote}</p>}
        {s.contactEmail && (
          <p className="mb-2">
            {P.contact}:{" "}
            <a className="underline" href={`mailto:${s.contactEmail}`}>
              {s.contactEmail}
            </a>
          </p>
        )}
        <p>{P.poweredBy}</p>
      </footer>
    </div>
  );
};

const Shell: React.FC<{ state: State }> = ({ state }) => {
  if (state.kind === "loading") {
    return (
      <p role="status" className="p-8">
        {DIR.public.loading}
      </p>
    );
  }
  if (state.kind === "missing") {
    return (
      <div className="mx-auto max-w-xl p-8" data-testid="public-directory-missing">
        <h1 className="font-secondary text-2xl">{DIR.public.notFound}</h1>
        <p className="mt-2 text-[#555]">{DIR.public.notFoundHint}</p>
      </div>
    );
  }
  return <Landing page={state.page} />;
};

/** `/d/:slug`: a published collection's page. Open to anyone. */
export const PublicDirectory: React.FC = () => {
  const { slug = "" } = useParams();
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    load(ApiEndpoints.DIRECTORY.PUBLIC_COLLECTION(slug)).then(next => live && setState(next));
    return () => {
      live = false;
    };
  }, [slug]);
  return <Shell state={state} />;
};

/** The same page, found by the host it is served on: a collection's custom domain. */
export const PublicDirectoryByHost: React.FC = () => {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    load(ApiEndpoints.DIRECTORY.PUBLIC_DOMAIN(window.location.hostname)).then(
      next => live && setState(next),
    );
    return () => {
      live = false;
    };
  }, []);
  return <Shell state={state} />;
};
