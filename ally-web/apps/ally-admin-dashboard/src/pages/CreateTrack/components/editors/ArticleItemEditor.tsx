import { FC, useMemo, useState } from "react";

import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { TextArea, Tooltip, htmlToPlainText, escapeHtml } from "@ally-ui-mono/ui-shared";
import { TooltipIcon, Trash } from "@assets";
import {
  courseSlotPrefix,
  LazyGenerateImageModal,
  toContextText,
  useCourseImage,
  useImageStudioEnabled,
} from "@components/image-studio";
import { GenerateImageAtCursor, RichTextEditor } from "@components/rich-text-editor";
import { MAX_ARTICLE_QUESTIONS, MAX_ARTICLE_RESOURCES } from "@constants";
import {
  ArticleCover,
  ArticleExperience,
  ArticleResource,
  McqSingleQuestion,
  TrackFormValues,
  TrackItemType,
} from "@types";

import {
  ArticleCoverField,
  ArticleExperiencePicker,
  ArticleTakeawaysField,
} from "./ArticlePresentationFields";
import { ItemEditorFrame } from "./ItemEditorFrame";
import { McqEditor } from "./quiz/McqEditor";
import { articleHasCardBreaks, estimateReadingMinutes } from "../../articleExperience";
import {
  createQuestionOfType,
  parseArticleQuestionMarkers,
  QuestionPath,
  removeArticleQuestionMarker,
} from "../../trackFormUtils";
import { useTrackMediaUpload } from "../../useTrackMediaUpload";

/** In Cards mode, a dashed line above each H2 shows where a new card starts. */
const CARD_BREAK_CLASS =
  "[&_.ProseMirror>h2]:mt-5 [&_.ProseMirror>h2]:border-t-2 [&_.ProseMirror>h2]:border-dashed [&_.ProseMirror>h2]:border-primary-200 [&_.ProseMirror>h2]:pt-4";

interface ArticleItemEditorProps {
  sectionIndex: number;
  itemIndex: number;
  onDelete: () => void;
}

/**
 * Article authoring: how it is presented (reading experience, cover photo,
 * key takeaways), the body, plus any inline questions it anchors.
 *
 * The two halves are deliberately split. A question is *placed* in the body —
 * the toolbar's question button drops a placeholder at the cursor — but it is
 * *written* in the fields below, which reuse the quiz editor's MCQ fields
 * rather than inventing a second way to write the same thing. Keeping the
 * answer key out of the rich text is also what stops it riding along in the
 * HTML the learner is served.
 *
 * The fields are ordered by where their placeholders sit, so "Question 2"
 * below is the chip labelled "Question 2" in the body. A question whose
 * placeholder has been deleted is called out rather than quietly dropped:
 * it would otherwise fail publish validation with nothing on screen to
 * explain why.
 */
