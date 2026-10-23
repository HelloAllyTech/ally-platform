import { FC, useMemo, useState } from "react";

import { toast } from "sonner";

import { Button, Select, SelectItem, SidePanel, TextArea, Tooltip } from "@ally-ui-mono/ui-shared";
import {
  useGetBugHunterFeatureMapsQuery,
  useRefreshBugHunterFeatureMapsMutation,
  useRemoveBugHunterFeatureMapMutation,
} from "@api";
import { TooltipIcon } from "@assets";
import { ActionConfirmationPopup } from "@components/action-confirmation-popup";
import { en } from "@constants";
import { BugHunterFeatureCard } from "@types";
import { formatDate } from "@utils";

import { BUG_HUNTER_REPOS } from "./repos";

const ALL_REPOS = "__all__";

/**
 * Shared by every caller of the refresh mutation, so the Notebook's button and
 * the header menu's shortcut see one request in flight rather than two.
 */
const REFRESH_CACHE_KEY = "bug-hunter-feature-map-refresh";

export interface FeatureMapRefreshDialogProps {
  /** One repo, or every repo when absent. */
  repo?: string;
  onClose: () => void;
}

/**
 * "Map features now", behind its confirmation.
 *
 * Its own component since 2026-10-13 so the page header's ⋯ menu can offer the
 * same action as a shortcut without a second copy of the dialog. A map run is a
 * read-only agent session per repo, and it costs what one costs, so the
 * shortcut keeps the confirm rather than firing on a menu click.
 */
export const FeatureMapRefreshDialog: FC<FeatureMapRefreshDialogProps> = ({ repo, onClose }) => {
  const [refresh] = useRefreshBugHunterFeatureMapsMutation({ fixedCacheKey: REFRESH_CACHE_KEY });

  const handleRefresh = async () => {
    onClose();
    try {
      const { runIds } = await refresh(repo ? { repo } : {}).unwrap();
      if (runIds.length) {
        toast.success(
          en.bugHunter.featureMapRefreshStarted.replace("{count}", String(runIds.length)),
        );
      } else {
        toast.info(en.bugHunter.featureMapRefreshNone);
      }
    } catch {
      toast.error(en.bugHunter.featureMapRefreshFailed);
    }
  };

  return (
    <ActionConfirmationPopup
      isOpen
      onClose={onClose}
      title={en.bugHunter.featureMapRefreshConfirmTitle}
      description={en.bugHunter.featureMapRefreshConfirmBody.replace(
        "{scope}",
        repo ?? "every repo",
      )}
      primaryButton={{ label: en.bugHunter.featureMapRefreshConfirm, onClick: handleRefresh }}
      secondaryButton={{ label: en.bugHunter.cancel, onClick: onClose }}
    />
  );
};

export interface FeatureMapPanelProps {
  /** Whether this reader may start a map run, or only read the cards. */
  canTriage: boolean;
}

/**
 * Bug Hunter's feature map: one card per user-facing feature, how it works
 * across repos, written by a weekly read-only run and read by every study
 * before it opens a file.
 *
 * Sits under the notebook because both are what Bug Hunter remembers: the
 * notebook holds lessons, this holds how the product is built. What an admin
 * reads here is what a fix session starts from, so a wrong card is worth
 * spotting here before it misleads a study.
 */
