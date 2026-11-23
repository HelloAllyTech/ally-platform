import React, { useMemo, useState } from "react";

import { useSearchParams } from "react-router-dom";

import {
  Button,
  Checkbox,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  SkeletonText,
  TextArea,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useGetRoleplayAgentOptionsQuery,
  useGetRoleplayAgentRunQuery,
  useStartRoleplayAgentRunMutation,
} from "@api";
import { RoleplayCard } from "@components/course-copilot";
import { en, ROUTES } from "@constants";
import { RoleplayAgentMode, RoleplayAgentRequest, RoleplayAgentRun } from "@types";

import { errorMessageFrom } from "../CourseCopilot/courseCopilotErrors";

const STEP_ORDER = ["brief", "casting", "building", "saving"] as const;
const POLL_MS = 3000;

type Draft = {
  learners: string;
  goal: string;
  competencyId: string;
  mode: RoleplayAgentMode;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  clientDescription: string;
  languageId: string;
  minScore: string;
  lengthMinutes: string;
  triggerWarningIds: string[];
  saveCharacter: boolean;
  notes: string;
};

const EMPTY: Draft = {
  learners: "",
  goal: "",
  competencyId: "",
  mode: "practice",
  difficulty: "EASY",
  clientDescription: "",
  languageId: "",
  minScore: "60",
  lengthMinutes: "6",
  triggerWarningIds: [],
  saveCharacter: false,
  notes: "",
};

const toDraft = (request: RoleplayAgentRequest): Draft => ({
  learners: request.learners ?? "",
  goal: request.goal ?? "",
  competencyId: request.competencyIds?.[0] ?? "",
  mode: request.mode ?? "practice",
  difficulty: request.difficulty ?? "EASY",
  clientDescription: request.clientDescription ?? "",
  languageId: request.languageIds?.[0] ?? "",
  minScore: request.minScore !== undefined ? String(request.minScore) : "",
  lengthMinutes: request.lengthMinutes !== undefined ? String(request.lengthMinutes) : "",
  triggerWarningIds: request.triggerWarningIds ?? [],
  saveCharacter: Boolean(request.saveCharacter),
  notes: request.notes ?? "",
});

const toRequest = (draft: Draft): RoleplayAgentRequest => {
  const number = (value: string) => {
    const parsed = Number(value);
    return value.trim() && Number.isFinite(parsed) ? Math.round(parsed) : undefined;
  };
  return {
    learners: draft.learners.trim(),
    goal: draft.goal.trim(),
    competencyIds: draft.competencyId ? [draft.competencyId] : [],
    mode: draft.mode,
    difficulty: draft.difficulty,
    ...(draft.clientDescription.trim()
      ? { clientDescription: draft.clientDescription.trim() }
      : {}),
    ...(draft.languageId ? { languageIds: [draft.languageId] } : {}),
    ...(number(draft.minScore) !== undefined ? { minScore: number(draft.minScore) } : {}),
    ...(number(draft.lengthMinutes) !== undefined
      ? { lengthMinutes: number(draft.lengthMinutes) }
      : {}),
    ...(draft.triggerWarningIds.length ? { triggerWarningIds: draft.triggerWarningIds } : {}),
    saveCharacter: draft.saveCharacter,
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
  };
};

/**
 * `/roleplay-agent` — the roleplay agent on its own. A short form becomes one draft roleplay with
 * the same steps Course Copilot runs for a roleplay in a course. The run id sits in `?run=`, so a
 * trainer can leave and come back to a build in progress.
 */
