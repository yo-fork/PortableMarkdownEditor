# Mermaid 追加ギャラリー

[toc]

## 概要

この文書は Mermaid の追加構文をまとめた表示確認用サンプルです。

- timeline
- quadrantChart
- requirementDiagram
- xychart-beta
- sankey-beta
- packet-beta
- block-beta
- kanban
- C4Context
- flowchart subgraph

## Timeline

```mermaid
timeline
  title Portable Markdown Editor milestones
  2026-05-01 : Local vendor libraries
             : CSP hardening
  2026-05-06 : Mermaid rendering
             : KaTeX rendering
  2026-05-10 : Browser self-test
```

## Quadrant Chart

```mermaid
quadrantChart
  title Rendering priority map
  x-axis Low Risk --> High Risk
  y-axis Low Impact --> High Impact
  quadrant-1 Watch
  quadrant-2 Prioritize
  quadrant-3 Backlog
  quadrant-4 Quick wins
  Mermaid layout: [0.72, 0.86]
  KaTeX parsing: [0.38, 0.78]
  Header layout: [0.28, 0.46]
  Vendor audit: [0.63, 0.55]
```

## Requirement Diagram

```mermaid
requirementDiagram
  requirement local_only {
    id: 1
    text: The editor must not use external network calls.
    risk: high
    verifymethod: test
  }

  requirement safe_markdown {
    id: 2
    text: Raw HTML must stay disabled.
    risk: high
    verifymethod: inspection
  }

  element editor {
    type: application
  }

  editor - satisfies -> local_only
  editor - satisfies -> safe_markdown
```

## XY Chart

```mermaid
xychart-beta
  title "Rendering checks"
  x-axis [Markdown, Mermaid, KaTeX, Security]
  y-axis "Score" 0 --> 100
  bar [95, 88, 90, 98]
  line [90, 85, 87, 96]
```

## Sankey

```mermaid
sankey-beta
  Markdown,Parser,45
  Parser,Preview,35
  Parser,HTML Export,10
  Parser,Outline,8
  Preview,Mermaid SVG,12
  Preview,KaTeX HTML,10
```

## Packet

```mermaid
packet-beta
  title Local render package
  0-7: "Mode"
  8-15: "Flags"
  16-31: "Block count"
  32-63: "Content hash"
```

## Block

```mermaid
block-beta
  columns 3
  markdown["Markdown"] parser["Parser"] preview["Preview"]
  mermaid["Mermaid.js"] katex["KaTeX"] export["HTML/PDF"]
  markdown --> parser
  parser --> preview
  parser --> mermaid
  parser --> katex
  preview --> export
```

## Kanban

```mermaid
kanban
  Todo
    [Relative image checks]
    [More manual samples]
  Doing
    [Mermaid visual polish]
  Done
    [Security smoke]
    [Vendor static check]
```

## C4 Context

```mermaid
C4Context
  title Local editor context
  Person(user, "User", "Writes Markdown")
  System(editor, "Portable Markdown Editor", "Local-only browser app")
  System_Ext(files, "Local files", "Markdown and images")
  Rel(user, editor, "Edits and previews")
  Rel(editor, files, "Reads with permission")
```

## Flowchart Subgraph

```mermaid
flowchart TB
  subgraph Local[Local browser]
    A[Markdown file] --> B[Parser]
    B --> C[Preview]
    B --> D[Outline]
  end
  subgraph Vendor[Bundled vendor]
    M[Mermaid.js]
    K[KaTeX]
  end
  B --> M
  B --> K
```
