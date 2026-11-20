import { FC, useState } from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  Button,
  Modal,
  Search,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from "@ally-ui-mono/ui-shared";

import { errorMessage } from "./landingPageErrors";
import { LandingPageFormDialog } from "./LandingPageFormDialog";
import {
  AdminLandingPage,
  LandingPageStatus,
  useCreateLandingPageMutation,
  useDeleteLandingPageMutation,
  useGetLandingPagesQuery,
} from "../../api/landingPages";
import { buildPublicLink } from "../../components/organization-access-details/text-helpline/helpers";

const PAGE_SIZE = 20;

type StatusFilter = "ALL" | LandingPageStatus;

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * The Landing pages tab: every page across organizations, and a button to make
 * a new one. Opening a page opens the editor, which is the page itself.
 */
export const LandingPages: FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminLandingPage | null>(null);

  const { data, isLoading, isError, refetch } = useGetLandingPagesQuery({
    search: search.trim() || undefined,
    status: status === "ALL" ? undefined : status,
    page: 1,
    limit,
  });
  const [createPage, { isLoading: isCreating }] = useCreateLandingPageMutation();
  const [deletePage, { isLoading: isDeleting }] = useDeleteLandingPageMutation();

  const pages = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl">Landing pages</h1>
          <p className="text-sm opacity-70">
            Public pages for a campaign. Each belongs to one organization and opens at
            /organization-code/address.
          </p>
        </div>
        <Button
          kind="primary"
          onClick={() => {
            setCreateError(null);
            setCreating(true);
          }}
        >
          New landing page
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <Search
            id="landing-pages-search"
            labelText="Search landing pages"
            placeholder="Search by name or address"
            size="md"
            value={search}
            onChange={event => {
              setSearch(event.target.value);
              setLimit(PAGE_SIZE);
            }}
          />
        </div>
        <Select
          id="landing-pages-status"
          labelText="Status"
          hideLabel
          size="md"
          value={status}
          onChange={event => {
            setStatus(event.target.value as StatusFilter);
            setLimit(PAGE_SIZE);
          }}
        >
          <SelectItem value="ALL" text="All" />
          <SelectItem value="PUBLISHED" text="Live" />
          <SelectItem value="DRAFT" text="Drafts" />
        </Select>
      </div>

      {isLoading ? (
        <p role="status">Loading…</p>
      ) : isError ? (
        <p role="alert">
          Couldn&apos;t load the landing pages.{" "}
          <button type="button" className="underline" onClick={() => refetch()}>
            Try again
          </button>
        </p>
      ) : pages.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-lg">
            {search || status !== "ALL" ? "No landing pages match." : "No landing pages yet."}
          </p>
          {!search && status === "ALL" && (
            <p className="text-sm opacity-70">
              Create one to design a page parents can reach from a link.
            </p>
          )}
        </div>
      ) : (
        <>
          <Table aria-label="Landing pages">
            <TableHead>
              <TableRow>
                <TableHeader>Page</TableHeader>
                <TableHeader>Organization</TableHeader>
                <TableHeader>Address</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Last edited</TableHeader>
                <TableHeader>
                  <span className="sr-only">Actions</span>
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {pages.map(page => (
                <TableRow key={page.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="underline"
                      onClick={() => navigate(`/landing-pages/${page.id}`)}
                    >
                      {page.name}
                    </button>
                  </TableCell>
                  <TableCell>{page.tenantName}</TableCell>
                  <TableCell>
                    <code>{page.path}</code>
                  </TableCell>
                  <TableCell>
                    {page.status === "PUBLISHED" ? (
                      <Tag size="sm" type={page.hasUnpublishedChanges ? "warm-gray" : "green"}>
                        {page.hasUnpublishedChanges ? "Live, unpublished changes" : "Live"}
                      </Tag>
                    ) : (
                      <Tag size="sm" type="gray">
                        Draft
                      </Tag>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(page.updatedAt)}</TableCell>
                  <TableCell>
                    <span className="flex gap-2">
                      <Button
                        kind="ghost"
                        size="sm"
                        onClick={() => navigate(`/landing-pages/${page.id}`)}
                      >
                        Edit
                      </Button>
                      {page.status === "PUBLISHED" && (
                        <Button
                          kind="ghost"
                          size="sm"
                          onClick={() =>
                            window.open(buildPublicLink(page.path), "_blank", "noopener,noreferrer")
                          }
                        >
                          Open
                        </Button>
                      )}
                      <Button kind="danger--ghost" size="sm" onClick={() => setPendingDelete(page)}>
                        Delete
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pages.length < total && (
            <div className="text-center">
              <Button kind="tertiary" size="sm" onClick={() => setLimit(limit + PAGE_SIZE)}>
                Load more ({total - pages.length} more)
              </Button>
            </div>
          )}
        </>
      )}

      <LandingPageFormDialog
        open={creating}
        mode="create"
        submitting={isCreating}
        serverError={createError}
        onClose={() => setCreating(false)}
        onSubmit={async values => {
          try {
            const created = await createPage({
              tenantId: values.tenantId,
              name: values.name,
              slug: values.slug,
              languages: values.languages,
              defaultLanguage: values.defaultLanguage,
              signUpEnabled: values.signUpEnabled,
            }).unwrap();
            setCreating(false);
            navigate(`/landing-pages/${created.id}`);
          } catch (error) {
            setCreateError(errorMessage(error, "Couldn't create the page"));
          }
        }}
      />

      <Modal
        open={pendingDelete !== null}
        danger
        modalHeading="Delete this landing page?"
        primaryButtonText="Delete page"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={isDeleting}
        onRequestClose={() => setPendingDelete(null)}
        onSecondarySubmit={() => setPendingDelete(null)}
        onRequestSubmit={async () => {
          if (!pendingDelete) return;
          try {
            await deletePage(pendingDelete.id).unwrap();
            toast.success("Deleted");
          } catch (error) {
            toast.error(errorMessage(error, "Couldn't delete the page"));
          }
          setPendingDelete(null);
        }}
        size="xs"
      >
        <p>
          <strong>{pendingDelete?.name}</strong> will stop working at{" "}
          <code>{pendingDelete?.path}</code> straight away
          {pendingDelete?.status === "PUBLISHED"
            ? ", and anyone with the link will see an error"
            : ""}
          . This can&apos;t be undone from here.
        </p>
      </Modal>
    </div>
  );
};
