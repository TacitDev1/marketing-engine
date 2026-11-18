# Marketing Engine Wiki — maintainer guide

This is an **LLM-maintained knowledge base** for Larkwell Consulting's marketing, built on
Andrej Karpathy's "LLM wiki" pattern. Raw sources (the knowledge folder,
web articles, published LinkedIn posts) are immutable. This wiki is the curated,
cross-referenced layer the model writes and keeps current on top of them.

## Pages
Each page is one markdown file with front-matter:
```
---
title: SAP S/4HANA Migration
type: topic        # topic | service | competitor | campaign | audience | concept
updated: <iso date>
summary: one-line gist used for retrieval and indexes
sources: ["file or url it was derived from"]
---
Body in markdown. Link related pages with [[Other Page Title]].
```

## Principles
- One page per durable entity or concept. Keep pages focused and < ~400 words.
- Prefer updating an existing page over creating a near-duplicate.
- Cross-link generously with [[wiki links]] so the graph stays connected.
- Record marketing intelligence (themes, positioning, proof angles, terminology,
  audience pains, competitor notes) — NOT raw metrics dumps. Never invent facts.
- Stay in Larkwell's voice: plain, senior, specific. No hype words, no em dashes.

## Operations (run by the app)
- **Ingest**: read a new source once, write/update the few pages it touches.
- **Query**: answer from existing pages, not by re-reading raw sources.
- **Lint**: flag stale claims, contradictions, orphan pages, and missing links.
