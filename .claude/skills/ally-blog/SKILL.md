---
name: ally-blog
description: Write a post for the Ally blog and save it as a draft in Ally admin, in three passes (research, compose, review). Use when the user asks for a blog post, an engineering write-up, a release note or a product article for Ally, including "turn this conversation into a blog". Not for editing a published post and never for publishing one.
---

# Ally blog

Writes posts for the Ally blog (app.helloally.ai/blog) through the `ally-blog` MCP server and leaves them as **drafts**. A person reviews and publishes in Ally admin → Blog. You cannot publish, unpublish or delete.

## Setup (once)

In Ally admin → Blog, choose **Connect Claude**, create a key, then set two environment variables in your shell profile (the sheet shows both lines; the key is shown only once):

```bash
export ALLY_BLOG_URL="<the URL shown in the sheet>"
export ALLY_BLOG_KEY="bga_…"
```

The server is declared in this repo's `.mcp.json`. The key writes drafts as you and stops working if you lose the blog edit permission. If the tools are missing, the variables are not set or Claude Code was started before they were: say so and stop.

## Three passes

The writing guidance lives in the **Skills Store**, one skill per pass, so it can change without a deploy. You do not carry a copy here. Read each with `blog_guide` and the pass name:

1. **research** (`blog_guide` with `pass: "research"`): find what is true and what can be said. Produce a research brief. Skill: `ally-blog-research`.
2. **compose** (`pass: "compose"`): write the post and its pictures from the brief, upload the images and save with `create_draft`. Skill: `ally-blog-compose`.
3. **review** (`pass: "review"`): read the saved draft as an outsider, run `check_draft`, fix with `update_draft`, report. Skill: `ally-blog-review`.

Use all three, in order, for a new post. Use one alone when that is all that is needed. Call `blog_guide` with no pass for the overview and what the blog supports. Never say a post is published.
