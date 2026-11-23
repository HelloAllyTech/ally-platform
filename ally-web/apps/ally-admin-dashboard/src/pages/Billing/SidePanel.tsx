import React from "react";

import { DoubleArrowRight } from "@assets";

/** The admin side panel, as LlmModelCatalogPanel draws it: full width on a phone, half from md. */
export const SidePanel: React.FC<{
  onClose: () => void;
  actions?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}> = ({ onClose, actions, testId, children }) => (
  <div className="fixed inset-0 z-50 flex" data-testid={testId}>
    <div className="flex-1 bg-black bg-opacity-50" onClick={onClose} />
    <div className="w-full md:w-[50%] md:min-w-[600px] bg-white shadow-xl border-l-[1px] border-border-light overflow-y-auto overflow-x-hidden custom-scrollbar">
      <div className="flex items-center justify-between gap-3 px-4 md:px-10 py-4 border-b border-border-light">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="inline-flex h-10 w-10 -ml-2 items-center justify-center md:h-auto md:w-auto md:ml-0 text-typography-700"
        >
          <DoubleArrowRight />
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      </div>
      <div className="px-4 md:px-10 pt-4 md:pt-6 pb-10 space-y-5">{children}</div>
    </div>
  </div>
);

export const inputClass =
  "w-full border border-border-light rounded-md px-3 py-2 text-base bg-white focus:outline-none focus:border-primary-500";

/** A labelled form field with optional help text. */
export const Field: React.FC<{
  id: string;
  label: string;
  help?: string;
  children: React.ReactNode;
}> = ({ id, label, help, children }) => (
  <div className="min-w-0">
    <label htmlFor={id} className="block text-sm text-typography-700 mb-1">
      {label}
    </label>
    {children}
    {help && <p className="mt-1 text-xs text-typography-500">{help}</p>}
  </div>
);