export const FeatureMapPanel: FC<FeatureMapPanelProps> = ({ canTriage }) => {
  const [repo, setRepo] = useState<string>(ALL_REPOS);
  const { data, isLoading, isError } = useGetBugHunterFeatureMapsQuery(
    repo === ALL_REPOS ? undefined : { repo },
  );
  const [, { isLoading: isRefreshing }] = useRefreshBugHunterFeatureMapsMutation({
    fixedCacheKey: REFRESH_CACHE_KEY,
  });
  const [confirming, setConfirming] = useState(false);
  const cards = useMemo(() => data?.cards ?? [], [data]);
  const [removeCard, { isLoading: isRemoving }] = useRemoveBugHunterFeatureMapMutation();
  const [wrongCard, setWrongCard] = useState<BugHunterFeatureCard | null>(null);
  const [reason, setReason] = useState("");

  const handleRemove = async () => {
    if (!wrongCard || !reason.trim()) return;
    try {
      await removeCard({ id: wrongCard.id, reason: reason.trim() }).unwrap();
      toast.success(en.bugHunter.featureMapWrongDone);
      setWrongCard(null);
      setReason("");
    } catch {
      toast.error(en.bugHunter.featureMapWrongFailed);
    }
  };

  return (
    <section className="max-w-3xl mt-10" data-testid="feature-map-panel">
      <h2 className="text-base font-semibold text-typography-900">
        {en.bugHunter.featureMapTitle}
      </h2>
      <p className="text-sm text-typography-700 mt-1">{en.bugHunter.featureMapIntro}</p>

      <div className="mt-4 flex items-end gap-3">
        <div className="w-[220px]">
          <Select
            id="bug-hunter-feature-map-repo"
            labelText={en.bugHunter.featureMapRepoLabel}
            value={repo}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRepo(e.target.value)}
          >
            <SelectItem value={ALL_REPOS} text={en.bugHunter.featureMapRepoAll} />
            {BUG_HUNTER_REPOS.map(name => (
              <SelectItem key={name} value={name} text={name} />
            ))}
          </Select>
        </div>
        {canTriage && (
          <div className="flex items-center gap-1">
            <Button
              size="md"
              kind="tertiary"
              disabled={isRefreshing}
              onClick={() => setConfirming(true)}
            >
              {en.bugHunter.featureMapRefresh}
            </Button>
            <Tooltip label={en.bugHunter.featureMapRefreshTooltip} align="top">
              <button type="button" className="cursor-pointer inline-flex items-center">
                <TooltipIcon />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      <div className="mt-4 border border-border-light rounded-lg bg-white">
        {isLoading ? (
          <p className="px-4 py-6 text-sm text-typography-500">{en.bugHunter.featureMapLoading}</p>
        ) : isError ? (
          <p className="px-4 py-6 text-sm text-destructive-600">{en.bugHunter.featureMapError}</p>
        ) : cards.length === 0 ? (
          <p className="px-4 py-6 text-sm text-typography-500">{en.bugHunter.featureMapEmpty}</p>
        ) : (
          <ul>
            {cards.map(card => (
              <FeatureCard
                key={card.id}
                card={card}
                onWrong={canTriage ? () => setWrongCard(card) : undefined}
              />
            ))}
          </ul>
        )}
      </div>

      {!canTriage && (
        <p className="mt-4 text-xs text-typography-500">{en.bugHunter.featureMapReadOnly}</p>
      )}

      {wrongCard && (
        <SidePanel
          open
          onClose={() => setWrongCard(null)}
          title={en.bugHunter.featureMapWrongTitle}
          className="w-[28rem]"
        >
          <p className="text-sm font-semibold text-typography-900">{wrongCard.title}</p>
          <p className="text-xs text-typography-600 mt-1">{en.bugHunter.featureMapWrongIntro}</p>
          <div className="mt-4">
            <TextArea
              id="bug-hunter-feature-map-wrong-reason"
              labelText={en.bugHunter.featureMapWrongReasonLabel}
              placeholder={en.bugHunter.featureMapWrongReasonPlaceholder}
              value={reason}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
              rows={4}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button kind="secondary" onClick={() => setWrongCard(null)}>
              {en.bugHunter.cancel}
            </Button>
            <Button kind="danger" disabled={!reason.trim() || isRemoving} onClick={handleRemove}>
              {en.bugHunter.featureMapWrongSubmit}
            </Button>
          </div>
        </SidePanel>
      )}

      {confirming && (
        <FeatureMapRefreshDialog
          repo={repo === ALL_REPOS ? undefined : repo}
          onClose={() => setConfirming(false)}
        />
      )}
    </section>
  );
};

const Row: FC<{ label: string; items: string[] }> = ({ label, items }) =>
  items.length ? (
    <div className="flex gap-2 text-xs">
      <span className="w-28 shrink-0 text-typography-600">{label}</span>
      <span className="min-w-0 break-words text-typography-800">{items.join(" · ")}</span>
    </div>
  ) : null;

const FeatureCard: FC<{ card: BugHunterFeatureCard; onWrong?: () => void }> = ({
  card,
  onWrong,
}) => (
  <li
    className="px-4 py-3 border-b border-b-border-light last:border-b-0"
    data-testid="feature-card"
  >
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <h3 className="text-sm font-semibold text-typography-900">{card.title}</h3>
      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-typography-700">
        {card.repo}
      </span>
      {card.valueSource && (
        <Tooltip label={en.bugHunter.featureMapSourceTooltip} align="top">
          <span
            className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-800"
            data-testid="feature-card-source"
          >
            {en.bugHunter.featureMapSource[card.valueSource] ?? card.valueSource}
          </span>
        </Tooltip>
      )}
      {onWrong && (
        <span className="ml-auto">
          <Button size="sm" kind="ghost" onClick={onWrong}>
            {en.bugHunter.featureMapWrong}
          </Button>
        </span>
      )}
    </div>
    <p className="mt-1 text-sm text-typography-800 break-words">{card.summary}</p>
    <div className="mt-2 flex flex-col gap-1">
      <Row label={en.bugHunter.featureMapEntryPoints} items={card.entryPoints} />
      <Row label={en.bugHunter.featureMapEndpoints} items={card.endpoints} />
      <Row label={en.bugHunter.featureMapDataHomes} items={card.dataHomes} />
      <Row
        label={en.bugHunter.featureMapWrittenBy}
        items={card.writtenBy ? [card.writtenBy] : []}
      />
      <Row label={en.bugHunter.featureMapRelated} items={card.relatedRepos} />
      <Row label={en.bugHunter.featureMapGotchas} items={card.gotchas} />
    </div>
    <p className="mt-2 text-xs text-typography-500 tabular-nums">
      {en.bugHunter.featureMapMappedAt
        .replace("{sha}", card.sourceSha ? card.sourceSha.slice(0, 8) : "an unknown commit")
        .replace("{when}", formatDate(card.updatedAt))}
    </p>
  </li>
);
