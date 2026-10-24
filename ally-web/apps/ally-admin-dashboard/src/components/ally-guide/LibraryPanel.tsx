import React, { useEffect, useRef, useState } from "react";

import axios from "axios";
import { toast } from "sonner";

import {
  Button,
  ContentSwitcher,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextArea,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useArchiveAllyGuideLibraryDocumentMutation,
  useCreateAllyGuideLibraryDocumentMutation,
  useCreateAllyGuideLibraryUploadUrlMutation,
  useGetAllyGuideLibraryQuery,
} from "@api";
import {
  DOCUMENT_MAX_PASTE_CHARS,
  DOCUMENT_UPLOAD_FORMATS,
  FILE_SIZE_LIMITS,
  en,
} from "@constants";
import { AllyGuideLibraryDocument, AllyGuideLibraryScope } from "@types";
import { formatDate, getErrorMessage } from "@utils";

import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "./ConsoleStates";
import { InfoTip } from "./InfoTip";
import { Pill, PillTone } from "./Pill";

type AddSource = "paste" | "pdf" | "docx" | "epub";
const SOURCES: AddSource[] = ["paste", "pdf", "docx", "epub"];
const POLL_MS = 5000;
const IN_FLIGHT = new Set(["pending", "extracting", "chunking", "indexing"]);

const ACCEPT: Record<Exclude<AddSource, "paste">, string> = {
  pdf: "application/pdf,.pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx",
  epub: "application/epub+zip,.epub",
};

const STATUS_TONES: Record<string, PillTone> = {
  indexed: "success",
  failed: "danger",
};

interface LibraryPanelProps {
  scope: AllyGuideLibraryScope;
  /** The organisation, for its own library. */
  tenantId?: string;
  canEdit: boolean;
}

/**
 * Ally's documents for one scope: the platform's, or one organisation's own. The scope is chosen
 * by the route the slice calls, never by anything in the body, so a document cannot be published
 * to the wrong audience by editing a request. Adding is two steps for a file (ask for an upload
 * URL, PUT it straight to storage, then create the document with the returned URL) and one for
 * pasted text. Removing archives: Ally stops using the document at once and its rows stay so
 * citations already given still resolve. The list refreshes by itself while anything is indexing.
 */
