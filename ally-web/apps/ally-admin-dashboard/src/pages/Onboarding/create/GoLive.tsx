import React, { useState } from "react";

import {
  useAcceptSafetyTermsMutation,
  useGetAccessListQuery,
  useGetGoLiveChecklistQuery,
  useGetSafetyTermsQuery,
  usePublishBotDraftMutation,
  useRunCrisisCheckMutation,
} from "@api";
import type { GoLiveChecklist, GoLiveItem } from "@api";
import { Button } from "@components/v2";

import { BUILD_COPY, GO_LIVE_ACCESS_COPY } from "./copy";
import { PurposeInput } from "./Fields";
import { codeOf, errorOf, isCreditsRequired, messageOf } from "./logic";
import { SAFETY_PRIVACY_COPY } from "../../AssistantHome/copy/safetyPrivacy";
import { TF1_COPY } from "../../AssistantHome/copy/tf1";
import { AudienceAgeField, HumanContactField } from "../../AssistantHome/safety/SafetyFields";
import { useSafetySettings } from "../../AssistantHome/safety/useSafetySettings";

import type { FieldCommon } from "./Fields";
import type { PublishResult } from "../types";

const G = BUILD_COPY.goLive;
const S = SAFETY_PRIVACY_COPY;

/** What a 409 `go_live_incomplete` listed as missing, by item. */
export type Missing = Partial<Record<GoLiveItem, string>>;

export const missingOf = (error: unknown): Missing => {
  const list = errorOf(error).data?.details?.missing;
  const out: Missing = {};
  if (Array.isArray(list)) {
    for (const row of list as { item?: GoLiveItem; message?: string }[]) {
      if (row?.item) out[row.item] = row.message ?? "";
    }
  }
  return out;
};