export const RoleplayAgentPage: React.FC = () => {
  const strings = en.roleplayAgent;
  const [searchParams, setSearchParams] = useSearchParams();
  const runId = searchParams.get("run") ?? "";

  const options = useGetRoleplayAgentOptionsQuery();
  const [startRun, { isLoading: starting }] = useStartRoleplayAgentRunMutation();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);

  const run = useGetRoleplayAgentRunQuery(runId, {
    skip: !runId,
    pollingInterval: polling ? POLL_MS : 0,
  });
  const current: RoleplayAgentRun | undefined = runId ? run.data : undefined;
  // Stop polling once the run has an outcome.
  React.useEffect(() => {
    setPolling(!current || current.status === "running");
  }, [current]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(previous => ({ ...previous, [key]: value }));

  const handleSubmit = async () => {
    const request = toRequest(draft);
    if (!request.learners || !request.goal || !request.competencyIds.length) {
      setFormError(strings.required);
      return;
    }
    setFormError(null);
    try {
      const started = await startRun(request).unwrap();
      setPolling(true);
      setSearchParams({ run: started.id });
    } catch (caught) {
      setFormError(errorMessageFrom(caught, strings.failed));
    }
  };

  const backToForm = (keep: boolean) => {
    if (keep && current?.request) setDraft(toDraft(current.request));
    else setDraft(EMPTY);
    setSearchParams({});
  };

  const competencies = options.data?.competencies ?? [];
  const languages = options.data?.languages ?? [];
  const triggerWarnings = options.data?.triggerWarnings ?? [];
  const modes = useMemo(
    () => options.data?.modes ?? (Object.keys(strings.modeHelp) as RoleplayAgentMode[]),
    [options.data?.modes, strings.modeHelp],
  );

  return (
    <div className="mx-auto w-full max-w-2xl p-4 md:p-6">
      <h1 className="text-xl font-semibold text-typography-900">{strings.title}</h1>
      <p className="mt-1 text-sm text-typography-600">{strings.subtitle}</p>

      {runId ? (
        <RunView
          run={current}
          loading={run.isLoading}
          error={run.isError ? errorMessageFrom(run.error, strings.failed) : null}
          onEdit={() => backToForm(true)}
          onAnother={() => backToForm(false)}
        />
      ) : options.isLoading ? (
        <div className="mt-6">
          <SkeletonText paragraph lineCount={6} />
        </div>
      ) : options.isError ? (
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={strings.loadFailed}
          className="mt-6 w-full"
        />
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          <TextInput
            id="roleplay-agent-learners"
            labelText={strings.learners}
            placeholder={strings.learnersPlaceholder}
            value={draft.learners}
            maxLength={300}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              set("learners", event.target.value)
            }
          />
          <TextArea
            id="roleplay-agent-goal"
            labelText={strings.goal}
            placeholder={strings.goalPlaceholder}
            value={draft.goal}
            rows={2}
            maxLength={400}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              set("goal", event.target.value)
            }
          />
          <Select
            id="roleplay-agent-competency"
            labelText={strings.competency}
            value={draft.competencyId}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              set("competencyId", event.target.value)
            }
          >
            <SelectItem value="" text={strings.competencyPlaceholder} />
            {competencies.map(competency => (
              <SelectItem key={competency.id} value={competency.id} text={competency.name} />
            ))}
          </Select>
          <div>
            <Select
              id="roleplay-agent-mode"
              labelText={strings.mode}
              value={draft.mode}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                set("mode", event.target.value as RoleplayAgentMode)
              }
            >
              {modes.map(mode => (
                <SelectItem
                  key={mode}
                  value={mode}
                  text={en.courseCopilot.roleplayCard.mode[mode] ?? mode}
                />
              ))}
            </Select>
            <p className="mt-1 text-xs text-typography-600" data-testid="mode-help">
              {strings.modeHelp[draft.mode]}
            </p>
          </div>
          <Select
            id="roleplay-agent-difficulty"
            labelText={strings.difficulty}
            value={draft.difficulty}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              set("difficulty", event.target.value as Draft["difficulty"])
            }
          >
            {Object.entries(strings.difficultyOptions).map(([value, text]) => (
              <SelectItem key={value} value={value} text={text} />
            ))}
          </Select>
          <TextArea
            id="roleplay-agent-client"
            labelText={strings.client}
            placeholder={strings.clientPlaceholder}
            value={draft.clientDescription}
            rows={3}
            maxLength={1500}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              set("clientDescription", event.target.value)
            }
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              id="roleplay-agent-language"
              labelText={strings.language}
              value={draft.languageId}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                set("languageId", event.target.value)
              }
            >
              <SelectItem value="" text="—" />
              {languages.map(language => (
                <SelectItem key={language.id} value={language.id} text={language.name} />
              ))}
            </Select>
            <TextInput
              id="roleplay-agent-min-score"
              type="number"
              labelText={strings.minScore}
              value={draft.minScore}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                set("minScore", event.target.value)
              }
            />
            <TextInput
              id="roleplay-agent-length"
              type="number"
              labelText={strings.lengthMinutes}
              value={draft.lengthMinutes}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                set("lengthMinutes", event.target.value)
              }
            />
          </div>
          {triggerWarnings.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-xs text-typography-600">
                {strings.triggerWarnings}
              </legend>
              <div className="grid max-h-40 grid-cols-1 overflow-y-auto sm:grid-cols-2">
                {triggerWarnings.map(warning => (
                  <Checkbox
                    key={warning.id}
                    id={`roleplay-agent-tw-${warning.id}`}
                    labelText={warning.name}
                    checked={draft.triggerWarningIds.includes(warning.id)}
                    onChange={(_event: unknown, { checked }: { checked: boolean }) =>
                      set(
                        "triggerWarningIds",
                        checked
                          ? [...draft.triggerWarningIds, warning.id]
                          : draft.triggerWarningIds.filter(id => id !== warning.id),
                      )
                    }
                  />
                ))}
              </div>
            </fieldset>
          )}
          <Checkbox
            id="roleplay-agent-save-character"
            labelText={strings.saveCharacter}
            checked={draft.saveCharacter}
            onChange={(_event: unknown, { checked }: { checked: boolean }) =>
              set("saveCharacter", checked)
            }
          />
          <TextArea
            id="roleplay-agent-notes"
            labelText={strings.notes}
            value={draft.notes}
            rows={2}
            maxLength={800}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              set("notes", event.target.value)
            }
          />
          {formError && (
            <InlineNotification
              kind="error"
              lowContrast
              hideCloseButton
              title={formError}
              className="w-full"
            />
          )}
          <div>
            <Button kind="primary" onClick={handleSubmit} disabled={starting}>
              {starting ? strings.starting : strings.start}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