export const ArticleItemEditor: FC<ArticleItemEditorProps> = ({
  sectionIndex,
  itemIndex,
  onDelete,
}) => {
  const { control, setValue } = useFormContext<TrackFormValues>();
  const { upload } = useTrackMediaUpload();
  const base = `sections.${sectionIndex}.items.${itemIndex}` as const;
  const htmlName = `${base}.article.html` as const;
  const questionsName = `${base}.article.questions` as `sections.0.items.0.article.questions`;

  const { fields, append, remove } = useFieldArray({
    control,
    name: questionsName,
    keyName: "fieldId",
  });

  const resourcesName = `${base}.article.resources` as `sections.0.items.0.article.resources`;
  const {
    fields: resourceFields,
    append: appendResource,
    remove: removeResource,
  } = useFieldArray({
    control,
    name: resourcesName,
    keyName: "fieldId",
  });
  const watchedResources = useWatch({ control, name: resourcesName });
  const resources = useMemo(
    () => (watchedResources ?? []) as ArticleResource[],
    [watchedResources],
  );

  const html = (useWatch({ control, name: htmlName }) ?? "") as string;
  const watchedQuestions = useWatch({ control, name: questionsName });
  // `useWatch` hands back a fresh array each render when the field is unset,
  // which would make every memo below recompute.
  const questions = useMemo(
    () => (watchedQuestions ?? []) as McqSingleQuestion[],
    [watchedQuestions],
  );

  const placedIds = useMemo(() => parseArticleQuestionMarkers(html), [html]);

  const experienceName = `${base}.article.experience` as const;
  const coverName = `${base}.article.cover` as const;
  const takeawaysName = `${base}.article.takeaways` as const;
  const experience = useWatch({ control, name: experienceName }) as ArticleExperience | undefined;
  const cover = useWatch({ control, name: coverName }) as ArticleCover | undefined;
  const watchedTakeaways = useWatch({ control, name: takeawaysName });
  const takeaways = useMemo(() => (watchedTakeaways ?? []) as string[], [watchedTakeaways]);
  const isCards = experience === ArticleExperience.CARDS;
  const hasCardBreaks = useMemo(() => articleHasCardBreaks(html), [html]);
  const readingMinutes = useMemo(() => estimateReadingMinutes(html, takeaways), [html, takeaways]);

  const handleExperienceChange = (next: ArticleExperience) =>
    // Classic is the default and is stored by leaving the field out.
    setValue(experienceName, next === ArticleExperience.CLASSIC ? undefined : next, {
      shouldDirty: true,
    });

  /**
   * The field rows in the order the reader meets them, with anything the
   * author has unplaced pushed to the end.
   */
  const rows = useMemo(() => {
    const indexById = new Map(questions.map((question, index) => [question.id, index]));
    const placed = placedIds
      .map(id => indexById.get(id))
      .filter((index): index is number => index != null)
      .map(index => ({ index, placed: true }));
    const placedSet = new Set(placed.map(row => row.index));
    const unplaced = questions
      .map((_, index) => index)
      .filter(index => !placedSet.has(index))
      .map(index => ({ index, placed: false }));
    return [...placed, ...unplaced];
  }, [questions, placedIds]);

  const handleImageUpload = (file: File) => upload(file, "image");

  /* ---- Image Studio: cover and inline pictures ---- */
  const course = useCourseImage();
  const imageStudioEnabled = useImageStudioEnabled();
  const itemTitle = (useWatch({ control, name: `${base}.title` }) ?? "") as string;
  const serverId = useWatch({ control, name: `${base}.serverId` });
  const localId = useWatch({ control, name: `${base}.localId` });
  const itemSlotPrefix = `${courseSlotPrefix(course.trackId)}:item:${serverId || localId || `${sectionIndex}-${itemIndex}`}`;
  const articleContext = useMemo(
    () => ({ title: itemTitle, text: toContextText(html) }),
    [itemTitle, html],
  );
  const [inlineRequest, setInlineRequest] = useState<GenerateImageAtCursor | null>(null);

  /**
   * Called by the toolbar button. Creates the question and hands back its id
   * for the editor to anchor; returning null leaves the body untouched.
   */
  const handleCreateQuestion = (): string | null => {
    if (questions.length >= MAX_ARTICLE_QUESTIONS) {
      toast.error(`An article can hold at most ${MAX_ARTICLE_QUESTIONS} questions.`);
      return null;
    }
    const question = createQuestionOfType("mcq_single") as McqSingleQuestion;
    append(question);
    return question.id;
  };

  const handleAddResource = () => {
    if (resourceFields.length >= MAX_ARTICLE_RESOURCES) {
      toast.error(`An article can hold at most ${MAX_ARTICLE_RESOURCES} resources.`);
      return;
    }
    appendResource({ id: crypto.randomUUID(), title: "", url: "" });
  };

  const isValidResourceUrl = (url: string) => !url || /^https?:\/\//i.test(url);

  const handleRemoveQuestion = (index: number, questionId: string) => {
    remove(index);
    // Leaving the placeholder behind would render an empty hole in the
    // article and fail publish validation.
    setValue(htmlName, removeArticleQuestionMarker(html, questionId), {
      shouldDirty: true,
    });
  };

  return (
    <ItemEditorFrame
      sectionIndex={sectionIndex}
      itemIndex={itemIndex}
      type={TrackItemType.ARTICLE}
      onDelete={onDelete}
    >
      <ArticleExperiencePicker
        name={experienceName}
        value={experience}
        onChange={handleExperienceChange}
        hasCardBreaks={hasCardBreaks}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ArticleCoverField
          name={coverName}
          value={cover}
          onChange={next => setValue(coverName, next, { shouldDirty: true })}
          experience={experience}
          readingMinutes={readingMinutes}
          slotKey={`${itemSlotPrefix}:cover`}
          imageContext={articleContext}
        />
        <ArticleTakeawaysField
          name={takeawaysName}
          value={takeaways}
          onChange={next => setValue(takeawaysName, next, { shouldDirty: true })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-typography-800">Content</label>
        <Controller
          control={control}
          name={htmlName}
          render={({ field }) => (
            <RichTextEditor
              value={field.value ?? ""}
              onChange={field.onChange}
              placeholder="Write the article content…"
              allowImages
              onImageUpload={handleImageUpload}
              onGenerateImage={imageStudioEnabled ? setInlineRequest : undefined}
              onCreateQuestion={handleCreateQuestion}
              allowCallouts
              className={`min-h-[360px] [&_.ProseMirror]:min-h-[320px] ${isCards ? CARD_BREAK_CLASS : ""}`}
            />
          )}
        />
        {isCards && (
          <p className="text-xs text-typography-500">
            In Cards mode, each H2 heading starts a new card.
          </p>
        )}
        {inlineRequest && (
          <LazyGenerateImageModal
            slotKind="article_inline"
            slotKey={`${itemSlotPrefix}:inline`}
            context={{ title: itemTitle, text: toContextText(inlineRequest.nearbyText) }}
            onAccept={image => {
              inlineRequest.insert({ src: image.url, alt: image.altText });
              setInlineRequest(null);
            }}
            onClose={() => setInlineRequest(null)}
          />
        )}
      </div>

      {fields.length > 0 && (
        <div className="flex flex-col gap-4">
          <span className="inline-flex items-center gap-1">
            <span className="text-sm font-medium text-typography-800">
              Questions ({fields.length}/{MAX_ARTICLE_QUESTIONS})
            </span>
            <Tooltip
              label="A multiple choice question the reader answers where it sits in the article. Their answer is final and they're told straight away whether it was right, so an article with questions is finished by answering them, not by marking it read."
              align="top"
            >
              <button type="button" className="cursor-pointer inline-flex items-center">
                <TooltipIcon />
              </button>
            </Tooltip>
          </span>

          {rows.map(({ index, placed }, position) => {
            const question = questions[index];
            const field = fields[index];
            if (!question || !field) return null;
            const questionPath = `${base}.article.questions.${index}` as QuestionPath;

            return (
              <div
                key={field.fieldId}
                className={`border rounded-md p-4 flex flex-col gap-4 ${
                  placed ? "border-border-light" : "border-warning-400 bg-warning-50/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-typography-800">
                    {placed ? `Question ${position + 1}` : "Not in the article"}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveQuestion(index, question.id)}
                    className="text-destructive-500 hover:text-destructive-600 max-lg:p-2.5 max-lg:-m-2.5"
                    aria-label={`Delete question ${position + 1}`}
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>

                {!placed && (
                  <p className="text-xs text-warning-800">
                    Its placeholder was deleted from the article, so nobody will see it. Put it back
                    with the question button in the toolbar, or delete the question.
                  </p>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-typography-800">Question</label>
                  <Controller
                    control={control}
                    name={`${questionPath}.promptHtml`}
                    render={({ field: promptField }) => (
                      <RichTextEditor
                        value={
                          promptField.value && promptField.value.length > 0
                            ? promptField.value
                            : (questions[index]?.prompt ?? "")
                                .split("\n")
                                .map(line => `<p>${escapeHtml(line)}</p>`)
                                .join("")
                        }
                        onChange={html => {
                          promptField.onChange(html);
                          setValue(`${questionPath}.prompt`, htmlToPlainText(html), {
                            shouldDirty: true,
                          });
                        }}
                        placeholder="Question text"
                        className="w-full"
                      />
                    )}
                  />
                </div>

                <McqEditor questionPath={questionPath} multi={false} />

                <div className="flex flex-col gap-1.5">
                  <span className="inline-flex items-center gap-1">
                    <label className="text-sm font-medium text-typography-800">
                      Why (optional)
                    </label>
                    <Tooltip
                      label="Shown to the reader once they answer, right or wrong. Being told only which answer was correct leaves them nothing to correct — a line on why the wrong ones are wrong is what turns the question into teaching."
                      align="top"
                    >
                      <button type="button" className="cursor-pointer inline-flex items-center">
                        <TooltipIcon />
                      </button>
                    </Tooltip>
                  </span>
                  <Controller
                    control={control}
                    name={`${questionPath}.explanation`}
                    render={({ field: explanationField }) => (
                      <TextArea
                        id={`${questionPath}.explanation`}
                        labelText="Why (optional)"
                        hideLabel
                        {...explanationField}
                        value={explanationField.value ?? ""}
                        rows={2}
                        placeholder="Shown after they answer — e.g. why the tempting wrong answer is wrong"
                        className="w-full"
                      />
                    )}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <span className="inline-flex items-center gap-1">
          <span className="text-sm font-medium text-typography-800">
            Resources ({resourceFields.length}/{MAX_ARTICLE_RESOURCES})
          </span>
          <Tooltip
            label="Learners see these as links alongside the article — they open in place, without leaving the course."
            align="top"
          >
            <button type="button" className="cursor-pointer inline-flex items-center">
              <TooltipIcon />
            </button>
          </Tooltip>
        </span>

        {resourceFields.map((field, index) => {
          const resource = resources[index];
          const urlValid = isValidResourceUrl(resource?.url ?? "");

          return (
            <div
              key={field.fieldId}
              className="border border-border-light rounded-md p-4 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-typography-800">
                  Resource {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeResource(index)}
                  className="text-destructive-500 hover:text-destructive-600 max-lg:p-2.5 max-lg:-m-2.5"
                  aria-label={`Delete resource ${index + 1}`}
                >
                  <Trash className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={`${resourcesName}.${index}.title`}
                  className="text-sm font-medium text-typography-800"
                >
                  Title
                </label>
                <Controller
                  control={control}
                  name={`${resourcesName}.${index}.title`}
                  render={({ field: titleField }) => (
                    <input
                      id={`${resourcesName}.${index}.title`}
                      type="text"
                      {...titleField}
                      value={titleField.value ?? ""}
                      placeholder="e.g. Mental Health First Aid Guide"
                      className="w-full border border-border-light rounded-md px-3 py-2 text-sm outline-none focus:border-primary-400"
                    />
                  )}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={`${resourcesName}.${index}.url`}
                  className="text-sm font-medium text-typography-800"
                >
                  URL
                </label>
                <Controller
                  control={control}
                  name={`${resourcesName}.${index}.url`}
                  render={({ field: urlField }) => (
                    <input
                      id={`${resourcesName}.${index}.url`}
                      type="text"
                      {...urlField}
                      value={urlField.value ?? ""}
                      placeholder="https://example.com/article"
                      className={`w-full border rounded-md px-3 py-2 text-sm outline-none focus:border-primary-400 ${
                        urlValid ? "border-border-light" : "border-destructive-400"
                      }`}
                    />
                  )}
                />
                {!urlValid && (
                  <p className="text-xs text-destructive-500">Enter a valid http(s) link.</p>
                )}
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={handleAddResource}
          className="self-start text-sm font-medium text-primary-500 hover:text-primary-600"
        >
          + Add resource
        </button>
      </div>
    </ItemEditorFrame>
  );
};
