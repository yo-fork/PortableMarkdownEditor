# Mermaid 詳細ギャラリー

[toc]

## 概要

この文書は Mermaid の基本図種に少し複雑なケースを加えた表示確認用サンプルです。

- sequenceDiagram: loop / alt / par / note
- stateDiagram-v2: nested state
- classDiagram: inheritance / composition / dependency
- erDiagram: attributes / cardinality
- journey: score lanes
- gantt: milestones / active / done
- pie: multiple colors
- mindmap: nested branches
- gitGraph: branch / checkout / merge

## Sequence Advanced

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant App as Editor
  participant Parser as Markdown Parser
  participant Sec as Security
  participant View as Preview

  U->>App: Open local Markdown
  loop Edit cycle
    U->>App: Type rich text
    App->>Parser: Parse Markdown
    Parser->>Sec: Sanitize HTML and SVG
    Sec-->>View: Safe render model
  end
  alt Save requested
    App-->>U: Write Markdown file
  else Preview only
    View-->>U: Show local preview
  end
  par Local checks
    App->>Sec: Link allowlist
  and Rendering
    App->>View: Mermaid and KaTeX
  end
  Note over U,View: No CDN / no network
```

## State Nested

```mermaid
stateDiagram-v2
  [*] --> Editing
  state Editing {
    [*] --> Rich
    Rich --> InlineSource: cursor enters formatted text
    InlineSource --> Rich: cursor leaves source span
    Rich --> BlockSource: click Mermaid or code
    BlockSource --> Rich: apply or cancel
  }
  Editing --> Preview: switch mode
  Preview --> Split: compare source and result
  Split --> Editing: return to rich mode
  Editing --> Saved: save
  Saved --> [*]
```

## Class Relationships

```mermaid
classDiagram
  class DocumentState {
    +string markdown
    +string fileName
    +string theme
    +persistDraft()
  }

  class MarkdownRenderer {
    +renderMarkdownHtml()
    +renderKaTeXIn(root)
    +renderMermaidIn(root)
  }

  class SvgSanitizer {
    +sanitizeSvgMarkup(svg)
    +normalizeSvgMarkupForParsing(svg)
    +polishMermaidSvg(svg)
  }

  class AssetRegistry {
    +Map assetUrls
    +resolveRelativeImage(path)
  }

  DocumentState *-- AssetRegistry
  MarkdownRenderer --> SvgSanitizer
  MarkdownRenderer ..> DocumentState
```

## ER Document Model

```mermaid
erDiagram
  DOCUMENT ||--o{ HEADING : contains
  DOCUMENT ||--o{ ASSET : references
  DOCUMENT ||--o{ TASK : tracks
  HEADING ||--o{ HEADING : nests

  DOCUMENT {
    string id
    string fileName
    string markdownRelativePath
    datetime savedAt
  }
  HEADING {
    int level
    string title
    string slug
  }
  ASSET {
    string relativePath
    string objectUrl
    bool permissionGranted
  }
  TASK {
    string label
    bool checked
  }
```

## User Journey

```mermaid
journey
  title Portable Markdown Editor review
  section Open
    Choose Markdown file: 5: User
    Allow image folder: 4: User
  section Edit
    Type rich Markdown: 4: User
    Adjust Mermaid zoom: 3: User
    Edit diagram source: 4: User
  section Verify
    Check dark mode: 4: User
    Check light mode: 4: User
  section Export
    Save Markdown: 5: User
    Export HTML: 4: User
```

## Gantt With Milestones

```mermaid
gantt
  title Local rendering hardening
  dateFormat  YYYY-MM-DD
  axisFormat  %m/%d
  excludes weekends
  section Rendering
  Markdown parser       :done,    r1, 2026-05-01, 2d
  Mermaid polish        :active,  r2, after r1, 4d
  KaTeX verification    :         r3, after r2, 2d
  section Security
  CSP review            :done,    s1, 2026-05-02, 1d
  SVG sanitizer check   :active,  s2, 2026-05-05, 3d
  Vendor audit          :milestone, s3, 2026-05-12, 0d
```

## Pie Distribution

```mermaid
pie showData
  title Local rendering coverage
  "Markdown editing" : 28
  "Mermaid diagrams" : 32
  "KaTeX math" : 18
  "Security checks" : 14
  "Export" : 8
```

## Mindmap Deep

```mermaid
mindmap
  root((Portable Markdown Editor))
    Local first
      No CDN
      No network calls
      File System Access
    Rich editing
      Inline source
      Block source
      Task list
    Rendering
      Mermaid
        Flowchart
        C4
        Gantt
      KaTeX
        Inline math
        Display math
    Security
      CSP
      Raw HTML off
      Link allowlist
```

## Git Graph Branches

```mermaid
gitGraph
  commit id: "base"
  branch rendering
  checkout rendering
  commit id: "mermaid"
  commit id: "katex"
  branch security
  checkout security
  commit id: "csp"
  commit id: "sanitize"
  checkout rendering
  merge security id: "safe-render"
  checkout main
  merge rendering id: "release"
```

## Mixed Flow

```mermaid
flowchart LR
  subgraph Input[Local input]
    A[Markdown file]
    B[Image folder]
  end
  subgraph Render[Render pipeline]
    C[markdown-it]
    D[KaTeX]
    E[Mermaid.js]
    F[SVG sanitizer]
  end
  subgraph Output[Local output]
    G[Rich editor]
    H[Preview]
    I[HTML export]
  end
  A --> C
  B --> G
  C --> D
  C --> E
  E --> F
  D --> H
  F --> H
  H --> I
```
