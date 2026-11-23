import React from "react";

import { en } from "@constants";
import { RoleplayInterviewBrief } from "@types";

interface RoleplayBriefPanelProps {
  brief: RoleplayInterviewBrief;
  stillNeeded: string[];
}

const strings = () => en.roleplayInterview.brief;

const Row: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) =>
  value ? (
    <>
      <dt className="text-typography-500">{label}</dt>
      <dd className="text-typography-900 break-words">{value}</dd>
    </>
  ) : null;

/**
 * The roleplay brief as the interview fills it, beside the chat (Course Copilot's brief panel):
 * what is still needed first, then what the trainer has told the agent so far.
 */
export const RoleplayBriefPanel: React.FC<RoleplayBriefPanelProps> = ({ brief, stillNeeded }) => {
  const s = strings();
  const modeLabel = brief.mode ? (en.agentBuilderMode.labels[brief.mode] ?? brief.mode) : undefined;
  const client = brief.client?.characterName
    ? s.libraryCharacter(brief.client.characterName)
    : brief.client?.description;
  return (
    <aside className="flex flex-col gap-4 text-sm" data-testid="roleplay-brief">
      <h3 className="text-base font-medium text-typography-900">{s.title}</h3>
      {stillNeeded.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="still-needed">
          <span className="text-typography-700">{s.stillNeeded}</span>
          {stillNeeded.map(item => (
            <span
              key={item}
              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900"
            >
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p
          className="self-start rounded-full bg-success-50 px-3 py-1 text-xs font-medium text-success-700"
          data-testid="brief-ready"
        >
          ✓ {s.ready}
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <Row label={s.learners} value={brief.learnerProfileName ?? brief.learners?.who} />
        <Row label={s.goal} value={brief.goal} />
        <Row label={s.competency} value={brief.competencyNames?.join(", ")} />
        <Row label={s.mode} value={modeLabel} />
        <Row
          label={s.difficulty}
          value={brief.difficulty ? en.roleplayAgentDifficulty[brief.difficulty] : undefined}
        />
        <Row label={s.client} value={client} />
        <Row label={s.setting} value={brief.setting} />
        <Row label={s.languages} value={brief.languages?.map(l => l.label).join(", ")} />
        <Row
          label={s.passMark}
          value={brief.minScore !== undefined ? String(brief.minScore) : undefined}
        />
        <Row label={s.notes} value={brief.notes?.length ? brief.notes.join("; ") : undefined} />
      </dl>
    </aside>
  );
};
