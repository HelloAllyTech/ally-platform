import React from "react";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  PauseCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { useGetContextSourceQuery, useGetContextSourcesQuery } from "@api";
import { en } from "@constants";
import { ContextCollection, ContextSource } from "@types";

import {
  errorReason,
  formatCost,
  keptCount,
  lowConfidenceCount,
  nounsFor,
  yieldSentence,
} from "./contextLibraryFormat";
import { InlineError, LoadingRows, StatusWord } from "./ContextLibraryUi";
import { Sheet } from "../Builder/room/Sheet";

const STATUS_ICON: Record<
  string,
  { icon: LucideIcon; tone: "muted" | "warning" | "good" | "info" }
> = {
  queued: { icon: Clock, tone: "muted" },
  extracting: { icon: Layers, tone: "info" },
  consolidating: { icon: Layers, tone: "info" },
  paused: { icon: PauseCircle, tone: "muted" },
  complete: { icon: CheckCircle2, tone: "good" },
  failed: { icon: XCircle, tone: "warning" },
  cancelled: { icon: XCircle, tone: "muted" },
  archived: { icon: AlertTriangle, tone: "muted" },
};

export const SourceStatus: React.FC<{ status: string }> = ({ status }) => {
  const spec = STATUS_ICON[status] ?? STATUS_ICON.queued;
  return (
    <StatusWord
      icon={spec.icon}
      tone={spec.tone}
      label={en.contextLibrary.documentsView.statuses[status] ?? status}
    />
  );
};

const formatDate = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

interface DocumentsViewProps {
  collectionId?: string;
  onOpen: (id: string) => void;
}

/** Every document added to the collection (or to any, under All), newest first. */
export const DocumentsView: React.FC<DocumentsViewProps> = ({ collectionId, onOpen }) => {
  const strings = en.contextLibrary.documentsView;
  const { data, isLoading, isError, error, refetch } = useGetContextSourcesQuery(collectionId);

  if (isLoading) return <LoadingRows />;
  if (isError) {
    return (
      <InlineError
        what={en.contextLibrary.documents.toLowerCase()}
        reason={errorReason(error)}
        onRetry={() => void refetch()}
      />
    );
  }
  if (!data?.length) return <p className="py-8 text-sm text-typography-600">{strings.empty}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" data-testid="cl-documents-table">
        <thead className="border-b border-border-light text-xs text-typography-600">
          <tr>
            <th className="py-2 pr-3 font-medium">{strings.columns.title}</th>
            <th className="py-2 pr-3 font-medium">{strings.columns.version}</th>
            <th className="py-2 pr-3 font-medium">{strings.columns.added}</th>
            <th className="py-2 pr-3 text-right font-medium">{strings.columns.kept}</th>
            <th className="py-2 pr-3 text-right font-medium">{strings.columns.low}</th>
            <th className="py-2 pr-3 text-right font-medium">{strings.columns.cost}</th>
            <th className="py-2 font-medium">{strings.columns.status}</th>
          </tr>
        </thead>
        <tbody>
          {data.map(source => (
            <tr
              key={source.id}
              className="cursor-pointer border-b border-border-light hover:bg-neutral-50"
              onClick={() => onOpen(source.id)}
            >
              <td className="max-w-[360px] py-2 pr-3">
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    onOpen(source.id);
                  }}
                  className="truncate text-left font-medium text-typography-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                >
                  {source.title}
                </button>
              </td>
              <td className="py-2 pr-3 text-typography-600">
                {[source.docVersion, source.year].filter(Boolean).join(", ")}
              </td>
              <td className="whitespace-nowrap py-2 pr-3 text-typography-600">
                {formatDate(source.createdAt)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{keptCount(source.yield)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {lowConfidenceCount(source.yield)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatCost(source.costUsd)}</td>
              <td className="py-2">
                <SourceStatus status={source.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** The report for one document: the overview, then each collection's yield as sentences. */
export const YieldReport: React.FC<{ source: ContextSource; collections: ContextCollection[] }> = ({
  source,
  collections,
}) => {
  const strings = en.contextLibrary.documentsView;
  const entries = Object.entries(source.yield ?? {});
  if (!entries.length) return <p className="text-sm text-typography-600">{strings.notFinished}</p>;
  return (
    <div className="space-y-3">
      {entries.map(([collectionId, y]) => {
        const collection = collections.find(c => c.id === collectionId);
        return (
          <section key={collectionId}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-typography-600">
              {strings.yieldHeading(collection?.name ?? collectionId)}
            </h3>
            <p className="text-sm" data-testid="cl-yield-sentence">
              {yieldSentence(y, { parts: source.segmentCount, ...nounsFor(collection) })}
            </p>
          </section>
        );
      })}
    </div>
  );
};

export const DocumentSheet: React.FC<{
  id: string;
  collections: ContextCollection[];
  onClose: () => void;
}> = ({ id, collections, onClose }) => {
  const strings = en.contextLibrary.documentsView;
  const { data, isLoading, isError, error, refetch } = useGetContextSourceQuery(id);
  return (
    <Sheet title={data?.title ?? en.contextLibrary.documents} placement="side" onClose={onClose}>
      {isLoading ? (
        <LoadingRows rows={3} />
      ) : isError || !data ? (
        <InlineError
          what={en.contextLibrary.documents.toLowerCase()}
          reason={errorReason(error)}
          onRetry={() => void refetch()}
        />
      ) : (
        <div className="space-y-6" data-testid="cl-document-sheet">
          <div className="flex flex-wrap items-center gap-3 text-xs text-typography-600">
            {[data.docVersion, data.year].filter(Boolean).join(", ")}
            <SourceStatus status={data.status} />
            <span>{strings.cost(formatCost(data.costUsd))}</span>
          </div>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-typography-600">
              {strings.overview}
            </h3>
            <p className="text-sm">{data.overview || strings.noOverview}</p>
          </section>
          <YieldReport source={data} collections={collections} />
        </div>
      )}
    </Sheet>
  );
};
