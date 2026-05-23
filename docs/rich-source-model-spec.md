# リッチ編集 Source-of-Truth 移行仕様

この文書は、Portable Markdown Editor のリッチ編集を Markdown source を正本とする編集モデルへ移行するための目標仕様である。実装済み機能の説明ではなく、今後の変更が満たすべき判断基準を定義する。

## 目的

リッチ編集モードでは、ProseMirror の document/transaction をユーザー操作の入力面として使う。ただし保存される本文、プレビュー、HTML/PDF 出力、リッチ再描画の正本は常に Markdown source とする。

ProseMirror document は Markdown source から再構築可能な投影であり、表示 DOM の見た目を直接シリアライズして正本へ戻すことを標準経路にしない。ユーザー操作は ProseMirror transaction で document を更新し、その serializer 結果を Markdown source へ同期する。

## 非目標

- ProseMirror schema を巨大化して、すべての拡張 Markdown を構造化ノードとして完全再現することは目的にしない。
- Markdown 方言を増やすことを目的にしない。
- 旧 contenteditable DOM の特殊処理を標準経路として維持しない。
- 一度の大改修で全高度編集 UI を置き換えない。段階移行し、各段階で既存挙動を検証する。

## 用語

### Markdown source

`state.markdown` と `#sourceEditor.value` に保持される LF 正規化済み Markdown 文字列。内部 caret token は保存・表示・出力前に除去される。

source offset は JavaScript 文字列 index と同じ UTF-16 code unit offset とする。すべての block range、inline run range、transaction range、source selection はこの offset 系で表す。

### Rendered rich DOM

Markdown source から生成される `#richEditor` 内の DOM。source-backed なトップレベル block は `data-block-id`、`data-block-type`、`data-source-start`、`data-source-end` を持つ。

リッチ DOM は編集 UI であり、source-backed な編集の正本ではない。DOM だけに存在する補助ノードは保存対象ではない。

### Block range

Markdown source をトップレベル block に分割した範囲。各 block は次を持つ。

- `id`: source 範囲と内容から導出される安定的な識別子
- `type`: paragraph、heading、list、quote、table、code、math、rule、toc など
- `start`: block source の開始 offset
- `end`: block source の終了 offset。末尾の block 区切り改行は含めない
- `raw`: `start` から `end` までの Markdown
- `trailingNewline`: source 上で block の直後に改行があるか

block range はレンダリング、ローカル再描画、source offset から DOM への復元、source-backed fallback guard の共通基盤とする。

### Inline run

paragraph、heading、list item、table cell、quote line などの inline 編集領域内で、Markdown source 範囲を持つ単位。太字、斜体、打ち消し、inline code、link、image、inline math など、リッチ表示では atomic な run として扱う要素は `data-src-start`、`data-src-end` を持つ。

atomic inline run は通常時 `contenteditable=false` とし、ブラウザ DOM 編集で内部だけが壊れないようにする。ラベルや URL などを編集する場合は、source island として Markdown source 断片を明示的に開く。

### Source selection

リッチ DOM selection を Markdown source offset へ写像したもの。

```js
{
  anchor: number,
  focus: number,
  affinity?: 'before' | 'after'
}
```

collapsed selection では `anchor === focus` とし、atomic inline run や block 境界のどちら側に caret を戻すかを `affinity` で表す。非 collapsed selection では、atomic inline/block の内部を端点にした場合、その Markdown source 範囲全体を含むように拡張する。

### Source transaction

Markdown source に対する mutation 単位。ProseMirror 経路では、ユーザー操作はまず ProseMirror transaction になり、serializer の結果として source へ同期される。旧 DOM 経路を保守する場合だけ、この形式の source transaction を直接使う。

```js
{
  from: number,
  to: number,
  insert: string,
  selectionAfter?: SourceSelection,
  blankParagraphAt?: number,
  status?: string
}
```

`from` から `to` を `insert` で置換する。適用後は source を更新し、必要な範囲だけ rich DOM を patch できる場合は patch し、それ以外は Markdown source から再描画する。caret は `selectionAfter` から復元する。source gap に見える空段落が必要な場合は `blankParagraphAt` を使う。

### Protected Markdown block

ProseMirror 標準 Markdown parser/serializer で壊れるが、このアプリの Markdown source としては保持したい block。表、display math などが該当する。

