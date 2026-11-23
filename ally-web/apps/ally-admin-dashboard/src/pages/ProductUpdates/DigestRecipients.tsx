import { FC, FormEvent, useState } from "react";

import { Delete } from "@icons";
import { toast } from "sonner";

import {
  useAddDigestRecipientMutation,
  useGetDigestRecipientsQuery,
  useRemoveDigestRecipientMutation,
} from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";

// Deliberately loose: the server validates properly, this only catches typos before a round trip.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Who gets the daily email: add and remove addresses. The server is the source of truth. */
export const DigestRecipients: FC = () => {
  const t = en.productUpdates.recipients;
  const { data, isLoading, isError } = useGetDigestRecipientsQuery();
  const [addRecipient, { isLoading: isAdding }] = useAddDigestRecipientMutation();
  const [removeRecipient] = useRemoveDigestRecipientMutation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!LOOKS_LIKE_EMAIL.test(value)) {
      setError(t.invalid);
      return;
    }
    setError(null);
    const result = await addRecipient({ email: value });
    if ("error" in result && result.error) {
      // A duplicate comes back as a 409 with a message that names the address.
      const message = (result.error as { data?: { message?: string } }).data?.message;
      setError(message ?? t.addFailed);
      return;
    }
    setEmail("");
    toast.success(t.added(value.toLowerCase()));
  };

  const handleRemove = async (id: string, address: string) => {
    const result = await removeRecipient(id);
    if ("error" in result && result.error) {
      toast.error(t.removeFailed);
      return;
    }
    toast.success(t.removed(address));
  };

  const recipients = data?.recipients ?? [];

  return (
    <section
      className="mt-4 md:mt-6 p-4 shrink-0 border border-border-light bg-background-secondary"
      data-testid="digest-recipients"
    >
      <h2 className="text-base text-typography-900 font-secondary">{t.title}</h2>
      <p className="text-sm text-typography-700 mt-1 max-w-3xl">{t.description}</p>

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 mt-3" noValidate>
        <div className="flex flex-col gap-1 w-full md:w-auto">
          <label htmlFor="digest-recipient-email" className="text-xs text-typography-700">
            {t.emailLabel}
          </label>
          <input
            id="digest-recipient-email"
            type="email"
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder={t.emailPlaceholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "digest-recipient-error" : undefined}
            className="w-full md:w-[320px] rounded border border-border-light px-3 py-2 bg-white text-sm outline-none focus:border-primary-500"
          />
        </div>
        <Button
          type="submit"
          variant={ButtonVariant.SECONDARY}
          disabled={isAdding || !email.trim()}
        >
          {t.add}
        </Button>
        {error && (
          <p
            id="digest-recipient-error"
            role="alert"
            className="basis-full text-sm text-destructive-500"
          >
            {error}
          </p>
        )}
      </form>

      <div className="mt-3">
        {isLoading ? (
          <p className="text-sm text-typography-700">{t.loading}</p>
        ) : isError ? (
          <p className="text-sm text-destructive-500">{t.loadFailed}</p>
        ) : recipients.length === 0 ? (
          <p className="text-sm text-typography-700">{t.empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-light max-h-48 overflow-y-auto custom-scrollbar">
            {recipients.map(recipient => (
              <li
                key={recipient.id}
                className="flex items-center justify-between gap-3 py-1.5 text-sm text-typography-900"
              >
                <span className="break-all">{recipient.email}</span>
                <button
                  type="button"
                  onClick={() => handleRemove(recipient.id, recipient.email)}
                  aria-label={t.remove(recipient.email)}
                  title={t.remove(recipient.email)}
                  className="shrink-0 p-1 text-typography-700 hover:text-destructive-500"
                >
                  <Delete size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
