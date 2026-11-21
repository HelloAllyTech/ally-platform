import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

/**
 * The resources directory. Open to any signed-in user; ally-be decides what each caller may see
 * (public entries and their own) and change (only what they own).
 */

export type DirectoryVisibility = "public" | "private";
export type DirectoryLayout = "grid" | "list";
export type EntryScope = "all" | "public" | "mine";

export interface DirectoryEntry {
  id: string;
  title: string;
  description: string;
  category: string;
  organization: string;
  websiteUrl: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  region: string;
  country: string;
  tags: string[];
  languages: string[];
  visibility: DirectoryVisibility;
  /** True for the caller's own entries: the only ones they can edit or delete. */
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DirectoryEntryInput = Partial<
  Omit<DirectoryEntry, "id" | "isOwner" | "createdAt" | "updatedAt">
> & { title: string };

export interface CollectionSettings {
  headline: string;
  tagline: string;
  accentColor: string;
  layout: DirectoryLayout;
  showSearch: boolean;
  showCategoryFilter: boolean;
  showContactDetails: boolean;
  contactEmail: string;
  footerNote: string;
}

export interface DomainVerification {
  txtName: string;
  txtValue: string;
  /** Where the domain's CNAME points. Empty when the server has none configured. */
  cnameTarget: string;
}

export interface DirectoryCollectionSummary {
  id: string;
  name: string;
  description: string;
  slug: string;
  published: boolean;
  settings: CollectionSettings;
  customDomain: string | null;
  domainVerified: boolean;
  domainVerification: DomainVerification | null;
  createdAt: string;
  updatedAt: string;
  entryCount: number;
}

export interface DirectoryCollection extends Omit<DirectoryCollectionSummary, "entryCount"> {
  entries: DirectoryEntry[];
}

export type CollectionPatch = Partial<{
  name: string;
  description: string;
  slug: string;
  published: boolean;
  settings: Partial<CollectionSettings>;
}>;

export const directoryApi = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getDirectoryEntries: builder.query<
      DirectoryEntry[],
      { scope?: EntryScope; search?: string; category?: string } | void
    >({
      query: params => ({
        url: ApiEndpoints.DIRECTORY.ENTRIES,
        method: HttpMethod.GET,
        params: params || undefined,
      }),
      providesTags: [TAG_TYPES.DIRECTORY_ENTRIES],
    }),
    createDirectoryEntry: builder.mutation<DirectoryEntry, DirectoryEntryInput>({
      query: body => ({ url: ApiEndpoints.DIRECTORY.ENTRIES, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.DIRECTORY_ENTRIES],
    }),
    updateDirectoryEntry: builder.mutation<
      DirectoryEntry,
      { id: string; body: Partial<DirectoryEntryInput> }
    >({
      query: ({ id, body }) => ({
        url: ApiEndpoints.DIRECTORY.ENTRY(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DIRECTORY_ENTRIES, TAG_TYPES.DIRECTORY_COLLECTIONS],
    }),
    deleteDirectoryEntry: builder.mutation<void, string>({
      query: id => ({ url: ApiEndpoints.DIRECTORY.ENTRY(id), method: HttpMethod.DELETE }),
      invalidatesTags: [TAG_TYPES.DIRECTORY_ENTRIES, TAG_TYPES.DIRECTORY_COLLECTIONS],
    }),
    /** Ids of the caller's collections that hold an entry. */
    getEntryCollections: builder.query<string[], string>({
      query: id => ({ url: ApiEndpoints.DIRECTORY.ENTRY_COLLECTIONS(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DIRECTORY_COLLECTIONS],
    }),
    getDirectoryCollections: builder.query<DirectoryCollectionSummary[], void>({
      query: () => ({ url: ApiEndpoints.DIRECTORY.COLLECTIONS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DIRECTORY_COLLECTIONS],
    }),
    getDirectoryCollection: builder.query<DirectoryCollection, string>({
      query: id => ({ url: ApiEndpoints.DIRECTORY.COLLECTION(id), method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.DIRECTORY_COLLECTIONS],
    }),
    createDirectoryCollection: builder.mutation<
      DirectoryCollection,
      { name: string; description?: string }
    >({
      query: body => ({ url: ApiEndpoints.DIRECTORY.COLLECTIONS, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.DIRECTORY_COLLECTIONS],
    }),
    updateDirectoryCollection: builder.mutation<
      DirectoryCollection,
      { id: string; body: CollectionPatch }
    >({
      query: ({ id, body }) => ({
        url: ApiEndpoints.DIRECTORY.COLLECTION(id),
        method: HttpMethod.PATCH,
        body,
      }),
      invalidatesTags: [TAG_TYPES.DIRECTORY_COLLECTIONS],
    }),
    deleteDirectoryCollection: builder.mutation<void, string>({
      query: id => ({ url: ApiEndpoints.DIRECTORY.COLLECTION(id), method: HttpMethod.DELETE }),
      invalidatesTags: [TAG_TYPES.DIRECTORY_COLLECTIONS],
    }),
    saveEntryToCollection: builder.mutation<
      DirectoryCollection,
      { collectionId: string; entryId: string }
    >({
      query: ({ collectionId, entryId }) => ({
        url: ApiEndpoints.DIRECTORY.COLLECTION_ENTRY(collectionId, entryId),
        method: HttpMethod.PUT,
      }),
      invalidatesTags: [TAG_TYPES.DIRECTORY_COLLECTIONS],
    }),
    removeEntryFromCollection: builder.mutation<
      DirectoryCollection,
      { collectionId: string; entryId: string }
    >({
      query: ({ collectionId, entryId }) => ({
        url: ApiEndpoints.DIRECTORY.COLLECTION_ENTRY(collectionId, entryId),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.DIRECTORY_COLLECTIONS],
    }),
    setCollectionDomain: builder.mutation<DirectoryCollection, { id: string; domain: string }>({
      query: ({ id, domain }) => ({
        url: ApiEndpoints.DIRECTORY.COLLECTION_DOMAIN(id),
        method: HttpMethod.PUT,
        body: { domain },
      }),
      invalidatesTags: [TAG_TYPES.DIRECTORY_COLLECTIONS],
    }),
    clearCollectionDomain: builder.mutation<DirectoryCollection, string>({
      query: id => ({
        url: ApiEndpoints.DIRECTORY.COLLECTION_DOMAIN(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.DIRECTORY_COLLECTIONS],
    }),
    verifyCollectionDomain: builder.mutation<DirectoryCollection, string>({
      query: id => ({
        url: ApiEndpoints.DIRECTORY.COLLECTION_DOMAIN_VERIFY(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.DIRECTORY_COLLECTIONS],
    }),
  }),
});

export const {
  useGetDirectoryEntriesQuery,
  useCreateDirectoryEntryMutation,
  useUpdateDirectoryEntryMutation,
  useDeleteDirectoryEntryMutation,
  useGetEntryCollectionsQuery,
  useGetDirectoryCollectionsQuery,
  useGetDirectoryCollectionQuery,
  useCreateDirectoryCollectionMutation,
  useUpdateDirectoryCollectionMutation,
  useDeleteDirectoryCollectionMutation,
  useSaveEntryToCollectionMutation,
  useRemoveEntryFromCollectionMutation,
  useSetCollectionDomainMutation,
  useClearCollectionDomainMutation,
  useVerifyCollectionDomainMutation,
} = directoryApi;
