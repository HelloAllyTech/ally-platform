import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import { InlineNotification, TextInput } from "@ally-ui-mono/ui-shared";
import {
  useCheckWaNumberMutation,
  useConnectWaNumberMutation,
  useDisconnectWaNumberMutation,
  useGetWaNumbersQuery,
  useSubscribeWaNumberMutation,
} from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { WaBusinessNumber, WaBusinessNumberStatus } from "@types";

import { Card, CopyField, errorMessage, fill, StatusPill, timeAgo } from "./shared";

const t = en.whatsappBot.number;
const c = en.whatsappBot.connection;
const ch = en.whatsappBot.bots.channels;

/** How often the page asks whether Meta has called or a message has arrived, while it waits. */
const WAIT_POLL_MS = 5000;

type StepId = "details" | "connect" | "webhook" | "test";

const STEPS = [
  { id: "details", title: t.step1 },
  { id: "connect", title: t.step2 },
  { id: "webhook", title: t.step3 },
  { id: "test", title: t.step4 },
];

/**
 * Which step a number is on, read from its number rather than remembered by the page — so
 * an admin who leaves half-way (to find a token in Meta, say) comes back to exactly where they were.
 * `done` once a message has actually arrived: until then the setup is not proven.
 */
export const numberStep = (
  number: WaBusinessNumber | undefined,
  hasDetails: boolean,
): StepId | "done" => {
  if (!number) return hasDetails ? "connect" : "details";
  if (number.status === WaBusinessNumberStatus.AWAITING_WEBHOOK) return "webhook";
  if (!number.lastInboundAt && number.status !== WaBusinessNumberStatus.ERROR) return "test";
  return "done";
};

/** How a number's status reads to a person: one word, one colour. */
const ChannelStatus: React.FC<{ number: WaBusinessNumber }> = ({ number }) => {
  if (number.status === WaBusinessNumberStatus.ERROR) {
    return <StatusPill tone="danger">{ch.statusProblem}</StatusPill>;
  }
  if (number.status === WaBusinessNumberStatus.AWAITING_WEBHOOK) {
    return <StatusPill tone="warning">{ch.statusWaiting}</StatusPill>;
  }
  return <StatusPill tone="success">{ch.statusConnected}</StatusPill>;
};

/**
 * One WhatsApp channel as a row: the number, its status in words, when it last heard from someone,
 * and what you can do with it. A number whose setup stopped half-way offers "Finish setup", which
 * opens the remaining step in place.
 */
const ChannelRow: React.FC<{
  number: WaBusinessNumber;
  canManage: boolean;
  /** Extra controls on the right — the chatbot picker, or "Remove from chatbot". */
  trailing?: React.ReactNode;
}> = ({ number, canManage, trailing }) => {
  const [finishing, setFinishing] = useState(false);
  const [check, { isLoading: isChecking }] = useCheckWaNumberMutation();
  const [disconnect, { isLoading: isDisconnecting }] = useDisconnectWaNumberMutation();
  const awaiting = number.status === WaBusinessNumberStatus.AWAITING_WEBHOOK;

  const handleCheck = async () => {
    try {
      const result = await check({ id: number.id }).unwrap();
      if (result.check.ok) toast.success(t.checkOk);
      else toast.error(result.check.error ?? t.checkFailed);
    } catch (err) {
      toast.error(errorMessage(err, t.checkFailed));
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm(c.disconnectConfirm)) return;
    try {
      await disconnect({ id: number.id }).unwrap();
      toast.success(c.disconnected);
    } catch (err) {
      toast.error(errorMessage(err, c.disconnectFailed));
    }
  };

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex-1 min-w-[12rem] flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-typography-900">
              {number.displayPhoneNumber ?? number.phoneNumberId}
            </span>
            <ChannelStatus number={number} />
          </div>
          <span className="text-xs text-typography-500">
            {[
              number.verifiedName,
              number.lastInboundAt
                ? fill(ch.lastMessage, { when: timeAgo(number.lastInboundAt) })
                : ch.noMessages,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {number.status === WaBusinessNumberStatus.ERROR && number.lastError && (
            <span className="text-xs text-destructive-600">{number.lastError}</span>
          )}
        </div>
        {trailing}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {awaiting && (
              <Button variant={ButtonVariant.PRIMARY} onClick={() => setFinishing(f => !f)}>
                {ch.finishSetup}
              </Button>
            )}
            <Button
              variant={ButtonVariant.SECONDARY}
              onClick={() => void handleCheck()}
              disabled={isChecking}
            >
              {isChecking ? c.checking : ch.check}
            </Button>
            <Button
              variant={ButtonVariant.SECONDARY}
              onClick={() => void handleDisconnect()}
              disabled={isDisconnecting}
            >
              {ch.disconnect}
            </Button>
          </div>
        )}
      </div>
      {finishing && awaiting && (
        <div className="flex flex-col gap-4 border border-border-light rounded-md p-4">
          <WebhookStep number={number} />
        </div>
      )}
    </li>
  );
};

