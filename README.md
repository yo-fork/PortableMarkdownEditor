# Portable Markdown Editer

Windowsでインストールせずに使える、完全ローカル実行のMarkdownエディタです。

* `index.html` をブラウザで開くだけで起動します。
* CDN、npm実行、外部配信JavaScript、外部配信CSS、外部API通信は使いません。必要なブラウザ用ライブラリは `vendor/` に同梱します。
* ブロック単位のリッチ編集、ソース編集、分割プレビュー、プレビュー専用、集中モードを切り替えられます。
* 初期表示はリッチ編集モードです。
* Markdownの読み込み、保存、HTML出力、HTMLコピー、PDF/印刷に対応します。
* Markdownと画像を含むフォルダを開くと、相対画像パスをMarkdownファイルの場所基準で表示します。
* Markdown内のHTMLは実行せず文字として扱います。
* 完全ローカル性を優先し、外部リンクは許可ドメイン制、`javascript:` など危険なリンク、遠隔画像、SVG data画像はブロックします。

## 使い方

1. ZIPを展開します。
2. `OpenMarkdownEditer.cmd` または `index.html` をダブルクリックします。
3. 「開く」でMarkdownファイルを読み込み、「保存」でMarkdownとして保存します。
4. 相対画像をMarkdownファイル基準で表示したい場合は、「フォルダ」からMarkdownと画像を含むフォルダを選びます。
5. 外部リンクを有効にしたい場合は、「リンク許可」からドメインを1行ずつ登録します。
6. PDF化は「PDF/印刷」から Windows の「Microsoft Print to PDF」を選びます。

## ショートカット

|キー|操作|
|-|-|
|`Ctrl + S`|Markdown保存|
|`Ctrl + O`|Markdownを開く|
|`Ctrl + P`|PDF/印刷|
|`Ctrl + B`|太字|
|`Ctrl + I`|斜体|
|`Ctrl + K`|リンク挿入|

## 対応Markdown

見出し、段落、引用、箇条書き、番号リスト、チェックリスト、表、コードブロック、インラインコード、太字、斜体、打ち消し線、リンク、data URL画像、ローカル画像参照、折りたたみ可能な目次 `\[toc]` に対応しています。

Markdown解析、コードハイライト、Mermaid図、KaTeX数式は、`vendor/` に同梱したブラウザ用ライブラリをローカルから読み込んで処理します。`js`, `ts`, `python`, `html`, `css`, `json`, `bash`, `powershell`, `sql`, `yaml` などの主要言語、`mermaid` コードブロック、`$...$` / `$$...$$` / `\(...\)` / `\[...\]` の数式に対応します。

## セキュリティ設計

詳しくは [`SECURITY.md`](SECURITY.md) と [`docs/security-model.md`](docs/security-model.md) を参照してください。

主な防御方針は次の通りです。

* アプリ本体に Content Security Policy を設定し、外部通信、外部埋め込み、フォーム送信を禁止。
* raw HTMLはMarkdownとして解釈せず、エスケープして表示。
* リンクURLは許可制。相対リンク、アンカー、ユーザーが許可したドメインの `http`/`https` のみリンク化し、危険なスキームはリンク化しない。
* 画像は PNG/JPEG/GIF/WebP のみ許可。Data URL、フォルダ選択時のMarkdownファイル基準の相対パス、`file:` URL、Windowsドライブパス、UNCパスを参照でき、遠隔画像は読み込まない。
* `eval`、`new Function`、Web Worker、fetch/XHRは不使用。同梱ライブラリも `script-src 'self'` の範囲でだけ読み込みます。

## ライセンス

MIT Licenseです。個人利用・商用利用を問わず、利用、複製、改変、再配布、販売を許可する扱いです。詳細は [`LICENSE`](LICENSE) を確認してください。
