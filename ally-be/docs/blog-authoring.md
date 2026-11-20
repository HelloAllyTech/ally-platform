# Blog authoring from Claude Code

A coding agent can write a blog post and save it as a **draft** in Ally admin. It cannot publish.

## Pieces

| Piece | Where |
|---|---|
| MCP server (JSON-RPC over HTTP) | `POST /api/v1/blog-authoring/mcp`, `src/blog/controller/blog-authoring.controller.ts` |
| Keys (`bga_…`, hash only, shown once) | `GET/POST/DELETE /api/v1/blog-authoring/keys` (needs `edit:blog`), table `blog_author_keys` |
| Tools | `blog_guide`, `list_posts`, `get_post`, `request_image_upload`, `create_draft`, `update_draft` (`src/blog/service/blog-authoring-tools.service.ts`) |
| Writing guidance | Skills Store prompt `blog_authoring_skill` (default `src/prompts/blog/authoring_skill.txt`), returned by `blog_guide` |
| What the blog supports | `src/blog/util/blog-authoring-guide.util.ts` (tags the sanitizer keeps, cover palette, body checks) |
| Claude Code side | `.mcp.json` (`ally-blog`) and `.claude/skills/ally-blog/SKILL.md` at the monorepo root |

## Guardrails

- Every post an agent writes is a **draft**; there is no tool that publishes, unpublishes or deletes, and a published post is read-only to the agent.
- A key writes as its owner and stops working when it is revoked or when its owner loses `edit:blog`.
- Calls are limited to 60 a minute per key.
- Image bytes never go through a tool: `request_image_upload` returns a presigned S3 URL and the agent uploads with `curl`.
- `create_draft` and `update_draft` return what the blog's sanitizer would strip (div, span, figure, table, svg, inline styles, `data:` images, missing alt text) so the agent can fix it.

## Changing how posts are written

Edit the `blog_authoring_skill` prompt in the Skills Store. No deploy.
