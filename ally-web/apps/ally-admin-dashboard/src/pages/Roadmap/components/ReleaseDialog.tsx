import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import {
  Button,
  InlineNotification,
  Modal,
  RadioButton,
  RadioButtonGroup,
  SkeletonText,
  Tag,
} from "@ally-ui-mono/ui-shared";
import { useGetRoadmapReleasePlanQuery, useReleaseRoadmapServiceMutation } from "@api";
import { en } from "@constants";
import type { RoadmapItemDetail, RoadmapReleasePlan, RoadmapReleaseService } from "@types";
import { ROADMAP_RELEASE_SERVICES } from "@types";

import { BottomSheet } from "./BottomSheet";
import { SlideToConfirm } from "./SlideToConfirm";
import { haptic } from "../../../motion";

const isPolicyService = (value: string): value is RoadmapReleaseService =>
  (ROADMAP_RELEASE_SERVICES as string[]).includes(value);

/**
 * Which services an idea's Release can ship: those still waiting to go live (P1's item_releases),
 * in release order (backends before the frontends). Mobile ships through the stores, never here.
 * An idea held before any release row exists offers every service.
 */
export const releasableServices = (
  item: Pick<RoadmapItemDetail, "releases">,
): RoadmapReleaseService[] => {
  const releases = Array.isArray(item.releases) ? item.releases : [];
  const pending = new Set(
    releases
      .filter(r => r.state !== "live")
      .map(r => r.service)
      .filter(isPolicyService),
  );
  const list = ROADMAP_RELEASE_SERVICES.filter(s => pending.has(s));
  return list.length ? list : [...ROADMAP_RELEASE_SERVICES];
};

const errorMessage = (error: unknown): string | null => {
  const data = (error as { data?: { message?: unknown } })?.data;
  const message = Array.isArray(data?.message) ? data?.message[0] : data?.message;
  return typeof message === "string" && message.trim() ? message : null;
};

