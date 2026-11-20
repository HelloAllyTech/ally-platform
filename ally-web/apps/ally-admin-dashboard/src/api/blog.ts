import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";

import { baseAPI } from "./baseApi";

export type BlogStatus = "DRAFT" | "PUBLISHED";

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  tldr?: string | null;
  body?: string | null;
  tags: string[];
  coverColor: string;
  authorName?: string | null;
  headerImageUrl?: string | null;
  status: BlogStatus;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GetBlogsResponse {
  blogs: BlogPost[];
  count: number;
}

export interface GetBlogsQuery {
  search?: string;
  status?: BlogStatus;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface UpsertBlogRequest {
  title: string;
  slug?: string;
  tldr?: string;
  body?: string;
  tags?: string[];
  coverColor?: string;
  authorName?: string;
  headerImageUrl?: string;
  status?: BlogStatus;
}

export interface BlogImageUploadRequest {
  fileName: string;
  fileSize: number;
  contentType: string;
}

export interface BlogImageUploadResponse {
  presignedUrl: string;
  imageUrl: string;
}

/** One of your keys for Claude Code. The key itself is never listed, only its start. */
export interface BlogAuthoringKey {
  id: string;
  label: string;
  keyPrefix: string;
  lastUsedAt?: string | null;
  createdAt?: string;
}

/** `POST keys`: the only response that ever carries the key. */
export interface BlogAuthoringKeyCreated extends BlogAuthoringKey {
  key: string;
}

export interface BlogReviewLink {
  token: string;
  expiresAt: string;
  createdAt: string;
}

export type BlogSuggestionStatus = "OPEN" | "RESOLVED";

export interface BlogSuggestion {
  id: string;
  name: string;
  email: string | null;
  comment: string;
  quote: string | null;
  status: BlogSuggestionStatus;
  createdAt: string;
}

export interface BlogReviewState {
  link: BlogReviewLink | null;
  suggestions: BlogSuggestion[];
}

export const blogAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getBlogs: builder.query<GetBlogsResponse, GetBlogsQuery | void>({
      query: params => ({
        url: ApiEndpoints.BLOG.GET_BLOGS,
        method: HttpMethod.GET,
        params: params || undefined,
      }),
      providesTags: [TAG_TYPES.BLOGS],
    }),
    getBlog: builder.query<BlogPost, string>({
      query: id => ({
        url: ApiEndpoints.BLOG.GET_BLOG(id),
        method: HttpMethod.GET,
      }),
      providesTags: (_result, _error, id) => [{ type: TAG_TYPES.BLOGS, id }],
    }),
    createBlog: builder.mutation<BlogPost, UpsertBlogRequest>({
      query: body => ({
        url: ApiEndpoints.BLOG.CREATE_BLOG,
        method: HttpMethod.POST,
        body,
      }),
      invalidatesTags: [TAG_TYPES.BLOGS],
    }),
    updateBlog: builder.mutation<BlogPost, { id: string; data: Partial<UpsertBlogRequest> }>({
      query: ({ id, data }) => ({
        url: ApiEndpoints.BLOG.UPDATE_BLOG(id),
        method: HttpMethod.PATCH,
        body: data,
      }),
      invalidatesTags: [TAG_TYPES.BLOGS],
    }),
    publishBlog: builder.mutation<BlogPost, string>({
      query: id => ({
        url: ApiEndpoints.BLOG.PUBLISH_BLOG(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.BLOGS],
    }),
    unpublishBlog: builder.mutation<BlogPost, string>({
      query: id => ({
        url: ApiEndpoints.BLOG.UNPUBLISH_BLOG(id),
        method: HttpMethod.POST,
      }),
      invalidatesTags: [TAG_TYPES.BLOGS],
    }),
    deleteBlog: builder.mutation<{ success: boolean }, string>({
      query: id => ({
        url: ApiEndpoints.BLOG.DELETE_BLOG(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.BLOGS],
    }),
    getBlogImageUploadUrl: builder.mutation<BlogImageUploadResponse, BlogImageUploadRequest>({
      query: body => ({
        url: ApiEndpoints.BLOG.UPLOAD_IMAGE_URL,
        method: HttpMethod.POST,
        body,
      }),
    }),
    getBlogAuthoringKeys: builder.query<BlogAuthoringKey[], void>({
      query: () => ({ url: ApiEndpoints.BLOG_AUTHORING.KEYS, method: HttpMethod.GET }),
      providesTags: [TAG_TYPES.BLOG_AUTHORING_KEYS],
    }),
    createBlogAuthoringKey: builder.mutation<BlogAuthoringKeyCreated, { label: string }>({
      query: body => ({ url: ApiEndpoints.BLOG_AUTHORING.KEYS, method: HttpMethod.POST, body }),
      invalidatesTags: [TAG_TYPES.BLOG_AUTHORING_KEYS],
    }),
    revokeBlogAuthoringKey: builder.mutation<void, string>({
      query: id => ({
        url: ApiEndpoints.BLOG_AUTHORING.KEY_BY_ID(id),
        method: HttpMethod.DELETE,
      }),
      invalidatesTags: [TAG_TYPES.BLOG_AUTHORING_KEYS],
    }),
    getBlogReview: builder.query<BlogReviewState, string>({
      query: id => ({ url: ApiEndpoints.BLOG_REVIEW.POST(id), method: HttpMethod.GET }),
      providesTags: (_result, _error, id) => [{ type: TAG_TYPES.BLOG_REVIEW, id }],
    }),
    createBlogReviewLink: builder.mutation<BlogReviewLink, { id: string; days?: number }>({
      query: ({ id, days }) => ({
        url: ApiEndpoints.BLOG_REVIEW.LINK(id),
        method: HttpMethod.POST,
        body: days ? { days } : {},
      }),
      invalidatesTags: (_result, _error, { id }) => [{ type: TAG_TYPES.BLOG_REVIEW, id }],
    }),
    revokeBlogReviewLink: builder.mutation<{ success: boolean }, string>({
      query: id => ({ url: ApiEndpoints.BLOG_REVIEW.LINK(id), method: HttpMethod.DELETE }),
      invalidatesTags: (_result, _error, id) => [{ type: TAG_TYPES.BLOG_REVIEW, id }],
    }),
    setBlogSuggestionStatus: builder.mutation<
      BlogSuggestion,
      { id: string; suggestionId: string; status: BlogSuggestionStatus }
    >({
      query: ({ id, suggestionId, status }) => ({
        url: ApiEndpoints.BLOG_REVIEW.SUGGESTION(id, suggestionId),
        method: HttpMethod.PATCH,
        body: { status },
      }),
      invalidatesTags: (_result, _error, { id }) => [{ type: TAG_TYPES.BLOG_REVIEW, id }],
    }),
  }),
});

export const {
  useGetBlogsQuery,
  useGetBlogQuery,
  useLazyGetBlogQuery,
  useGetBlogReviewQuery,
  useCreateBlogReviewLinkMutation,
  useRevokeBlogReviewLinkMutation,
  useSetBlogSuggestionStatusMutation,
  useCreateBlogMutation,
  useUpdateBlogMutation,
  usePublishBlogMutation,
  useUnpublishBlogMutation,
  useDeleteBlogMutation,
  useGetBlogImageUploadUrlMutation,
  useGetBlogAuthoringKeysQuery,
  useCreateBlogAuthoringKeyMutation,
  useRevokeBlogAuthoringKeyMutation,
} = blogAPI;