export const LibraryPanel: React.FC<LibraryPanelProps> = ({ scope, tenantId, canEdit }) => {
  const strings = en.allyConsole.library;
  const [pollMs, setPollMs] = useState(0);
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideLibraryQuery(
    { scope, tenantId },
    { pollingInterval: pollMs, skip: scope === "organisation" && !tenantId },
  );
  const documents = (data?.documents ?? []).filter(document => !document.isArchived);

  useEffect(() => {
    setPollMs(documents.some(document => IN_FLIGHT.has(document.status)) ? POLL_MS : 0);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<AllyGuideLibraryDocument | null>(null);
  const [archive, { isLoading: isArchiving }] = useArchiveAllyGuideLibraryDocumentMutation();

  const handleArchive = async () => {
    if (!removing) return;
    try {
      await archive({ scope, tenantId, id: removing.id }).unwrap();
      toast.success(strings.archiveDialog.success);
      setRemoving(null);
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.archiveDialog.failed));
    }
  };

  if (scope === "organisation" && !tenantId) {
    return <p className="text-sm text-typography-700">{strings.needsOrg}</p>;
  }

  return (
    <div className="flex flex-col gap-4" data-testid={`library-${scope}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-typography-700">
          {scope === "platform" ? strings.platformIntro : strings.orgIntro}
        </p>
        {canEdit && (
          <Button kind="primary" size="md" onClick={() => setAddOpen(true)}>
            {strings.add}
          </Button>
        )}
      </div>

      {isLoading ? (
        <LoadingBlock lines={4} />
      ) : isError || !data ? (
        <ErrorPanel what={strings.loadFailed} error={error} onRetry={() => void refetch()} />
      ) : documents.length === 0 ? (
        <EmptyPanel title={strings.emptyTitle} message={strings.emptyMessage} />
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-left" data-testid="library-table">
            <TableHead>
              <TableRow className="border-b border-border-light text-sm text-typography-700">
                <TableHeader className="py-3 pr-4 font-medium">{strings.columns.title}</TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.source}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  <span className="inline-flex items-center gap-1">
                    {strings.columns.status}
                    <InfoTip label={strings.statusHelp} ariaLabel="About document statuses" />
                  </span>
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {strings.columns.chunks}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">{strings.columns.added}</TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  <span className="sr-only">Actions</span>
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {documents.map(document => (
                <TableRow
                  key={document.id}
                  className="border-b border-border-light align-top text-sm text-typography-900"
                  data-testid="library-row"
                >
                  <TableCell className="max-w-md break-words py-3 pr-4">
                    <span className="block font-medium">{document.title}</span>
                    {document.fileName && (
                      <span className="block text-xs text-typography-700">{document.fileName}</span>
                    )}
                    {document.status === "failed" && document.statusMessage && (
                      <span
                        className="block text-xs text-destructive-600"
                        data-testid="library-failed-why"
                      >
                        {strings.failedWhy(document.statusMessage)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 pr-4">
                    {strings.sources[document.sourceType] ?? document.sourceType}
                  </TableCell>
                  <TableCell className="py-3 pr-4">
                    <Pill tone={STATUS_TONES[document.status] ?? "info"}>
                      {strings.statuses[document.status] ?? document.status}
                    </Pill>
                  </TableCell>
                  <TableCell className="py-3 pr-4 tabular-nums">
                    {strings.chunks(document.indexedChunkCount, document.chunkCount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-3 pr-4">
                    {formatDate(document.createdAt)}
                  </TableCell>
                  <TableCell className="py-3 pr-4">
                    {canEdit && (
                      <Button
                        kind="danger--tertiary"
                        size="sm"
                        aria-label={strings.archiveLabel(document.title)}
                        onClick={() => setRemoving(document)}
                      >
                        {strings.archive}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddDocumentDialog
        isOpen={addOpen}
        scope={scope}
        tenantId={tenantId}
        onClose={() => setAddOpen(false)}
      />
      <ConfirmDialog
        isOpen={removing !== null}
        title={strings.archiveDialog.title(removing?.title ?? "")}
        cancelLabel={strings.archiveDialog.cancel}
        confirmLabel={isArchiving ? strings.archiveDialog.working : strings.archiveDialog.confirm}
        danger
        isWorking={isArchiving}
        onConfirm={() => void handleArchive()}
        onClose={() => setRemoving(null)}
      >
        <p>{strings.archiveDialog.body}</p>
      </ConfirmDialog>
    </div>
  );
};

const AddDocumentDialog: React.FC<{
  isOpen: boolean;
  scope: AllyGuideLibraryScope;
  tenantId?: string;
  onClose: () => void;
}> = ({ isOpen, scope, tenantId, onClose }) => {
  const strings = en.allyConsole.library.addDialog;
  const [createUploadUrl] = useCreateAllyGuideLibraryUploadUrlMutation();
  const [createDocument] = useCreateAllyGuideLibraryDocumentMutation();

  const [title, setTitle] = useState("");
  const [source, setSource] = useState<AddSource>("paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("");
  const [busy, setBusy] = useState<"idle" | "uploading" | "adding">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle("");
      setSource("paste");
      setText("");
      setFile(null);
      setLanguage("");
      setBusy("idle");
    }
  }, [isOpen]);

  const tooLong = text.length > DOCUMENT_MAX_PASTE_CHARS;
  const ready =
    title.trim().length > 0 &&
    (source === "paste" ? text.trim().length > 0 && !tooLong : file !== null);

  const pickFile = (picked: File | undefined) => {
    if (!picked || source === "paste") return;
    const format = DOCUMENT_UPLOAD_FORMATS[source];
    const name = picked.name.toLowerCase();
    // Either the MIME type or the extension: browsers report .epub as octet-stream on some platforms.
    const accepted =
      picked.type === format.mime || format.extensions.some(extension => name.endsWith(extension));
    if (!accepted) {
      toast.error(strings.invalidFileType);
      return;
    }
    if (picked.size > FILE_SIZE_LIMITS.DOCUMENT) {
      toast.error(strings.fileTooLarge);
      return;
    }
    setFile(picked);
  };

  const handleConfirm = async () => {
    if (!ready) return;
    try {
      if (source === "paste") {
        setBusy("adding");
        await createDocument({
          scope,
          tenantId,
          title: title.trim(),
          sourceType: "paste",
          text,
          ...(language.trim() ? { language: language.trim() } : {}),
        }).unwrap();
      } else if (file) {
        const format = DOCUMENT_UPLOAD_FORMATS[source];
        setBusy("uploading");
        let uploaded: { fileUrl: string } | null = null;
        try {
          const { presignedUrl, fileUrl } = await createUploadUrl({
            scope,
            tenantId,
            fileName: file.name,
            fileSize: file.size,
            // The canonical type, not file.type: the server maps it back to a source.
            contentType: format.mime,
          }).unwrap();
          await axios.put(presignedUrl, file, { headers: { "Content-Type": format.mime } });
          uploaded = { fileUrl };
        } catch {
          toast.error(strings.uploadFailed);
          setBusy("idle");
          return;
        }
        setBusy("adding");
        await createDocument({
          scope,
          tenantId,
          title: title.trim(),
          sourceType: source,
          fileUrl: uploaded.fileUrl,
          fileName: file.name,
          contentType: format.mime,
          sizeBytes: file.size,
          ...(language.trim() ? { language: language.trim() } : {}),
        }).unwrap();
      }
      toast.success(strings.success);
      onClose();
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.failed));
      setBusy("idle");
    }
  };

  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={strings.title}
      cancelLabel={strings.cancel}
      confirmLabel={
        busy === "uploading"
          ? strings.uploading
          : busy === "adding"
            ? strings.working
            : strings.confirm
      }
      confirmDisabled={!ready}
      isWorking={busy !== "idle"}
      onConfirm={() => void handleConfirm()}
      onClose={onClose}
    >
      <TextInput
        id="ally-library-title"
        labelText={strings.titleLabel}
        placeholder={strings.titlePlaceholder}
        maxLength={300}
        value={title}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)}
      />
      <ContentSwitcher
        size="sm"
        selectedIndex={SOURCES.indexOf(source)}
        onChange={(event: { name?: string | number }) => {
          setSource(event.name as AddSource);
          setFile(null);
        }}
        aria-label={strings.sourceLabel}
      >
        {SOURCES.map(name => (
          <Switch key={name} name={name} text={strings.sourceOptions[name]} />
        ))}
      </ContentSwitcher>
      {source === "paste" ? (
        <TextArea
          id="ally-library-text"
          labelText={strings.textLabel}
          placeholder={strings.textPlaceholder}
          helperText={strings.textHelp(DOCUMENT_MAX_PASTE_CHARS)}
          rows={8}
          invalid={tooLong}
          invalidText={strings.textHelp(DOCUMENT_MAX_PASTE_CHARS)}
          value={text}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor="ally-library-file" className="text-xs tracking-wide text-typography-700">
            {strings.fileLabel}
          </label>
          <input
            id="ally-library-file"
            ref={inputRef}
            type="file"
            accept={ACCEPT[source]}
            onChange={event => pickFile(event.target.files?.[0])}
          />
          <span className="text-xs text-typography-700">
            {file ? strings.fileChosen(file.name) : strings.fileHelp}
          </span>
        </div>
      )}
      <TextInput
        id="ally-library-language"
        labelText={strings.languageLabel}
        helperText={strings.languageHelp}
        maxLength={16}
        value={language}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLanguage(event.target.value)}
      />
    </ConfirmDialog>
  );
};