/** Every commit in the range, held ones marked, with the held reasons spelled out. */
export const ReleasePlanBody: React.FC<{ plan: RoadmapReleasePlan }> = ({ plan }) => {
  const copy = en.roadmapV2Tools.ship;
  const commits = Array.isArray(plan.commits) ? plan.commits : [];
  const held = Array.isArray(plan.heldReasons) ? plan.heldReasons : [];
  if (!commits.length) return <p className="text-sm text-typography-600">{copy.nothing}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="m-0 text-sm font-medium text-typography-900">
          {copy.willShip(commits.length, plan.nextTag ?? "")}
        </p>
        {plan.baseTag && (
          <p className="m-0 text-xs text-typography-600">{copy.fromTag(plan.baseTag)}</p>
        )}
        <p className="m-0 text-xs text-typography-600">{copy.othersNote}</p>
      </div>
      {plan.breaker?.pausedAt && (
        <InlineNotification kind="warning" lowContrast hideCloseButton title={copy.breakerOpen} />
      )}
      {held.length > 0 && (
        <div className="flex flex-col gap-1 rounded border border-amber-200 bg-amber-50 p-2">
          <p className="m-0 text-xs font-medium text-amber-700">{copy.heldIntro}</p>
          <ul className="m-0 list-disc pl-4 text-xs text-typography-900">
            {held.map(reason => (
              <li key={`${reason.sha}:${reason.file}`} className="break-all">
                {copy.heldBecause(reason.file, reason.rule)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul
        className="m-0 flex max-h-[40vh] list-none flex-col divide-y divide-border-light overflow-y-auto rounded border border-border-light p-0"
        aria-label={copy.willShip(commits.length, plan.nextTag ?? "")}
      >
        {commits.map(commit => (
          <li key={commit.sha} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
            <span className="flex items-start gap-2">
              <span className="min-w-0 flex-1 break-words text-typography-900">{commit.title}</span>
              {commit.held && (
                <Tag type="warm-gray" size="sm" className="shrink-0">
                  {copy.held}
                </Tag>
              )}
            </span>
            <span className="text-xs tabular-nums text-typography-600">
              {[
                commit.sha.slice(0, 7),
                commit.authorLogin,
                commit.prNumber ? copy.prLink(commit.prNumber) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

interface ReleaseDialogProps {
  open: boolean;
  onClose: () => void;
  services: RoadmapReleaseService[];
  /** Phone: a bottom sheet with slide to confirm (§4.18). */
  phone?: boolean;
}

/**
 * Release (D6, §4.7 "Release held"): lists everything that will ship — every commit in
 * `lastSuccessfulProdTag...master` for the service, other people's included (P5's plan) — before
 * one click releases it. The plan's `serviceHeadSha` goes back with the click, so what was listed
 * is what ships: if more landed, the server refuses and the list reloads.
 */
export const ReleaseDialog: React.FC<ReleaseDialogProps> = ({ open, onClose, services, phone }) => {
  const copy = en.roadmapV2Tools.ship;
  const [service, setService] = useState<RoadmapReleaseService>(services[0] ?? "be");
  useEffect(() => {
    if (open && !services.includes(service)) setService(services[0] ?? "be");
  }, [open, services, service]);
  const {
    data: plan,
    isFetching,
    isError,
    refetch,
  } = useGetRoadmapReleasePlanQuery(service, {
    skip: !open,
    refetchOnMountOrArgChange: true,
  });
  const [release, { isLoading: releasing }] = useReleaseRoadmapServiceMutation();
  const [slideKey, setSlideKey] = useState(0);

  const commits = Array.isArray(plan?.commits) ? plan!.commits : [];
  const ready =
    !!plan && !isFetching && commits.length > 0 && !plan.unknown && !!plan.serviceHeadSha;
  const allowed = !!plan?.canRelease;

  const submit = async () => {
    if (!plan?.serviceHeadSha) return;
    try {
      const result = await release({ service, serviceHeadSha: plan.serviceHeadSha }).unwrap();
      haptic(10);
      toast.success(copy.released(result.tag));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error) ?? copy.failed);
      setSlideKey(k => k + 1);
      void refetch();
    }
  };

  const serviceName = copy.services[service] ?? service;
  const body = (
    <div className="flex flex-col gap-3">
      {services.length > 1 && (
        <RadioButtonGroup
          legendText={copy.service}
          name="roadmap-release-service"
          orientation="horizontal"
          valueSelected={service}
          onChange={(value: string | number | undefined) =>
            setService(String(value ?? "") as RoadmapReleaseService)
          }
        >
          {services.map(s => (
            <RadioButton
              key={s}
              id={`roadmap-release-service-${s}`}
              labelText={copy.services[s] ?? s}
              value={s}
            />
          ))}
        </RadioButtonGroup>
      )}
      {isFetching && !plan ? (
        <div aria-busy="true">
          <p className="m-0 mb-2 text-sm text-typography-600">{copy.loading}</p>
          <SkeletonText paragraph lineCount={4} />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2" role="alert">
          <p className="m-0 text-sm text-typography-900">{copy.loadFailed}</p>
          <Button kind="tertiary" size="sm" onClick={() => void refetch()}>
            {copy.retry}
          </Button>
        </div>
      ) : plan ? (
        <>
          {plan.unknown && (
            <InlineNotification
              kind="warning"
              lowContrast
              hideCloseButton
              title={copy.unknown(plan.unknown)}
            />
          )}
          <ReleasePlanBody plan={plan} />
          {!allowed && commits.length > 0 && (
            <p className="m-0 text-sm text-typography-600">{copy.cannotRelease}</p>
          )}
        </>
      ) : null}
    </div>
  );

  if (phone) {
    return (
      <BottomSheet
        open={open}
        onClose={onClose}
        title={copy.releaseTitle(serviceName)}
        closeLabel={copy.cancel}
        footer={
          allowed && ready ? (
            <SlideToConfirm
              key={`${service}:${slideKey}`}
              label={copy.slide}
              doneLabel={copy.slideDone}
              disabled={releasing}
              onConfirm={() => void submit()}
            />
          ) : undefined
        }
      >
        {body}
      </BottomSheet>
    );
  }

  return (
    <Modal
      open={open}
      size="md"
      modalHeading={copy.releaseTitle(serviceName)}
      primaryButtonText={copy.confirm}
      secondaryButtonText={copy.cancel}
      primaryButtonDisabled={!allowed || !ready || releasing}
      onRequestClose={onClose}
      onRequestSubmit={() => void submit()}
    >
      {body}
    </Modal>
  );
};

/**
 * Merge and Release, for the idea page's one primary action and the Ship tab. Merge happens on the
 * pull request, in the Build tab, so its button opens that tab.
 */
export const ShipActions: React.FC<{
  item: RoadmapItemDetail;
  kind: "merge" | "release";
  phone?: boolean;
  fullWidth?: boolean;
  onOpenBuild?: () => void;
}> = ({ item, kind, phone, fullWidth, onOpenBuild }) => {
  const copy = en.roadmapV2Tools.ship;
  const [open, setOpen] = useState(false);
  const size = fullWidth ? "lg" : "md";
  const className = fullWidth ? "w-full max-w-none" : "";
  if (kind === "merge") {
    if (!item.can?.merge || !onOpenBuild) return null;
    return (
      <Button kind="primary" size={size} className={className} onClick={onOpenBuild}>
        {copy.merge}
      </Button>
    );
  }
  if (!item.can?.release) return null;
  return (
    <>
      <Button kind="primary" size={size} className={className} onClick={() => setOpen(true)}>
        {copy.release}
      </Button>
      {open && (
        <ReleaseDialog
          open={open}
          onClose={() => setOpen(false)}
          services={releasableServices(item)}
          phone={phone}
        />
      )}
    </>
  );
};
