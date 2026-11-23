import React, { useId, useState } from "react";

import {
  useAddBotPageDomainMutation,
  useCheckBotPageDomainMutation,
  useGetBotPageDomainsQuery,
  useRemoveBotPageDomainMutation,
} from "@api";
import type { BotPageDomain, DomainStepResult } from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";

import { fill } from "../../Onboarding/copy";
import { CHANNELS_COPY } from "../copy/channels";
import { Group } from "../fields";

const t = CHANNELS_COPY.domain;

/** ally-be's refusal code (`error`), in our words. */
export const domainError = (error: unknown): string => {
  const code = (error as { data?: { error?: unknown } })?.data?.error;
  return (typeof code === "string" && t.errors[code]) || t.errors.failed;
};

/** What one record's last check means, in plain words. */
export const stepMessage = (
  step: DomainStepResult | undefined,
  record: { type: "CNAME" | "TXT"; value: string },
): { text: string; help?: string; ok: boolean } => {
  if (!step) return { text: t.states.notChecked, ok: false };
  switch (step.state) {
    case "ok":
      return { text: t.states.ok, ok: true };
    case "missing":
      return { text: t.states.missing, ok: false };
    case "wrong":
      return {
        text: fill(t.states.wrong, { found: step.found.join(", ") }),
        help: fill(record.type === "CNAME" ? t.cnameWrongHelp : t.txtWrongHelp, {
          value: record.value,
        }),
        ok: false,
      };
    default:
      return { text: t.states.error, ok: false };
  }
};

const RecordStep: React.FC<{
  title: string;
  record: BotPageDomain["records"][number];
  step: DomainStepResult | undefined;
  testId: string;
}> = ({ title, record, step, testId }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const message = stepMessage(step, record);
  // As the widget snippet copies (Website.tsx): no toast, a "Copied" on the button instead.
  const copy = (value: string) =>
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(value);
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => undefined);
  return (
    <li className="ally-card ally-home__question" data-testid={testId}>
      <p className="ally-home__strong">{title}</p>
      <dl className="ally-home__dns">
        <dt>{t.type}</dt>
        <dd>
          <code>{record.type}</code>
        </dd>
        {(
          [
            [t.name, record.name],
            [t.value, record.value],
          ] as const
        ).map(([label, value]) => (
          <React.Fragment key={label}>
            <dt>{label}</dt>
            <dd>
              <code>{value}</code>{" "}
              <Button variant={ButtonVariant.TERTIARY} onClick={() => copy(value)}>
                {copied === value ? t.copied : t.copy}
              </Button>
            </dd>
          </React.Fragment>
        ))}
      </dl>
      <p className={message.ok ? "ally-small" : "ally-field__hint"} role="status">
        {message.text}
      </p>
      {message.help && <p className="ally-field__hint">{message.help}</p>}
    </li>
  );
};

const DomainSteps: React.FC<{ botId: string; domain: BotPageDomain; canEdit: boolean }> = ({
  botId,
  domain,
  canEdit,
}) => {
  const [check, { isLoading: checking }] = useCheckBotPageDomainMutation();
  const [remove, { isLoading: removing }] = useRemoveBotPageDomainMutation();
  const [error, setError] = useState<string | null>(null);
  const [cname, txt] = domain.records;
  const summary =
    domain.status === "verified" ? t.verified : domain.status === "failed" ? t.failed : t.pending;
  return (
    <div data-testid="custom-domain-steps">
      <p className="ally-home__strong">{domain.host}</p>
      <ol className="ally-home__questions">
        <RecordStep
          title={t.step1}
          record={cname}
          step={domain.lastCheck?.cname}
          testId="dns-cname"
        />
        <RecordStep title={t.step2} record={txt} step={domain.lastCheck?.txt} testId="dns-txt" />
        <li className="ally-card ally-home__question">
          <p className="ally-home__strong">{t.step3}</p>
          <p className="ally-field__hint">{t.dnsDelay}</p>
          {canEdit && (
            <div className="ally-btn-row">
              <Button
                variant={ButtonVariant.SECONDARY}
                type="button"
                disabled={checking}
                onClick={() => {
                  setError(null);
                  check({ id: botId, domainId: domain.id })
                    .unwrap()
                    .catch(e => setError(domainError(e)));
                }}
              >
                {checking ? t.checking : t.check}
              </Button>
              <Button
                variant={ButtonVariant.TERTIARY}
                type="button"
                disabled={removing}
                onClick={() => {
                  if (!window.confirm(fill(t.removeConfirm, { host: domain.host }))) return;
                  remove({ id: botId, domainId: domain.id })
                    .unwrap()
                    .catch(e => setError(domainError(e)));
                }}
              >
                {t.remove}
              </Button>
            </div>
          )}
          <p className="ally-body" role="status" data-testid="custom-domain-status">
            {summary}
          </p>
          {domain.checkedAt && (
            <p className="ally-small">
              {fill(t.lastChecked, { date: new Date(domain.checkedAt).toLocaleString() })}
            </p>
          )}
          {error && (
            <p className="ally-error" role="alert">
              {error}
            </p>
          )}
        </li>
      </ol>
    </div>
  );
};

/**
 * Your own web address (stage 7): add a host, then the two DNS records to add with a live check
 * for each, explained in plain words. Certificates are added on Ally's side, so a verified domain
 * says "we'll confirm when it's ready" and never claims to be live. The Ally address keeps working.
 */
export const CustomDomain: React.FC<{ botId: string; canEdit: boolean }> = ({ botId, canEdit }) => {
  const id = useId();
  const { data, isError } = useGetBotPageDomainsQuery(botId, { skip: !canEdit });
  const [add, { isLoading: adding }] = useAddBotPageDomainMutation();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!canEdit) return null;
  const domain = data?.domains[0];
  const submit = () => {
    const host = draft.trim();
    if (!host) return;
    setError(null);
    add({ id: botId, host })
      .unwrap()
      .then(() => setDraft(""))
      .catch(e => setError(domainError(e)));
  };
  return (
    <Group title={t.title} hint={t.hint} testId="custom-domain">
      {isError && (
        <p className="ally-error" role="alert">
          {t.errors.failed}
        </p>
      )}
      {domain ? (
        <DomainSteps botId={botId} domain={domain} canEdit={canEdit} />
      ) : (
        <div className="ally-field">
          <label htmlFor={`${id}-host`}>{t.hostLabel}</label>
          <div className="ally-home__line">
            <input
              id={`${id}-host`}
              className="ally-input"
              placeholder={t.placeholder}
              value={draft}
              maxLength={253}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <Button
              variant={ButtonVariant.TERTIARY}
              type="button"
              onClick={submit}
              disabled={!draft.trim() || adding}
            >
              {t.add}
            </Button>
          </div>
          {error && (
            <p className="ally-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Group>
  );
};
