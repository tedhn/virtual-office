# Issue tracker: Notion

Issues and specs for this repo live in Notion, in the issues database at
<https://app.notion.com/p/3cf1252612b580bf9f6dc6f988dd3e34?v=3cf1252612b580efb9bb000cfcabe01c>
(page id `3cf12526-12b5-80bf-9f6d-c6f988dd3e34`, default view
`3cf12526-12b5-80ef-b9bb-000cfcabe01c`).

All access is through the Notion MCP server (`mcp__claude_ai_Notion__*`), never through a
CLI or a raw API token.

## Before anything else: authentication

The Notion MCP server may expose only `authenticate` and `complete_authentication`. That
means it is not connected yet, and no read or write tool exists. Run the authentication
flow first and let the user complete it in their browser; the full toolset appears
afterwards. Do not fall back to scraping Notion over HTTP.

Tool names are not stable enough to hardcode here. Discover them with ToolSearch against
`mcp__claude_ai_Notion__` once authenticated, and prefer a search tool to locate the
issues database rather than assuming a fixed id shape.

## Conventions

- **Create an issue**: create a page in the issues database. The agent is authorised to
  create issues directly; it does not need to hand the user a draft first.
- **Read an issue**: fetch the page, including its comments and its property values.
- **List issues**: query the database, filtering on the triage property (see
  `docs/agents/triage-labels.md`).
- **Comment**: the agent may comment on an issue.
- **Labels**: the agent may set and clear triage property values.
- **Close**: the agent may close an issue by moving it to the closed state used by the
  database.

## When a skill says "publish to the issue tracker"

Create a page in the Notion issues database.

## When a skill says "fetch the relevant ticket"

Fetch that Notion page together with its comments.
