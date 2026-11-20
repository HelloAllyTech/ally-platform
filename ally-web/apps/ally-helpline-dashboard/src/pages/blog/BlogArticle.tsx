import { FC } from "react";

import { Link } from "react-router-dom";

import { RichTextRenderer } from "@ally-ui-mono/ui-shared";
import type { BlogPost } from "@api";
import { ALLY_URL, ROUTES } from "@constants";

import { ShareActions } from "./ShareActions";

export const formatDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

/** Quiet "Written by" block shown after every post body. */
export const AuthorBlock: FC<{ post: Pick<BlogPost, "authorName" | "authorEmail"> }> = ({
  post,
}) => {
  const hasAuthor = Boolean(post.authorName || post.authorEmail);
  return (
    <aside
      aria-label="About the author"
      data-testid="author-block"
      className="mt-12 rounded-2xl border border-[#29261f]/10 bg-white/60 px-5 py-5 text-sm text-[#565045]"
    >
      {hasAuthor && (
        <>
          <h2 className="text-xs uppercase tracking-wide text-[#928b7c]">Written by</h2>
          {post.authorName && <p className="mt-1 text-base text-[#29261f]">{post.authorName}</p>}
          {post.authorEmail && (
            <p className="mt-1">
              <a
                href={`mailto:${post.authorEmail}`}
                className="underline underline-offset-2 hover:text-[#29261f]"
              >
                {post.authorEmail}
              </a>
            </p>
          )}
        </>
      )}
      <p className={hasAuthor ? "mt-3" : ""}>
        Ally is a mental health training platform.{" "}
        <a
          href={ALLY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-[#29261f]"
        >
          helloally.ai
        </a>
      </p>
    </aside>
  );
};

/** The article body of a post: header, image, rich text, author block, tags. */
export const BlogArticle: FC<{ post: BlogPost }> = ({ post }) => (
  <article className="mt-8">
    <header>
      <p className="text-sm text-[#928b7c]">{formatDate(post.publishedAt ?? post.createdAt)}</p>
      <h1 className="mt-4 text-4xl leading-[1.15] sm:text-5xl">{post.title}</h1>
      {post.tldr && <p className="mt-6 text-xl leading-8 text-[#565045]">{post.tldr}</p>}
      {post.authorName && <p className="mt-6 text-sm text-[#928b7c]">By {post.authorName}</p>}
      <div className="mt-8 flex items-center gap-3 border-t border-[#29261f]/10 pt-5">
        <span className="text-sm text-[#928b7c]">Share</span>
        <ShareActions slug={post.slug} title={post.title} />
      </div>
    </header>

    {post.headerImageUrl && (
      <img
        src={post.headerImageUrl}
        alt={post.title}
        className="mb-10 mt-8 w-full rounded-2xl object-cover"
      />
    )}

    <div data-testid="article-body">
      <RichTextRenderer
        content={post.body}
        allowImages
        className="mt-8 max-w-none break-words text-[17px] leading-[1.75] [&_img]:h-auto [&_img]:max-w-full [&_pre]:overflow-x-auto text-[#33322F] [&_h1]:text-3xl [&_h1]:text-[#29261f] [&_h1]:mt-10 [&_h1]:mb-4 [&_h2]:text-2xl [&_h2]:text-[#29261f] [&_h2]:mt-10 [&_h2]:mb-3 [&_h3]:text-xl [&_h3]:text-[#29261f] [&_h3]:mt-8 [&_h3]:mb-2 [&_p]:my-4 [&_a]:underline [&_a]:underline-offset-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-4 [&_li]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[#D97757] [&_blockquote]:pl-5 [&_blockquote]:my-6 [&_blockquote]:text-lg [&_blockquote]:text-[#565045] [&_img]:rounded-xl"
      />
    </div>

    <AuthorBlock post={post} />

    {post.tags?.length > 0 && (
      <div className="mt-12 flex flex-wrap gap-2 border-t border-[#29261f]/10 pt-6">
        {post.tags.map(tag => (
          <Link
            key={tag}
            to={`${ROUTES.BLOG}?tag=${encodeURIComponent(tag)}`}
            className="inline-flex min-h-[40px] items-center rounded-full border border-[#29261f]/10 bg-white px-3 py-1 text-sm text-[#565045] md:min-h-0 transition-colors hover:border-[#29261f]/30 hover:text-[#29261f]"
          >
            #{tag}
          </Link>
        ))}
      </div>
    )}
  </article>
);