const RunView: React.FC<{
  run: RoleplayAgentRun | undefined;
  loading: boolean;
  error: string | null;
  onEdit: () => void;
  onAnother: () => void;
}> = ({ run, loading, error, onEdit, onAnother }) => {
  const strings = en.roleplayAgent;
  if (error) {
    return (
      <div className="mt-6 flex flex-col items-start gap-3">
        <InlineNotification kind="error" lowContrast hideCloseButton title={error} />
        <Button kind="tertiary" size="sm" onClick={onAnother}>
          {strings.buildAnother}
        </Button>
      </div>
    );
  }
  if (loading || !run) {
    return (
      <div className="mt-6">
        <SkeletonText paragraph lineCount={3} />
      </div>
    );
  }

  if (run.status === "failed") {
    return (
      <div className="mt-6 flex flex-col items-start gap-3">
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={strings.failed}
          subtitle={run.error}
          className="w-full"
        />
        <div className="flex gap-2">
          <Button kind="primary" size="sm" onClick={onEdit}>
            {strings.tryAgain}
          </Button>
          <Button kind="tertiary" size="sm" onClick={onAnother}>
            {strings.buildAnother}
          </Button>
        </div>
      </div>
    );
  }

  if (run.status === "done" && run.result) {
    return (
      <div className="mt-6 flex flex-col gap-3" data-testid="roleplay-agent-done">
        <InlineNotification
          kind="success"
          lowContrast
          hideCloseButton
          title={strings.done}
          subtitle={run.result.card.title}
          className="w-full"
        />
        <RoleplayCard card={run.result.card} />
        {run.result.casting?.note && (
          <p className="text-xs text-typography-700">{run.result.casting.note}</p>
        )}
        <div className="flex gap-2">
          <Button
            kind="primary"
            size="sm"
            href={ROUTES.EDIT_SIMULATION(run.result.scenarioId)}
            target="_blank"
            rel="noreferrer"
          >
            {strings.openRoleplay}
          </Button>
          <Button kind="tertiary" size="sm" onClick={onAnother}>
            {strings.buildAnother}
          </Button>
        </div>
      </div>
    );
  }

  const stepIndex = STEP_ORDER.indexOf(run.step as (typeof STEP_ORDER)[number]);
  return (
    <div className="mt-6 flex flex-col gap-3" data-testid="roleplay-agent-running">
      <ol className="flex flex-col gap-2">
        {STEP_ORDER.map((step, index) => (
          <li key={step} className="text-sm">
            {index < stepIndex ? (
              <span className="text-typography-600">✓ {strings.steps[step]}</span>
            ) : index === stepIndex ? (
              <InlineLoading description={strings.steps[step]} />
            ) : (
              <span className="text-typography-400">{strings.steps[step]}</span>
            )}
          </li>
        ))}
      </ol>
      <p className="text-xs text-typography-600">{strings.takesMinutes}</p>
    </div>
  );
};