/** A plain list of channel rows, or what to do when there are none. */
export const ChannelList: React.FC<{
  numbers: WaBusinessNumber[];
  canManage: boolean;
  emptyTitle: string;
  emptyHint: string;
  trailing?: (number: WaBusinessNumber) => React.ReactNode;
}> = ({ numbers, canManage, emptyTitle, emptyHint, trailing }) =>
  numbers.length === 0 ? (
    <div className="flex flex-col gap-1 py-6 text-center">
      <span className="text-sm text-typography-900">{emptyTitle}</span>
      <span className="text-sm text-typography-600">{emptyHint}</span>
    </div>
  ) : (
    <ul className="flex flex-col divide-y divide-border-light">
      {numbers.map(number => (
        <ChannelRow
          key={number.id}
          number={number}
          canManage={canManage}
          trailing={trailing?.(number)}
        />
      ))}
    </ul>
  );

/** Numbers poll only while one of them is waiting on Meta; a finished setup costs nothing. */
export const useWaNumbers = (chatbotId?: string) => {
  const [pollingInterval, setPollingInterval] = useState(0);
  const query = useGetWaNumbersQuery(chatbotId ? { chatbotId } : undefined, { pollingInterval });
  const waiting = (query.data ?? []).some(
    n => n.status === WaBusinessNumberStatus.AWAITING_WEBHOOK,
  );
  useEffect(() => {
    setPollingInterval(waiting ? WAIT_POLL_MS : 0);
  }, [waiting]);
  return query;
};

