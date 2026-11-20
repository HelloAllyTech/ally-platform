---
name: ally-blog
description: Write a post for the Ally blog and save it as a draft in Ally admin. Use when the user asks for a blog post, an engineering write-up, a release note or a product article for Ally, including "turn this conversation into a blog". Not for editing a published post and never for publishing one.
---

# Ally blog

Writes posts for the Ally blog (app.helloally.ai/blog) through the `ally-blog` MCP server and leaves them as **drafts**. A person reviews and publishes in Ally admin → Blog. You cannot publish, unpublish or delete.

## Setup (once)

In Ally admin → Blog, choose **Connect Claude**, create a key, then set two environment variables in your shell profile (the sheet shows both lines; the key is shown only once):

```bash
export ALLY_BLOG_URL="<the URL shown in the sheet>"
export ALLY_BLOG_KEY="bga_…"
```

The server is declared in this repo's `.mcp.json`. The key writes drafts as you and stops working if you lose the blog edit permission.

## How to write a post

The writing guidance is a skill in the **Skills Store** (prompt `blog_authoring_skill`), so it can be changed without a deploy. You do not carry a copy here. Always start with the tool:

1. Call **`blog_guide`**. It returns the live skill (what a post must contain, how to illustrate it, the voice, what never goes in a public post) and what the blog supports (allowed HTML, image rules, the tags and cover colours in use). Follow it.
2. **`list_posts`** so you do not repeat a topic.
3. Plan the pictures with the sections. Make each image, then **`request_image_upload`** and upload the file with the `curl` line it returns. Never send image bytes through a tool.
4. **`create_draft`** with title, tldr, body (allowed tags only), tags, coverColor, authorName and headerImageUrl. Read the `issues` it returns and fix them with **`update_draft`**.
5. Tell the person where to review it and which facts need their confirmation. Never say it is published.

If the tools are missing, the environment variables are not set or Claude Code was started before they were: say so and stop. Do not try to write to the blog any other way.