これらは ProseMirror 内では `pme-table` / `pme-math-display` のような保護付き code block として扱い、serializer 後に元の Markdown 構文へ戻す。保護 marker は `state.markdown`、保存、preview、HTML 出力へ漏れてはならない。

## 基本不変条件

1. 保存・プレビュー・HTMLコピー・HTML出力・PDF/印刷は Markdown source から生成する。
2. リッチ編集の標準 mutation は ProseMirror transaction とし、source は serializer 経由で同期する。
3. ProseMirror に載せられない場合でも、source-backed block 内で transaction を作れない DOM mutation は、DOM sync へ進まず、操作を止めるか source から再描画して戻す。
4. `data-source-start/end` と `data-src-start/end` は Markdown source の現在値と一致する。
5. source-backed block の一部だけを DOM シリアライズして block 全体の source と混ぜない。
6. atomic inline/block の内部 selection は、source selection へ変換するとき Markdown source 範囲境界へ丸める。
7. caret marker、zero-width anchor、transaction blank paragraph、trailing paragraph は UI 補助であり、保存される Markdown へ漏らさない。
8. IME composition、paste、cut、drag/drop、toolbar 操作、keyboard shortcut も同じ source transaction 方針に従う。

## Rendering 仕様

Markdown source は `buildBlockModel` 相当の block model に分割してから rich DOM へ描画する。各 top-level block は source range 属性を持つ。inline run range は block source 内の scanner から再計算する。

レンダリング後は次を行う。

- unsafe HTML を実行せず文字として扱う。
- link/image/math/code/mermaid の security policy を維持する。
- atomic inline run を `contenteditable=false` にする。
- source-backed control、たとえば task checkbox、code language input、Mermaid/math/code source editor は直接 DOM sync ではなく専用 transaction へ接続する。
- trailing editable paragraph は、source-backed block ではない最後尾入力面としてだけ使う。

## Selection 仕様

DOM selection を使う前に、rich editor 内に完全に含まれる selection か検証する。標準入口は `richSelectionRange(selection)` 相当の helper とする。

source selection への変換では、次を満たす。

- paragraph/heading は source content offset に変換する。
- list item は marker prefix と continuation line を考慮する。
- task checkbox marker は本文 offset へ混入しない。
- table cell は cell content range のみを対象にする。
- quote は `> ` prefix を考慮する。
- hard break は Markdown の two-space newline と DOM `<br>` を相互変換する。
- atomic inline run は Markdown source 長で offset を数える。
- code/math/mermaid/table/list など atomic block の selection endpoint は block source 境界に丸める。

source selection から DOM range へ戻すときは、rich editor を focus してから Range を適用する。ブラウザ focus による selection 上書きを避けるため、Range 適用後に不用意に再 focus しない。

## Transaction 適用仕様

source transaction 適用時は次の順序を守る。

1. `from/to/insert` を検証し、内部 caret token を除去する。
2. Undo snapshot を source 基準で保存する。
3. Markdown source を置換する。
4. `#sourceEditor.value` と `state.markdown` を同期する。
5. local patch 可能な場合は該当 block のみ再描画する。
6. patch 不可能な場合は rich/preview/outline を source から再描画する。
7. `selectionAfter` を source selection として DOM range へ復元する。
8. `blankParagraphAt` がある場合は source gap 上に visible blank paragraph を作る。
9. autosave と dirty 状態を更新する。

transaction に失敗した場合、source-backed DOM の壊れた状態を正本へ採用してはならない。status を表示し、source から再描画して戻す。

## 操作別仕様

### 通常文字入力

source-backed paragraph、heading、list item、table cell、quote への文字入力は source offset を計算し、`insert` transaction とする。Markdown shortcut になりうる入力は、DOM sync 後ではなく source transaction 前後で検出する。

transaction-created blank paragraph への入力は、既存の前後 block separator を再利用し、余分な blank line を増やさない。

### Enter

通常 Enter は block/list/table/quote の種類ごとに source transaction とする。

- paragraph/heading の Enter は `\n\n` を挿入する。
- block 末尾 Enter は次の空段落へ caret を置く。source が `alpha\n\n` のとき、次の入力は `alpha\n\nZ` になる。
- block 先頭 Enter はcaret位置から空段落を作り、block行を次の段落へ移動する。 caret はblock行先頭を保ったまま次の段落に置く。
- list item Enter は現在 item を marker 単位で split する。`- one` 末尾 Enter 後の次入力は `- one\n- Z` になる。
- 空 list item Enter は list を抜け、source gap の空 paragraph を作る。
- table/quote 内 Enter は各構造の Markdown 表現に沿って改行を表す。
- unsupported selection Enter は DOM deletion に進まず、source-backed block を保護する。

