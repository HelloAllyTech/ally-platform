import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LineChart, ScatterChart, SimpleBarChart, StackedBarChart } from "@carbon/charts-react";
import {
  Add,
  Send,
  ThumbsDown,
  ThumbsDownFilled,
  ThumbsUp,
  ThumbsUpFilled,
} from "@carbon/icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  Accordion,
  AccordionItem,
  Button,
  InlineNotification,
  SkeletonPlaceholder,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextArea,
  Tile,
} from "@ally-ui-mono/ui-shared";
import {
  useAskAnalyticsAgentMutation,
  useGetAnalyticsAgentCatalogQuery,
  useGetAnalyticsAgentConversationsQuery,
  useLazyGetAnalyticsAgentConversationQuery,
  useSetAnalyticsAgentFeedbackMutation,
} from "@api";
import { sharedMarkdownComponents } from "@components";
import { en } from "@constants";
import {
  AnalyticsAgentConversationDetail,
  AnalyticsAgentFeedback,
  AnalyticsAgentConversationSummary,
  AnalyticsAgentMessage,
  AnalyticsAgentTurnInput,
  AskAnalyticsAgentResponse,
} from "@types";

import { AgentChartModel, buildAgentChart } from "../agentChart";
import { CHART_HEIGHT, ChartIdBadge, ScrollableChart } from "../chartKit";

/**
 * Analytics Agent — the conversational tab of the analytics dashboard.
 *
 * The open thread is a list of turns held in this component's state, and the
 * agent is stateless (it is handed the turns it should consider with each
 * question). Each answered turn is also saved server-side, per user, so the
 * sidebar can list earlier conversations and reopen one after a reload. Starting
 * a new conversation therefore needs no confirmation — nothing is lost, the old
 * thread just moves down the list.
 *
 * The screen's job is not to make an answer look confident — it is to make one
 * checkable. Every answered turn shows, in this order: the answer, its caveats,
 * the chart (only when the rows can honestly carry one), the rows themselves,
 * and the SQL that produced them behind one click. A reader who doubts a number
 * can get to the query without leaving the tab, which is the difference between
 * a tool people trust and a tool people quietly stop using.
 */

const SLOW_AFTER_MS = 6000;
/** Turns of context sent back with a follow-up. The server caps this too; the
 *  client keeping the same bound means the request stays small. */
const HISTORY_TURNS = 8;
/** Rows rendered before the table scrolls rather than growing the page. */
const TABLE_VIEWPORT_ROWS = 12;

let messageSeq = 0;
const nextId = (): string => {
  messageSeq += 1;
  return `agent-msg-${messageSeq}`;
};

/** A saved conversation as on-screen messages: each turn is the question, then
 *  its reply exactly as it was shown when asked. */
const toMessages = (detail: AnalyticsAgentConversationDetail): AnalyticsAgentMessage[] =>
  detail.messages.flatMap<AnalyticsAgentMessage>(turn => [
    { id: nextId(), role: "user", question: turn.question },
    {
      id: nextId(),
      role: "agent",
      status: "done",
      response: turn.response,
      messageId: turn.id,
      feedback: turn.feedback ?? null,
    },
  ]);

/** Cell rendering for the result table. Dates are trimmed to their date part;
 *  null renders as an em dash so an unmeasured value is visibly not a zero. */
const renderCell = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  const isoDate = /^(\d{4}-\d{2}-\d{2})T[\d:.]+/.exec(text);
  return isoDate ? isoDate[1] : text;
};

const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );

/** The Carbon component for a mapped chart. Kept beside the mapper so adding a
 *  chart type is two edits in the same pair of files, not a hunt. */
const AgentChart = ({ model }: { model: AgentChartModel }) => {
  const { kind, data, options } = model;
  if (kind === "line") return <LineChart data={data} options={options} />;
  if (kind === "bar") return <SimpleBarChart data={data} options={options} />;
  if (kind === "stacked") return <StackedBarChart data={data} options={options} />;
  return <ScatterChart data={data} options={options} />;
};

/** Non-answer outcomes: a sentence in a notification, plus the SQL when there
 *  was one. `kind` is honest about severity — a clarifying question is not an
 *  error, and styling it red teaches readers to distrust the tab. */
