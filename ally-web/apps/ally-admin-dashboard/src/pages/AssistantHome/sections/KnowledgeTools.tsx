import React, { useState } from "react";

import {
  useAddKnowledgeFromPoolMutation,
  useApproveKnowledgeMutation,
  useCopyKnowledgeFromMutation,
  useExcludeKnowledgeMutation,
  useGetChatbotDocumentsQuery,
  useGetChatbotsQuery,
  useGetCuratedKnowledgeQuery,
  useGetKnowledgeFreshnessQuery,
  useGetKnowledgeReviewQuery,
  useReadSourceAgainMutation,
} from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { ChatbotMemberRole } from "@types";

import { SAFETY_PRIVACY_COPY } from "../copy/safetyPrivacy";
import { Group } from "../fields";

import type { SectionProps } from "./props";

const K = SAFETY_PRIVACY_COPY.knowledge;
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (w, key: string) => (key in values ? String(values[key]) : w));

const reasonOf = (error: unknown, fallback: string): string => {
  const m = (error as { data?: { message?: string | string[] } })?.data?.message;
  const text = Array.isArray(m) ? m.join(" ") : m;
  return text?.trim() ? text : fallback;
};

const Problem: React.FC<{ text: string | null }> = ({ text }) =>
  text ? (
    <p className="ally-error" role="alert">
      {text}
    </p>
  ) : null;

