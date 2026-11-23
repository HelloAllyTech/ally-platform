import React, { useState } from "react";

import { Link } from "react-router-dom";

import type { PublishUse } from "@api";
import { AssistantLine, Button, PrimaryButton, Question, useEnterToSubmit } from "@components/v2";
import type { TemplateOrigin } from "@types";

import { reasonOf } from "../../AssistantHome/checkupCases";
import { PLAN } from "../../Plan/copy";
import { TEMPLATE_COPY } from "../../Templates/copy";
import { COPY } from "../copy";
import { parseEmails } from "../flow";

import type { CheckupResult } from "../../../types/checkup";
import type { BotDraftView } from "../types";

// ── Who can use it? ───────────────────────────────────────────────────────

type Access = "public" | "organisation" | "invite";

export const ShareScreen: React.FC<{
  view: BotDraftView;
  publicAllowed: boolean;
  publishing: boolean;
  /** An owner's Must pass question failed (chunk 20d-2): asked before going live. */
  mustPass?: {
    message: string;
    questions: string[];
    belowGate?: boolean;
    onConfirm: () => void;
  } | null;
  line?: string;
  /**
   * The plan's count (CR1 §C3): "This uses 1 of your 3 assistants", and why publishing is refused
   * when the plan has no room. Absent while it loads or on Ally's unlimited plans.
   */
  publishUse?: PublishUse | null;
  /** A template's examples still in its lists (T1): asked about once before going live. */
  examplesLeft?: TemplateOrigin["examples_left"] | null;
  /** Publishing's safety recheck (Q4 A0): its progress, or the question that still fails. */
  safety?: {
    status: "checking" | "failed";
    message: string;
    done: number;
    total: number;
    questions: { question: string; reply?: string; reasons?: string[] }[];
  } | null;
  onCheckAgain?: () => void;
  /** Q4 H3: back to the Checkup to fix the answer, or to Safety to correct the pack. */
  onOpenCheckup?: () => void;
  onCorrectPack?: () => void;
  onPublish: (access: Access, emails: string[]) => void;
}> = ({
  view,
  publicAllowed,
  publishing,
  line,
  onPublish,
  mustPass,
  publishUse,
  examplesLeft,
  safety,
  onCheckAgain,
  onOpenCheckup,
  onCorrectPack,
}) => {
  const [access, setAccess] = useState<Access>(view.draft.access.mode ?? "invite");
  const [emails, setEmails] = useState(view.draft.access.emails.join(", "));
  const options: { id: Access; label: string; help: string; disabled?: boolean }[] = [
    {
      id: "public",
      label: COPY.share.public,
      help: publicAllowed ? COPY.share.publicHelp : COPY.share.publicDisabled,
      disabled: !publicAllowed,
    },
    { id: "organisation", label: COPY.share.organisation, help: COPY.share.organisationHelp },
    { id: "invite", label: COPY.share.invite, help: COPY.share.inviteHelp },
  ];
  const list = parseEmails(emails);
  const blocked = publishUse?.canPublish === false;
  const ready = (access !== "invite" || list.length > 0) && !publishing && !blocked;
  // T1: a template's examples still in a list are asked about once before going live.
  const examples = examplesLeft?.total ?? 0;
  const [examplesOk, setExamplesOk] = useState(false);
  const [askExamples, setAskExamples] = useState(false);
  const goLive = () => onPublish(access, access === "invite" ? list : []);
  const publish = () => {
    if (!ready) return;
    if (examples > 0 && !examplesOk) setAskExamples(true);
    else goLive();
  };
  useEnterToSubmit(publish, ready);
  return (
    <>
      {line && <AssistantLine>{line}</AssistantLine>}
      <Question title={COPY.share.title}>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }} className="ally-options">
          <legend className="ally-sr-only">{COPY.share.title}</legend>
          {options.map(option => (
            <label
              key={option.id}
              className="ally-option"
              data-checked={access === option.id}
              style={option.disabled ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
            >
              <input
                type="radio"
                name="access"
                checked={access === option.id}
                disabled={option.disabled}
                onChange={() => setAccess(option.id)}
              />
              <span className="ally-option__text">
                <span>{option.label}</span>
                <span className="ally-option__hint">{option.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {access === "invite" && (
          <div className="ally-field">
            <label htmlFor="invite-emails">{COPY.share.emailsLabel}</label>
            <textarea
              id="invite-emails"
              className="ally-input"
              value={emails}
              placeholder={COPY.share.emailsPlaceholder}
              onChange={event => setEmails(event.target.value)}
            />
            <span className="ally-field__hint">{COPY.share.emailsHelp}</span>
          </div>
        )}
        {safety && (
          <div
            className="ally-card ally-must-pass"
            role={safety.status === "failed" ? "alert" : "status"}
            aria-live="polite"
            data-testid="publish-safety"
          >
            <p className="ally-body">{safety.message}</p>
            {safety.status === "checking" && (
              <p className="ally-small">{COPY.share.safetyProgress(safety.done, safety.total)}</p>
            )}
            {safety.status === "failed" && safety.questions.length > 0 && (
              <ul className="ally-small">
                {safety.questions.map(q => (
                  <li key={q.question}>
                    “{q.question}”
                    {q.reply && (
                      <>
                        <br />
                        {COPY.share.safetyAnswer} “{q.reply}”
                      </>
                    )}
                    {q.reasons?.length ? (
                      <>
                        <br />
                        {COPY.share.safetyWhy}{" "}
                        {reasonOf([{ verdict: "fail", reasons: q.reasons } as CheckupResult])}
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {safety.status === "failed" && (
              <p className="ally-small" data-testid="publish-safety-fixes">
                {COPY.share.safetyFixes}
              </p>
            )}
            {safety.status === "failed" && (
              <div className="ally-btn-row">
                {onOpenCheckup && (
                  <Button disabled={publishing} onClick={onOpenCheckup}>
                    {COPY.share.openCheckup}
                  </Button>
                )}
                {onCorrectPack && (
                  <Button disabled={publishing} onClick={onCorrectPack}>
                    {COPY.share.wrongPack}
                  </Button>
                )}
                {onCheckAgain && (
                  <Button disabled={publishing} onClick={onCheckAgain}>
                    {COPY.share.checkAgain}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        {mustPass && (
          <div className="ally-card ally-must-pass" role="alert" data-testid="must-pass">
            <p className="ally-body">{mustPass.message}</p>
            {mustPass.questions.length > 0 && (
              <ul className="ally-small">
                {mustPass.questions.map(q => (
                  <li key={q}>“{q}”</li>
                ))}
              </ul>
            )}
            <Button disabled={publishing} onClick={mustPass.onConfirm}>
              {mustPass.belowGate ? COPY.share.publishAnyway : COPY.share.goLiveAnyway}
            </Button>
          </div>
        )}
        {typeof publishUse?.maxPublished === "number" && !blocked && (
          <p className="ally-small" data-testid="publish-use">
            {PLAN.publish.uses(publishUse.wouldUse, publishUse.maxPublished)}
          </p>
        )}
        {blocked && publishUse?.message && (
          <div className="ally-card ally-must-pass" role="alert" data-testid="publish-limit">
            <p className="ally-body">{publishUse.message}</p>
          </div>
        )}
        {askExamples && (
          <div className="ally-card ally-must-pass" role="alert" data-testid="publish-examples">
            <p className="ally-body">{TEMPLATE_COPY.publishWarning}</p>
            <div className="ally-templates__actions">
              {view.chatbotId && (
                // Round 8 N2: a router link, so the app's base path (/admin on production) is kept.
                <Link
                  className="ally-link"
                  to={`/assistants/${view.chatbotId}?section=lists&tool=${encodeURIComponent(
                    examplesLeft?.lists[0]?.key ?? "",
                  )}`}
                >
                  {TEMPLATE_COPY.replaceThem}
                </Link>
              )}
              <Button
                disabled={publishing}
                onClick={() => {
                  setExamplesOk(true);
                  setAskExamples(false);
                  goLive();
                }}
              >
                {TEMPLATE_COPY.publishAnyway}
              </Button>
            </div>
          </div>
        )}
        <PrimaryButton enterHint={COPY.frame.enterHint} disabled={!ready} onClick={publish}>
          {publishing ? COPY.share.publishing : COPY.share.publish}
        </PrimaryButton>
      </Question>
    </>
  );
};
