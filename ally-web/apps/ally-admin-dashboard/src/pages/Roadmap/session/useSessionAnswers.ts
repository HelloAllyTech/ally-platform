import { useCallback, useMemo } from "react";

import {
  useChooseRoadmapAnswerMutation,
  useGetRoadmapSessionAnswersQuery,
  usePostRoadmapAnswerMutation,
  usePostRoadmapCommentMutation,
} from "../../../api/roadmapV2Flow";
import { PendingSend, useOutbox } from "../hooks/useOutbox";
import { OutboxEntry } from "../utils/deviceStore";

import type { RoadmapItemDetail } from "../../../types/roadmapV2";
import type { RoadmapConversationPost, RoadmapQuestionAnswers } from "../../../types/roadmapV2Flow";

/**
 * P3b's one attributed session for an idea (§4.5a): the answers each question has, the comments
 * to people, and the sends still on their way. Answers and comments go through the outbox, so
 * they show at once and survive going offline; the idempotency key makes a retry return the
 * original post (contract: 200, same id).
 */
export const useSessionAnswers = (
  item: Pick<RoadmapItemDetail, "sessionId" | "can" | "shownStage">,
) => {
  const sessionId = item.sessionId;
  // A draft's session is private and answers 403 here (its page uses /drafts instead).
  const skip = !sessionId || item.shownStage === "draft";
  const { data, refetch } = useGetRoadmapSessionAnswersQuery(sessionId ?? "", {
    skip,
    pollingInterval: 20_000,
    skipPollingIfUnfocused: true,
  });
  const [postAnswer] = usePostRoadmapAnswerMutation();
  const [postComment] = usePostRoadmapCommentMutation();
  const [choose] = useChooseRoadmapAnswerMutation();

  const send = useCallback(
    async (entry: OutboxEntry) => {
      if (entry.kind === "comment") {
        await postComment({
          sessionId: entry.target,
          text: entry.text ?? "",
          ...(entry.mentionUserIds?.length ? { mentionUserIds: entry.mentionUserIds } : {}),
          idempotencyKey: entry.idempotencyKey,
        }).unwrap();
        return;
      }
      await postAnswer({
        sessionId: entry.target,
        questionId: entry.questionId ?? "",
        ...(entry.text ? { text: entry.text } : {}),
        ...(entry.optionIds?.length ? { optionIds: entry.optionIds } : {}),
        idempotencyKey: entry.idempotencyKey,
      }).unwrap();
    },
    [postAnswer, postComment],
  );

  const outbox = useOutbox({ target: skip ? undefined : sessionId, send });

  const questions = useMemo(() => {
    const map = new Map<string, RoadmapQuestionAnswers>();
    (Array.isArray(data?.questions) ? data!.questions : []).forEach(q => map.set(q.questionId, q));
    return map;
  }, [data]);

  const comments: RoadmapConversationPost[] = useMemo(
    () =>
      (Array.isArray(data?.comments) ? data!.comments : [])
        .slice()
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
    [data],
  );

  const sentKeys = useMemo(() => {
    const keys = new Set<string>();
    comments.forEach(c => keys.add(c.idempotencyKey));
    questions.forEach(q => q.answers.forEach(a => keys.add(a.idempotencyKey)));
    return keys;
  }, [comments, questions]);

  /** Sends not yet reflected in the server's lists. */
  const pending: PendingSend[] = outbox.pending.filter(p => !sentKeys.has(p.idempotencyKey));

  const answer = (questionId: string, value: { text?: string; optionIds?: string[] }) =>
    outbox.enqueue({ kind: "answer", questionId, ...value });

  const comment = (text: string, mentionUserIds: number[]) =>
    outbox.enqueue({ kind: "comment", text, mentionUserIds });

  const chooseAnswer = async (postId: string) => {
    if (!sessionId) return;
    await choose({ sessionId, postId }).unwrap();
  };

  return {
    enabled: !skip,
    sessionId,
    questions,
    comments,
    pending,
    answer,
    comment,
    retry: outbox.retry,
    chooseAnswer,
    refetch,
  };
};

export type SessionAnswers = ReturnType<typeof useSessionAnswers>;
