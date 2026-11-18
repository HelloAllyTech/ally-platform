import React, { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import {
  AutoExpandableTextarea,
  ContentSwitcher,
  Switch,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useCreateKbDocumentMutation,
  useGetKbDocumentQuery,
  useGetTenantsQuery,
  useReplaceKbDocumentContentMutation,
  useSetKbDocumentAudienceMutation,
  useUpdateKbDocumentMutation,
} from "@api";
import { EntityField, EntitySidePanel } from "@components";
import { DOCUMENT_MAX_PASTE_CHARS, en } from "@constants";
import { KbCorpus, KbDocument, KbDocumentSourceType } from "@types";

import { CorpusAudienceField } from "./CorpusAudienceField";
import { DocumentUploadField } from "./DocumentUploadField";

/**
 * Enough to cover every organisation on the platform in one request.
 *
 * A paged picker would be the "correct" answer and is the wrong trade here: the list is tens of
 * rows, an admin retargeting a document wants to search all of them at once, and a second page
 * that silently hides an organisation would look exactly like that organisation not existing.
 */
const TENANT_PAGE_SIZE = 200;

interface CorpusDocumentPanelProps {
  isOpen: boolean;
  /** Null = create. */
  document: KbDocument | null;
  /**
   * Opened from one organisation's WhatsApp page: a new document is aimed at that organisation
   * by default, and every request names it (an org-restricted admin's are refused otherwise).
   */
  scopeTenantId?: string;
  onClose: () => void;
}

const SOURCE_ORDER: KbDocumentSourceType[] = [
  KbDocumentSourceType.PASTE,
  KbDocumentSourceType.PDF,
  KbDocumentSourceType.DOCX,
  KbDocumentSourceType.EPUB,
  KbDocumentSourceType.URL,
];

type UploadValue = {
  fileUrl: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
} | null;

const isUploadSource = (source: KbDocumentSourceType) =>
  source === KbDocumentSourceType.PDF ||
  source === KbDocumentSourceType.DOCX ||
  source === KbDocumentSourceType.EPUB;

/**
 * Create or edit one corpus document.
 *
 * Two rules shape this form:
 *
 *  - The SOURCE TYPE is immutable after creation. A PDF is not a URL; changing the source means a
 *    different document. The switcher is therefore disabled in edit mode, and the file input offers
 *    "Replace file" instead.
 *  - Only PASTED text is editable in place. For a file-backed document the file IS the content, so
 *    letting an admin edit the extracted text would produce a corpus that silently disagrees with
 *    the PDF they can still download. Its extracted text is still SHOWN, read-only, so an admin
 *    can see what the bot actually reads.
 */
export const CorpusDocumentPanel: React.FC<CorpusDocumentPanelProps> = ({
  isOpen,
  document,
  scopeTenantId,
  onClose,
}) => {
  const isEdit = Boolean(document);
  const scope = scopeTenantId ? { tenantId: scopeTenantId } : {};

  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<KbDocumentSourceType>(KbDocumentSourceType.PASTE);
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [upload, setUpload] = useState<UploadValue>(null);
  const [language, setLanguage] = useState("");
  const [isGlobal, setIsGlobal] = useState(false);
  const [tenantIds, setTenantIds] = useState<string[]>([]);

  const [createDocument, { isLoading: isCreating }] = useCreateKbDocumentMutation();
  const [updateDocument, { isLoading: isUpdating }] = useUpdateKbDocumentMutation();
  const [replaceContent, { isLoading: isReplacing }] = useReplaceKbDocumentContentMutation();
  const [setAudience, { isLoading: isSavingAudience }] = useSetKbDocumentAudienceMutation();

  // The list leaves the text out (megabytes per page), so an opened document fetches its own
  // copy. Refetched on every open: the text may have changed since through another admin's edit.
  const { data: fullDocument, isFetching: isLoadingText } = useGetKbDocumentQuery(
    { id: document?.id ?? "", tenantId: scopeTenantId },
    { skip: !isOpen || !document, refetchOnMountOrArgChange: true },
  );
  const originalText = fullDocument?.id === document?.id ? (fullDocument?.rawText ?? "") : "";
  // Seeded once per opening, so a background refetch cannot overwrite what the admin is typing.
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Loaded only while the panel is open: the corpus table does not need it, and an admin who never
  // opens a document should not pay for the organisation list.
  const { data: tenantData } = useGetTenantsQuery({ limit: TENANT_PAGE_SIZE }, { skip: !isOpen });
  const tenants = tenantData?.data ?? [];

  useEffect(() => {
    if (!isOpen) return;
    setTitle(document?.title ?? "");
    setSourceType(document?.sourceType ?? KbDocumentSourceType.PASTE);
    // Filled from the single-document fetch below once it lands; empty until then.
    setText("");
    setSeededFor(null);
    setSourceUrl(document?.sourceUrl ?? "");
    setUpload(null);
    setLanguage(document?.language ?? "");
    // A NEW document defaults to no audience at all, matching the API: an admin has to say who it
    // is for. The alternative — defaulting to every organisation — makes the most permissive
    // outcome the one you get by not reading the form.
    setIsGlobal(document?.isGlobal ?? false);
    setTenantIds(document?.tenantIds ?? (scopeTenantId ? [scopeTenantId] : []));
  }, [isOpen, document, scopeTenantId]);

  useEffect(() => {
    if (!isOpen || !document || fullDocument?.id !== document.id) return;
    if (seededFor === document.id) return;
    setSeededFor(document.id);
    if (document.sourceType === KbDocumentSourceType.PASTE) setText(fullDocument.rawText ?? "");
  }, [isOpen, document, fullDocument, seededFor]);

  const textReady = !isEdit || seededFor === document?.id;

  // Compared trimmed, matching what is sent: re-saving the same text must not re-embed every
  // passage, and an emptied box never blanks a document.
  const textChanged =
    isEdit && textReady && text.trim().length > 0 && text.trim() !== originalText.trim();

  const canEditBody = !isEdit || document?.sourceType === KbDocumentSourceType.PASTE;

  // Compared as a SET, so re-picking the same organisations in a different order is not a change
  // worth sweeping every chunk of a 300-page book for.
  const audienceChanged = useMemo(() => {
    if (!isEdit || !document) return false;
    if (isGlobal !== document.isGlobal) return true;
    if (isGlobal) return false;
    const before = new Set(document.tenantIds);
    return tenantIds.length !== before.size || tenantIds.some(id => !before.has(id));
  }, [isEdit, document, isGlobal, tenantIds]);

  const validation = useMemo(() => {
    if (!title.trim()) return en.whatsappBot.corpus.validationTitle;
    if (isEdit) return null;

    if (sourceType === KbDocumentSourceType.PASTE && !text.trim()) {
      return en.whatsappBot.corpus.validationBody;
    }
    if (sourceType === KbDocumentSourceType.URL) {
      if (!sourceUrl.trim()) return en.whatsappBot.corpus.validationBody;
      try {
        const parsed = new URL(sourceUrl.trim());
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return en.whatsappBot.corpus.invalidUrl;
        }
      } catch {
        return en.whatsappBot.corpus.invalidUrl;
      }
    }
    if (isUploadSource(sourceType) && !upload) {
      return en.whatsappBot.corpus.validationBody;
    }
    return null;
  }, [title, isEdit, sourceType, text, sourceUrl, upload]);

  const dirty = useMemo(() => {
    if (!isEdit) {
      return Boolean(title.trim() || text.trim() || sourceUrl.trim() || upload);
    }
    return (
      title !== (document?.title ?? "") ||
      language !== (document?.language ?? "") ||
      textChanged ||
      audienceChanged
    );
  }, [isEdit, title, text, sourceUrl, upload, language, document, audienceChanged, textChanged]);

  const isSaving = isCreating || isUpdating || isReplacing || isSavingAudience;

  const handleSave = async () => {
    if (validation) return;

    try {
      if (isEdit && document) {
        await updateDocument({
          ...scope,
          id: document.id,
          title: title.trim(),
          language: language.trim() || undefined,
        }).unwrap();

        // Only when the text actually changed — an empty or untouched textarea sends nothing.
        if (textChanged && document.sourceType === KbDocumentSourceType.PASTE) {
          const updated = await replaceContent({
            ...scope,
            id: document.id,
            text: text.trim(),
          }).unwrap();
          // ally-be no-ops an identical edit rather than re-embedding hundreds of passages, so the
          // status tells us which happened.
          toast.success(
            updated.status === document.status && updated.chunkCount === document.chunkCount
              ? en.whatsappBot.corpus.contentUnchanged
              : en.whatsappBot.corpus.updated,
          );
        } else {
          toast.success(en.whatsappBot.corpus.updated);
        }

        // Its own call, and only when something changed. Sent AFTER the metadata update so a
        // failure here cannot leave a title edit unsaved: this is the request that can fail on
        // its own (it sweeps every indexed chunk), and its error message is specific — the
        // assignment saved, the index did not, use Retry.
        if (audienceChanged) {
          try {
            await setAudience({
              scopeTenantId,
              id: document.id,
              isGlobal,
              tenantIds: isGlobal ? [] : tenantIds,
            }).unwrap();
            toast.success(en.whatsappBot.corpus.audienceSaved);
          } catch {
            toast.error(en.whatsappBot.corpus.audienceIndexFailed);
            // Left OPEN, unlike every other failure here. The panel closing on a partial save
            // reads as success, and this is the one case where the two stores can disagree.
            return;
          }
        }
      } else {
        await createDocument({
          ...scope,
          // The only corpus the Knowledge Base still serves.
          corpus: KbCorpus.WHATSAPP_QA,
          title: title.trim(),
          sourceType,
          ...(sourceType === KbDocumentSourceType.PASTE ? { text: text.trim() } : {}),
          ...(sourceType === KbDocumentSourceType.URL ? { sourceUrl: sourceUrl.trim() } : {}),
          ...(upload ?? {}),
          ...(language.trim() ? { language: language.trim() } : {}),
          // Sent with the create rather than as a follow-up call, so the audience is already in
          // place when the ingest worker stamps it onto the first generation of chunks.
          isGlobal,
          tenantIds: isGlobal ? [] : tenantIds,
        }).unwrap();
        toast.success(en.whatsappBot.corpus.created);
      }
      onClose();
    } catch {
      toast.error(en.whatsappBot.corpus.saveFailed);
    }
  };

  return (
    <EntitySidePanel
      isOpen={isOpen}
      title={isEdit ? en.whatsappBot.corpus.edit : en.whatsappBot.corpus.create}
      dirty={dirty}
      saveDisabled={Boolean(validation) || isSaving}
      saveDisabledReason={validation ?? undefined}
      onClose={onClose}
      onSave={() => void handleSave()}
    >
      <EntityField label={en.whatsappBot.corpus.titleLabel} required>
        <TextInput
          id="kb-title"
          labelText=""
          hideLabel
          value={title}
          placeholder={en.whatsappBot.corpus.titlePlaceholder}
          onChange={event => setTitle(event.target.value)}
        />
      </EntityField>

      <EntityField
        label={en.whatsappBot.corpus.sourceTypeLabel}
        required
        help={isEdit ? en.whatsappBot.corpus.sourceTypeLocked : undefined}
      >
        <ContentSwitcher
          selectedIndex={SOURCE_ORDER.indexOf(sourceType)}
          onChange={({ index }: { index?: number }) => {
            if (isEdit || index === undefined) return;
            setSourceType(SOURCE_ORDER[index]);
            // Clear the previous source's input so a switch cannot submit a stale body.
            setText("");
            setSourceUrl("");
            setUpload(null);
          }}
        >
          {SOURCE_ORDER.map(source => (
            <Switch
              key={source}
              name={source}
              text={en.whatsappBot.corpus.sourceType[source]}
              disabled={isEdit && source !== sourceType}
            />
          ))}
        </ContentSwitcher>
      </EntityField>

      {sourceType === KbDocumentSourceType.PASTE && (
        <EntityField
          label={en.whatsappBot.corpus.textLabel}
          required={!isEdit}
          help={
            text.length > DOCUMENT_MAX_PASTE_CHARS
              ? en.whatsappBot.corpus.textTooLong
              : isEdit
                ? en.whatsappBot.corpus.textEditHelp
                : undefined
          }
        >
          <AutoExpandableTextarea
            value={text}
            onChange={setText}
            placeholder={
              textReady ? en.whatsappBot.corpus.textPlaceholder : en.whatsappBot.corpus.textLoading
            }
            maxLength={DOCUMENT_MAX_PASTE_CHARS}
            minHeight={180}
            disabled={!textReady}
          />
        </EntityField>
      )}

      {isEdit && sourceType !== KbDocumentSourceType.PASTE && (
        <EntityField
          label={en.whatsappBot.corpus.extractedTextLabel}
          help={en.whatsappBot.corpus.extractedTextHelp}
        >
          <AutoExpandableTextarea
            value={
              isLoadingText && !originalText
                ? en.whatsappBot.corpus.textLoading
                : originalText || en.whatsappBot.corpus.extractedTextEmpty
            }
            onChange={() => undefined}
            minHeight={180}
            disabled
          />
        </EntityField>
      )}

      {isUploadSource(sourceType) && (
        <EntityField label={en.whatsappBot.corpus.uploadLabel} required={!isEdit}>
          <DocumentUploadField
            sourceType={sourceType}
            value={upload}
            onChange={setUpload}
            scopeTenantId={scopeTenantId}
          />
        </EntityField>
      )}

      {sourceType === KbDocumentSourceType.URL && (
        <EntityField label={en.whatsappBot.corpus.urlLabel} required={!isEdit}>
          <TextInput
            id="kb-url"
            labelText=""
            hideLabel
            value={sourceUrl}
            placeholder={en.whatsappBot.corpus.urlPlaceholder}
            disabled={isEdit}
            onChange={event => setSourceUrl(event.target.value)}
          />
        </EntityField>
      )}

      {isEdit && !canEditBody && (
        <p className="text-xs text-typography-500">{en.whatsappBot.corpus.sourceTypeLocked}</p>
      )}

      <CorpusAudienceField
        isGlobal={isGlobal}
        tenantIds={tenantIds}
        tenants={tenants}
        disabled={isSaving}
        onChange={next => {
          setIsGlobal(next.isGlobal);
          setTenantIds(next.tenantIds);
        }}
      />

      <EntityField
        label={en.whatsappBot.corpus.languageLabel}
        help={en.whatsappBot.corpus.languageHelp}
      >
        <TextInput
          id="kb-language"
          labelText=""
          hideLabel
          value={language}
          placeholder="en"
          onChange={event => setLanguage(event.target.value)}
        />
      </EntityField>
    </EntitySidePanel>
  );
};
