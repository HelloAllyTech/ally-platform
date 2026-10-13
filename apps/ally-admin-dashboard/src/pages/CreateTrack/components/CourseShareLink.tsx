import { FC } from "react";

import { toast } from "sonner";

import { Button } from "@components";
import { buildPublicLink } from "@components/organization-access-details/text-helpline/helpers";
import { ButtonVariant } from "@components/types";
import { getCourseSharePath } from "@constants";

export type CourseShareLinkState =
  /** Brand-new course: there is no id, so there is no link yet. */
  | "unsaved"
  /** Saved, but a draft — the link 404s until the course is published. */
  | "draft"
  /** Public view was just switched on and not saved yet. */
  | "pending"
  | "live";

const NOTE: Record<Exclude<CourseShareLinkState, "unsaved">, string> = {
  draft: "The link starts working once you publish the course.",
  pending: "Save your changes to turn the link on.",
  live: "Visitors see the outline and log in to start. Only learners this course is assigned to can take it.",
};

interface CourseShareLinkProps {
  trackId: string | null;
  state: CourseShareLinkState;
}

/** The course's public URL, with Copy and Open. Shown only while public view is on. */
export const CourseShareLink: FC<CourseShareLinkProps> = ({ trackId, state }) => {
  if (!trackId || state === "unsaved") {
    return (
      <p className="text-xs text-typography-500" data-testid="course-share-link-unsaved">
        Save the course to get its link.
      </p>
    );
  }

  const url = buildPublicLink(getCourseSharePath(trackId));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      // No clipboard permission, or an insecure context where `navigator.clipboard` is undefined.
      toast.error("Couldn't copy the link. Select it and copy it yourself.");
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="course-share-link">
      <span className="text-sm font-medium text-typography-800">Course link</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          readOnly
          value={url}
          aria-label="Course link"
          onFocus={event => event.currentTarget.select()}
          className="flex-1 min-w-[16rem] border border-border-light rounded-md px-3 py-2 text-sm font-mono text-typography-800 outline-none focus:border-primary-400"
        />
        <Button
          variant={ButtonVariant.SECONDARY}
          className="!h-9 text-sm"
          onClick={() => void handleCopy()}
        >
          Copy link
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center h-9 px-3 text-sm text-primary-500 hover:underline"
        >
          Open
        </a>
      </div>
      <span className="text-xs text-typography-500">{NOTE[state]}</span>
    </div>
  );
};
