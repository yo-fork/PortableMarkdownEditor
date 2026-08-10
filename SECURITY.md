# Security Policy

Portable Markdown Editor は、Markdownファイルを完全ローカルで編集するWindowsアプリ兼ブラウザアプリです。

文書をネットワークへ送信しないことと、Markdown内のHTMLを実行しないことを最優先にしています。

## 想定する利用環境

- Windows 10/11 x64、.NET Framework 4.8以降、WebView2 Evergreen Runtimeを使うポータブルWindowsアプリ
- Windows + Microsoft Edge / Chrome などの標準ブラウザ
- `index.html` をローカルファイルとして開く運用
- 外部サーバー、Electron、npm実行、CDNを使わない運用
- `vendor/` に固定して同梱したブラウザ用ライブラリだけを使う運用

## 主な防御

### 1. 外部通信の遮断

`index.html` に CSP を設定しています。

- `default-src 'none'`
- `connect-src 'none'`
- `script-src 'self'`
- `style-src 'self' 'unsafe-inline'`
- `object-src 'none'`
- `form-action 'none'`
- `base-uri 'none'`

これにより、外部API通信、外部スクリプト、フォーム送信、object/embedの利用を禁止します。

### 2. Windowsネイティブホストの境界

Windowsアプリ版は、WebView2のホストオブジェクトを無効化します。

JavaScriptとWPFの間では、許可した種類のJSONメッセージだけを交換します。

ネイティブ側は、メッセージ送信元が固定アプリオリジン `https://portable-markdown-editor.local/` の場合だけ処理します。

Windowsホストは、現在の文書パスやフォルダ列挙結果、汎用ファイルアクセス関数をWebViewへ渡しません。

Markdown本文そのものに絶対画像パスが含まれる場合、その文字列は文書内容としてWebViewにも届きます。

Windowsホストへ解決を要求できるのは最大64件で、現在の文書フォルダ内に実在する25MB以下のPNG、JPEG、GIF、WebPだけを相対参照へ変換します。

アプリ資産は読み取り専用の仮想ホストへ割り当てます。

文書画像用の仮想URLはフォルダへ直接割り当てず、ネイティブ側が要求ごとに現在の文書フォルダ内でパス、拡張子、バイト署名、25MB上限を検証して応答します。

トップレベル画面はアプリオリジン以外へ遷移できません。

外部リンクは、Web側の許可ドメイン検査を通り、ユーザー操作で要求された場合だけ既定ブラウザへ渡します。

WebView2の権限要求は、アプリオリジンからユーザー操作で要求されたクリップボード読取りを除いて拒否します。

Windows側の画像保存は、25MB上限、PNG/JPEG/GIF/WebPのバイト署名、MIME一致、保存名、再解析ポイントを検査します。

### 3. Markdown内HTMLの無効化

Markdown本文に含まれる `<script>`, `<img onerror=...>`, `<iframe>` などのHTMLは、DOMにHTMLとして挿入する前にエスケープします。ユーザーのMarkdown由来で生成されるHTMLは、アプリ内レンダラーが作った限定タグだけです。

### 4. URLの許可制

リンクと画像のURLは別々に検証します。

- リンク: 完全ローカル性を優先し、相対リンク、アンカー、ユーザーが明示的に許可したドメインの `http`/`https` のみ許可。`mailto`, `tel`, `file` などのスキーム付きURLはリンク化しません。
- 画像: `data:image/png`, `data:image/jpeg`, `data:image/gif`, `data:image/webp`, `blob:`, フォルダ選択時のMarkdownファイル基準の相対パスを許可。ブラウザ版は `file:` URL、Windowsドライブパス、UNCパスを直接読み込みません。Windowsアプリ版は文書フォルダ内の検証済み画像だけを相対参照へ解決します。
- `javascript:`, `vbscript:`, `data:text/html`, SVG data画像、プロトコル相対URL、外部リンク、外部画像はブロック。

### 5. 画像挿入の制限

Windowsアプリ版は、開いているMarkdownファイルの場所に `MarkdownFileName.assets/` を作成します。

WebViewには保存先の絶対パスを渡さず、ネイティブ側が安全化した相対パスだけを返します。

Windowsアプリ版の相対画像は、画像専用URLへの要求をネイティブ側で検証してから表示します。

画像挿入は PNG/JPEG/GIF/WebP のみで、File System Access APIで開いたMarkdownファイルと同じ場所に `MarkdownFileName.assets/` フォルダを作り、その中へ保存した画像を相対パスで参照します。Markdown本文へ巨大な Data URL は埋め込みません。フォルダの読み書き権限がない場合、画像挿入は行わず、フォルダ許可が必要であることを画面上に表示します。

