import React, { useEffect, useRef, useState } from "react";

import { ArrowDown } from "@icons";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import { Button, Modal, TextInput } from "@ally-ui-mono/ui-shared";
import {
  useGetBuilderSessionQuery,
  useGetBuilderSettingsQuery,
  useLazyGetRoadmapBriefQuery,
  useRecordRoadmapExternalBuildMutation,
} from "@api";
import { StartBuildDialog, designBuildBlock } from "@components/builder";
import { en } from "@constants";
import type { RoadmapBuildBrief, RoadmapItemDetail } from "@types";

import { motionTransition, useReducedMotionPreference } from "../../../motion";
import { useRoadmapJobTimer } from "../hooks/useRoadmapJobTimer";
import {
  briefFitsDeepLink,
  claudeCodeLink,
  downloadText,
  isPlausibleFolder,
  openDeepLink,
  promptFor,
  readClaudeCodeFolder,
  writeClaudeCodeFolder,
} from "../utils/claudeCode";
import { nameFor, usd } from "../utils/copy";

export type BuildMenuAction =
  | "buildHere"
  | "openInClaudeCode"
  | "copyBrief"
  | "downloadBrief"
  | "previewBrief"
  | "changeFolder";

/**
 * What Build ▾ offers this person on this device (§4.5b, D18, D21). Build here needs `startBuild`;
 * the brief needs `exportBrief`. On a phone, Open in Claude Code is replaced by a hint.
 */
export const buildMenuActions = (
  can: RoadmapItemDetail["can"],
  opts: { phone: boolean; hasFolder: boolean },
): BuildMenuAction[] => {
  const actions: BuildMenuAction[] = [];
  if (can?.startBuild) actions.push("buildHere");
  if (can?.exportBrief) {
    if (!opts.phone) actions.push("openInClaudeCode");
    actions.push("copyBrief", "downloadBrief", "previewBrief");
    if (!opts.phone && opts.hasFolder) actions.push("changeFolder");
  }
  return actions;
};

const externalBuildOf = (item: RoadmapItemDetail): { byUserId: number; at: string } | null => {
  const parts = item.statusParts as { externalBuild?: { byUserId: number; at: string } | null };
  return parts?.externalBuild ?? null;
};

/** Asks once for the local ally-platform folder; kept in this browser (§4.5b). */
const FolderDialog: React.FC<{
  open: boolean;
  initial: string;
  onClose: () => void;
  onSave: (folder: string) => void;
}> = ({ open, initial, onClose, onSave }) => {
  const copy = en.roadmapV2Tools.build;
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setValue(initial);
      setTouched(false);
    }
  }, [open, initial]);
  const valid = isPlausibleFolder(value);
  return (
    <Modal
      open={open}
      size="sm"
      modalHeading={copy.folderTitle}
      primaryButtonText={copy.folderSave}
      secondaryButtonText={copy.folderCancel}
      primaryButtonDisabled={!valid}
      onRequestClose={onClose}
      onRequestSubmit={() => {
        setTouched(true);
        if (valid) onSave(value.trim());
      }}
    >
      <p className="mb-4 text-sm text-typography-600">{copy.folderBody}</p>
      <TextInput
        id="roadmap-claude-code-folder"
        labelText={copy.folderLabel}
        placeholder={copy.folderPlaceholder}
        value={value}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setValue(event.target.value)}
        onBlur={() => setTouched(true)}
        invalid={touched && !valid}
        invalidText={copy.folderInvalid}
        autoComplete="off"
        spellCheck={false}
      />
    </Modal>
  );
};

/** Shows exactly what leaves the page (§4.5b). */
export const BriefPreviewDialog: React.FC<{
  brief: RoadmapBuildBrief | null;
  onClose: () => void;
  onCopy: () => void;
}> = ({ brief, onClose, onCopy }) => {
  const copy = en.roadmapV2Tools.build;
  return (
    <Modal
      open={!!brief}
      size="lg"
      modalHeading={brief ? copy.previewTitle(brief.code) : ""}
      primaryButtonText={copy.copyBrief}
      secondaryButtonText={copy.previewClose}
      onRequestClose={onClose}
      onRequestSubmit={onCopy}
    >
      {brief && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-sm text-typography-600">{copy.previewIntro}</p>
          <p className="m-0 text-xs tabular-nums text-typography-600">
            {copy.previewLength(brief.length ?? brief.markdown.length)}
          </p>
          <pre
            className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-border-light bg-neutral-50 p-3 text-xs text-typography-900"
            data-testid="roadmap-brief-preview"
          >
            {brief.markdown}
          </pre>
        </div>
      )}
    </Modal>
  );
};

