import React, { useEffect } from "react";

import { toast } from "sonner";

/** The reason ally-be gave, or a fallback. */
export const errMsg = (error: unknown, fallback: string): string => {
  const message = (error as { data?: { message?: unknown } } | undefined)?.data?.message;
  if (typeof message === "string" && message) return message;
  if (Array.isArray(message) && typeof message[0] === "string") return message[0];
  return fallback;
};

export const copyText = async (value: string, ok: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(ok);
  } catch {
    toast.error(value);
  }
};

/** The URL of a collection's page on this app, as a visitor would type it. */
export const publicPageUrl = (slug: string): string => {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  return `${window.location.origin}${base}/d/${slug}`;
};

export const inputClass =
  "w-full rounded-none border border-border-light bg-white px-3 py-2 text-base text-typography-900 placeholder:text-typography-500 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500 disabled:opacity-50";

export const Field: React.FC<{
  label: string;
  hint?: string;
  htmlFor: string;
  children: React.ReactNode;
}> = ({ label, hint, htmlFor, children }) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={htmlFor} className="text-sm font-medium text-typography-800">
      {label}
    </label>
    {children}
    {hint && <span className="text-xs text-typography-600">{hint}</span>}
  </div>
);

export const Badge: React.FC<{ tone?: "public" | "private" | "neutral"; children: string }> = ({
  tone = "neutral",
  children,
}) => {
  const tones = {
    public: "bg-[#E7F6EC] text-[#14532D]",
    private: "bg-[#F1EFFF] text-[#3B2FA8]",
    neutral: "bg-background-secondary text-typography-700",
  };
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
};

/** A centred dialog. Escape and a click on the backdrop close it. */
export const Modal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, onClose, children }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92dvh] w-full overflow-y-auto bg-white p-5 shadow-xl sm:max-w-2xl"
      >
        <h2 className="mb-4 font-secondary text-2xl text-typography-900">{title}</h2>
        {children}
      </div>
    </div>
  );
};
