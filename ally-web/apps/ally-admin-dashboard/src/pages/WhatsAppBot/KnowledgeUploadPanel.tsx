import React, { useRef, useState } from "react";

import axios from "axios";
import { toast } from "sonner";

import {
  AutoExpandableTextarea,
  RadioButton,
  RadioButtonGroup,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useCreateChatbotDocumentUploadUrlMutation,
  useCreatePrivateChatbotDocumentMutation,
} from "@api";
import { Button, EntityField, EntitySidePanel } from "@components";
import { ButtonVariant } from "@components/types";
import {
  ACCEPT_ATTRIBUTES,
  DOCUMENT_MAX_PASTE_CHARS,
  DOCUMENT_UPLOAD_FORMATS,
  FILE_SIZE_LIMITS,
  en,
} from "@constants";

import { errorMessage } from "./shared";

const t = en.whatsappBot.bots.knowledge;
const corpusCopy = en.whatsappBot.corpus;

type FileSource = keyof typeof DOCUMENT_UPLOAD_FORMATS;
type Mode = "file" | "paste";

interface UploadedFile {
  sourceType: FileSource;
  fileUrl: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

const ACCEPT = [ACCEPT_ATTRIBUTES.PDF, ACCEPT_ATTRIBUTES.DOCX, ACCEPT_ATTRIBUTES.EPUB].join(",");

/**
 * Which format a file is, by its MIME type OR its extension: browsers report .epub as
 * application/octet-stream on some platforms (see DOCUMENT_UPLOAD_FORMATS).
 */
const sourceOf = (file: File): FileSource | null => {
  const name = file.name.toLowerCase();
  const match = (Object.keys(DOCUMENT_UPLOAD_FORMATS) as FileSource[]).find(
    key =>
      file.type === DOCUMENT_UPLOAD_FORMATS[key].mime ||
      DOCUMENT_UPLOAD_FORMATS[key].extensions.some(ext => name.endsWith(ext)),
  );
  return match ?? null;
};

const withoutExtension = (fileName: string) => fileName.replace(/\.[^.]+$/, "");

/**
 * Add a document only this chatbot sees: a PDF, Word or EPUB file (presigned, then PUT straight
 * to storage, as the library does) or pasted text. ally-be attaches it to the chatbot and queues
 * it for indexing; the Knowledge list shows its progress.
 */
export const KnowledgeUploadPanel: React.FC<{
  botId: string;
  isOpen: boolean;
  onClose: () => void;
}> = ({ botId, isOpen, onClose }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("file");
  const [title, setTitle] = useState("");
  // The title follows the file's name until the person types their own.
  const [titleEdited, setTitleEdited] = useState(false);
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [text, setText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [createUploadUrl] = useCreateChatbotDocumentUploadUrlMutation();
  const [createDocument, { isLoading: isSaving }] = useCreatePrivateChatbotDocumentMutation();

  const reset = () => {
    setMode("file");
    setTitle("");
    setTitleEdited(false);
    setFile(null);
    setText("");
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleFile = async (picked: File) => {
    const sourceType = sourceOf(picked);
    if (!sourceType) {
      toast.error(t.uploadFileType);
      return;
    }
    if (picked.size > FILE_SIZE_LIMITS.DOCUMENT) {
      toast.error(corpusCopy.fileTooLarge);
      return;
    }
    // Always the canonical MIME type, not file.type: ally-be maps it back to the source type.
    const contentType = DOCUMENT_UPLOAD_FORMATS[sourceType].mime;
    setIsUploading(true);
    try {
      const { presignedUrl, fileUrl } = await createUploadUrl({
        id: botId,
        fileName: picked.name,
        fileSize: picked.size,
        contentType,
      }).unwrap();
      await axios.put(presignedUrl, picked, { headers: { "Content-Type": contentType } });
      setFile({ sourceType, fileUrl, fileName: picked.name, contentType, sizeBytes: picked.size });
      if (!titleEdited) setTitle(withoutExtension(picked.name));
    } catch {
      toast.error(corpusCopy.uploadFailed);
    } finally {
      setIsUploading(false);
      // Reset the input so picking the same file again fires a change event.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const trimmedTitle = title.trim();
  const trimmedText = text.trim();
  const ready = Boolean(trimmedTitle) && (mode === "file" ? Boolean(file) : Boolean(trimmedText));

  const handleSave = async () => {
    if (!ready) return;
    try {
      await createDocument(
        mode === "file" && file
          ? { id: botId, title: trimmedTitle, ...file }
          : { id: botId, title: trimmedTitle, sourceType: "paste", text: trimmedText },
      ).unwrap();
      toast.success(t.uploadSaved);
      close();
    } catch (err) {
      toast.error(errorMessage(err, t.uploadFailed));
    }
  };

  return (
    <EntitySidePanel
      isOpen={isOpen}
      title={t.uploadTitle}
      dirty={Boolean(trimmedTitle || file || trimmedText)}
      saveDisabled={!ready || isUploading || isSaving}
      onClose={close}
      onSave={() => void handleSave()}
    >
      <p className="text-sm text-typography-600">{t.uploadIntro}</p>
      <EntityField label={t.uploadSourceLabel}>
        <RadioButtonGroup
          name="knowledge-upload-source"
          orientation="vertical"
          valueSelected={mode}
          onChange={value => setMode(value as Mode)}
        >
          <RadioButton id="knowledge-upload-file" value="file" labelText={t.uploadSourceFile} />
          <RadioButton id="knowledge-upload-paste" value="paste" labelText={t.uploadSourcePaste} />
        </RadioButtonGroup>
      </EntityField>
      {mode === "file" ? (
        <EntityField label={t.uploadFileLabel} required>
          <div className="flex flex-col gap-2">
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              data-testid="knowledge-upload-input"
              accept={ACCEPT}
              disabled={isUploading}
              onChange={event => {
                const picked = event.target.files?.[0];
                if (picked) void handleFile(picked);
              }}
            />
            <div className="flex items-center gap-3">
              <Button
                variant={ButtonVariant.SECONDARY}
                onClick={() => inputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading
                  ? corpusCopy.uploading
                  : file
                    ? corpusCopy.uploadReplace
                    : corpusCopy.uploadChoose}
              </Button>
              {file && (
                <span className="text-sm text-typography-700 truncate max-w-[320px]">
                  {file.fileName}
                </span>
              )}
            </div>
            <span className="text-xs text-typography-400">{corpusCopy.uploadHelp}</span>
          </div>
        </EntityField>
      ) : (
        <EntityField label={t.uploadTextLabel} required>
          <AutoExpandableTextarea
            value={text}
            onChange={value => setText(value.slice(0, DOCUMENT_MAX_PASTE_CHARS))}
            placeholder={t.uploadTextPlaceholder}
            minHeight={220}
          />
        </EntityField>
      )}
      <EntityField label={t.uploadTitleLabel} required>
        <TextInput
          id="knowledge-upload-title"
          labelText=""
          hideLabel
          value={title}
          maxLength={500}
          onChange={event => {
            setTitle(event.target.value);
            setTitleEdited(true);
          }}
        />
      </EntityField>
    </EntitySidePanel>
  );
};