画像参照は PNG/JPEG/GIF/WebP の相対参照を基本とします。
対応ブラウザでは `ファイルから開く` でMarkdownファイルを選んだ後、ユーザー許可により同じフォルダを File System Access API で選択できます。
編集中内容を維持したままフォルダだけ許可する場合は、`フォルダ許可` で現在のMarkdownを読み直さずにフォルダ参照だけ接続します。
その場合、相対パスはMarkdownファイルの場所を基準にフォルダ内画像を Blob URL として表示します。
フォルダ未許可時や許可済みフォルダ内に対象画像がない場合は、画像を相対URLとして読み込まず、理由を示すプレースホルダーを表示します。
File System Access API のピッカー開始位置には、現在のMarkdownファイルのディレクトリまたは前回選択したフォルダハンドルを使います。
ハンドルはローカルの IndexedDB に保存し、絶対パス文字列は取得、保存しません。
フォルダ走査は最大5,000ファイル、最大8階層に制限し、上限を超えた部分は読み飛ばして警告します。
未対応環境では `フォルダから開く` ボタンの `webkitdirectory` ファイル入力にフォールバックします。
ブラウザ版は `file:` URL、`Z:\share\image.png` のようなWindowsドライブパス、`\\server\share\image.png` のようなUNCパスを直接読み込みません。
Windowsアプリ版は、既存Markdownに含まれる絶対画像パスが現在の文書フォルダ内を指し、拡張子、ファイル署名、サイズの検査を通った場合だけ、画像専用URLの相対パスへ解決します。
文書フォルダ外の絶対パスと `http`/`https` 画像は許可しません。

### 6. 外部リンク許可ドメイン

外部リンクはデフォルトではリンク化しません。「リンク許可」で登録したドメインの `http`/`https` URLだけをリンク化します。登録したドメインのサブドメインも許可されます。

許可ドメインはブラウザまたはポータブルWebView2プロファイルのlocalStorageに保存します。

設定ファイル読み込みはユーザーが選択したJSONだけをFile APIで読み、`allowedLinkDomains` 配列を正規化してlocalStorageへ反映します。

Windowsアプリ版の設定書出しはネイティブ保存ダイアログを使い、ブラウザ版はローカルダウンロードを使います。

どちらも外部通信は行いません。

File System Access API対応ブラウザでは、ユーザーが許可した設定フォルダのハンドルを IndexedDB に保存できます。次回起動時は権限が残っている場合だけ `portable-markdown-editor-settings.json` を自動読み込みし、明示操作で同じファイルへ上書き保存します。未許可フォルダや任意の `config/` を勝手に読むことはありません。

### 7. ローカル同梱ライブラリ

Markdown解析、コードハイライト、Mermaid、KaTeXは `vendor/` 配下に同梱したブラウザ用ファイルだけを読み込みます。CDN、npm実行、実行時のパッケージ取得、外部API通信は使わず、CSPの `script-src 'self'` と `connect-src 'none'` は緩めません。ライセンスと同梱ファイルは `docs/third-party-licenses.md` と `vendor/manifest.json` に記録します。

Mermaidは `securityLevel: 'strict'`、`htmlLabels: false` で初期化します。Mermaid/KaTeXの生成スタイル表示のため `style-src 'self' 'unsafe-inline'` を許可しますが、`script-src` と `connect-src` は緩めず、raw HTMLは無効のままです。MermaidのSVG描画結果は挿入前にスクリプト、イベントハンドラ、危険URL、危険なCSS URLを除去します。描画やSVG安全化に失敗した場合は、元のMermaidコードをエスケープ済みのフォールバックとして表示します。

KaTeXのCSSとフォントは `vendor/katex/` からのみ読み込みます。`font-src 'self' data:` は維持し、数式描画に失敗した場合は数式ソースをエスケープして表示します。

## 残る注意点

- ブラウザ自体の脆弱性までは防げません。OSとブラウザは最新状態で使ってください。
- Windowsアプリ版はWebView2 Evergreen Runtimeに依存するため、OSとRuntimeを最新状態で使ってください。
- 自動復元はlocalStorageに保存します。Windowsアプリ版では `data/WebView2/`、ブラウザ版ではブラウザのサイトデータを削除すると下書きも消えます。
- Windows配布物はコード署名していないため、別PCではWindows SmartScreenが未認識アプリとして警告する可能性があります。
- HTML出力ファイルも CSP を含みますが、貼り付け先のCMSやWebアプリがHTMLを再解釈する場合は、貼り付け先側の仕様に依存します。

## 報告

問題を見つけた場合は、GitHub Issueで再現手順、入力Markdown、期待結果、実際の結果を共有してください。機密情報は含めないでください。
