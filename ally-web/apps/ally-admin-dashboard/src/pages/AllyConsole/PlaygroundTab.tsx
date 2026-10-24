import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  Button,
  Checkbox,
  InlineNotification,
  Select,
  SelectItem,
  TextArea,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useGetAllyGuideReleasesQuery,
  useGetTenantsQuery,
  useGetTracksQuery,
  useRunAllyGuidePlaygroundMutation,
} from "@api";
import { releaseVersionLabel } from "@components/ally-guide/allyGuideFormat";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { AllyGuidePlaygroundIntent, AllyGuideRelease } from "@types";
import { getErrorMessage } from "@utils";

import { PlaygroundPane } from "./PlaygroundPane";
import {
  buildBody,
  historyFor,
  PaneTurn,
  PLAYGROUND_MESSAGE_MAX,
  PLAYGROUND_PROGRESS_MAX,
  parseProgress,
  Scenario,
} from "./playgroundScenario";

type Slot = "a" | "b";
const SLOTS: Slot[] = ["a", "b"];
const COURSE_PAGE = 50;
const INTENTS: AllyGuidePlaygroundIntent[] = [
  "start",
  "continue",
  "locked_peek",
  "not_now",
  "safe_now",
];
const MODES = ["NORMAL", "CARE", "CRISIS_FOLLOWUP"] as const;
const GUIDANCE = ["lead", "walk", "drive"] as const;
const CHANNELS = ["text", "voice"] as const;

const Field: React.FC<{ label: string; help?: string; children: React.ReactNode }> = ({
  label,
  help,
  children,
}) => (
  <div className="flex flex-col gap-1">
    <span className="flex items-center gap-1 text-xs tracking-wide text-typography-700">
      {label}
      {help && <InfoTip label={help} ariaLabel={`About ${label}`} />}
    </span>
    {children}
  </div>
);

/**
 * The Playground (plan §10.5): one scripted conversation, put to two releases at once, a draft
 * included. Each release keeps its own conversation (its own replies feed its own history) while the
 * learner's lines are shared, so the columns differ only in what the release did.
 *
 * Every run calls the models for real and takes 5 to 30 seconds, so progress shows per column and the
 * Send button locks while any run is in flight. Nothing is saved server-side. The server requires the
 * edit grant, so a view-only admin gets an explanation rather than a form that would fail.
 */