/** Sources held back for personal details: an owner approves, an editor can leave them out. */
export const Review: React.FC<{ botId: string; canEdit: boolean; canManage: boolean }> = ({
  botId,
  canEdit,
  canManage,
}) => {
  const { data } = useGetKnowledgeReviewQuery(botId);
  const [approve] = useApproveKnowledgeMutation();
  const [exclude] = useExcludeKnowledgeMutation();
  const [problem, setProblem] = useState<string | null>(null);
  const docs = data?.documents ?? [];
  const run = async (action: () => Promise<unknown>) => {
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(reasonOf(error, K.failed));
    }
  };
  return (
    <Group title={K.reviewTitle} hint={K.reviewHint} testId="knowledge-review">
      {docs.length === 0 && <p className="ally-small">{K.reviewEmpty}</p>}
      <ul className="ally-build__list">
        {docs.map(doc => (
          <li key={doc.id} data-testid="review-item">
            <strong>{doc.title}</strong>
            <ul>
              {doc.findings.map(f => (
                <li key={f.kind} className="ally-small">
                  {K.found}: {f.kind} ({f.count}) {f.sample}
                </li>
              ))}
            </ul>
            <div className="ally-btn-row">
              <Button
                variant={ButtonVariant.SECONDARY}
                type="button"
                disabled={!canManage}
                title={canManage ? undefined : K.ownerApprove}
                onClick={() => void run(() => approve({ id: botId, documentId: doc.id }).unwrap())}
              >
                {K.approve}
              </Button>
              <Button
                variant={ButtonVariant.TEXT}
                type="button"
                disabled={!canEdit}
                onClick={() => void run(() => exclude({ id: botId, documentId: doc.id }).unwrap())}
              >
                {K.exclude}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Problem text={problem} />
    </Group>
  );
};

/** How long since the oldest source was read, with "Read again" on each of its own sources. */
const Freshness: React.FC<{ botId: string; canEdit: boolean }> = ({ botId, canEdit }) => {
  const fresh = useGetKnowledgeFreshnessQuery(botId);
  const docs = useGetChatbotDocumentsQuery(botId);
  const [readAgain, state] = useReadSourceAgainMutation();
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const own = (docs.data ?? []).filter(d => d.private && !d.archived);
  const days = fresh.data?.knowledgeStaleDays ?? null;
  return (
    <Group title={K.freshTitle} testId="knowledge-freshness">
      <p className="ally-small">{days === null ? K.freshNone : fill(K.freshDays, { n: days })}</p>
      <ul className="ally-build__list">
        {own.map(doc => (
          <li key={doc.id}>
            <span>{doc.title}</span>
            <Button
              variant={ButtonVariant.TEXT}
              type="button"
              disabled={!canEdit || state.isLoading}
              onClick={async () => {
                setNote(null);
                setProblem(null);
                try {
                  const done = await readAgain({ id: botId, documentId: doc.id }).unwrap();
                  setNote(done.changed ? K.readChanged : K.readSame);
                } catch (error) {
                  setProblem(reasonOf(error, K.readFailed));
                }
              }}
            >
              {state.isLoading ? K.reading : K.readAgain}
            </Button>
          </li>
        ))}
      </ul>
      {note && (
        <p className="ally-small" role="status">
          {note}
        </p>
      )}
      <Problem text={problem} />
    </Group>
  );
};

/** Copies another chatbot's documents here as private copies. */
const CopyFrom: React.FC<{ botId: string; canEdit: boolean }> = ({ botId, canEdit }) => {
  const bots = useGetChatbotsQuery();
  const [copy, state] = useCopyKnowledgeFromMutation();
  const [otherId, setOtherId] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const others = (bots.data?.chatbots ?? []).filter(
    b =>
      b.id !== botId &&
      (b.myRole === ChatbotMemberRole.EDITOR || b.myRole === ChatbotMemberRole.OWNER),
  );
  return (
    <Group title={K.copyTitle} hint={K.copyHint} testId="knowledge-copy">
      <label className="ally-field">
        <span className="ally-sr-only">{K.copyPick}</span>
        <select
          className="ally-input"
          value={otherId}
          disabled={!canEdit}
          onChange={e => setOtherId(e.target.value)}
        >
          <option value="">{K.copyPick}</option>
          {others.map(b => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <div>
        <Button
          variant={ButtonVariant.SECONDARY}
          type="button"
          disabled={!canEdit || !otherId || state.isLoading}
          onClick={async () => {
            setNote(null);
            setProblem(null);
            try {
              const result = await copy({ id: botId, otherId }).unwrap();
              setNote(fill(K.copied, { n: result.documentIds.length, skipped: result.skipped }));
            } catch (error) {
              setProblem(reasonOf(error, K.failed));
            }
          }}
        >
          {K.copyAction}
        </Button>
      </div>
      {note && (
        <p className="ally-small" role="status">
          {note}
        </p>
      )}
      <Problem text={problem} />
    </Group>
  );
};

/** Ally's curated documents, each copied on choice. */
const Pool: React.FC<{ botId: string; canEdit: boolean }> = ({ botId, canEdit }) => {
  const { data } = useGetCuratedKnowledgeQuery();
  const [add] = useAddKnowledgeFromPoolMutation();
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const docs = data?.documents ?? [];
  return (
    <Group title={K.poolTitle} hint={K.poolHint} testId="knowledge-pool">
      {docs.length === 0 && <p className="ally-small">{K.poolEmpty}</p>}
      <ul className="ally-build__list">
        {docs.map(doc => (
          <li key={doc.id}>
            <span>{doc.title}</span>
            <Button
              variant={ButtonVariant.TEXT}
              type="button"
              disabled={!canEdit}
              onClick={async () => {
                setNote(null);
                setProblem(null);
                try {
                  await add({ id: botId, documentId: doc.id }).unwrap();
                  setNote(K.poolAdded);
                } catch (error) {
                  setProblem(reasonOf(error, K.failed));
                }
              }}
            >
              {K.poolAdd}
            </Button>
          </li>
        ))}
      </ul>
      {note && (
        <p className="ally-small" role="status">
          {note}
        </p>
      )}
      <Problem text={problem} />
    </Group>
  );
};

/** What it knows: review of held sources, freshness, copying knowledge in. */
export const KnowledgeTools: React.FC<Pick<SectionProps, "bot" | "canEdit" | "canManage">> = ({
  bot,
  canEdit,
  canManage,
}) => (
  <div className="ally-home__stack" data-testid="knowledge-tools">
    <Review botId={bot.id} canEdit={canEdit} canManage={canManage} />
    <Freshness botId={bot.id} canEdit={canEdit} />
    <CopyFrom botId={bot.id} canEdit={canEdit} />
    <Pool botId={bot.id} canEdit={canEdit} />
  </div>
);
