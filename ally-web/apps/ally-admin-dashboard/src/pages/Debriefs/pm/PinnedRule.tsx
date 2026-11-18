import React, { useRef, useState } from "react";

import { toast } from "sonner";

import { Button, TextArea } from "@ally-ui-mono/ui-shared";
import { useProposePinnedRuleMutation } from "@api";
import { en } from "@constants";
import { PinnedRuleSegment } from "@types";
import { getErrorMessage } from "@utils";

import { passageProblem } from "./pinnedRuleButtons";

const RULE_BOX =
  "max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-sm bg-white px-4 py-3 text-[13px] leading-relaxed";

/** The rule's text, the proposed wording highlighted. */
const Segments: React.FC<{ segments: PinnedRuleSegment[] }> = ({ segments }) => (
  <>
    {segments.map((s, i) =>
      s.changed ? (
        <mark key={i} className="bg-success-50 text-success-600" data-testid="pinned-rule-change">
          {s.text}
        </mark>
      ) : (
        <React.Fragment key={i}>{s.text}</React.Fragment>
      ),
    )}
  </>
);

/**
 * The whole rule on a pinned-rule item: below the diff and collapsed as "Read the whole rule"
 * for a change (as it would read after it, the new wording highlighted); open, with nothing
 * highlighted, for a first version.
 */
export const PinnedRuleText: React.FC<{
  name: string;
  version: number | null;
  segments: PinnedRuleSegment[];
  firstVersion: boolean;
}> = ({ name, version, segments, firstVersion }) => {
  const p = en.debriefs.pmPage.pinnedRule;
  if (firstVersion) {
    return (
      <section className="flex flex-col gap-1.5" data-testid="pinned-rule-text">
        <div className="text-xs text-neutral-600">{p.asItReads(name, version)}</div>
        <div className={RULE_BOX}>
          <Segments segments={segments} />
        </div>
      </section>
    );
  }
  return (
    <details className="rounded-sm bg-white text-sm" data-testid="pinned-rule-text">
      <summary className="cursor-pointer px-4 py-2.5 text-primary-500">{p.readWhole}</summary>
      <div className="px-4 pb-1 text-xs text-neutral-600">{p.afterChange}</div>
      <div className={RULE_BOX}>
        <Segments segments={segments} />
      </div>
    </details>
  );
};

/**
 * "Ask for a change": select a passage in the rule (or paste it), write the replacement and
 * why. Sent to `pinned-rules/proposals`; it then waits in PM agent › Ideas for the clinical
 * advisor or the owner.
 */
export const AskForChange: React.FC<{
  code: string;
  name: string;
  text: string;
  /** Other proposals on this rule still waiting. */
  otherOpen?: number;
  onClose: () => void;
}> = ({ code, name, text, otherOpen = 0, onClose }) => {
  const f = en.debriefs.pmPage.pinnedRule.form;
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [why, setWhy] = useState("");
  const [tried, setTried] = useState(false);
  const [propose, { isLoading }] = useProposePinnedRuleMutation();
  const ruleRef = useRef<HTMLDivElement>(null);

  const takeSelection = () => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || !ruleRef.current) return;
    const node = sel.anchorNode;
    if (!node || !ruleRef.current.contains(node)) return;
    const picked = sel.toString();
    if (picked.trim()) {
      setFind(picked);
      if (!replace) setReplace(picked);
    }
  };

  const problem = passageProblem(text, find);
  const passageError = tried && problem ? f[problem] : null;
  const sameError = tried && !problem && find === replace ? f.same : null;
  const whyError = tried && !why.trim() ? f.noWhy : null;

  const send = async () => {
    setTried(true);
    if (problem || find === replace || !why.trim()) return;
    try {
      await propose({ promptCode: code, find, replace, why: why.trim() }).unwrap();
      toast.success(f.sent);
      onClose();
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.pmAgent.actionFailed));
    }
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-sm border border-primary-200 bg-white px-4 py-4"
      data-testid="pinned-rule-ask"
      aria-label={f.title(name)}
    >
      <h3 className="text-base font-semibold">{f.title(name)}</h3>
      <p className="text-sm text-neutral-700">{f.help}</p>
      {otherOpen > 0 && <p className="text-sm text-[#8A3800]">{f.otherOpen(otherOpen)}</p>}
      <div className="text-xs text-neutral-600">{f.ruleLabel}</div>
      <div
        ref={ruleRef}
        className={`${RULE_BOX} border border-neutral-100 bg-neutral-50`}
        onMouseUp={takeSelection}
        onKeyUp={takeSelection}
        data-testid="pinned-rule-ask-text"
      >
        {text}
      </div>
      <TextArea
        id={`pinned-find-${code}`}
        labelText={f.passage}
        helperText={f.passageHelp}
        rows={3}
        value={find}
        invalid={!!passageError}
        invalidText={passageError ?? undefined}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFind(e.target.value)}
      />
      <TextArea
        id={`pinned-replace-${code}`}
        labelText={f.replace}
        rows={3}
        value={replace}
        invalid={!!sameError}
        invalidText={sameError ?? undefined}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReplace(e.target.value)}
      />
      <TextArea
        id={`pinned-why-${code}`}
        labelText={f.why}
        helperText={f.whyHelp}
        rows={2}
        value={why}
        invalid={!!whyError}
        invalidText={whyError ?? undefined}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setWhy(e.target.value)}
      />
      <div className="flex gap-2">
        <Button kind="primary" size="md" disabled={isLoading} onClick={() => void send()}>
          {f.submit}
        </Button>
        <Button kind="ghost" size="md" onClick={onClose}>
          {f.cancel}
        </Button>
      </div>
    </section>
  );
};
