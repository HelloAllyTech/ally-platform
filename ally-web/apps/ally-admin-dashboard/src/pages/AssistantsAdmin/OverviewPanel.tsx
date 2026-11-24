import React, { useMemo } from "react";

import { Link, useNavigate } from "react-router-dom";

import { ClickableTile, SkeletonText, Tag, Tile } from "@ally-ui-mono/ui-shared";
import {
  useGetCostOverviewQuery,
  useGetCreditAccountsQuery,
  useGetFeatureTogglesQuery,
  useGetPermissionsQuery,
  useGetUnknownBillingModelsQuery,
} from "@api";
import { ROUTES } from "@constants";

import { ASSISTANTS_ADMIN_COPY as COPY } from "./copy";
import { accessFrom, assistantsAdminPath, type SectionId } from "./sections";
import { useGetSafetyPacksQuery } from "../SafetyPacks/safetyPacksApi";

const O = COPY.overview;
/** Under this a builder is "running low" (the placeholder reserve warning, $5.00). */
const LOW_BALANCE_USD = 5;

type Tone = "red" | "green" | "gray" | "warm-gray";

interface Attention {
  id: string;
  tone: Tone;
  status: string;
  headline: string;
  hint: string;
  to: string;
}

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

/**
 * The first screen: what needs you today, how the month is going, and a shortcut for every common
 * job. Every number is read live from the same endpoints the sections use, and a card appears only
 * when you hold the grant to act on it.
 */
export const OverviewPanel: React.FC = () => {
  const { data: permissions } = useGetPermissionsQuery();
  const { data: features } = useGetFeatureTogglesQuery();
  const access = accessFrom(permissions as string[] | undefined, features as string[] | undefined);
  const navigate = useNavigate();

  const accounts = useGetCreditAccountsQuery(undefined, { skip: !access.costs });
  const unpriced = useGetUnknownBillingModelsQuery(undefined, { skip: !access.costs });
  const costs = useGetCostOverviewQuery(undefined, { skip: !access.costs });
  const packs = useGetSafetyPacksQuery(undefined, { skip: !access.safety });

  const link = (section: SectionId, view?: string) =>
    assistantsAdminPath(ROUTES.ASSISTANTS_ADMIN, section, view);

  const cards = useMemo<Attention[]>(() => {
    const out: Attention[] = [];
    if (access.costs && accounts.data) {
      const empty = accounts.data.filter(a => a.freeBalanceUsd <= 0).length;
      const low = accounts.data.filter(
        a => a.freeBalanceUsd > 0 && a.freeBalanceUsd < LOW_BALANCE_USD,
      ).length;
      out.push({
        id: "credits",
        tone: empty ? "red" : low ? "warm-gray" : "green",
        status: empty ? "Act now" : low ? "Watch" : O.allClear,
        headline: empty ? O.credits.out(empty) : low ? O.credits.low(low) : O.credits.ok,
        hint: O.credits.hint,
        to: link("credits"),
      });
    }
    if (access.costs && unpriced.data) {
      const n = unpriced.data.length;
      out.push({
        id: "models",
        tone: n ? "red" : "green",
        status: n ? "Act now" : O.allClear,
        headline: n ? O.models.some(n) : O.models.none,
        hint: O.models.hint,
        to: link("pricing", "models"),
      });
    }
    if (access.costs && costs.data) {
      const n = costs.data.alerts.length;
      out.push({
        id: "costs",
        tone: n ? "warm-gray" : "green",
        status: n ? "Watch" : O.allClear,
        headline: n ? O.costs.some(n) : O.costs.none,
        hint: O.costs.hint,
        to: link("pricing", "costs"),
      });
    }
    if (access.safety && packs.data) {
      const live = packs.data.packs.filter(p => p.currentReleaseId).length;
      out.push({
        id: "safety",
        tone: packs.data.enabled ? "green" : "warm-gray",
        status: packs.data.enabled ? O.allClear : "Check",
        headline: packs.data.enabled ? O.safety.on(live) : O.safety.off,
        hint: packs.data.enabled ? O.safety.hintOn : O.safety.hint,
        to: link("safety"),
      });
    }
    return out;
  }, [access.costs, access.safety, accounts.data, unpriced.data, costs.data, packs.data]);

  const loading =
    (access.costs && (accounts.isLoading || unpriced.isLoading || costs.isLoading)) ||
    (access.safety && packs.isLoading);

  const tasks = COPY.tasks.filter(t => {
    if (t.section === "credits" || t.section === "pricing") return access.costs;
    if (t.section === "safety") return access.safety;
    return access.system;
  });

  return (
    <div className="aa-ov" data-testid="aa-overview">
      {cards.length > 0 || loading ? (
        <section aria-labelledby="aa-ov-attn">
          <h2 id="aa-ov-attn" className="aa-ov__h">
            {O.attentionTitle}
          </h2>
          <p className="aa-ov__sub">{O.attentionHint}</p>
          {loading && cards.length === 0 ? (
            <SkeletonText paragraph lineCount={3} />
          ) : (
            <div className="aa-ov__cards">
              {cards.map(card => (
                <ClickableTile
                  key={card.id}
                  href={card.to}
                  className="aa-ov__card"
                  data-testid={`aa-card-${card.id}`}
                  onClick={(e: React.SyntheticEvent) => {
                    // The tile renders an anchor; keep a plain click inside the app, but leave
                    // new-tab clicks (cmd, ctrl, shift, middle) to the browser.
                    const m = e as React.MouseEvent;
                    if (m.metaKey || m.ctrlKey || m.shiftKey || m.button > 0) return;
                    e.preventDefault();
                    navigate(card.to);
                  }}
                >
                  <Tag type={card.tone} size="sm">
                    {card.status}
                  </Tag>
                  <p className="aa-ov__headline">{card.headline}</p>
                  <p className="aa-ov__hint">{card.hint}</p>
                  <span className="aa-ov__open">{O.open} →</span>
                </ClickableTile>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {access.costs && costs.data && (
        <section aria-labelledby="aa-ov-nums">
          <h2 id="aa-ov-nums" className="aa-ov__h">
            {O.numbersTitle}
          </h2>
          <div className="aa-ov__stats">
            <Tile className="aa-ov__stat">
              <p className="aa-ov__stat-label">{O.spendMonth}</p>
              <p className="aa-ov__stat-value">{usd(costs.data.monthWithFixed)}</p>
            </Tile>
            <Tile className="aa-ov__stat">
              <p className="aa-ov__stat-label">{O.spendToday}</p>
              <p className="aa-ov__stat-value">{usd(costs.data.today)}</p>
            </Tile>
            <Tile className="aa-ov__stat">
              <p className="aa-ov__stat-label">{O.builders}</p>
              <p className="aa-ov__stat-value">{accounts.data?.length ?? "—"}</p>
            </Tile>
          </div>
        </section>
      )}

      <section aria-labelledby="aa-ov-tasks">
        <h2 id="aa-ov-tasks" className="aa-ov__h">
          {O.tasksTitle}
        </h2>
        <p className="aa-ov__sub">{O.tasksHint}</p>
        <ul className="aa-ov__tasks">
          {tasks.map(t => (
            <li key={t.id}>
              <Link
                to={link(t.section as SectionId, t.view)}
                data-testid={`aa-task-${t.id}`}
                className="aa-ov__task"
              >
                {t.label}
                <span aria-hidden>→</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default OverviewPanel;
