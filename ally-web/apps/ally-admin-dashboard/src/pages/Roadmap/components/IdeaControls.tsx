import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Copy, Notification, StarOutline, StarSolid, Tick } from "@icons";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import { Button, OverflowMenu, OverflowMenuItem } from "@ally-ui-mono/ui-shared";
import {
  usePatchRoadmapItemMutation,
  useSetRoadmapStarMutation,
  useSetRoadmapWatchMutation,
} from "@api";
import { ROUTES, en } from "@constants";
import type { RoadmapItemDetail, RoadmapWatchLevel } from "@types";

import { BuildMenu } from "./BuildMenu";
import { BuildModeControl, buildModeOf } from "./BuildModeControl";
import { ShipActions } from "./ReleaseDialog";
import { VoteControl } from "./VoteControl";
import { haptic, motionTransition, useReducedMotionPreference } from "../../../motion";
import { DeclineButton, IdeaFlowAction, hasIdeaFlowAction } from "../triage/ReviewActions";
import { quietLine } from "../utils/copy";
import { PRIMARY_ACTIONS_BUILT, primaryActionFor } from "../utils/primaryAction";

/** An absolute link to an idea, for Copy link. Built from the app's own base, so /admin works. */
export const ideaUrl = (code: string): string => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${window.location.origin}${base}${ROUTES.ROADMAP_IDEA(code)}`;
};

/** Copy link; the icon morphs into a ✓ for 1.5 s (§4.18). */
export const CopyLinkButton: React.FC<{ code: string; compact?: boolean }> = ({
  code,
  compact,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.actions;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(ideaUrl(code));
      setCopied(true);
    } catch {
      toast.error(copy.copyFailed);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? copy.copied : copy.copyLink}
      className={`inline-flex items-center justify-center rounded hover:bg-neutral-100 ${
        compact ? "h-11 w-11" : "h-8 w-8"
      }`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? "done" : "copy"}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTransition("fast", "productive", reduced)}
          className="inline-flex"
        >
          {copied ? <Tick size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        </motion.span>
      </AnimatePresence>
      <span className="sr-only" aria-live="polite">
        {copied ? copy.copied : ""}
      </span>
    </button>
  );
};

/** The idea's votes: the real VoteButton straight away (one record to load, not one per row). */
export const IdeaVotes: React.FC<{ item: RoadmapItemDetail }> = ({ item }) => {
  // Votes open and close with the stage: you can add and take away votes only while the idea is in
  // the Backlog. Past it the count stays, and it is locked.
  const open = item.stage === "backlog";
  return (
    <span title={open ? undefined : en.roadmapV2.row.votesLocked}>
      <VoteControl
        id={item.id}
        code={item.code}
        votes={item.votes}
        votedByMe={item.votedByMe}
        canVote={!!item.can?.vote && open}
      />
    </span>
  );
};

/** Star (Owner only, D16): fills and scales 1 → 1.2 → 1. Others see who starred it, read-only. */
export const IdeaStar: React.FC<{ item: RoadmapItemDetail; compact?: boolean }> = ({
  item,
  compact,
}) => {
  const reduced = useReducedMotionPreference();
  const [setStar] = useSetRoadmapStarMutation();
  const copy = en.roadmapV2;
  // Local state wins over the cache, so the star moves even if the cache entry can't be patched.
  const [starred, setStarred] = useState(item.starred);
  useEffect(() => setStarred(item.starred), [item.starred]);

  if (!item.can?.star) {
    if (!item.starred) return null;
    const who = item.starredBy?.name;
    return (
      <span className="inline-flex items-center gap-1 text-xs text-typography-secondary">
        <StarSolid size={16} className="text-warning-500" aria-hidden />
        {who ? copy.people.starredBy(who) : copy.row.starred}
      </span>
    );
  }

  const toggle = async () => {
    const next = !starred;
    setStarred(next);
    haptic(10);
    try {
      await setStar({ code: item.code, starred: next }).unwrap();
    } catch {
      setStarred(!next);
      toast.error(copy.actions.starFailed);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={starred}
      aria-label={starred ? copy.actions.unstar : copy.actions.star}
      className={`inline-flex items-center justify-center rounded hover:bg-neutral-100 ${
        compact ? "h-11 w-11" : "h-8 w-8"
      }`}
    >
      <motion.span
        key={starred ? "on" : "off"}
        className="inline-flex"
        initial={false}
        animate={reduced || !starred ? { scale: 1 } : { scale: [1, 1.2, 1] }}
        transition={motionTransition("moderate", "expressive", reduced)}
      >
        {starred ? (
          <StarSolid size={18} className="text-warning-500" aria-hidden />
        ) : (
          <StarOutline size={18} aria-hidden />
        )}
      </motion.span>
    </button>
  );
};

/** Watch: All · Milestones · None. The bell gives one 8° wiggle on change (§4.18). */
export const IdeaWatch: React.FC<{ item: RoadmapItemDetail }> = ({ item }) => {
  const reduced = useReducedMotionPreference();
  const [setWatch] = useSetRoadmapWatchMutation();
  const copy = en.roadmapV2.actions;
  const [level, setLevel] = useState<RoadmapWatchLevel>(item.watchLevel ?? "none");
  const [wiggle, setWiggle] = useState(0);
  useEffect(() => setLevel(item.watchLevel ?? "none"), [item.watchLevel]);

  // Watching is for the Idea role and up (§3.1); a Viewer gets no control at all.
  const canWatch = item.can?.watch ?? item.can?.answer ?? false;
  if (!canWatch) return null;

  const choose = async (next: RoadmapWatchLevel) => {
    if (next === level) return;
    const previous = level;
    setLevel(next);
    setWiggle(w => w + 1);
    try {
      await setWatch({ code: item.code, level: next }).unwrap();
    } catch {
      setLevel(previous);
      toast.error(copy.watchFailed);
    }
  };

  const label = copy.watchLevel(copy.watchLevels[level]);
  return (
    <OverflowMenu
      aria-label={label}
      iconDescription={label}
      flipped
      menuOptionsClass="!z-[9100] !w-64 [&_.cds--overflow-menu-options\_\_btn]:!max-w-none"
      renderIcon={() => (
        <span className="inline-flex items-center gap-1 px-1 text-sm text-typography-primary">
          <motion.span
            key={wiggle}
            className="inline-flex"
            animate={reduced || wiggle === 0 ? { rotate: 0 } : { rotate: [0, 8, -8, 0] }}
            transition={motionTransition("fast", "productive", reduced)}
          >
            <Notification size={16} aria-hidden />
          </motion.span>
          <span className="hidden sm:inline">{label}</span>
        </span>
      )}
      className="!h-8 !w-auto"
    >
      {(["all", "milestones", "none"] as RoadmapWatchLevel[]).map(option => (
        <OverflowMenuItem
          key={option}
          itemText={`${option === level ? "✓ " : ""}${copy.watchLevels[option]} — ${copy.watchHelp[option]}`}
          onClick={() => choose(option)}
        />
      ))}
    </OverflowMenu>
  );
};

/**
 * Inline title edit (§4.11): the border fades in on focus; saves on blur or Enter, Esc cancels; a ✓
 * flashes on save. Only where `can.editTitle`; otherwise a plain heading.
 */
export const IdeaTitle: React.FC<{
  item: RoadmapItemDetail;
  as: "h1" | "h2";
  className?: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
}> = ({ item, as: Heading, className = "", headingRef }) => {
  const reduced = useReducedMotionPreference();
  const [patch] = usePatchRoadmapItemMutation();
  const copy = en.roadmapV2.actions;
  const [value, setValue] = useState(item.title);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setValue(item.title), [item.title]);
  // A title is prose, not a code: it must wrap and show in full. A one-line <input> scrolled
  // sideways and clipped long titles, so grow the box to fit its content instead.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    if (!saved) return undefined;
    const t = setTimeout(() => setSaved(false), 1200);
    return () => clearTimeout(t);
  }, [saved]);

  if (!item.can?.editTitle) {
    return (
      <Heading ref={headingRef} tabIndex={-1} className={`outline-none ${className}`}>
        {item.title}
      </Heading>
    );
  }

  const commit = async () => {
    const next = value.trim();
    if (!next || next === item.title) {
      setValue(item.title);
      return;
    }
    try {
      await patch({ code: item.code, patch: { title: next } }).unwrap();
      setSaved(true);
    } catch {
      setValue(item.title);
      toast.error(copy.editFailed);
    }
  };

  return (
    <Heading
      ref={headingRef}
      tabIndex={-1}
      className={`flex min-w-0 items-center gap-2 outline-none ${className}`}
    >
      <textarea
        ref={inputRef}
        rows={1}
        aria-label={copy.editTitle}
        value={value}
        maxLength={200}
        onChange={event => setValue(event.target.value.replace(/\n/g, " "))}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            inputRef.current?.blur();
          }
          if (event.key === "Escape") {
            setValue(item.title);
            event.stopPropagation();
            requestAnimationFrame(() => inputRef.current?.blur());
          }
        }}
        className="min-w-0 flex-1 resize-none overflow-hidden rounded border border-transparent bg-transparent px-1 font-[inherit] text-[length:inherit] outline-none transition-colors duration-100 hover:border-border-light focus:border-primary-600"
      />
      <AnimatePresence>
        {saved && (
          <motion.span
            className="inline-flex text-success-600"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransition("fast", "productive", reduced)}
            aria-live="polite"
          >
            <Tick size={16} aria-hidden />
            <span className="sr-only">{copy.editSaved}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </Heading>
  );
};

/**
 * The one primary action, or the quiet line (§4.5). Only Approve design exists in P2; the rest
 * render nothing until their phase builds them.
 */
export const PrimaryAction: React.FC<{
  item: RoadmapItemDetail;
  onApproveDesign: () => void;
  fullWidth?: boolean;
  /** Opens the side panel on a tab (Merge opens Build, where the pull requests are). */
  onOpenDetails?: (tab: "build" | "ship") => void;
  /** Phone: Build ▾ shows the Claude Code hint; Release slides to confirm. */
  phone?: boolean;
}> = props => {
  const action = primaryActionFor(props.item);
  // The Owner's own steps carry Decline already; beside the builder's, an Owner gets it too, up to
  // Released (lifecycle 2026-11-18).
  const ownerStep = action === "startPlanning" || action === "closePlan" || action === "pickLead";
  const decline =
    !ownerStep && !!props.item.can?.decline && !!props.item.lead ? (
      <DeclineButton item={props.item} fullWidth={props.fullWidth} />
    ) : null;
  const slot = <PrimaryActionSlot {...props} />;
  const inner = decline ? (
    <div className={`flex items-center gap-2 ${props.fullWidth ? "w-full" : ""}`}>
      {decline}
      {slot}
    </div>
  ) : (
    slot
  );
  // Once a builder is assigned, how it's built sits beside the action (lifecycle 2026-11-18).
  const showMode =
    !!props.item.lead && (!!props.item.can?.setBuildMode || buildModeOf(props.item) !== null);
  if (!showMode) return inner;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${props.fullWidth ? "w-full" : ""}`}>
      <BuildModeControl item={props.item} />
      {inner}
    </div>
  );
};