export const PlaygroundTab: React.FC = () => {
  const strings = en.allyConsole.playground;
  const { canEdit } = useAllyGuideAccess();
  const releasesQuery = useGetAllyGuideReleasesQuery();
  const { data: tenantPage } = useGetTenantsQuery({ limit: 200 });
  const [run] = useRunAllyGuidePlaygroundMutation();

  const [course, setCourse] = useState<{ id: string; title: string } | null>(null);
  const [courseSearch, setCourseSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [progress, setProgress] = useState("0");
  const [mode, setMode] = useState<Scenario["mode"]>("NORMAL");
  const [guidance, setGuidance] = useState<Scenario["guidance"]>("walk");
  const [channel, setChannel] = useState<Scenario["channel"]>("text");
  const [visitor, setVisitor] = useState(false);
  const [releaseIds, setReleaseIds] = useState<Record<Slot, string>>({ a: "", b: "" });
  const [turns, setTurns] = useState<Record<Slot, PaneTurn[]>>({ a: [], b: [] });
  const [message, setMessage] = useState("");
  const [intent, setIntent] = useState<AllyGuidePlaygroundIntent | "">("");

  const mounted = useRef(true);
  const nextId = useRef(0);
  const defaulted = useRef(false);
  const inflight = useRef(new Map<string, { abort: () => void }>());
  const stoppedKeys = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(courseSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [courseSearch]);

  const tracksQuery = useGetTracksQuery({
    limit: COURSE_PAGE,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  });

  const releases = useMemo<AllyGuideRelease[]>(
    () => releasesQuery.data ?? [],
    [releasesQuery.data],
  );
  // First load only: A is the live release and B is the canary or newest draft, so the first run
  // already answers "what does the change do". After that the person's choices are never overwritten.
  useEffect(() => {
    if (defaulted.current || releases.length === 0) return;
    defaulted.current = true;
    const live = releases.find(release => release.status === "ga") ?? releases[0];
    const challenger =
      releases.find(release => release.status === "canary") ??
      releases.find(release => ["draft", "candidate", "shadow"].includes(release.status));
    setReleaseIds({
      a: live.id,
      b: challenger && challenger.id !== live.id ? challenger.id : "",
    });
  }, [releases]);

  const releaseById = (id: string) => releases.find(release => release.id === id);
  const optionLabel = (release: AllyGuideRelease) =>
    strings.releases.option(
      releaseVersionLabel(release.version),
      en.allyConsole.releases.statuses[release.status] ?? release.status,
    );

  const progressValue = parseProgress(progress);
  const trimmedMessage = message.trim();
  const busy = SLOTS.some(slot => turns[slot].some(turn => turn.status === "running"));
  const active = SLOTS.filter(slot => releaseIds[slot] !== "");

  let blocked: string | null = null;
  if (!course) blocked = strings.cannotSend.course;
  else if (active.length === 0) blocked = strings.cannotSend.release;
  else if (busy) blocked = strings.cannotSend.busy;
  else if (!visitor && progressValue === null) blocked = strings.cannotSend.progress;
  else if (message.length > PLAYGROUND_MESSAGE_MAX) blocked = strings.cannotSend.tooLong;
  else if (!trimmedMessage && !intent) blocked = strings.cannotSend.nothing;

  const scenario = (): Scenario => ({
    trackId: course?.id ?? "",
    tenantId,
    progress: progressValue ?? 0,
    mode,
    guidance,
    channel,
    visitor,
  });

  const patchTurn = (slot: Slot, id: number, patch: Partial<PaneTurn>) =>
    setTurns(previous => ({
      ...previous,
      [slot]: previous[slot].map(turn => (turn.id === id ? { ...turn, ...patch } : turn)),
    }));

  const execute = (
    slot: Slot,
    releaseId: string,
    id: number,
    text: string,
    chosen: AllyGuidePlaygroundIntent | undefined,
    history: ReturnType<typeof historyFor>,
  ) => {
    const key = `${slot}-${id}`;
    const request = run(buildBody(scenario(), releaseId, text, chosen, history));
    inflight.current.set(key, request);
    request
      .unwrap()
      .then(result => {
        if (stoppedKeys.current.has(key)) return;
        if (mounted.current) patchTurn(slot, id, { status: "done", result, error: undefined });
      })
      .catch(error => {
        // A run the person stopped waiting for already says so: its abort error is not news.
        if (stoppedKeys.current.delete(key)) return;
        if (mounted.current) {
          patchTurn(slot, id, {
            status: "error",
            error: getErrorMessage(error, strings.pane.failed),
          });
        }
      });
  };

  const handleSend = () => {
    if (blocked) return;
    const id = (nextId.current += 1);
    const chosen = intent || undefined;
    const added: PaneTurn = {
      id,
      learner: trimmedMessage,
      intent: chosen,
      status: "running",
    };
    setTurns(previous => ({
      a: releaseIds.a ? [...previous.a, added] : previous.a,
      b: releaseIds.b ? [...previous.b, added] : previous.b,
    }));
    active.forEach(slot =>
      execute(slot, releaseIds[slot], id, trimmedMessage, chosen, historyFor(turns[slot])),
    );
    setMessage("");
    setIntent("");
  };

  const handleStop = (slot: Slot, id: number) => {
    const key = `${slot}-${id}`;
    stoppedKeys.current.add(key);
    inflight.current.get(key)?.abort();
    inflight.current.delete(key);
    patchTurn(slot, id, { status: "error", stopped: true, error: undefined });
  };

  const handleRetry = (slot: Slot, id: number) => {
    const list = turns[slot];
    const index = list.findIndex(turn => turn.id === id);
    if (index < 0) return;
    const turn = list[index];
    stoppedKeys.current.delete(`${slot}-${id}`);
    patchTurn(slot, id, { status: "running", error: undefined, stopped: false });
    execute(
      slot,
      releaseIds[slot],
      id,
      turn.learner,
      turn.intent,
      historyFor(list.slice(0, index)),
    );
  };

  const reset = () => setTurns({ a: [], b: [] });

  if (!canEdit) {
    return (
      <div data-testid="ally-playground-needs-edit">
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={strings.needsEditTitle}
          subtitle={strings.needsEdit}
        />
      </div>
    );
  }
  if (releasesQuery.isLoading) return <LoadingBlock lines={6} />;
  if (releasesQuery.isError) {
    return (
      <ErrorPanel
        what="the releases"
        error={releasesQuery.error}
        onRetry={() => void releasesQuery.refetch()}
      />
    );
  }

  const tracks = tracksQuery.data?.data ?? [];
  const courseOptions =
    course && !tracks.some(track => track.id === course.id) ? [course, ...tracks] : tracks;
  const tenants = tenantPage?.data ?? [];
  const startedOver = SLOTS.every(slot => turns[slot].length === 0);

  return (
    <div className="flex flex-col gap-6" data-testid="ally-playground">
      <p className="max-w-3xl text-sm text-typography-700">{strings.intro}</p>

      <section className="flex flex-col gap-4" aria-label={strings.scenario.heading}>
        <div className="flex items-center gap-1">
          <h3 className="text-xl font-normal text-typography-900">{strings.scenario.heading}</h3>
          <InfoTip label={strings.scenario.help} ariaLabel="About the scenario" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={strings.course.label} help={strings.course.help}>
            <TextInput
              id="playground-course-search"
              labelText={strings.course.searchLabel}
              placeholder={strings.course.searchPlaceholder}
              value={courseSearch}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setCourseSearch(event.target.value)
              }
            />
            <Select
              id="playground-course"
              labelText={strings.course.choose}
              value={course?.id ?? ""}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                const picked = courseOptions.find(option => option.id === event.target.value);
                setCourse(picked ? { id: picked.id, title: picked.title } : null);
                reset();
              }}
            >
              <SelectItem value="" text={strings.course.choose} />
              {courseOptions.map(option => (
                <SelectItem key={option.id} value={option.id} text={option.title} />
              ))}
            </Select>
            {tracksQuery.isLoading && (
              <p className="text-xs text-typography-700">{strings.course.loading}</p>
            )}
            {tracksQuery.isError && (
              <p className="text-xs text-destructive-600" role="alert">
                {strings.course.failed}
              </p>
            )}
            {!tracksQuery.isLoading && !tracksQuery.isError && tracks.length === 0 && (
              <p className="text-xs text-typography-700">{strings.course.noMatches}</p>
            )}
            {typeof tracksQuery.data?.count === "number" &&
              tracksQuery.data.count > tracks.length && (
                <p className="text-xs text-typography-700">
                  {strings.course.shownOf(tracks.length, tracksQuery.data.count)}
                </p>
              )}
          </Field>

          <div className="flex flex-col gap-4">
            <Field label={strings.organisation.label} help={strings.organisation.help}>
              <Select
                id="playground-organisation"
                labelText={strings.organisation.label}
                value={tenantId}
                disabled={visitor}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                  setTenantId(event.target.value)
                }
              >
                <SelectItem value="" text={strings.organisation.none} />
                {tenants.map(tenant => (
                  <SelectItem key={tenant.id} value={tenant.id} text={tenant.name} />
                ))}
              </Select>
            </Field>
            <TextInput
              id="playground-progress"
              labelText={strings.progress.label}
              helperText={strings.progress.help}
              inputMode="numeric"
              disabled={visitor}
              invalid={!visitor && progressValue === null}
              invalidText={strings.progress.invalid(PLAYGROUND_PROGRESS_MAX)}
              value={progress}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setProgress(event.target.value)
              }
            />
          </div>

          <Field label={strings.mode.label} help={strings.mode.help}>
            <Select
              id="playground-mode"
              labelText={strings.mode.label}
              value={mode}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                setMode(event.target.value as Scenario["mode"])
              }
            >
              {MODES.map(value => (
                <SelectItem key={value} value={value} text={en.allyConsole.modes[value]} />
              ))}
            </Select>
          </Field>
          <Field label={strings.guidance.label} help={strings.guidance.help}>
            <Select
              id="playground-guidance"
              labelText={strings.guidance.label}
              value={guidance}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                setGuidance(event.target.value as Scenario["guidance"])
              }
            >
              {GUIDANCE.map(value => (
                <SelectItem key={value} value={value} text={strings.guidance.options[value]} />
              ))}
            </Select>
          </Field>
          <Field label={strings.channel.label} help={strings.channel.help}>
            <Select
              id="playground-channel"
              labelText={strings.channel.label}
              value={channel}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                setChannel(event.target.value as Scenario["channel"])
              }
            >
              {CHANNELS.map(value => (
                <SelectItem key={value} value={value} text={en.allyConsole.channels[value]} />
              ))}
            </Select>
          </Field>
          <div>
            <Checkbox
              id="playground-visitor"
              labelText={strings.visitor.label}
              checked={visitor}
              onChange={(_event: unknown, { checked }: { checked: boolean }) => setVisitor(checked)}
            />
            <p className="mt-1 pl-7 text-xs text-typography-700">{strings.visitor.help}</p>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-label={strings.releases.heading}>
        <div className="flex items-center gap-1">
          <h3 className="text-xl font-normal text-typography-900">{strings.releases.heading}</h3>
          <InfoTip label={strings.releases.help} ariaLabel="About comparing releases" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {SLOTS.map(slot => (
            <Select
              key={slot}
              id={`playground-release-${slot}`}
              labelText={slot === "a" ? strings.releases.a : strings.releases.b}
              value={releaseIds[slot]}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                const value = event.target.value;
                setReleaseIds(previous => {
                  const next = { ...previous, [slot]: value };
                  // The same release twice would compare it with itself.
                  const other: Slot = slot === "a" ? "b" : "a";
                  if (value && next[other] === value) next[other] = "";
                  return next;
                });
                setTurns({ a: [], b: [] });
              }}
            >
              {slot === "b" && <SelectItem value="" text={strings.releases.noneB} />}
              {slot === "a" && <SelectItem value="" text={strings.course.choose} />}
              {releases.map(release => (
                <SelectItem key={release.id} value={release.id} text={optionLabel(release)} />
              ))}
            </Select>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-label={strings.conversation.heading}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xl font-normal text-typography-900">
            {strings.conversation.heading}
          </h3>
          {!startedOver && (
            <span className="inline-flex items-center gap-1">
              <Button kind="ghost" size="sm" disabled={busy} onClick={reset}>
                {strings.conversation.reset}
              </Button>
              <InfoTip label={strings.conversation.resetHelp} ariaLabel="About starting over" />
            </span>
          )}
        </div>

        {active.length === 0 ? (
          <p className="text-sm text-typography-700">{strings.cannotSend.release}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="playground-panes">
            {active.map(slot => {
              const release = releaseById(releaseIds[slot]);
              if (!release) return null;
              return (
                <PlaygroundPane
                  key={slot}
                  heading={slot === "a" ? strings.releases.a : strings.releases.b}
                  releaseId={release.id}
                  version={release.version}
                  statusLabel={en.allyConsole.releases.statuses[release.status] ?? release.status}
                  turns={turns[slot]}
                  onRetry={id => handleRetry(slot, id)}
                  onStop={id => handleStop(slot, id)}
                />
              );
            })}
          </div>
        )}

        <TextArea
          id="playground-message"
          labelText={strings.message.label}
          placeholder={strings.message.placeholder}
          helperText={strings.message.help(PLAYGROUND_MESSAGE_MAX)}
          rows={3}
          invalid={message.length > PLAYGROUND_MESSAGE_MAX}
          invalidText={strings.message.tooLong(PLAYGROUND_MESSAGE_MAX)}
          value={message}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            setMessage(event.target.value)
          }
        />
        <Field label={strings.action.label} help={strings.action.help}>
          <Select
            id="playground-action"
            labelText={strings.action.label}
            value={intent}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              setIntent(event.target.value as AllyGuidePlaygroundIntent | "")
            }
          >
            <SelectItem value="" text={strings.action.none} />
            {INTENTS.map(value => (
              <SelectItem key={value} value={value} text={strings.action.options[value]} />
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button kind="primary" size="md" disabled={blocked !== null} onClick={handleSend}>
            {busy ? strings.sending : active.length > 1 ? strings.send : strings.sendOne}
          </Button>
          {blocked && (
            <span className="text-sm text-typography-700" data-testid="playground-blocked">
              {blocked}
            </span>
          )}
        </div>
      </section>
    </div>
  );
};
