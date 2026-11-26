import React from "react";

import type { InboxAttachment, InboxDeliveryStatus, InboxMessage } from "@api";
import { Button } from "@components/button";
import { Input } from "@components/input";
import { ButtonVariant } from "@components/types";

import { fill, INBOX_WA } from "./copy";

/**
 * WA-A §3: WhatsApp's ticks on a message sent to the person: one for sent, two for delivered, two
 * coloured for read; a failed send says so, with its reason in plain words. The label is the
 * accessible name, so the ticks are never the only signal.
 */
export const DeliveryTicks: React.FC<{
  status: InboxDeliveryStatus;
  failedReason?: string | null;
}> = ({ status, failedReason }) => {
  const label = INBOX_WA.delivery[status];
  if (status === "failed") {
    return (
      <p className="ally-small ally-inbox__failed" role="note" data-testid="inbox-delivery">
        <span aria-hidden="true">!</span> {label}
        {failedReason ? `: ${failedReason}` : ""}
      </p>
    );
  }
  return (
    <span
      className={`ally-inbox__ticks ally-inbox__ticks--${status}`}
      title={label}
      aria-label={label}
      role="img"
      data-testid="inbox-delivery"
    >
      {status === "sent" ? "✓" : "✓✓"}
    </span>
  );
};

/** WA-A §1–2: a voice note (playable, with its transcript), a photo, or a document. */
export const MessageFiles: React.FC<{ attachments: InboxAttachment[] }> = ({ attachments }) => (
  <>
    {attachments.map((a, i) => (
      <div key={i} className="ally-inbox__file" data-testid={`inbox-file-${a.kind}`}>
        {a.kind === "audio" && (
          <>
            <p className="ally-small ally-inbox__file-label">
              {INBOX_WA.voiceNote}
              {a.durationSec ? ` · ${Math.round(a.durationSec)} s` : ""}
            </p>
            {a.url ? (
              <audio controls preload="none" src={a.url} aria-label={INBOX_WA.voiceNote} />
            ) : (
              <p className="ally-small">{INBOX_WA.fileNotStored}</p>
            )}
            {a.transcript ? (
              <p className="ally-small ally-inbox__transcript">
                <span className="sr-only">{INBOX_WA.transcript}: </span>
                {a.transcript}
              </p>
            ) : (
              <p className="ally-small ally-inbox__transcript">
                {a.transcriptError === "too_long" ? INBOX_WA.tooLong : INBOX_WA.noTranscript}
              </p>
            )}
          </>
        )}
        {a.kind === "image" &&
          (a.url ? (
            <a href={a.url} target="_blank" rel="noreferrer">
              <img
                className="ally-inbox__image"
                src={a.url}
                alt={a.caption ?? INBOX_WA.photo}
                loading="lazy"
              />
            </a>
          ) : (
            <p className="ally-small">{INBOX_WA.fileNotStored}</p>
          ))}
        {a.kind === "document" &&
          (a.url ? (
            <a className="ally-link ally-small" href={a.url} target="_blank" rel="noreferrer">
              {fill(INBOX_WA.openFile, { name: a.filename ?? "file" })}
            </a>
          ) : (
            <p className="ally-small">{INBOX_WA.fileNotStored}</p>
          ))}
      </div>
    ))}
  </>
);

/** Whether a message shows ticks: one sent to the person on WhatsApp. */
export const showsDelivery = (m: InboxMessage, channel: string): boolean =>
  channel === "whatsapp" && m.role !== "user" && Boolean(m.status);

export const ACCEPTED_FILES =
  "image/jpeg,image/png,application/pdf,text/plain,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.ms-powerpoint," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/**
 * WA-A §3: what a WhatsApp reply can carry besides its text: one file, or up to 3 reply buttons
 * (BT1's interactive send). Rendered inside the reply form.
 */
export const ReplyExtras: React.FC<{
  file: File | null;
  onFile: (file: File | null) => void;
  buttons: string[] | null;
  onButtons: (buttons: string[] | null) => void;
  disabled?: boolean;
}> = ({ file, onFile, buttons, onButtons, disabled }) => (
  <div className="ally-inbox__extras">
    {file ? (
      <p className="ally-small" data-testid="inbox-attached">
        {file.name}{" "}
        <Button
          variant={ButtonVariant.TEXT}
          size="sm"
          type="button"
          className="ally-link ally-link--inline"
          onClick={() => onFile(null)}
        >
          {INBOX_WA.removeFile}
        </Button>
      </p>
    ) : (
      <label className="ally-link ally-small ally-inbox__attach" title={INBOX_WA.attachHint}>
        {INBOX_WA.attach}
        <Input
          type="file"
          className="sr-only"
          accept={ACCEPTED_FILES}
          disabled={disabled}
          data-testid="inbox-attach-input"
          onChange={event => onFile(event.target.files?.[0] ?? null)}
        />
      </label>
    )}
    {!file &&
      (buttons === null ? (
        <Button
          variant={ButtonVariant.TEXT}
          size="sm"
          type="button"
          className="ally-link ally-small"
          disabled={disabled}
          title={INBOX_WA.buttonsHint}
          onClick={() => onButtons(["", "", ""])}
        >
          {INBOX_WA.addButtons}
        </Button>
      ) : (
        <fieldset className="ally-inbox__buttons">
          <legend className="ally-small">{INBOX_WA.buttonsHint}</legend>
          {buttons.map((value, i) => (
            <Input
              key={i}
              className="ally-input"
              maxLength={20}
              aria-label={fill(INBOX_WA.buttonLabel, { n: String(i + 1) })}
              value={value}
              disabled={disabled}
              onChange={event =>
                onButtons(buttons.map((b, j) => (j === i ? event.target.value : b)))
              }
            />
          ))}
          <Button
            variant={ButtonVariant.TEXT}
            size="sm"
            type="button"
            className="ally-link ally-small"
            onClick={() => onButtons(null)}
          >
            {INBOX_WA.removeFile}
          </Button>
        </fieldset>
      ))}
  </div>
);