const PrimaryActionSlot: React.FC<{
  item: RoadmapItemDetail;
  onApproveDesign: () => void;
  fullWidth?: boolean;
  onOpenDetails?: (tab: "build" | "ship") => void;
  phone?: boolean;
}> = ({ item, onApproveDesign, fullWidth, onOpenDetails, phone }) => {
  const action = primaryActionFor(item);
  // Start planning, Close plan, Pick a builder, Mark released, and a declined idea's Reopen / New idea.
  if (hasIdeaFlowAction(item)) return <IdeaFlowAction item={item} fullWidth={fullWidth} />;
  if (!action) {
    return <p className="text-sm text-typography-secondary">{quietLine(item)}</p>;
  }
  if (!PRIMARY_ACTIONS_BUILT.includes(action)) {
    switch (action) {
      case "pickLead":
      case "startPlanning":
      case "closePlan":
      case "markReleased":
        // Rendered by IdeaFlowAction above.
        return null;
      case "build":
        return <BuildMenu item={item} phone={phone} fullWidth={fullWidth} />;
      case "merge":
      case "release":
        return (
          <ShipActions
            item={item}
            kind={action}
            phone={phone}
            fullWidth={fullWidth}
            onOpenBuild={onOpenDetails ? () => onOpenDetails("build") : undefined}
          />
        );
      default:
        return null;
    }
  }
  return (
    <Button
      kind="primary"
      size={fullWidth ? "lg" : "md"}
      className={fullWidth ? "w-full max-w-none" : ""}
      onClick={onApproveDesign}
    >
      {en.roadmapV2.actions.approveDesign}
    </Button>
  );
};