interface BuildMenuProps {
  item: RoadmapItemDetail;
  phone?: boolean;
  fullWidth?: boolean;
}

/**
 * Build ▾ (§4.5b): Build here with the Builder agent, or Open in Claude Code with the build brief;
 * Copy, Download and Preview brief always alongside. Open in Claude Code asks for the folder once,
 * downloads a long brief and sends a short prompt instead, records "Brief sent to Claude Code", and
 * offers Copy brief if the app doesn't open. Build here hooks into Builder's own Start build dialog;
 * after a brief went to Claude Code it asks first. The kill switch disables Build here with its
 * reason (§4.7); Open in Claude Code still works.
 */
export const BuildMenu: React.FC<BuildMenuProps> = ({ item, phone = false, fullWidth }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2Tools.build;
  const [open, setOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderThen, setFolderThen] = useState<"open" | null>(null);
  const [preview, setPreview] = useState<RoadmapBuildBrief | null>(null);
  const [confirmBuildHere, setConfirmBuildHere] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [busy, setBusy] = useState<BuildMenuAction | null>(null);
  const [folder, setFolder] = useState<string | null>(() => readClaudeCodeFolder());
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cancelOpen = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelOpen.current?.(), []);

  const [fetchBrief] = useLazyGetRoadmapBriefQuery();
  const [recordSent] = useRecordRoadmapExternalBuildMutation();
  const canBuildHere = !!item.can?.startBuild;
  const { data: settings } = useGetBuilderSettingsQuery(undefined, { skip: !canBuildHere });
  const { data: session } = useGetBuilderSessionQuery(item.sessionId ?? "", {
    skip: !canBuildHere || !item.sessionId,
  });
  const buildsPaused = settings?.enabled === false;
  const external = externalBuildOf(item);

  const actions = buildMenuActions(item.can, { phone, hasFolder: !!folder });

  // P8 (§4.16): Ready to build in front of someone who can send the brief starts "brief to Claude
  // Code"; Open in Claude Code opening the app ends it. Once a brief went, it isn't timed again.
  const jobs = useRoadmapJobTimer();
  const canSendBrief = actions.includes("openInClaudeCode") && !external;
  useEffect(() => {
    if (canSendBrief) jobs.start("brief_to_claude_code", { itemId: item.code });
    // On arrival, per idea.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSendBrief, item.code]);

  // Close on outside click and Esc; focus returns to the button.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() =>
      menuRef.current
        ?.querySelector<HTMLButtonElement>("[role='menuitem']:not([disabled])")
        ?.focus(),
    );
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!actions.length) return null;

  const getBrief = async (): Promise<RoadmapBuildBrief | null> => {
    try {
      return await fetchBrief(item.code, true).unwrap();
    } catch {
      toast.error(copy.briefFailed);
      return null;
    }
  };

  const copyText = async (brief: RoadmapBuildBrief) => {
    try {
      await navigator.clipboard.writeText(brief.markdown);
      toast.success(copy.copied);
    } catch {
      toast.error(copy.copyFailed);
    }
  };

  const sendToClaudeCode = async (target: string) => {
    const brief = await getBrief();
    if (!brief) return;
    if (!briefFitsDeepLink(brief)) {
      downloadText(brief.filename, brief.markdown);
      toast.message(copy.longBrief(brief.filename));
    }
    cancelOpen.current?.();
    jobs.complete("brief_to_claude_code", { itemId: item.code });
    cancelOpen.current = openDeepLink(claudeCodeLink(promptFor(brief), target), () =>
      toast(copy.didNotOpen, {
        action: { label: copy.copyInstead, onClick: () => void copyText(brief) },
        duration: 10_000,
      }),
    );
    try {
      await recordSent(item.code).unwrap();
    } catch {
      toast.error(copy.sentFailed);
    }
  };

  const run = async (action: BuildMenuAction) => {
    setOpen(false);
    setBusy(action);
    try {
      switch (action) {
        case "buildHere":
          if (external) setConfirmBuildHere(true);
          else setStartOpen(true);
          break;
        case "openInClaudeCode":
          if (folder) await sendToClaudeCode(folder);
          else {
            setFolderThen("open");
            setFolderOpen(true);
          }
          break;
        case "changeFolder":
          setFolderThen(null);
          setFolderOpen(true);
          break;
        case "copyBrief": {
          const brief = await getBrief();
          if (brief) await copyText(brief);
          break;
        }
        case "downloadBrief": {
          const brief = await getBrief();
          if (brief) {
            downloadText(brief.filename, brief.markdown);
            toast.success(copy.downloaded(brief.filename));
          }
          break;
        }
        case "previewBrief": {
          const brief = await getBrief();
          if (brief) setPreview(brief);
          break;
        }
        default:
          break;
      }
    } finally {
      setBusy(null);
    }
  };

  const budget = item.spend?.ceilingUsd ? usd(item.spend.ceilingUsd) : null;
  const labels: Record<BuildMenuAction, { label: string; help?: string }> = {
    buildHere: {
      label: copy.buildHere,
      help: buildsPaused
        ? copy.buildPaused
        : budget
          ? copy.buildHereHelp(budget)
          : copy.buildHereHelpNoBudget,
    },
    openInClaudeCode: { label: copy.openInClaudeCode, help: copy.openInClaudeCodeHelp },
    copyBrief: { label: copy.copyBrief },
    downloadBrief: { label: copy.downloadBrief },
    previewBrief: { label: copy.previewBrief },
    changeFolder: { label: copy.changeFolder, help: folder ?? undefined },
  };
  const disabled = (action: BuildMenuAction) =>
    busy !== null || (action === "buildHere" && (buildsPaused || !session));

  const onMenuKey = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not([disabled])") ??
        [],
    );
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    next?.focus();
  };

  const startDialog =
    session && item.sessionId ? (
      <StartBuildDialog
        isOpen={startOpen}
        onClose={() => setStartOpen(false)}
        sessionId={item.sessionId}
        currentRepos={
          session.repos?.length
            ? session.repos
            : (session.prd?.technicalPlan?.repos ?? [])
                .map(plan => plan.repo)
                .filter((repo): repo is string => Boolean(repo))
        }
        readiness={session.readiness}
        designBlock={designBuildBlock(session.prd?.technicalDesign, session.designReadiness)}
        onStarted={() => setStartOpen(false)}
      />
    ) : null;

  return (
    <div ref={menuRef} className={`relative ${fullWidth ? "w-full" : "inline-flex"} flex-col`}>
      <Button
        ref={buttonRef}
        kind="primary"
        size={fullWidth ? "lg" : "md"}
        className={fullWidth ? "w-full max-w-none" : ""}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        renderIcon={() => <ArrowDown size={16} aria-hidden />}
      >
        {copy.button}
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label={copy.menu}
            onKeyDown={onMenuKey}
            className={`absolute z-[40] mt-1 flex w-72 flex-col rounded border border-border-light bg-white py-1 shadow-lg ${
              phone ? "bottom-full left-0 right-0 mb-1 w-auto" : "right-0 top-full"
            }`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransition("fast", "productive", reduced)}
          >
            {actions.map(action => (
              <button
                key={action}
                type="button"
                role="menuitem"
                disabled={disabled(action)}
                onClick={() => void run(action)}
                className="flex min-h-11 flex-col items-start px-4 py-2 text-left text-sm text-typography-900 hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{labels[action].label}</span>
                {labels[action].help && (
                  <span className="text-xs text-typography-600">{labels[action].help}</span>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      {phone && item.can?.exportBrief && (
        <p className="m-0 mt-2 text-xs text-typography-600">{copy.phoneHint}</p>
      )}

      <FolderDialog
        open={folderOpen}
        initial={folder ?? ""}
        onClose={() => {
          setFolderOpen(false);
          setFolderThen(null);
        }}
        onSave={next => {
          writeClaudeCodeFolder(next);
          setFolder(next);
          setFolderOpen(false);
          if (folderThen === "open") void sendToClaudeCode(next);
          setFolderThen(null);
        }}
      />
      <BriefPreviewDialog
        brief={preview}
        onClose={() => setPreview(null)}
        onCopy={() => preview && void copyText(preview)}
      />
      <Modal
        open={confirmBuildHere}
        size="sm"
        modalHeading={copy.buildHereConfirmTitle}
        primaryButtonText={copy.buildHereConfirm}
        secondaryButtonText={en.roadmapV2Tools.ship.cancel}
        onRequestClose={() => setConfirmBuildHere(false)}
        onRequestSubmit={() => {
          setConfirmBuildHere(false);
          setStartOpen(true);
        }}
      >
        <p className="text-sm text-typography-900">
          {copy.buildHereConfirmBody(
            (external && nameFor(external.byUserId, item.people, item.lead)) ||
              en.roadmapV2.idea.unknownPerson,
          )}
        </p>
      </Modal>
      {startDialog}
    </div>
  );
};
