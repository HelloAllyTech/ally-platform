import React, { useState } from "react";

import { toast } from "sonner";

import { Select, SelectItem, SkeletonText } from "@ally-ui-mono/ui-shared";
import { useBindConnectorMutation } from "@api";
import { Button, EmptyState } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { Chatbot, WaBusinessNumber } from "@types";

import { ChannelList, ConnectWhatsAppFlow, useWaNumbers } from "./NumberTab";
import { Card, errorMessage, LoadError } from "./shared";

const t = en.whatsappBot.bots.connectors;
const ch = en.whatsappBot.bots.channels;

const useMoveChannel = () => {
  const [bind, { isLoading }] = useBindConnectorMutation();
  const move = async (number: WaBusinessNumber, chatbotId: string | null) => {
    if (!number.connectorId) return;
    if (!chatbotId && !window.confirm(t.unassignConfirm)) return;
    try {
      await bind({ id: number.connectorId, chatbotId }).unwrap();
      toast.success(chatbotId ? t.assigned : t.unassigned);
    } catch (err) {
      toast.error(errorMessage(err, t.failed));
    }
  };
  return { move, isMoving: isLoading };
};

/**
 * Platform view: every channel and the agent it serves, with a picker to move it — the place to
 * give Ally's production number to an agent, or take a number off one.
 */
export const AllConnectorsTab: React.FC<{ bots: Chatbot[]; onCreateAgent: () => void }> = ({
  bots,
  onCreateAgent,
}) => {
  const [connecting, setConnecting] = useState(false);
  const { data: numbers = [], isLoading, isError, refetch } = useWaNumbers();
  const { move, isMoving } = useMoveChannel();

  // A channel with no agent behind it answers nobody, so with no agents yet the first step is an
  // agent, not a number. (Numbers that already exist are still listed, so they can be managed.)
  if (!isLoading && !isError && bots.length === 0 && numbers.length === 0) {
    return (
      <div className="max-w-4xl">
        <Card title={t.allTitle}>
          <EmptyState
            title={ch.noAgentsTitle}
            subtitle={ch.noAgentsHint}
            actionLabel={en.whatsappBot.bots.create}
            onAction={onCreateAgent}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <Card
        title={t.allTitle}
        subtitle={t.allIntro}
        action={
          !connecting &&
          bots.length > 0 && (
            <Button variant={ButtonVariant.PRIMARY} onClick={() => setConnecting(true)}>
              {t.newWhatsApp}
            </Button>
          )
        }
      >
        {isLoading ? (
          <SkeletonText paragraph lineCount={3} />
        ) : isError ? (
          <LoadError title={t.failed} onRetry={() => void refetch()} />
        ) : (
          <ChannelList
            numbers={numbers}
            canManage
            emptyTitle={ch.allEmpty}
            emptyHint={ch.allEmptyHint}
            trailing={number => (
              <div className="w-56">
                <Select
                  id={`channel-agent-${number.id}`}
                  labelText={t.bot}
                  hideLabel
                  disabled={isMoving || !number.connectorId}
                  value={number.chatbotId ?? ""}
                  onChange={e => void move(number, e.target.value || null)}
                >
                  <SelectItem value="" text={t.none} />
                  {bots.map(bot => (
                    <SelectItem key={bot.id} value={bot.id} text={bot.name} />
                  ))}
                </Select>
              </div>
            )}
          />
        )}
      </Card>
      {connecting && <ConnectWhatsAppFlow onClose={() => setConnecting(false)} />}
    </div>
  );
};
