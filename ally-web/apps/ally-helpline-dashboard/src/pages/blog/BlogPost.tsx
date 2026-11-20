import { FC } from "react";

import { Link, useParams } from "react-router-dom";

import { useGetPublicBlogBySlugQuery } from "@api";
import { ROUTES } from "@constants";

import { BlogArticle } from "./BlogArticle";
import { BlogFooter } from "./BlogFooter";
import { BlogHeader } from "./BlogHeader";
import {
  BLOG_INDEX_DESCRIPTION,
  BLOG_INDEX_TITLE,
  blogPostTitle,
  excerptFromHtml,
} from "./blogMeta";
import { usePageMeta } from "./usePageMeta";

export const BlogPost: FC = () => {
  const { slug = "" } = useParams<{ slug: string }>();
  const {
    data: post,
    isFetching,
    isError,
  } = useGetPublicBlogBySlugQuery({ slug }, { skip: !slug });

  // These tags are set client-side, which is enough for the browser tab and for
  // crawlers that render JS. Link-preview scrapers (WhatsApp, Slack, LinkedIn)
  // read the raw HTML and never run the bundle, so they still see index.html's
  // defaults — giving them per-post tags needs server-rendered HTML for
  // /blog/:slug. See usePageMeta for the full note.
  usePageMeta({
    title: post ? blogPostTitle(post.title) : BLOG_INDEX_TITLE,
    // `||` not `??`: tldr is a nullable text column, so a post saved with an
    // empty one should still fall through to an excerpt of the body.
    description: post ? post.tldr || excerptFromHtml(post.body) : BLOG_INDEX_DESCRIPTION,
    image: post?.headerImageUrl,
    url: `/blog/${slug}`,
    type: post ? "article" : "website",
    publishedTime: post?.publishedAt ?? post?.createdAt,
  });

  return (
    <div className="blog-serif flex min-h-dvh flex-col bg-[#FAF9F5] text-[#29261f]">
      <BlogHeader />

      <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <Link
          to={ROUTES.BLOG}
          className="text-sm text-[#928b7c] transition-colors hover:text-[#29261f] max-md:inline-flex max-md:min-h-[44px] max-md:items-center"
        >
          ← All posts
        </Link>

        {isFetching ? (
          <p className="mt-8 text-[#565045]">Loading…</p>
        ) : isError || !post ? (
          <p className="mt-8 text-[#565045]">
            This post could not be found or is no longer available.
          </p>
        ) : (
          <BlogArticle post={post} />
        )}
      </div>
      <BlogFooter containerClassName="max-w-2xl" />
    </div>
  );
};
