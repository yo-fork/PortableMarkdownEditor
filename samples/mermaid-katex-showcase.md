# Mermaid / KaTeX 表示サンプル

[toc]

## 概要

この文書は Mermaid と KaTeX の表示確認用サンプルです。

- Mermaid: flowchart / sequence / class / state / ER / journey / gantt / pie / mindmap / gitGraph
- KaTeX: inline math / display math / aligned / matrix / cases / summation / integral
- Markdown 内 HTML は使いません。

## KaTeX inline

文章中の数式: $E = mc^2$、$a^2 + b^2 = c^2$、$\alpha + \beta = \gamma$。

確率の例: $P(A \mid B) = \frac{P(B \mid A)P(A)}{P(B)}$。

## KaTeX display

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

## KaTeX aligned

$$
\begin{aligned}
f(x) &= ax^2 + bx + c \\
f'(x) &= 2ax + b \\
x &= \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
\end{aligned}
$$

## KaTeX matrix

$$
\begin{bmatrix}
1 & 2 & 3 \\
4 & 5 & 6 \\
7 & 8 & 9
\end{bmatrix}
\begin{bmatrix}
x \\
y \\
z
\end{bmatrix}
=
\begin{bmatrix}
14 \\
32 \\
50
\end{bmatrix}
$$

## KaTeX cases

$$
f(x)=
\begin{cases}
x^2 & x \ge 0 \\
-x & x < 0
\end{cases}
$$

## Mermaid flowchart TD

```mermaid
flowchart TD
  A[Markdownを書く] --> B{安全にプレビュー}
  B -->|OK| C[保存]
  B -->|確認| D[修正]
  D --> A
```

## Mermaid flowchart LR

```mermaid
flowchart LR
  Input[Markdown] --> Parse[markdown-it]
  Parse --> Sanitize[安全化]
  Sanitize --> Render[Preview]
  Render --> Export[HTML/PDF]
```

## Mermaid sequence

```mermaid
sequenceDiagram
  participant User as ユーザー
  participant App as Editor
  participant Parser as Markdown Parser
  participant Mermaid as Mermaid.js

  User->>App: Markdownを編集
  App->>Parser: HTMLへ変換
  Parser-->>App: 安全化済みHTML
  App->>Mermaid: 図を描画
  Mermaid-->>App: SVG
  App-->>User: プレビュー表示
```

## Mermaid class

```mermaid
classDiagram
  class DocumentState {
    +string markdown
    +string fileName
    +string mode
    +save()
  }

  class Renderer {
    +renderMarkdown()
    +renderMermaid()
    +renderKaTeX()
  }

  class SecurityPolicy {
    +sanitizeLinkUrl()
    +sanitizeSvgMarkup()
  }

  DocumentState --> Renderer
  Renderer --> SecurityPolicy
```

## Mermaid state

```mermaid
stateDiagram-v2
  [*] --> Rich
  Rich --> Source: ソース
  Rich --> Preview: プレビュー
  Source --> Split: 分割
  Preview --> Split: 分割
  Split --> Rich: リッチ
  Rich --> [*]
```

## Mermaid ER

```mermaid
erDiagram
  DOCUMENT ||--o{ ASSET : references
  DOCUMENT ||--o{ HEADING : contains
  DOCUMENT {
    string fileName
    string markdown
  }
  ASSET {
    string relativePath
    string objectUrl
  }
  HEADING {
    int level
    string title
  }
```

## Mermaid journey

```mermaid
journey
  title ローカルMarkdown編集の流れ
  section 編集
    ファイルを開く: 5: User
    リッチ編集する: 4: User
  section 確認
    Mermaidを確認: 3: User
    KaTeXを確認: 3: User
  section 保存
    Markdown保存: 5: User
    HTML書き出し: 4: User
```

## Mermaid gantt

```mermaid
gantt
  title ローカル同梱ライブラリ対応
  dateFormat  YYYY-MM-DD
  section Rendering
  Markdown parser       :done,    a1, 2026-05-01, 2d
  Mermaid rendering     :active,  a2, 2026-05-03, 3d
  KaTeX rendering       :         a3, 2026-05-06, 2d
  section Security
  CSP check             :done,    b1, 2026-05-02, 2d
  Vendor audit          :         b2, 2026-05-08, 2d
```

## Mermaid pie

```mermaid
pie showData
  title 表示確認の割合
  "Markdown" : 35
  "Mermaid" : 35
  "KaTeX" : 20
  "Security" : 10
```

## Mermaid mindmap

```mermaid
mindmap
  root((Portable Markdown Editor))
    Local
      No CDN
      No network
    Rendering
      Markdown
      Mermaid
      KaTeX
      highlight.js
    Security
      CSP
      Raw HTML off
      Link allowlist
```

## Mermaid gitGraph

```mermaid
gitGraph
  commit id: "local"
  branch rich-edit
  checkout rich-edit
  commit id: "mermaid"
  commit id: "katex"
  checkout main
  merge rich-edit
  commit id: "release"
```

## 混在確認

Mermaid 図の前後に inline math $x_{n+1}=x_n-\frac{f(x_n)}{f'(x_n)}$ があるケースです。

```mermaid
flowchart TD
  Start([Start]) --> Formula["$x_{n+1}=x_n-f(x_n)/f'(x_n)$"]
  Formula --> End([End])
```

最後に display math を置きます。

$$
\lim_{n \to \infty}\left(1+\frac{1}{n}\right)^n = e
$$