const OutcomeNotice = ({ response }: { response: AskAnalyticsAgentResponse }) => {
  const strings = en.analyticsAgent;
  const byOutcome = {
    clarify: { kind: "info" as const, title: strings.clarifyTitle },
    refused: { kind: "info" as const, title: strings.refusedTitle },
    rejected: { kind: "warning" as const, title: strings.rejectedTitle },
    failed: { kind: "error" as const, title: strings.failedTitle },
  };
  const config = byOutcome[response.outcome as keyof typeof byOutcome];
  if (!config) return null;
  return (
    <InlineNotification
      kind={config.kind}
      lowContrast
      hideCloseButton
      title={config.title}
      subtitle={response.message}
      className="max-w-full"
    />
  );
};

/** The SQL, collapsed. Shown for every turn that generated one — including a
 *  refused one, where it is the only way to see what was attempted. */
const QueryDisclosure = ({ response }: { response: AskAnalyticsAgentResponse }) => {
  const strings = en.analyticsAgent;
  if (!response.sql) return null;
  return (
    <Accordion size="sm" className="mt-3">
      <AccordionItem title={strings.showQuery}>
        <pre className="bg-neutral-100 rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
          {response.sql}
        </pre>
        {response.rationale && (
          <p className="text-xs text-typography-600 mt-2">{response.rationale}</p>
        )}
      </AccordionItem>
    </Accordion>
  );
};