/** A short numbered list with ticks for what is done — read at a glance, not navigated. */
const SetupSteps: React.FC<{ current: StepId }> = ({ current }) => {
  const index = STEPS.findIndex(step => step.id === current);
  return (
    <ol className="flex flex-col gap-3 min-w-[11rem]">
      {STEPS.map((step, i) => {
        const done = i < index;
        const active = i === index;
        return (
          <li key={step.id} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs ${
                done
                  ? "bg-success-400 text-white"
                  : active
                    ? "bg-primary-500 text-white"
                    : "border border-border-light text-typography-500"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={`text-sm ${
                active ? "text-typography-900 font-medium" : "text-typography-600"
              }`}
            >
              {step.title}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

/**
 * Connect ONE new WhatsApp number, start to finish. It follows only the number it created, so
 * numbers that already exist never reappear here; when Meta has confirmed and a message has
 * arrived (or the admin says they're done), it closes and the number is in the list.
 */
export const ConnectWhatsAppFlow: React.FC<{ chatbotId?: string; onClose: () => void }> = ({
  chatbotId,
  onClose,
}) => {
  const [hasDetails, setHasDetails] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const { data: numbers = [] } = useWaNumbers(chatbotId);
  const number = createdId ? numbers.find(n => n.id === createdId) : undefined;
  const step = numberStep(number, hasDetails);

  useEffect(() => {
    if (step === "done") {
      toast.success(ch.connectedToast);
      onClose();
    }
  }, [step, onClose]);

  return (
    <Card
      title={t.newHeading}
      subtitle={chatbotId ? t.newIntro : ch.newFreeIntro}
      action={
        <Button variant={ButtonVariant.SECONDARY} onClick={onClose}>
          {number ? ch.done : ch.cancel}
        </Button>
      }
    >
      <div className="flex max-md:flex-col gap-8">
        <SetupSteps current={step === "done" ? "test" : step} />
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {step === "details" && <DetailsStep onReady={() => setHasDetails(true)} />}
          {step === "connect" && (
            <ConnectStep chatbotId={chatbotId} onConnected={id => setCreatedId(id)} />
          )}
          {step === "webhook" && number && <WebhookStep number={number} />}
          {step === "test" && number && <TestStep number={number} />}
        </div>
      </div>
    </Card>
  );
};

const DetailsStep: React.FC<{ onReady: () => void }> = ({ onReady }) => (
  <>
    <p className="text-sm text-typography-700">{t.step1Body}</p>
    <ul className="flex flex-col gap-2 text-sm text-typography-800 list-disc pl-5">
      <li>{t.step1Item1}</li>
      <li>{t.step1Item2}</li>
      <li>{t.step1Item3}</li>
      <li>{t.step1Item4}</li>
    </ul>
    <InlineNotification kind="info" title={t.step1Warning} lowContrast hideCloseButton />
    <div>
      <Button variant={ButtonVariant.PRIMARY} onClick={onReady}>
        {t.step1Next}
      </Button>
    </div>
  </>
);

/** Meta checks the details before anything is saved, so a mistake shows here, not as silence later. */
const ConnectStep: React.FC<{ chatbotId?: string; onConnected: (numberId: string) => void }> = ({
  chatbotId,
  onConnected,
}) => {
  const [form, setForm] = useState({
    phoneNumberId: "",
    wabaId: "",
    accessToken: "",
    appSecret: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [connect, { isLoading }] = useConnectWaNumberMutation();
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm(current => ({ ...current, [key]: event.target.value }));
  const complete = Object.values(form).every(value => value.trim());

  const handleConnect = async () => {
    setError(null);
    try {
      const created = await connect({ ...(chatbotId ? { chatbotId } : {}), ...form }).unwrap();
      onConnected(created.id);
      toast.success(c.connected);
    } catch (err) {
      setError(errorMessage(err, c.connectFailed));
    }
  };

  return (
    <>
      <TextInput
        id="wa-number-phone-number-id"
        labelText={c.phoneNumberIdLabel}
        helperText={c.phoneNumberIdHelp}
        value={form.phoneNumberId}
        inputMode="numeric"
        onChange={set("phoneNumberId")}
      />
      <TextInput
        id="wa-number-waba-id"
        labelText={c.wabaIdLabel}
        value={form.wabaId}
        inputMode="numeric"
        onChange={set("wabaId")}
      />
      <TextInput
        id="wa-number-access-token"
        labelText={c.accessTokenLabel}
        helperText={c.accessTokenHelp}
        type="password"
        autoComplete="off"
        value={form.accessToken}
        onChange={set("accessToken")}
      />
      <TextInput
        id="wa-number-app-secret"
        labelText={c.appSecretLabel}
        helperText={c.appSecretHelp}
        type="password"
        autoComplete="off"
        value={form.appSecret}
        onChange={set("appSecret")}
      />
      {error && (
        <InlineNotification
          kind="error"
          title={c.connectFailed}
          subtitle={error}
          lowContrast
          hideCloseButton
        />
      )}
      <div>
        <Button
          variant={ButtonVariant.PRIMARY}
          onClick={() => void handleConnect()}
          disabled={!complete || isLoading}
        >
          {isLoading ? c.connecting : c.connectButton}
        </Button>
      </div>
    </>
  );
};

const WebhookStep: React.FC<{ number: WaBusinessNumber }> = ({ number }) => (
  <>
    <p className="text-sm text-typography-700">{t.step3Body}</p>
    {number.callbackUrl && <CopyField label={c.callbackUrlLabel} value={number.callbackUrl} />}
    {number.verifyToken && <CopyField label={c.verifyTokenLabel} value={number.verifyToken} />}
    <p className="text-sm text-typography-700">{t.step3Fields}</p>
    <InlineNotification kind="info" title={t.step3Waiting} lowContrast hideCloseButton />
  </>
);

const TestStep: React.FC<{ number: WaBusinessNumber }> = ({ number }) => {
  const [subscribe, { isLoading }] = useSubscribeWaNumberMutation();
  const handleSubscribe = async () => {
    try {
      await subscribe({ id: number.id }).unwrap();
      toast.success(c.subscribed);
    } catch (err) {
      toast.error(errorMessage(err, c.subscribeFailed));
    }
  };
  return (
    <>
      <p className="text-sm text-typography-700">
        {fill(t.step4Body, { number: number.displayPhoneNumber ?? "your number" })}
      </p>
      <InlineNotification kind="info" title={t.step4Waiting} lowContrast hideCloseButton />
      <div>
        <Button
          variant={ButtonVariant.SECONDARY}
          onClick={() => void handleSubscribe()}
          disabled={isLoading}
        >
          {isLoading ? c.subscribing : t.step4Subscribe}
        </Button>
      </div>
    </>
  );
};
