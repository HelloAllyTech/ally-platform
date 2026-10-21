import { FC } from "react";

import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { Plus, Trash, TooltipIcon } from "@assets";
import {
  MAX_BUCKET_SORT_BUCKETS,
  MAX_BUCKET_SORT_DESCRIPTION,
  MAX_BUCKET_SORT_EXPLANATION,
  MAX_BUCKET_SORT_ITEM_TEXT,
  MAX_BUCKET_SORT_ITEMS,
  MAX_BUCKET_SORT_LABEL,
  MIN_BUCKET_SORT_BUCKETS,
  MIN_BUCKET_SORT_ITEMS,
} from "@constants";
import { TrackFormValues, TrackItemType } from "@types";

import { ItemEditorFrame } from "./ItemEditorFrame";

interface BucketSortItemEditorProps {
  sectionIndex: number;
  itemIndex: number;
  onDelete: () => void;
}

const newId = () => crypto.randomUUID();
const inputClass =
  "w-full border border-border-light rounded-md px-3 py-2 text-sm outline-none focus:border-primary-400";

export const BucketSortItemEditor: FC<BucketSortItemEditorProps> = ({
  sectionIndex,
  itemIndex,
  onDelete,
}) => {
  const { control, getValues, setValue } = useFormContext<TrackFormValues>();
  const base = `sections.${sectionIndex}.items.${itemIndex}.bucketSort` as const;

  const buckets = useFieldArray({ control, name: `${base}.buckets`, keyName: "fieldId" });
  const items = useFieldArray({ control, name: `${base}.items`, keyName: "fieldId" });
  const watchedBuckets = useWatch({ control, name: `${base}.buckets` }) || [];

  const removeBucket = (index: number) => {
    const removedId = getValues(`${base}.buckets.${index}.id`);
    buckets.remove(index);
    // An item left pointing at a deleted bucket would silently have no home.
    (getValues(`${base}.items`) ?? []).forEach((item, itemPos) => {
      if (item.bucketId === removedId) {
        setValue(`${base}.items.${itemPos}.bucketId`, "", { shouldDirty: true });
      }
    });
  };

  return (
    <ItemEditorFrame
      sectionIndex={sectionIndex}
      itemIndex={itemIndex}
      type={TrackItemType.BUCKET_SORT}
      onDelete={onDelete}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-typography-800">Intro (optional)</label>
          <Controller
            control={control}
            name={`${base}.intro`}
            render={({ field }) => (
              <textarea
                {...field}
                value={field.value ?? ""}
                rows={2}
                placeholder="e.g. Before we start, sort these into the group you think they belong in."
                className={inputClass}
              />
            )}
          />
        </div>

        <section className="flex flex-col gap-3">
          <label className="text-sm font-medium text-typography-800">
            Buckets ({buckets.fields.length}/{MAX_BUCKET_SORT_BUCKETS})
          </label>
          {buckets.fields.map((field, index) => (
            <div
              key={field.fieldId}
              className="border border-border-light rounded-md p-3 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <Controller
                  control={control}
                  name={`${base}.buckets.${index}.label`}
                  render={({ field: f }) => (
                    <input
                      {...f}
                      value={f.value ?? ""}
                      maxLength={MAX_BUCKET_SORT_LABEL}
                      placeholder={`Bucket ${index + 1} name`}
                      aria-label={`Bucket ${index + 1} name`}
                      className={inputClass}
                    />
                  )}
                />
                {buckets.fields.length > MIN_BUCKET_SORT_BUCKETS && (
                  <button
                    type="button"
                    onClick={() => removeBucket(index)}
                    className="text-destructive-500 hover:text-destructive-600 max-lg:p-2.5 max-lg:-m-2.5"
                    aria-label={`Remove bucket ${index + 1}`}
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Controller
                control={control}
                name={`${base}.buckets.${index}.description`}
                render={({ field: f }) => (
                  <input
                    {...f}
                    value={f.value ?? ""}
                    maxLength={MAX_BUCKET_SORT_DESCRIPTION}
                    placeholder="Hint shown under the name (optional)"
                    aria-label={`Bucket ${index + 1} hint`}
                    className={inputClass}
                  />
                )}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => buckets.append({ id: newId(), label: "", description: "" })}
            disabled={buckets.fields.length >= MAX_BUCKET_SORT_BUCKETS}
            className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 disabled:opacity-40 w-fit"
          >
            <Plus className="w-4 h-4" />
            Add bucket
          </button>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-typography-800">
              Items to sort ({items.fields.length}/{MAX_BUCKET_SORT_ITEMS})
            </label>
            <Tooltip
              label="The learner sees each item's verdict right after placing it, plus the correct bucket and your explanation. Write the explanation for the wrong guess you expect, not just the right answer."
              align="top"
            >
              <button type="button" className="cursor-pointer inline-flex items-center">
                <TooltipIcon />
              </button>
            </Tooltip>
          </div>
          {items.fields.map((field, index) => (
            <div
              key={field.fieldId}
              className="border border-border-light rounded-md p-3 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <Controller
                  control={control}
                  name={`${base}.items.${index}.text`}
                  render={({ field: f }) => (
                    <input
                      {...f}
                      value={f.value ?? ""}
                      maxLength={MAX_BUCKET_SORT_ITEM_TEXT}
                      placeholder={`Item ${index + 1}`}
                      aria-label={`Item ${index + 1} text`}
                      className={inputClass}
                    />
                  )}
                />
                {items.fields.length > MIN_BUCKET_SORT_ITEMS && (
                  <button
                    type="button"
                    onClick={() => items.remove(index)}
                    className="text-destructive-500 hover:text-destructive-600 max-lg:p-2.5 max-lg:-m-2.5"
                    aria-label={`Remove item ${index + 1}`}
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Controller
                control={control}
                name={`${base}.items.${index}.bucketId`}
                render={({ field: f }) => (
                  <select
                    {...f}
                    value={f.value ?? ""}
                    aria-label={`Item ${index + 1} belongs in`}
                    className={inputClass}
                  >
                    <option value="">Belongs in…</option>
                    {watchedBuckets.map((bucket, bucketIndex) => (
                      <option key={bucket.id} value={bucket.id}>
                        {bucket.label.trim() || `Bucket ${bucketIndex + 1}`}
                      </option>
                    ))}
                  </select>
                )}
              />
              <Controller
                control={control}
                name={`${base}.items.${index}.explanation`}
                render={({ field: f }) => (
                  <textarea
                    {...f}
                    value={f.value ?? ""}
                    rows={2}
                    maxLength={MAX_BUCKET_SORT_EXPLANATION}
                    placeholder="Why it belongs there (shown as feedback)"
                    aria-label={`Item ${index + 1} explanation`}
                    className={inputClass}
                  />
                )}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              items.append({
                id: newId(),
                text: "",
                bucketId: watchedBuckets[0]?.id ?? "",
                explanation: "",
              })
            }
            disabled={items.fields.length >= MAX_BUCKET_SORT_ITEMS}
            className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 disabled:opacity-40 w-fit"
          >
            <Plus className="w-4 h-4" />
            Add item
          </button>
        </section>
      </div>
    </ItemEditorFrame>
  );
};