/** The checklist from `GET /v1/chatbots/:id/go-live`: items, each language's crisis check, terms. */
const Checklist: React.FC<{
  chatbotId: string;
  data: GoLiveChecklist;
  disabled?: boolean;
  missing?: Missing;
  onChanged: () => void;
  onCreditsOut: () => void;
}> = ({ chatbotId, data, disabled, missing = {}, onChanged, onCreditsOut }) => {
  const [runCheck, { isLoading: checking }] = useRunCrisisCheckMutation();
  const [accept, { isLoading: accepting }] = useAcceptSafetyTermsMutation();
  const termsDone = data.items.some(i => i.item === "safety_terms" && i.done);
  const terms = useGetSafetyTermsQuery(chatbotId, { skip: termsDone });
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, failed: string) => {
    setProblem(null);
    try {
      await action();
      onChanged();
    } catch (error) {
      if (isCreditsRequired(error)) {
        onCreditsOut();
        setProblem(BUILD_COPY.credits.field);
      } else if (errorOf(error).status === 403) {
        setProblem(G.termsOwnerOnly);
      } else setProblem(messageOf(error) ?? failed);
    }
  };

  return (
    <div className="ally-build__golive" data-testid="golive-checklist">
      <p className="ally-field__label">{G.checklist}</p>
      {!data.enforced && <p className="ally-small">{G.notEnforced}</p>}
      <ul className="ally-build__list">
        {data.items.map(item => (
          <li key={item.item} data-testid={`golive-item-${item.item}`}>
            <span>
              <span aria-hidden="true">{item.done ? "✓ " : "○ "}</span>
              {item.message}
            </span>
          </li>
        ))}
      </ul>
      {data.ok && (
        <p className="ally-small" role="status">
          {G.ready}
        </p>
      )}
      {data.languages.length > 0 && (
        <>
          <p className="ally-field__label">{G.languages}</p>
          <ul className="ally-build__list">
            {data.languages.map(row => (
              <li key={row.language}>
                <span>{BUILD_COPY.form.languageNames[row.language] ?? row.language}</span>
                <span className="ally-small">{G.languageStatus[row.status] ?? row.status}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Button
        variant="secondary"
        disabled={disabled || checking}
        onClick={() => void run(() => runCheck({ chatbotId }).unwrap(), G.crisisFailed)}
      >
        {checking ? G.runningCrisis : G.runCrisis}
      </Button>
      {!termsDone && terms.data && (
        <div>
          <details>
            <summary className="ally-link">{G.readTerms}</summary>
            <p className="ally-small ally-build__terms">{terms.data.text}</p>
          </details>
          <Button
            variant="secondary"
            disabled={disabled || accepting}
            onClick={() =>
              void run(() => accept({ chatbotId, version: terms.data!.version }).unwrap(), G.failed)
            }
          >
            {G.accept}
          </Button>
        </div>
      )}
      {(missing.crisis_check ?? missing.safety_terms) && (
        <p className="ally-error" role="alert" data-testid="golive-missing-checks">
          {[missing.safety_terms, missing.crisis_check].filter(Boolean).join(" ")}
        </p>
      )}
      {problem && (
        <p className="ally-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
};

/**
 * The form's go-live section (stage 3 "Finish"): the go-live checklist (stage 4's gate, from
 * `GET /v1/chatbots/:id/go-live`) and Go live. While the checklist route doesn't answer, it shows
 * as coming soon.
 *
 * Who may chat is decided only by the chatbot's access list (D4, "Who may chat" below this
 * section): Go live always publishes invite only, with no emails of its own, and the backend sets
 * the chatbot to listed mode. An empty list may go live; nobody can chat until people are added.
 */
export const GoLiveSection: React.FC<{
  draftId: string;
  chatbotId: string | null;
  live: boolean;
  disabled?: boolean;
  onLive: () => void;
  onCreditsOut: () => void;
  /** The form's field wiring, for the purpose field (a working-copy field). */
  field?: (name: string) => Omit<FieldCommon, "label">;
}> = ({ draftId, chatbotId, live, disabled, onLive, onCreditsOut, field }) => {
  const checklist = useGetGoLiveChecklistQuery(chatbotId ?? "", { skip: !chatbotId });
  const [publish, { isLoading }] = usePublishBotDraftMutation();
  const accessList = useGetAccessListQuery(chatbotId ?? "", { skip: !chatbotId });
  const [ask, setAsk] = useState<{ message: string; belowGate: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [budget, setBudget] = useState<PublishResult["budget"]>(null);
  const [missing, setMissing] = useState<Missing>({});
  const safety = useSafetySettings(chatbotId ?? "");
  const data = checklist.data?.items ? checklist.data : null;
  const blocked = Boolean(data && data.enforced && !data.ok);

  const go = async (confirmMustPass = false, publishAnyway = false) => {
    setProblem(null);
    setMissing({});
    try {
      const result = await publish({
        id: draftId,
        access: "invite",
        ...(confirmMustPass ? { confirmMustPass: true } : {}),
        ...(publishAnyway ? { publishAnyway: true } : {}),
      }).unwrap();
      setAsk(null);
      setLink(result.link);
      setBudget(result.budget ?? null);
      onLive();
    } catch (error) {
      const code = codeOf(error);
      if (code === "go_live_incomplete") {
        setMissing(missingOf(error));
        setProblem(messageOf(error) ?? G.refused);
        void checklist.refetch();
        return;
      }
      if (code === "must_pass_failed" || code === "checkup_below_gate") {
        setAsk({ message: messageOf(error) ?? "", belowGate: code === "checkup_below_gate" });
        return;
      }
      setProblem(messageOf(error) ?? G.failed);
      void checklist.refetch();
    }
  };

  return (
    <div className="ally-build__golive" data-testid="build-golive">
      {chatbotId && !live && (
        <div className="ally-build__golive-fields" data-testid="golive-fields">
          <AudienceAgeField
            value={safety.values.audienceAge}
            disabled={disabled || !safety.loaded}
            save={async patch => {
              const reason = await safety.save(patch);
              void checklist.refetch();
              return reason;
            }}
            missing={missing.audience_age}
          />
          <HumanContactField
            value={safety.values.humanContact}
            disabled={disabled || !safety.loaded}
            save={async patch => {
              const reason = await safety.save(patch);
              void checklist.refetch();
              return reason;
            }}
            missing={missing.human_contact}
          />
          {field && (
            <PurposeInput
              {...field("purpose")}
              label={S.goLive.purpose}
              applyReason={missing.purpose ?? field("purpose").applyReason}
            />
          )}
        </div>
      )}
      {data && chatbotId ? (
        <Checklist
          missing={missing}
          chatbotId={chatbotId}
          data={data}
          disabled={disabled}
          onChanged={() => void checklist.refetch()}
          onCreditsOut={onCreditsOut}
        />
      ) : (
        <p className="ally-small" data-testid="golive-placeholder">
          <span className="ally-build__tag">{G.marker}</span> {G.placeholder}
        </p>
      )}
      {live ? (
        <p className="ally-small" role="status">
          {G.live}{" "}
          {link && (
            <a className="ally-link" href={link} target="_blank" rel="noreferrer">
              {G.link}
            </a>
          )}
        </p>
      ) : null}
      {live && budget ? (
        <p className="ally-small" role="status" data-testid="golive-budget">
          {budget.setAsideUsd > 0
            ? TF1_COPY.goLive.budgetAdded.replace("{amount}", budget.setAsideUsd.toFixed(2))
            : TF1_COPY.goLive.budgetNone}
        </p>
      ) : null}
      {live ? null : (
        <>
          {blocked && <p className="ally-small">{G.refused}</p>}
          {ask ? (
            <div role="alert">
              <p className="ally-small">{ask.message}</p>
              <Button
                variant="primary"
                disabled={isLoading}
                onClick={() => void (ask.belowGate ? go(true, true) : go(true))}
              >
                {G.anyway}
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              disabled={disabled || isLoading || blocked}
              onClick={() => void go()}
            >
              {isLoading ? G.publishing : G.publish}
            </Button>
          )}
        </>
      )}
      {accessList.data && accessList.data.length === 0 && (
        <p className="ally-small" data-testid="golive-nobody-yet">
          {GO_LIVE_ACCESS_COPY.nobodyYet}
        </p>
      )}
      {problem && (
        <p className="ally-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
};
