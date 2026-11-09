import React, { useRef, useState } from "react";

import { Download, FileUp } from "lucide-react";
import { toast } from "sonner";

import { useBulkContextChunksMutation, useLazyGetContextTemplateQuery } from "@api";
import { en } from "@constants";
import { ContextBulkResult, ContextCollection } from "@types";

import { bulkSummary, errorReason, takesEntries } from "./contextLibraryFormat";
import { useContextLibraryScope } from "./contextLibraryScope";
import { Sheet } from "../Builder/room/Sheet";

const isBulkFile = (name: string) => /\.(csv|json)$/i.test(name);

/**
 * Bulk upload: template → file → dry run (to create, to update, rejected with row and reason)
 * → Apply. The same file is sent twice; nothing is written until Apply.
 */
export const BulkUpload: React.FC<{
  collections: ContextCollection[];
  initialCollectionId?: string;
  onClose: () => void;
}> = ({ collections, initialCollectionId, onClose }) => {
  const strings = en.contextLibrary.bulk;
  const targets = collections.filter(takesEntries);
  const [collectionId, setCollectionId] = useState(
    targets.find(c => c.id === initialCollectionId)?.id ?? targets[0]?.id ?? "",
  );
  const collection = targets.find(c => c.id === collectionId);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ContextBulkResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { tenantId } = useContextLibraryScope();
  const [fetchTemplate, templateState] = useLazyGetContextTemplateQuery();
  const [sendBulk, bulkState] = useBulkContextChunksMutation();

  const download = async () => {
    if (!collection) return;
    try {
      const csv = await fetchTemplate({ collectionId: collection.id, tenantId }).unwrap();
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${collection.id}-template.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(strings.downloadFailed);
    }
  };

  const dryRun = async (chosen: File) => {
    if (!collection) return;
    if (!isBulkFile(chosen.name)) {
      setProblem(strings.wrongType);
      return;
    }
    setFile(chosen);
    setResult(null);
    setProblem(null);
    try {
      setResult(
        await sendBulk({
          file: chosen,
          collectionId: collection.id,
          apply: false,
          tenantId,
        }).unwrap(),
      );
    } catch (error) {
      setProblem(errorReason(error) || strings.failed);
    }
  };

  const apply = async () => {
    if (!collection || !file) return;
    try {
      const applied = await sendBulk({
        file,
        collectionId: collection.id,
        apply: true,
        tenantId,
      }).unwrap();
      toast.success(bulkSummary(applied, collection).toast);
      onClose();
    } catch (error) {
      setProblem(errorReason(error) || strings.failed);
    }
  };

  const summary = result && collection ? bulkSummary(result, collection) : null;

  return (
    <Sheet title={strings.title} placement="side" onClose={onClose}>
      <div className="space-y-6" data-testid="cl-bulk">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-typography-700">{strings.collection}</span>
          <select
            value={collectionId}
            onChange={event => {
              setCollectionId(event.target.value);
              setResult(null);
              setFile(null);
            }}
            className="h-10 w-full rounded border border-border-light bg-white px-2 text-sm"
          >
            {targets.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">1. {strings.step1}</h3>
          <p className="text-xs text-typography-600">{strings.step1Help}</p>
          <button
            type="button"
            onClick={() => void download()}
            disabled={!collection || templateState.isFetching}
            className="inline-flex items-center gap-2 rounded border border-border-light px-3 py-2 text-sm hover:bg-neutral-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            <Download size={14} aria-hidden /> {strings.download}
          </button>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">2. {strings.step2}</h3>
          <div
            onDragOver={event => {
              event.preventDefault();
              event.stopPropagation();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => {
              event.preventDefault();
              event.stopPropagation();
              setDragging(false);
              const dropped = event.dataTransfer.files?.[0];
              if (dropped) void dryRun(dropped);
            }}
            className={`flex flex-col items-center gap-2 rounded border-2 border-dashed px-4 py-6 text-sm ${
              dragging ? "border-primary-500 bg-primary-50" : "border-border-light"
            }`}
          >
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
            >
              <FileUp size={14} aria-hidden /> {strings.choose}
            </button>
            <span className="text-xs text-typography-600">{strings.dropHint}</span>
            {file && <span className="text-xs text-typography-700">{file.name}</span>}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="hidden"
              data-testid="cl-bulk-input"
              onChange={event => {
                const chosen = event.target.files?.[0];
                event.target.value = "";
                if (chosen) void dryRun(chosen);
              }}
            />
          </div>
        </section>

        {bulkState.isLoading && !result && (
          <p role="status" className="text-sm text-typography-600">
            {strings.checking}
          </p>
        )}
        {problem && (
          <p role="alert" className="text-sm text-red-700">
            {problem}
          </p>
        )}

        {result && summary && (
          <section className="space-y-3" data-testid="cl-bulk-dry-run">
            <p className="text-sm font-medium" role="status">
              {summary.line}
            </p>
            {result.rejected.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs text-typography-600">{strings.rejectedHeading}</h4>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-typography-600">
                    <tr>
                      <th className="w-16 py-1 font-medium">{strings.row}</th>
                      <th className="py-1 font-medium">{strings.reason}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rejected.map((r, i) => (
                      <tr key={`${r.row}-${i}`} className="border-t border-border-light">
                        <td className="py-1 tabular-nums">{r.row}</td>
                        <td className="py-1">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded px-3 py-2 text-sm hover:bg-neutral-100"
              >
                {strings.chooseAnother}
              </button>
              <button
                type="button"
                onClick={() => void apply()}
                disabled={!summary.canApply || bulkState.isLoading}
                className="rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
              >
                {bulkState.isLoading
                  ? strings.applying
                  : summary.canApply
                    ? strings.apply
                    : strings.nothingToApply}
              </button>
            </div>
          </section>
        )}
      </div>
    </Sheet>
  );
};
