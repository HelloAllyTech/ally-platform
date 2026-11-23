import { ApiEndpoints, HttpMethod } from "@constants";

import { baseAPI } from "./baseAPI";

// Mirrors the ally-be BlogResponseDto (published posts only on these endpoints).
export type BlogPost = {
  id: string;
  title: string;
  slug: string;
  tldr?: string | null;
  body?: string | null; // sanitized HTML
  tags: string[];
  coverColor: string; // #RRGGBB, shown when there is no header image
  authorName?: string | null;
  authorEmail?: string | null;
  headerImageUrl?: string | null;
  status: "DRAFT" | "PUBLISHED";
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BlogReview = {
  status: "DRAFT" | "PUBLISHED";
  slug: string;
  expiresAt: string;
  post: BlogPost;
};

export type BlogSuggestionBody = {
  name: string;
  email?: string;
  comment: string;
  quote?: string;
};

type GetPublicBlogsResponse = { blogs: BlogPost[]; count: number };

/** A tag used on at least one published post, with how many carry it. */
export type BlogTagCount = { tag: string; count: number };

const blogAPI = baseAPI.injectEndpoints({
  endpoints: builder => ({
    getPublicBlogs: builder.query<
      GetPublicBlogsResponse,
      { offset?: number; limit?: number; tag?: string } | void
    >({
      query: (params = {}) => ({
        url: ApiEndpoints.BLOG.GET_PUBLIC_BLOGS,
        method: HttpMethod.GET,
        params: params || undefined,
      }),
    }),
    getPublicBlogTags: builder.query<{ tags: BlogTagCount[] }, void>({
      query: () => ({
        url: ApiEndpoints.BLOG.GET_PUBLIC_BLOG_TAGS,
        method: HttpMethod.GET,
      }),
    }),
    getPublicBlogBySlug: builder.query<BlogPost, { slug: string }>({
      query: ({ slug }) => ({
        url: ApiEndpoints.BLOG.GET_PUBLIC_BLOG_BY_SLUG(slug),
        method: HttpMethod.GET,
      }),
    }),
    getBlogReview: builder.query<BlogReview, { token: string }>({
      query: ({ token }) => ({
        url: ApiEndpoints.BLOG.GET_BLOG_REVIEW(token),
        method: HttpMethod.GET,
      }),
    }),
    createBlogReviewSuggestion: builder.mutation<
      { success: true },
      { token: string; body: BlogSuggestionBody }
    >({
      query: ({ token, body }) => ({
        url: ApiEndpoints.BLOG.CREATE_BLOG_REVIEW_SUGGESTION(token),
        method: HttpMethod.POST,
        body,
      }),
    }),
  }),
});

export const {
  useGetPublicBlogsQuery,
  useGetPublicBlogTagsQuery,
  useGetPublicBlogBySlugQuery,
  useGetBlogReviewQuery,
  useCreateBlogReviewSuggestionMutation,
} = blogAPI;
