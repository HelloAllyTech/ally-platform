import { FC, useEffect, useState } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import { useGetCrmContactsQuery } from "@api";
import { Button, EmptyState } from "@components";
import { en } from "@constants";

import { ContactPanel } from "./ContactPanel";
import { formatDay } from "./formatDay";

/** What the panel is open on: nothing, a new contact, or an existing one by id. */
type PanelTarget = null | "new" | { id: string };

/**
 * Contacts: the team's shared mini CRM. A searchable A–Z list; a click (or Add contact) opens the
 * contact in a side panel where it is edited and its conversation log is kept.
 */
export const Contacts: FC = () => {
  const t = en.crm;
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<PanelTarget>(null);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const { data, isLoading, isError } = useGetCrmContactsQuery({ search: search || undefined });
  const contacts = data?.contacts ?? [];

  return (
    <div className="md:h-full md:overflow-y-auto custom-scrollbar font-primary flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-2xl text-typography-900 font-secondary">{t.title}</h1>
          <p className="text-sm text-typography-700 mt-1 max-w-3xl">{t.description}</p>
        </div>
        <Button onClick={() => setTarget("new")} data-testid="add-contact">
          {t.addContact}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mt-4 md:mt-6 shrink-0">
        <div className="flex flex-col gap-1 w-full md:w-auto">
          <label htmlFor="crm-search" className="text-xs text-typography-700">
            {t.searchLabel}
          </label>
          <input
            id="crm-search"
            type="search"
            enterKeyHint="search"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full md:w-[320px] rounded border border-border-light px-3 py-2 bg-white text-sm outline-none focus:border-primary-500"
          />
        </div>
        {!isLoading && !isError && (
          <span className="text-sm text-typography-700 pb-2">{t.table.count(contacts.length)}</span>
        )}
      </div>

      <div className="md:flex-1 md:min-h-[320px] md:overflow-y-auto custom-scrollbar mt-4">
        {isLoading ? (
          <p className="text-typography-700">{t.table.loading}</p>
        ) : isError ? (
          <p className="text-destructive-500">{t.table.loadFailed}</p>
        ) : contacts.length === 0 ? (
          <EmptyState title={search ? t.table.noMatches : t.table.none} hideActionButton />
        ) : (
          <Table className="w-full text-left border-collapse">
            <TableHead>
              <TableRow className="border-b border-border-light text-sm text-typography-700">
                <TableHeader className="py-3 pr-4 font-medium">{t.columns.name}</TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">
                  {t.columns.organization}
                </TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">{t.columns.jobTitle}</TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">{t.columns.manager}</TableHeader>
                <TableHeader className="py-3 pr-4 font-medium">{t.columns.lastLogged}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {contacts.map(contact => (
                <TableRow
                  key={contact.id}
                  tabIndex={0}
                  onClick={() => setTarget({ id: contact.id })}
                  onKeyDown={e => {
                    if (e.key === "Enter") setTarget({ id: contact.id });
                  }}
                  className="border-b border-border-light text-sm text-typography-900 align-top cursor-pointer hover:bg-background-secondary"
                >
                  <TableCell className="py-3 pr-4 font-medium">{contact.fullName}</TableCell>
                  <TableCell className="py-3 pr-4">{contact.organization || "—"}</TableCell>
                  <TableCell className="py-3 pr-4">{contact.jobTitle || "—"}</TableCell>
                  <TableCell className="py-3 pr-4">
                    {contact.relationshipManagerName ?? (
                      <span className="text-typography-700">{t.table.unassigned}</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 pr-4 whitespace-nowrap">
                    {contact.lastLoggedOn ? (
                      formatDay(contact.lastLoggedOn)
                    ) : (
                      <span className="text-typography-700">{t.table.never}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {target && (
        <ContactPanel
          // A fresh panel (and form state) per contact, so switching from a duplicate match never
          // carries one contact's edits into another.
          key={target === "new" ? "new" : target.id}
          contactId={target === "new" ? null : target.id}
          onOpenContact={id => setTarget({ id })}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
};