const ResultTable = ({ response }: { response: AskAnalyticsAgentResponse }) => {
  const strings = en.analyticsAgent;
  if (!response.columns.length || !response.rows.length) return null;
  return (
    <div className="mt-3">
      {/* A capped result must say so where the numbers are, not in a tooltip:
          a total read off a truncated table is wrong by an unknown amount. */}
      {response.truncated && (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title=""
          subtitle={fill(strings.truncatedNotice, { count: response.rowCount })}
          className="max-w-full mb-2"
        />
      )}
      <TableContainer>
        <div
          className="overflow-auto"
          // Bounded height rather than a pager: a few hundred rows is the normal
          // case here, and scrolling keeps the answer above it on screen.
          style={{ maxHeight: `${TABLE_VIEWPORT_ROWS * 2.5}rem` }}
        >
          <Table size="sm" useZebraStyles>
            <TableHead>
              <TableRow>
                {response.columns.map(column => (
                  <TableHeader key={column}>{column}</TableHeader>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {response.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {response.columns.map(column => (
                    <TableCell key={column}>{renderCell(row[column])}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </TableContainer>
      <p className="text-xs text-typography-500 mt-1">
        {response.rowCount} {strings.rowsReturned} · {strings.ranIn} {response.durationMs}ms
      </p>
    </div>
  );
};

/**
 * The reader's optional thumbs up / down on one saved answer.
 *
 * Nothing is required: a rating is only ever something the reader chose to give,
 * tapping the same thumb again takes it back, and a failed save puts the buttons
 * back as they were and says so. The value lives here rather than in the thread —
 * the thread only needs it to start from, and a reopened conversation is read
 * fresh from the server.
 */
const FeedbackButtons = ({
  messageId,
  initial,
}: {
  messageId: string;
  initial: AnalyticsAgentFeedback | null;
}) => {
  const strings = en.analyticsAgent;
  const [value, setValue] = useState<AnalyticsAgentFeedback | null>(initial);
  const [failed, setFailed] = useState(false);
  const [save, { isLoading }] = useSetAnalyticsAgentFeedbackMutation();

  const choose = async (picked: AnalyticsAgentFeedback) => {
    const previous = value;
    const next = previous === picked ? null : picked;
    setValue(next);
    setFailed(false);
    try {
      await save({ messageId, feedback: next }).unwrap();
    } catch {
      setValue(previous);
      setFailed(true);
    }
  };

  return (
    <div className="flex flex-col items-end">
      <div role="group" aria-label={strings.feedbackLabel} className="flex items-center">
        <Button
          kind="ghost"
          size="sm"
          hasIconOnly
          iconDescription={strings.feedbackUp}
          renderIcon={value === "up" ? ThumbsUpFilled : ThumbsUp}
          aria-pressed={value === "up"}
          disabled={isLoading}
          onClick={() => void choose("up")}
        />
        <Button
          kind="ghost"
          size="sm"
          hasIconOnly
          iconDescription={strings.feedbackDown}
          renderIcon={value === "down" ? ThumbsDownFilled : ThumbsDown}
          aria-pressed={value === "down"}
          disabled={isLoading}
          onClick={() => void choose("down")}
        />
      </div>
      {failed && <p className="text-xs text-red-700">{strings.feedbackFailed}</p>}
    </div>
  );
};

/** One answered turn. */
const AgentAnswer = ({
  response,
  messageId,
  feedback,
  onFollowUp,
}: {
  response: AskAnalyticsAgentResponse;
  messageId: string | null;
  feedback: AnalyticsAgentFeedback | null;
  onFollowUp: (question: string) => void;
}) => {
  const strings = en.analyticsAgent;
  const chart = useMemo(
    () => buildAgentChart(response.chart, response.rows),
    [response.chart, response.rows],
  );

  const provenance = response.provenance.answerModel
    ? fill(strings.provenance, {
        planner: response.provenance.plannerModel,
        answer: response.provenance.answerModel,
        version: response.provenance.promptVersion,
      })
    : fill(strings.provenancePlannerOnly, {
        planner: response.provenance.plannerModel,
        version: response.provenance.promptVersion,
      });

  return (
    <div className="min-w-0">
      {response.outcome === "answer" ? (
        <>
          <div className="break-words text-sm text-typography-900">
            <ReactMarkdown components={sharedMarkdownComponents} remarkPlugins={[remarkGfm]}>
              {response.answer}
            </ReactMarkdown>
          </div>

          {/* An empty result is a finding, and saying so beats an empty table. */}
          {response.rowCount === 0 && (
            <p className="text-sm text-typography-600 mt-2">{strings.emptyResult}</p>
          )}

          {/* Caveats sit directly under the answer, never in a tooltip: they are
              the part a reader most needs and least seeks out. */}
          {response.caveats.length > 0 && (
            <div className="mt-3 border-l-2 border-border-light pl-3">
              <p className="text-xs font-medium text-typography-700">{strings.caveatsTitle}</p>
              <ul className="list-disc list-inside">
                {response.caveats.map(caveat => (
                  <li key={caveat} className="text-xs text-typography-600">
                    {caveat}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {chart && (
            <div className="mt-4">
              {response.chart?.title && (
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-sm font-medium text-typography-900">
                    {response.chart.title}
                  </h4>
                  <ChartIdBadge id="AAQ-151" />
                </div>
              )}
              {/* A scatter's x-axis is a quantity, not a growing set of
                  categories, so it has nothing to scroll for. */}
              {chart.kind === "scatter" ? (
                <div style={{ height: CHART_HEIGHT }}>
                  <AgentChart model={chart} />
                </div>
              ) : (
                <ScrollableChart data={chart.data} on={chart.kind === "bar" ? "group" : "key"}>
                  <AgentChart model={chart} />
                </ScrollableChart>
              )}
              {/* Rows the plot could not carry are named, so the chart is never
                  quietly narrower than the table beside it. */}
              {chart.skippedRows > 0 && (
                <p className="text-xs text-typography-500 mt-1">
                  {fill(strings.skippedRowsNotice, { count: chart.skippedRows })}
                </p>
              )}
            </div>
          )}

          <ResultTable response={response} />
        </>
      ) : (
        <OutcomeNotice response={response} />
      )}

      <QueryDisclosure response={response} />

      {response.followUps.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-typography-700 mb-1">{strings.followUpsTitle}</p>
          <div className="flex flex-wrap gap-2">
            {response.followUps.map(followUp => (
              <Button
                key={followUp}
                kind="ghost"
                size="sm"
                className="text-left max-sm:!max-w-full"
                onClick={() => onFollowUp(followUp)}
              >
                {followUp}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-typography-500">{provenance}</p>
        {/* Only a saved turn has something to rate. */}
        {messageId && <FeedbackButtons messageId={messageId} initial={feedback} />}
      </div>
    </div>
  );
};

/** What the agent can read. Answers "why was that refused?" before it is asked. */
const ScopePanel = () => {
  const strings = en.analyticsAgent;
  const { data, isLoading, isError } = useGetAnalyticsAgentCatalogQuery();

  return (
    <Accordion size="sm">
      <AccordionItem title={strings.scopeTitle}>
        {isLoading && <SkeletonPlaceholder className="w-full h-16" />}
        {isError && <p className="text-sm text-typography-600">{strings.scopeLoadFailed}</p>}
        {data && (
          <>
            <p className="text-sm text-typography-700">
              {fill(strings.scopeIntro, { rowLimit: data.rowLimit })}
            </p>
            <div className="flex flex-wrap gap-1 mt-2">
              {data.tables.map(table => (
                <Tag key={table.name} type="cool-gray" title={table.purpose}>
                  {table.name}
                </Tag>
              ))}
            </div>
            <p className="text-xs text-typography-600 mt-3">{strings.scopeDeniedIntro}</p>
          </>
        )}
      </AccordionItem>
    </Accordion>
  );
};

/**
 * The reader's saved conversations, newest activity first, with the button that
 * starts a fresh one. Titles are the first question asked.
 *
 * Switching is disabled while a question is in flight: the pending reply belongs
 * to the thread it was asked in, and letting the reader move away would land it
 * in the wrong place.
 */
const ConversationSidebar = ({
  activeId,
  disabled,
  onSelect,
  onNew,
}: {
  activeId: string | null;
  disabled: boolean;
  onSelect: (conversation: AnalyticsAgentConversationSummary) => void;
  onNew: () => void;
}) => {
  const strings = en.analyticsAgent;
  const { data, isLoading, isError } = useGetAnalyticsAgentConversationsQuery();

  return (
    <aside
      aria-label={strings.historyTitle}
      className="flex flex-col gap-2 md:w-64 md:shrink-0 md:border-r md:border-border-light md:pr-3"
    >
      <Button
        kind="tertiary"
        size="sm"
        className="w-full max-w-full"
        renderIcon={Add}
        disabled={disabled}
        onClick={onNew}
      >
        {strings.newConversation}
      </Button>

      <p className="text-xs font-medium text-typography-700 mt-2">{strings.historyTitle}</p>

      {/* Bounded on a phone so the thread is still on screen under the list. */}
      <div className="max-md:max-h-40 overflow-y-auto">
        {isLoading && <SkeletonPlaceholder className="w-full h-16" />}
        {isError && <p className="text-sm text-typography-600">{strings.historyLoadFailed}</p>}
        {data && data.length === 0 && (
          <p className="text-sm text-typography-600">{strings.historyEmpty}</p>
        )}
        {data && data.length > 0 && (
          <ul className="flex flex-col gap-1">
            {data.map(conversation => {
              const active = conversation.id === activeId;
              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    title={conversation.title}
                    aria-current={active ? "true" : undefined}
                    disabled={disabled}
                    onClick={() => onSelect(conversation)}
                    className={`w-full cursor-pointer truncate rounded px-2 py-2 text-left text-sm text-typography-900 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 ${
                      active ? "bg-neutral-100 font-medium" : ""
                    }`}
                  >
                    {conversation.title}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-typography-500">{strings.historyPrivacy}</p>
    </aside>
  );
};

export const AnalyticsAgentTab = () => {
  const strings = en.analyticsAgent;
  const [messages, setMessages] = useState<AnalyticsAgentMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [slow, setSlow] = useState(false);
  // The saved conversation the thread belongs to. null until the first turn is
  // answered, at which point the server hands back the id it created.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [ask, { isLoading }] = useAskAnalyticsAgentMutation();
  const [fetchConversation] = useLazyGetAnalyticsAgentConversationQuery();
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  // Which open request is current, so a slow response for a conversation the
  // reader has already clicked away from cannot overwrite the one they chose.
  const openSeq = useRef(0);

  // Only answered turns become context. A failed or refused turn would teach the
  // planner to repeat the thing that failed.
  const history = useMemo<AnalyticsAgentTurnInput[]>(
    () =>
      messages
        .filter(
          (message): message is Extract<AnalyticsAgentMessage, { status: "done" }> =>
            message.role === "agent" &&
            message.status === "done" &&
            message.response.outcome === "answer",
        )
        .slice(-HISTORY_TURNS)
        .map(message => ({
          question: message.response.question,
          sql: message.response.sql,
          answer: message.response.answer,
        })),
    [messages],
  );

  // Honest progress rather than an unbounded spinner: two model calls and a
  // query take real seconds, and a reader who cannot tell "working" from "stuck"
  // reloads the page mid-question.
  useEffect(() => {
    if (!isLoading) {
      setSlow(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const submit = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim();
      if (!question || isLoading) return;

      const pendingId = nextId();
      setMessages(current => [
        ...current,
        { id: nextId(), role: "user", question },
        { id: pendingId, role: "agent", status: "pending", question },
      ]);
      setDraft("");

      try {
        const response = await ask({
          question,
          history,
          conversationId: conversationId ?? undefined,
        }).unwrap();
        if (response.conversationId) setConversationId(response.conversationId);
        setMessages(current =>
          current.map(message =>
            message.id === pendingId
              ? {
                  id: pendingId,
                  role: "agent",
                  status: "done",
                  response,
                  messageId: response.messageId ?? null,
                  feedback: null,
                }
              : message,
          ),
        );
      } catch {
        // The turn keeps its place in the thread and states what happened, so the
        // reader can retype or ask something narrower. A toast would be gone
        // before it was read.
        setMessages(current =>
          current.map(message =>
            message.id === pendingId
              ? {
                  id: pendingId,
                  role: "agent",
                  status: "error",
                  question,
                  message: strings.requestFailed,
                }
              : message,
          ),
        );
      }
    },
    [ask, history, isLoading, conversationId, strings.requestFailed],
  );

  const startNew = () => {
    openSeq.current += 1;
    setMessages([]);
    setDraft("");
    setConversationId(null);
    setOpening(false);
    setOpenFailed(false);
  };

  const openConversation = async (conversation: AnalyticsAgentConversationSummary) => {
    if (isLoading || conversation.id === conversationId) return;
    openSeq.current += 1;
    const seq = openSeq.current;
    setOpening(true);
    setOpenFailed(false);
    try {
      const detail = await fetchConversation(conversation.id).unwrap();
      if (seq !== openSeq.current) return;
      setMessages(toMessages(detail));
      setConversationId(detail.id);
      setDraft("");
    } catch {
      if (seq === openSeq.current) setOpenFailed(true);
    } finally {
      if (seq === openSeq.current) setOpening(false);
    }
  };

  return (
    <div className="pt-2 flex flex-col gap-4 md:flex-row">
      <ConversationSidebar
        activeId={conversationId}
        disabled={isLoading || opening}
        onSelect={conversation => void openConversation(conversation)}
        onNew={startNew}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 className="text-lg font-medium text-typography-900">{strings.heading}</h2>
        </div>

        <div className="mb-4">
          <ScopePanel />
        </div>

        {openFailed && (
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title=""
            subtitle={strings.conversationLoadFailed}
            className="max-w-full mb-4"
          />
        )}

        {opening ? (
          <div className="mb-4 flex flex-col gap-2">
            <p className="text-sm text-typography-600">{strings.conversationLoading}</p>
            <SkeletonPlaceholder className="w-full h-24" />
          </div>
        ) : messages.length === 0 ? (
          <Tile className="mb-4">
            <p className="text-base font-medium text-typography-900">{strings.emptyTitle}</p>
            <p className="text-sm text-typography-600 mt-1">{strings.emptySubtitle}</p>
            <div className="flex flex-col items-start gap-1 mt-3">
              {strings.samples.map(sample => (
                <Button
                  key={sample}
                  kind="ghost"
                  size="sm"
                  className="max-sm:!max-w-full"
                  onClick={() => submit(sample)}
                >
                  {sample}
                </Button>
              ))}
            </div>
          </Tile>
        ) : (
          <div className="flex flex-col gap-4 mb-4">
            {messages.map(message =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[80%] break-words rounded bg-neutral-100 px-3 py-2 text-sm text-typography-900">
                    {message.question}
                  </div>
                </div>
              ) : (
                <Tile key={message.id} className="min-w-0">
                  {message.status === "pending" && (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm text-typography-600">
                        {slow ? strings.pendingSlow : strings.pendingPlanning}
                      </p>
                      <SkeletonPlaceholder className="w-full h-16" />
                    </div>
                  )}
                  {message.status === "error" && (
                    <InlineNotification
                      kind="error"
                      lowContrast
                      hideCloseButton
                      title={strings.failedTitle}
                      subtitle={message.message}
                      className="max-w-full"
                    />
                  )}
                  {message.status === "done" && (
                    <AgentAnswer
                      response={message.response}
                      messageId={message.messageId}
                      feedback={message.feedback}
                      onFollowUp={submit}
                    />
                  )}
                </Tile>
              ),
            )}
            {/* The scroll margin keeps the newest answer clear of the composer,
              which is pinned to the bottom of the screen on phones. */}
            <div ref={threadEndRef} className="max-md:scroll-mb-32" />
          </div>
        )}

        {/* Pinned to the bottom on phones, so the composer stays in reach (and
          above the keyboard) however long the thread grows. */}
        <div className="flex items-end gap-2 border-t border-border-light pt-3 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:bg-white max-md:pb-3">
          <div className="flex-1 min-w-0">
            <TextArea
              id="analytics-agent-question"
              labelText={strings.inputPlaceholder}
              hideLabel
              value={draft}
              onChange={event => setDraft(event.target.value)}
              placeholder={strings.inputPlaceholder}
              rows={2}
              disabled={isLoading || opening}
              onKeyDown={event => {
                // Enter sends, Shift+Enter adds a line — the same contract as the
                // roleplay copilot composer, so the two chats behave alike.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit(draft);
                }
              }}
            />
          </div>
          <Button
            kind="primary"
            size="md"
            className="shrink-0"
            renderIcon={Send}
            disabled={isLoading || opening || !draft.trim()}
            onClick={() => void submit(draft)}
          >
            {isLoading ? strings.sending : strings.send}
          </Button>
        </div>
      </div>
    </div>
  );
};
