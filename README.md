# Portable Markdown Editer

Windowsでインストールせずに使える、完全ローカル実行のMarkdownエディタです。

- `index.html` をブラウザで開くだけで起動します。
- CDN、npm、外部JavaScript、外部CSS、外部API通信は使いません。
- Typora風のリッチ編集、ソース編集、分割プレビュー、プレビュー専用、集中モードを切り替えられます。
- Markdownの読み込み、保存、HTML出力、HTMLコピー、PDF/印刷に対応します。
- Markdown内のHTMLは実行せず文字として扱います。
- 完全ローカル性を優先し、外部リンク、`javascript:` など危険なリンク、外部画像、SVG data画像はブロックします。

## 使い方

1. ZIPを展開します。
2. `OpenMarkdownEditer.cmd` または `index.html` をダブルクリックします。
3. 「開く」でMarkdownファイルを読み込み、「保存」でMarkdownとして保存します。
4. PDF化は「PDF/印刷」から Windows の「Microsoft Print to PDF」を選びます。

## ショートカット

| キー | 操作 |
| --- | --- |
| `Ctrl + S` | Markdown保存 |
| `Ctrl + O` | Markdownを開く |
| `Ctrl + P` | PDF/印刷 |
| `Ctrl + B` | 太字 |
| `Ctrl + I` | 斜体 |
| `Ctrl + K` | リンク挿入 |

## 対応Markdown

見出し、段落、引用、箇条書き、番号リスト、チェックリスト、表、コードブロック、インラインコード、太字、斜体、打ち消し線、リンク、data URL画像、目次 `[toc]` に対応しています。

## セキュリティ設計

詳しくは [`SECURITY.md`](SECURITY.md) と [`docs/security-model.md`](docs/security-model.md) を参照してください。

主な防御方針は次の通りです。

- アプリ本体に Content Security Policy を設定し、外部通信、外部埋め込み、フォーム送信を禁止。
- raw HTMLはMarkdownとして解釈せず、エスケープして表示。
- リンクURLは許可制。相対リンクとアンカーのみ許可し、外部リンクや危険なスキームはリンク化しない。
- 画像はアプリ内で挿入した PNG/JPEG/GIF/WebP の Data URL のみを想定。遠隔画像は読み込まない。
- `eval`、`new Function`、外部ライブラリ、Web Worker、fetch/XHRは不使用。

## GitHubへ反映する方法

このリポジトリが空の場合は、ZIPを展開したフォルダで `PushToGitHub.cmd` を実行してください。GitHub CLIではなく通常の `git` を使います。

```bat
PushToGitHub.cmd
```

初回だけGitHubの認証画面が出る場合があります。
