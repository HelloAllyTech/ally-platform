import React, { useState } from "react";

import { toast } from "sonner";

import {
  useGetDebriefLearnerFeatureQuery,
  useGrantDebriefLearnerFeatureMutation,
  useRevokeDebriefLearnerFeatureMutation,
  useSetDebriefLearnerFeatureEveryoneMutation,
} from "@api";
import { en } from "@constants";
import { DebriefLearnerFeatureKey } from "@types";
import { getErrorMessage } from "@utils";

const FEATURE: DebriefLearnerFeatureKey = "selection_comments";

const initials = (name: string, email: string) =>
  (name || email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join("");

/**
 * Settings › Learner features: who has a learner-facing feature on the web debrief. Today one:
 * select and comment. People are added by email; "everyone" is the switch for later. Everyone with
 * the console reads it; only the owner changes it.
 */
export const LearnerFeaturesSection: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const s = en.debriefs.settingsPage.learner;
  const q = useGetDebriefLearnerFeatureQuery(FEATURE);
  const [grant, { isLoading: granting }] = useGrantDebriefLearnerFeatureMutation();
  const [revoke, { isLoading: revoking }] = useRevokeDebriefLearnerFeatureMutation();
  const [setEveryone, { isLoading: switching }] = useSetDebriefLearnerFeatureEveryoneMutation();
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const view = q.data;

  if (!view) {
    return <p className="text-sm text-neutral-600">{q.isError ? s.loadFailed : s.loading}</p>;
  }

  const give = async () => {
    const wanted = email.trim();
    if (!wanted) {
      setProblem(s.needEmail);
      return;
    }
    try {
      await grant({ feature: FEATURE, email: wanted }).unwrap();
      toast.success(s.given(wanted));
      setEmail("");
      setProblem(null);
    } catch (e) {
      setProblem(getErrorMessage(e, s.giveFailed));
    }
  };
  const take = async (userId: number) => {
    try {
      await revoke({ feature: FEATURE, userId }).unwrap();
      toast.success(s.removed);
    } catch (e) {
      toast.error(getErrorMessage(e, s.removeFailed));
    }
  };
  const flip = async () => {
    try {
      await setEveryone({ feature: FEATURE, on: !view.everyone }).unwrap();
    } catch (e) {
      toast.error(getErrorMessage(e, s.everyoneFailed));
    }
  };

  return (
    <div
      className="flex flex-col gap-4 rounded-sm bg-neutral-50 px-5 py-4"
      data-testid="learner-features"
    >
      <div>
        <h3 className="text-base font-medium">{s.selectionTitle}</h3>
        <p className="mt-1 max-w-3xl text-sm text-neutral-600">{s.selectionBody}</p>
      </div>
      {canEdit ? (
        <div className="flex flex-col gap-1">
          <div className="flex max-w-xl gap-2">
            <input
              aria-label={s.emailLabel}
              placeholder={s.emailPlaceholder}
              value={email}
              onChange={e => {
                setEmail(e.target.value);
                setProblem(null);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") void give();
              }}
              className="h-9 min-w-0 flex-1 rounded-sm border border-neutral-200 bg-white px-3 text-sm"
              data-testid="learner-feature-email"
            />
            <button
              type="button"
              disabled={granting}
              onClick={() => void give()}
              className="h-9 rounded-sm bg-primary-500 px-4 text-sm text-white disabled:opacity-50"
              data-testid="learner-feature-give"
            >
              {s.give}
            </button>
          </div>
          {problem && (
            <p
              role="alert"
              className="text-xs text-destructive-700"
              data-testid="learner-feature-problem"
            >
              {problem}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-neutral-600">{s.ownerOnly}</p>
      )}
      <div className="flex flex-col" data-testid="learner-feature-people">
        {view.people.length === 0 && <p className="text-sm text-neutral-600">{s.nobody}</p>}
        {view.people.map(p => (
          <div
            key={p.userId}
            className="flex items-center gap-3 border-b border-neutral-100 py-2.5 text-sm last:border-b-0"
            data-testid={`learner-feature-person-${p.userId}`}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-50 text-xs font-medium text-primary-700">
              {initials(p.name, p.email)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block">{p.name || p.email}</span>
              <span className="block text-xs text-neutral-600">{p.email}</span>
            </span>
            <span className="rounded-sm bg-success-50 px-2 py-0.5 text-xs text-success-700">
              {s.hasAccess}
            </span>
            {canEdit && (
              <button
                type="button"
                disabled={revoking}
                onClick={() => void take(p.userId)}
                className="text-xs text-neutral-700 underline"
                data-testid={`learner-feature-remove-${p.userId}`}
              >
                {s.remove}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{s.everyoneTitle}</span>
          <span className="block text-xs text-neutral-600">
            {view.everyone ? s.everyoneOn : s.everyoneOff}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={view.everyone}
          aria-label={s.everyoneLabel}
          disabled={!canEdit || switching}
          onClick={() => void flip()}
          className={`relative h-5 w-9 rounded-full ${view.everyone ? "bg-primary-500" : "bg-neutral-300"} disabled:opacity-50`}
          data-testid="learner-feature-everyone"
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${view.everyone ? "left-[18px]" : "left-0.5"}`}
          />
        </button>
      </div>
    </div>
  );
};