### Shift+Enter

paragraph/list/quote/table cell の soft line break は Markdown hard break source transaction とする。DOM `<br>` だけを正本にしない。削除時も two-space newline の source range を削除する。

### Backspace/Delete

collapsed caret の削除は source offset と隣接 source range から transaction を作る。

- paragraph block 境界削除は Markdown block separator を削除/結合する。
- list item 境界削除は隣接 item marker と separator を source として処理する。
- atomic inline/block 隣接削除は Markdown source 範囲全体を削除する。
- final character delete で空 block になる場合も source transaction とし、必要なら visible blank paragraph を作る。

### Paste/Cut/Selection Replacement

paste、cut、selection replacement は source selection から replacement range を作る。table cell と quote は、それぞれ Markdown table cell text / quote text へ変換する。source selection に変換できない source-backed selection は DOM mutation を止める。

### Toolbar Formatting

bold/italic/link/image/block format などの toolbar 操作は、captured source range へ transaction を適用する。dialog が focus を奪う前に source insertion range を保存する。collapsed inline insert は、挿入後に source island を開いてラベル編集できる。

### Source Islands

atomic inline run、Mermaid/code/math block などは、必要に応じて source island として Markdown source 断片を表示する。source island 内の編集はその island の source range にだけ commit する。commit 後は source selection で caret を戻す。

## Fallback 方針

通常の rich mode は ProseMirror を使う。旧 contenteditable rich DOM は、ProseMirror bundle が読み込めない場合や初期化不能な場合の緊急 fallback とする。

完全な beforeinput transaction が作れない場合でも、source-backed block では次の順序を守る。

1. DOM mutation 後の source-backed block をシリアライズして、元 block source 全体との差分 transaction にできるか試す。
2. caret は post-input DOM selection だけに依存せず、旧 source と新 source の diff offset から復元する。
3. transaction にできない場合は DOM sync へ進まず、source から再描画して戻す。

非 source-backed な trailing paragraph など、保存済み source と対応しない入力面だけは例外的に DOM から source へ昇格できる。

## Undo/Redo 仕様

Undo snapshot は rich DOM ではなく Markdown source を基準にする。rich undo 中の入力や source island 編集でも、復元後に source selection を使って caret を戻す。DOM-only caret marker は Undo 対象に含めない。

## 検証基準

各段階の変更では、少なくとも次を確認する。

```powershell
node --check app.js
node tests\security-smoke.mjs
node tests\lint-security.mjs
node tests\vendor-static-check.mjs
node tests\vendor-audit.mjs
git diff --check
```

加えて `http://127.0.0.1:8773/index.html` を直接操作し、変更対象の操作を rich mode で確認する。検証では source value、rich DOM、caret 後続入力の位置、console error/warning の有無を見る。

最低限の回帰シナリオは次の通り。

- paragraph 末尾 Enter 後の連続入力: `alpha` -> Enter -> `ZB` が `alpha\n\nZB`
- list item 末尾 Enter 後の連続入力: `- one` -> Enter -> `ZB` が `- one\n- ZB`
- atomic inline run 境界入力/削除
- table cell 入力と `<br>` 削除
- quote 入力と Enter
- hard break 挿入/削除
- selection paste/cut/replacement
- toolbar bold/italic/link/image/block format
- task checkbox toggle と marker 削除
- code language 編集
- Mermaid/code/math source island commit/cancel

## 完了条件

この移行は、次を満たしたとき完了とみなす。

1. source-backed rich editing の主要 mutation 経路が source transaction または明示的な source-backed DOM diff transaction になっている。
2. source-backed block で、失敗時に whole-DOM sync が正本を上書きする経路が残っていない。
3. block range、inline run range、source selection、transaction の不変条件が smoke test と browser 操作で検証されている。
4. Enter、Backspace/Delete、paste/cut、IME、toolbar、source island、list/table/quote/code/math/mermaid の代表操作で、後続入力の caret 位置が source 上で正しい。
5. セキュリティ方針、vendor 固定方針、完全ローカル方針に影響する変更がない。
