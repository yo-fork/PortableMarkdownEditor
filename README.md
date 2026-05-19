# Portable Markdown Editor

Windowsでインストールせずに使える、完全ローカル実行のMarkdownエディタです。

* `index.html` をブラウザで開くだけで起動します。
* CDN、npm実行、外部配信JavaScript、外部配信CSS、外部API通信は使いません。必要なブラウザ用ライブラリは `vendor/` に固定して同梱します。
* シームレスなリッチ編集、ソース編集、分割プレビュー、プレビュー専用、集中モードを切り替えられます。
* 初期表示はリッチ編集モードです。
* Markdownの読み込み、保存、HTML出力、HTMLコピー、PDF/印刷に対応します。File System Access API でフォルダを許可している場合、保存ボタンは開いているMarkdownファイルへ上書き保存します。未許可時は従来どおりダウンロード保存します。
* Markdownと画像を含むフォルダを開くと、相対画像パスをMarkdownファイルの場所基準で表示します。対応ブラウザでは File System Access API のフォルダ選択を使い、未対応環境では従来のフォルダ入力にフォールバックします。
* すでに編集中のMarkdownに対しては、「フォルダ許可」から本文を読み直さずにフォルダ参照だけ接続できます。
* File System Access API 対応ブラウザでは、「ファイルから開く」「フォルダから開く」「フォルダ許可」のダイアログ開始位置に、現在のMarkdownファイルのディレクトリまたは前回選択したフォルダを使います。
* フォルダを開く場合の走査は最大5,000ファイル、最大8階層までです。上限を超えた部分は読み飛ばし、警告ダイアログと画面下部のステータスに表示します。
* File System Access API でフォルダを開いている場合、`Ctrl+V` や画像ファイルのドラッグアンドドロップで、Markdownファイル名に対応した `ファイル名.assets/` フォルダへ画像を保存し、相対参照として挿入できます。フォルダ未許可時は画像保存や相対画像表示ができない理由を画面上に表示します。
* Markdown内のHTMLは実行せず文字として扱います。
* 完全ローカル性を優先し、外部リンクは許可ドメイン制、`javascript:` など危険なリンク、遠隔画像、SVG data画像はブロックします。許可ドメインはlocalStorageに保存し、JSON設定ファイルから読み込み/書き出しできます。File System Access API対応ブラウザでは、許可した設定フォルダの `portable-markdown-editor-settings.json` を起動時に自動読み込みし、同じファイルへ上書き保存できます。

## 使い方

推奨ブラウザは Microsoft Edge または Google Chrome です。File System Access API を使った上書き保存、フォルダ許可、画像assets保存はChromium系ブラウザでの利用を前提にしています。

1. ZIPを展開します。
2. `OpenMarkdownEditor.cmd` または `index.html` をダブルクリックします。
3. 「ファイルから開く」でMarkdownファイルを読み込み、「保存」でMarkdownとして保存します。フォルダ許可済みなら元ファイルへ上書きし、未許可ならダウンロード保存します。
4. 相対画像をMarkdownファイル基準で表示・挿入したい場合は、「フォルダから開く」からMarkdownと画像を含むフォルダを選びます。編集中内容を維持したまま権限だけ付けたい場合は「フォルダ許可」を使います。対応ブラウザでは画像貼り付け/ドロップ時に `ファイル名.assets/` へ保存します。
5. 外部リンクを有効にしたい場合は、「リンク許可」からドメインを1行ずつ登録します。同じ画面から `allowedLinkDomains` を含むJSON設定ファイルの読み込みと書き出しもできます。「設定フォルダ許可」で任意の `config` フォルダなどを許可すると、次回起動時に `portable-markdown-editor-settings.json` を自動読み込みできます。
6. PDF化は「PDF/印刷」から Windows の「Microsoft Print to PDF」を選びます。

通常は `index.html` を直接ダブルクリックして使えます。必要に応じてローカルHTTPで確認する場合は、プロジェクト直下で次のように起動し、EdgeまたはChromeで `http://127.0.0.1:8773/index.html` を開きます。

```powershell
py -m http.server 8773 --bind 127.0.0.1
```

`py` が使えない環境では、Pythonが入っていれば次でも起動できます。

```powershell
python -m http.server 8773 --bind 127.0.0.1
```

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

見出し、段落、引用、箇条書き、番号リスト、チェックリスト、表、コードブロック、インラインコード、太字、斜体、打ち消し線、リンク、PNG/JPEG/GIF/WebPのdata URL画像、許可済みフォルダ内の相対画像参照、assetsフォルダへの画像貼り付け/ドロップ、折りたたみ可能な目次 `\[toc]` に対応しています。

Markdown解析、コードハイライト、Mermaid図、KaTeX数式は、`vendor/` に同梱したブラウザ用ライブラリをローカルから読み込んで処理します。`js`, `ts`, `python`, `html`, `css`, `json`, `bash`, `powershell`, `sql`, `yaml` などの主要言語、`mermaid` コードブロック、`$...$` / `$$...$$` / `\(...\)` / `\[...\]` の数式に対応します。

## セキュリティ設計

詳しくは [`SECURITY.md`](SECURITY.md) と [`docs/security-model.md`](docs/security-model.md) を参照してください。

主な防御方針は次の通りです。

* アプリ本体に Content Security Policy を設定し、外部通信、外部埋め込み、フォーム送信を禁止。
* raw HTMLはMarkdownとして解釈せず、エスケープして表示。
* リンクURLは許可制。相対リンク、アンカー、ユーザーが許可したドメインの `http`/`https` のみリンク化し、危険なスキームはリンク化しない。
* 画像は PNG/JPEG/GIF/WebP のみ許可。挿入画像は `MarkdownFileName.assets/` に保存して相対参照し、File System Access APIで許可したMarkdownファイル基準の相対パスだけを表示します。`file:` URL、Windowsドライブパス、UNCパス、遠隔画像は直接読み込まず、ネットワークドライブ上の画像も許可したフォルダ内の相対パスとして扱います。
* `eval`、`new Function`、Web Worker、fetch/XHRは不使用。同梱ライブラリも `script-src 'self'` の範囲でだけ読み込みます。
* vendorファイルは手動で確認・更新し、アプリ実行時にnpmやネットワーク取得は行いません。

## ライセンス

MIT Licenseです。個人利用・商用利用を問わず、利用、複製、改変、再配布、販売を許可する扱いです。詳細は [`LICENSE`](LICENSE) を確認してください。
