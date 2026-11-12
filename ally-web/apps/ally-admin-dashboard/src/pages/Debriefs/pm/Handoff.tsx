import React from "react";

import { Link } from "react-router-dom";

import { shortId } from "@components/ally-guide/allyGuideFormat";
import { Pill } from "@components/ally-guide/Pill";
import { en, ROUTES } from "@constants";
import { PmAgentIdeaRow } from "@types";

import { inWords } from "../consoleLabels";

/** The brief, report or question the PM agent wrote for a person (no learner quotes). */
export const Handoff: React.FC<{ idea: PmAgentIdeaRow }> = ({ idea }) => {
  const s = en.debriefs.pmAgent.handoff;
  const h = idea.evidence.handoff;
  if (!h) return null;
  return (
    <div className="flex flex-col gap-1 bg-neutral-50 p-2 text-sm" data-testid="idea-handoff">
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        {s[h.kind]}
        <Pill tone={h.status === "waiting" ? "info" : "success"}>
          {s.status[h.status] ?? h.status}
        </Pill>
        {(h.kind === "person" || h.kind === "guidance") && (
          <span className="font-normal">{s.forWhom[h.for] ?? h.for}</span>
        )}
      </p>
      {h.kind === "builder" && (
        <>
          <p className="whitespace-pre-wrap">{inWords(h.problem)}</p>
          <p className="whitespace-pre-wrap">{inWords(h.evidenceSummary)}</p>
          <p className="whitespace-pre-wrap">{inWords(h.expectedEffect)}</p>
          <p className="font-semibold">{s.checks}</p>
          <ul className="list-disc pl-5">
            {h.acceptanceChecks.map(c => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
      {h.kind === "bug_hunter" && (
        <>
          <p className="whitespace-pre-wrap">{inWords(h.summary)}</p>
          {h.runIds.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 text-xs" data-testid="handoff-runs">
              <span>{s.runs}:</span>
              {h.runIds.map(id => (
                <Link
                  key={id}
                  to={ROUTES.DEBRIEF_SESSION(id)}
                  className="font-mono text-primary-600 underline"
                  aria-label={en.debriefs.runs.openLabel(shortId(id))}
                >
                  {shortId(id)}
                </Link>
              ))}
            </p>
          )}
        </>
      )}
      {h.kind === "guidance" && (
        <div className="flex flex-col gap-1" data-testid="handoff-guidance">
          <p className="text-typography-700">
            {h.action === "change" && h.existingCode
              ? s.guidanceChange(h.existingCode, h.existingTitle ?? "")
              : s.guidanceNew}
          </p>
          <p className="font-semibold">{h.title}</p>
          <p>
            <span className="font-semibold">{s.guidanceSituation}:</span> {inWords(h.situation)}
          </p>
          <p className="whitespace-pre-wrap">{inWords(h.guidance)}</p>
          {h.why && (
            <p className="whitespace-pre-wrap text-typography-700">
              <span className="font-semibold">{s.guidanceWhy}:</span> {inWords(h.why)}
            </p>
          )}
          <p className="text-xs text-typography-700">
            {s.guidanceEvidence(h.learners, h.tenants, h.scope === "platform")}
          </p>
          {h.runIds.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 text-xs" data-testid="handoff-runs">
              <span>{s.runs}:</span>
              {h.runIds.map(id => (
                <Link
                  key={id}
                  to={ROUTES.DEBRIEF_SESSION(id)}
                  className="font-mono text-primary-600 underline"
                  aria-label={en.debriefs.runs.openLabel(shortId(id))}
                >
                  {shortId(id)}
                </Link>
              ))}
            </p>
          )}
          <p className="text-xs text-typography-700">{s.guidanceNotWritten}</p>
        </div>
      )}
      {h.kind === "person" && (
        <>
          <p className="whitespace-pre-wrap">{inWords(h.question)}</p>
          {h.context && (
            <p className="whitespace-pre-wrap text-typography-700">{inWords(h.context)}</p>
          )}
        </>
      )}
    </div>
  );
};
