import React, { useCallback, useRef, useState } from "react";

import { ArrowSolid, BackArrowIcon } from "@icons";

import { en } from "@constants";

import { Drawer } from "./Drawer";
import { DEFAULT_TONE, Motif, PALETTE, TONES } from "./Motifs";

type UseCase = (typeof en.assistantsShell.login.useCases)[number];

const toneFor = (id: string) => TONES[id] ?? DEFAULT_TONE;

interface UseCasesProps {
  /** Called by the panel's last button: close it and take the visitor to the email field. */
  onStart?: () => void;
}

/**
 * A short row of what organisations use Ally chatbots for: swipe or scroll through the colour
 * cards (the next one peeks in), open one for its detail in a side panel. Purely informational,
 * so it needs no data and never gets in the way of signing in.
 */
export const UseCases: React.FC<UseCasesProps> = ({ onStart }) => {
  const copy = en.assistantsShell.login;
  const cases = copy.useCases;
  const [openId, setOpenId] = useState<string | null>(null);
  const closePanel = useCallback(() => setOpenId(null), []);
  const track = useRef<HTMLDivElement>(null);
  const open = cases.find(c => c.id === openId) ?? null;

  if (!cases.length) return null;

  const scrollBy = (direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section aria-label={copy.useCasesHeading} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[#1E1B4B]">{copy.useCasesHeading}</h2>
        <div className="hidden gap-2 sm:flex">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label={copy.previousCases}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-[#1E1B4B]/25 hover:bg-[#5B4BFF] hover:text-[#FFFFFF] hover:border-[#5B4BFF]"
          >
            <BackArrowIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label={copy.nextCases}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-[#1E1B4B]/25 hover:bg-[#5B4BFF] hover:text-[#FFFFFF] hover:border-[#5B4BFF]"
          >
            <ArrowSolid className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div
        ref={track}
        data-testid="use-cases-track"
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {cases.map(item => {
          const tone = toneFor(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setOpenId(item.id)}
              style={{ background: tone.bg, color: tone.fg }}
              className="group flex min-h-[230px] w-[78%] shrink-0 cursor-pointer snap-start flex-col items-start gap-2 p-5 text-left transition-transform duration-200 hover:-translate-y-0.5 sm:w-[calc(50%-6px)]"
            >
              <Motif
                id={item.id}
                className="mb-3 h-20 w-32 transition-transform duration-300 group-hover:scale-105"
              />
              <span className="font-secondary text-xl font-semibold leading-tight tracking-[-0.02em]">
                {item.title}
              </span>
              <span className="text-sm leading-relaxed" style={{ color: tone.soft }}>
                {item.blurb}
              </span>
            </button>
          );
        })}
      </div>
      <Drawer
        open={open !== null}
        title={open?.title ?? ""}
        onClose={closePanel}
        testId="use-case-drawer"
        tone={open ? toneFor(open.id) : undefined}
      >
        {open && <UseCaseDetail item={open} onStart={onStart} onClose={closePanel} />}
      </Drawer>
    </section>
  );
};

const UseCaseDetail: React.FC<{ item: UseCase; onStart?: () => void; onClose: () => void }> = ({
  item,
  onStart,
  onClose,
}) => {
  const copy = en.assistantsShell.login;
  const tone = toneFor(item.id);
  return (
    <div className="flex flex-col">
      <div
        className="flex flex-col gap-6 px-6 pb-9 pt-2"
        style={{ background: tone.bg, color: tone.fg }}
      >
        <Motif id={item.id} className="h-36 w-56" />
        <p className="font-secondary text-2xl font-semibold leading-snug tracking-[-0.02em]">
          {item.detail.intro}
        </p>
      </div>
      <div className="flex flex-col gap-8 px-6 py-8">
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold tracking-wide text-[#1E1B4B]/60">
            {copy.whatItDoes}
          </h3>
          <ol className="flex flex-col gap-4">
            {item.detail.points.map((point, index) => (
              <li key={point} className="flex items-baseline gap-4">
                <span
                  className="font-secondary text-3xl font-semibold leading-none tracking-[-0.03em]"
                  style={{ color: PALETTE.accent }}
                  aria-hidden="true"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-lg leading-snug text-[#1E1B4B]">{point}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold tracking-wide text-[#1E1B4B]/60">
            {copy.exampleHeading}
          </h3>
          <div className="flex flex-col gap-3 bg-[#1E1B4B]/[0.05] p-4">
            <p
              className="max-w-[85%] self-end rounded-2xl rounded-br-sm px-4 py-3 text-base"
              style={{ background: tone.bg, color: tone.fg }}
            >
              {item.detail.example.question}
            </p>
            <p className="max-w-[85%] self-start rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-base text-[#1E1B4B]">
              {item.detail.example.answer}
            </p>
          </div>
          <p className="text-xs text-[#1E1B4B]/50">{copy.exampleNote}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            onClose();
            onStart?.();
          }}
          style={{ background: tone.bg, color: tone.fg }}
          className="h-14 w-full cursor-pointer text-lg font-semibold hover:opacity-90"
        >
          {copy.startBuilding}
        </button>
      </div>
    </div>
  );
};
