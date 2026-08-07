---
name: email-to-note
description: Turn an email (plus any attachments) into a PIP note. Use when the user hands over an email to "bring into our system", "turn into a note", "migrate", or says "we got an email from X about Y" and wants it captured — not for tickets/tasks, which go through ado-sync or monday-sync instead.
---

# email-to-note

Pulls one email thread into PIP as a **note** (reference material, no
lifecycle) — transformed into house style, with any attachments carried over
using the same file-attachment support tickets use.

Not for actionable work items — those are ado-sync's or monday-sync's job.
This is for reference material: requirements docs, link round-ups, meeting
recaps, spec attachments. If what arrives is clearly a task, say so and ask
before creating a note that should have been a task instead.

## 1. Find the email

Use the Gmail MCP tools directly — `search_threads` with a query built from
whatever the user gave you (sender name/email, subject keywords), then
`get_thread` (or `get_message`) with `messageFormat: FULL_CONTENT` to get
`plaintextBody`, `htmlBody`, and the `attachments` list.

## 2. Watch for corrupted links — verify before trusting

The Gmail MCP connector's plaintext/HTML extraction can mangle a URL's `=`
character when it's immediately followed by two hex-like digits (e.g.
`node-id=931-2426` comes back as `node-id<garbled>1-2426` — the `=93` reads
as a quoted-printable escape and gets eaten). This is silent — the rest of
the link looks fine, so a lifted URL can be subtly wrong without any error.

**Never hand-repair a garbled link by guessing the missing characters.**
Instead, open the actual message in the browser and read the real `href`s:

1. Load `mcp__claude-in-chrome__*` tools (this needs Key's authenticated
   session — Gmail cookies aren't available in the sandboxed browser).
2. Navigate to `https://mail.google.com/mail/u/1/#search/<query>` (try
   `/u/1/` first, matching jclark@folklore.digital; Gmail redirects to the
   right account index on its own if that's wrong).
3. Open the message, then `find` the links by description and `read_page`
   each one specifically — the `href` attribute is the real, correctly
   decoded URL, since Gmail's own rendering already fixed the encoding.

Cross-check at least one link against anything the user already pasted into
chat themselves (often more reliable than either extraction) before trusting
the rest.

## 3. Download attachments the same way

There is no "download this attachment" tool in the Gmail connector — only
filename/mimeType/id metadata. Get the bytes via the same authenticated
browser session:

1. `find` the attachment's "Download attachment <filename>" button and click
   it. It lands in `~/Downloads/<filename>`.
2. This is a real file download — the "explicit permission" rule for
   downloads is satisfied by the user naming this exact document as part of
   asking you to bring the email in; you don't need to re-ask for a document
   they explicitly asked you to fetch.

For office documents (.docx/.pdf/etc.), you'll usually want their text too —
`textutil -convert txt -stdout "<path>"` (macOS) is enough to read the
content and write a proper structured summary rather than copying verbatim.

## 4. Pick the destination project

Match the email to an existing PIP project by sender/company/subject —
`curl -s http://127.0.0.1:4288/api/projects` and compare names. Don't create
a new project for this; if nothing obviously fits, ask rather than guessing.

## 5. Write the note — transform, don't paste

Compose `bodyMd` in the house style already used for synced email notes
(see any note with `source_type: "email"` for a live example, e.g. the Best
Buy / Anna Cole notes):

- Opens with **`**From:** {sender}, {date} — {one line of context}`**.
- Real `## Heading` sections that organize the content, not a raw copy of
  the email body. Turn prose into a list where the email is really a list.
- Markdown links for anything you verified in step 2, with descriptive link
  text, not bare URLs.

Create it via the API, never raw SQL:

```bash
curl -s -X POST http://127.0.0.1:4288/api/notes \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "…",
    "bodyMd": "…",
    "sourceType": "email",
    "projectId": "<the project id from step 4>",
    "tags": ["…"]
  }'
```

Pick tags matching the project's existing convention (check a sibling note's
tags first rather than inventing new ones).

## 6. Attach files

Use `scripts/pip-ingest-assets.js` — it now handles documents (PDF, DOCX,
XLSX, ...) as well as images, auto-detecting `kind` from the mime type. Only
images get inlined into the note's markdown; documents attach as gallery
files (viewable via the in-app PDF/DOCX viewer) and are never inlined.

```bash
echo '[{
  "entityType": "note",
  "entityId": "<note id from step 5>",
  "file": "/Users/key/Downloads/<filename>",
  "title": "<caption describing what the document IS, not its filename>",
  "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}]' | node scripts/pip-ingest-assets.js
```

`title` is required and enforced to not just be the filename — same rule as
image ingestion, for the same reason: a filename tells a future reader
nothing about what's actually in the document.

## 7. Report

State: which note (title + which project), what got attached, and call out
explicitly any link you had to re-verify in the browser because the direct
extraction mangled it — that's the failure mode this skill exists to catch,
so a silent success on that front is worth confirming out loud.
