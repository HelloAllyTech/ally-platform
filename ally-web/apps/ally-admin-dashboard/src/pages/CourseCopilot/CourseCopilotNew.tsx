import React, { useEffect, useRef, useState } from "react";

import { useNavigate, useSearchParams } from "react-router-dom";

import { Button, InlineLoading, InlineNotification } from "@ally-ui-mono/ui-shared";
import { useCreateCourseCopilotSessionMutation } from "@api";
import { en, LOCAL_STORAGE_KEYS, ROUTES } from "@constants";

import { errorMessageFrom, errorStatusOf } from "./courseCopilotErrors";

/**
 * `/course-copilot/new` — creates a session, then replaces itself with it.
 *
 * With `?trackId=` the session is bound to that saved course (EDIT mode); the server hands back the
 * caller's existing active session for that course instead of minting a duplicate, so pressing
 * "Ask Copilot" twice lands in the same conversation. Without it, a fresh CREATE session.
 *
 * `replace`, so Back from the session returns to wherever "Ask Copilot" was pressed rather than to
 * this transient page, which would immediately create another session.
 */
export const CourseCopilotNew: React.FC = () => {
  const strings = en.courseCopilot.start;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const trackId = searchParams.get("trackId") ?? undefined;
  const [createSession] = useCreateCourseCopilotSessionMutation();

  const [error, setError] = useState<{ message: string; isCap: boolean } | null>(null);
  // Bumped by "Try again" to re-run the effect.
  const [attempt, setAttempt] = useState(0);
  // StrictMode mounts effects twice in dev; without this a second POST would run — and the
  // 2-active-session cap would count the duplicate.
  const startedAttemptRef = useRef<number | null>(null);

  useEffect(() => {
    if (startedAttemptRef.current === attempt) return;
    startedAttemptRef.current = attempt;

    (async () => {
      try {
        const session = await createSession(trackId ? { trackId } : undefined).unwrap();
        localStorage.setItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID, session.id);
        navigate(ROUTES.COURSE_COPILOT_SESSION(session.id), { replace: true });
      } catch (caught) {
        // The cap is the one failure a retry cannot fix; it needs an archived session first.
        const isCap = errorStatusOf(caught) === 409;
        setError({
          message: errorMessageFrom(caught, isCap ? strings.capReached : strings.failed),
          isCap,
        });
      }
    })();
  }, [attempt, createSession, navigate, trackId, strings.failed, strings.capReached]);

  const handleTryAgain = () => {
    setError(null);
    setAttempt(value => value + 1);
  };

  return (
    <div className="mx-auto w-full max-w-xl p-4 md:p-6">
      {error ? (
        <div className="flex flex-col items-start gap-3">
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title={error.message}
            className="w-full"
          />
          <div className="flex gap-2">
            <Button kind="primary" size="sm" onClick={() => navigate(ROUTES.COURSE_COPILOT)}>
              {strings.backToList}
            </Button>
            {!error.isCap && (
              <Button kind="tertiary" size="sm" onClick={handleTryAgain}>
                {en.courseCopilot.chat.retry}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <InlineLoading description={strings.starting} />
      )}
    </div>
  );
};
