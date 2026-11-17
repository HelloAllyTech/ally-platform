import React, { useMemo, useRef, useState } from "react";

import { motion } from "framer-motion";
import { NavLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ROUTES, en } from "@constants";
import type { BuilderHistoryItem, BuilderRule } from "@types";

import { useRoadmapRole } from "./RoadmapGate";
import { motionTransition, useReducedMotionPreference } from "../../motion";
import { AgentEmbedContext } from "../Builder/agentEmbed";
import { BuilderEval } from "../Builder/BuilderEval";
import { BuilderKnowledge } from "../Builder/BuilderKnowledge";
import { BuilderPipeline } from "../Builder/BuilderPipeline";
import { BuilderScoreboard } from "../Builder/BuilderScoreboard";
import { RoadmapAreaHeader } from "./components/RoadmapAreaHeader";
import { RoadmapBottomBar } from "./components/RoadmapBottomBar";
import { useRoadmapBreakpoint } from "./hooks/useRoadmapBreakpoint";
import { useStackedTables } from "./hooks/useStackedTables";
import { AGENT_SECTIONS, AgentSection, canSeeAgent, isAgentSection } from "./utils/redirects";
import { HistoryTab } from "../Builder/room/HistoryTab";
import { RuleEditor, RuleEditorSource } from "../Builder/room/RuleEditor";
import { RulesTab } from "../Builder/room/RulesTab";

const noop = () => undefined;

/**
 * Roadmap → Agent (§4.1): Builder's cost-per-run, scoreboard, history, rules, knowledge and evals
 * pages, mounted under `/roadmap/agent/…`. Builders read; Owners edit (the embed context hides the
 * controls that change anything). On a phone, wide tables become stacked cards with three fields
 * and a "More" expander (§4.17).
 */
export const RoadmapAgentPage: React.FC = () => {
  const { role } = useRoadmapRole();
  const params = useParams<{ section?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const breakpoint = useRoadmapBreakpoint();
  const phone = breakpoint === "phone";
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2Tools.agent;
  const readOnly = role !== "owner";
  const section: AgentSection = isAgentSection(params.section) ? params.section : "pipeline";
  const [ruleSource, setRuleSource] = useState<RuleEditorSource | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useStackedTables(contentRef, phone, { more: copy.cardMore, less: copy.cardLess });
  const embed = useMemo(() => ({ embedded: true, readOnly }), [readOnly]);

  if (!canSeeAgent(role)) return <Navigate to={ROUTES.ROADMAP} replace />;
  if (params.section && !isAgentSection(params.section)) {
    return <Navigate to={ROUTES.ROADMAP_AGENT_SECTION("pipeline")} replace />;
  }

  const ruleId = searchParams.get("ruleId") ?? undefined;
  const content = (() => {
    switch (section) {
      case "scoreboard":
        return <BuilderScoreboard />;
      case "history":
        return (
          <div className="flex flex-col gap-4 p-4 md:p-6">
            <p className="m-0 text-sm text-typography-600">{copy.historyIntro}</p>
            <HistoryTab
              key={ruleId ?? "all"}
              initial={ruleId ? { ruleId } : {}}
              compact={phone}
              onMakeRule={(entry: BuilderHistoryItem) =>
                setRuleSource({ mode: "draft", historyId: entry.id, sessionId: entry.sessionId })
              }
            />
          </div>
        );
      case "rules":
        return (
          <div className="p-4 md:p-6">
            <RulesTab
              lastHistoryId={null}
              onNewRule={() => setRuleSource({ mode: "new" })}
              onRuleFromLast={noop}
              onEdit={(rule: BuilderRule) => setRuleSource({ mode: "edit", rule })}
              onHistory={(rule: BuilderRule) =>
                navigate(`${ROUTES.ROADMAP_AGENT_SECTION("history")}?ruleId=${rule.id}`)
              }
            />
          </div>
        );
      case "knowledge":
        return <BuilderKnowledge />;
      case "evals":
        return <BuilderEval />;
      default:
        return <BuilderPipeline />;
    }
  })();

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <RoadmapAreaHeader phone={phone} current={en.roadmapV2Tools.tabs.agent} />
      <nav
        aria-label={copy.sectionsLabel}
        className="flex gap-1 overflow-x-auto border-b border-border-light px-4 py-2 [scrollbar-width:none]"
      >
        {AGENT_SECTIONS.map(key => (
          <NavLink
            key={key}
            to={ROUTES.ROADMAP_AGENT_SECTION(key)}
            className={({ isActive }) =>
              `relative inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm md:min-h-8 ${
                isActive || (key === "pipeline" && !params.section)
                  ? "bg-primary-50 font-semibold text-primary-700"
                  : "text-typography-600 hover:bg-neutral-100"
              }`
            }
          >
            {copy.sections[key]}
          </NavLink>
        ))}
      </nav>
      {readOnly && (
        <p className="m-0 border-b border-border-light bg-neutral-50 px-4 py-2 text-xs text-typography-600">
          {copy.readOnly}
        </p>
      )}
      <AgentEmbedContext.Provider value={embed}>
        <motion.div
          key={section}
          ref={contentRef}
          className={`min-h-0 flex-1 overflow-y-auto ${phone ? "roadmap-stacked-tables pb-24" : ""}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={motionTransition("moderate", "productive", reduced)}
        >
          {content}
        </motion.div>
        {ruleSource && !readOnly && (
          <RuleEditor
            source={ruleSource}
            placement={phone ? "bottom" : "side"}
            onClose={() => setRuleSource(null)}
          />
        )}
      </AgentEmbedContext.Provider>
      {phone && <RoadmapBottomBar hidden={false} />}
    </div>
  );
};
