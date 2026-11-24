import React, { useCallback, useEffect, useRef, useState } from "react";

import { useNavigate } from "react-router-dom";

import { useCreateBlankBotDraftMutation } from "@api";
import { Button, Orb } from "@components/v2";
import { ROUTES } from "@constants";

import { BUILD_COPY } from "./create/copy";
import { codeOf, messageOf } from "./create/logic";

import "./create/build.css";

/**
 * `/assistants/new` (stage 3): a chatbot is created at the click, blank, and the Create and Build
 * screen opens on it at once. The create is idempotent on the server (the newest untouched blank is
 * reused, at most three), and this asks only once per mount, so a double load makes one blank.
 * The narrow-screen gate is the route's (`CreateGate`), so nothing is created below 1280px.
 */
export const OnboardingStart: React.FC<{
  /** Kept for the dev harness's signature; leaving is the header's. */
  onLeave?: () => void;
}> = () => {
  const navigate = useNavigate();
  const [create] = useCreateBlankBotDraftMutation();
  const asked = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);

  const go = useCallback(async () => {
    setProblem(null);
    try {
      const blank = await create().unwrap();
      navigate(ROUTES.CHATBOT_NEW_SESSION(blank.id), { replace: true });
    } catch (error) {
      setProblem(
        codeOf(error) === "too_many_blanks"
          ? BUILD_COPY.tooManyBlanks
          : (messageOf(error) ?? BUILD_COPY.loadFailed),
      );
    }
  }, [create, navigate]);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void go();
  }, [go]);

  return (
    <div className="ally-v2 ally-build ally-build--loading" data-testid="create-start">
      {problem ? (
        <div role="alert">
          <p className="ally-error">{problem}</p>
          <Button variant="secondary" onClick={() => void go()}>
            {BUILD_COPY.retry}
          </Button>
        </div>
      ) : (
        <>
          <Orb size={48} working />
          <p className="ally-small">{BUILD_COPY.loading}</p>
        </>
      )}
    </div>
  );
};
