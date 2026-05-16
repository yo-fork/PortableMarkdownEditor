# Security Policy

Portable Markdown Editor は、Markdownファイルを完全ローカルで編集するための小さなブラウザアプリです。ネットワークに送信しないこと、Markdown内のHTMLを実行しないことを最優先にしています。

## 想定する利用環境

- Windows + Microsoft Edge / Chrome などの標準ブラウザ
- `index.html` をローカルファイルとして開く運用
- サーバー、Electron、npm実行、CDNを使わない運用
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

### 2. Markdown内HTMLの無効化

Markdown本文に含まれる `<script>`, `<img onerror=...>`, `<iframe>` などのHTMLは、DOMにHTMLとして挿入する前にエスケープします。ユーザーのMarkdown由来で生成されるHTMLは、アプリ内レンダラーが作った限定タグだけです。

### 3. URLの許可制

リンクと画像のURLは別々に検証します。

- リンク: 完全ローカル性を優先し、相対リンク、アンカー、ユーザーが明示的に許可したドメインの `http`/`https` のみ許可。`mailto`, `tel`, `file` などのスキーム付きURLはリンク化しません。
- 画像: `data:image/png`, `data:image/jpeg`, `data:image/gif`, `data:image/webp`, `blob:`, フォルダ選択時のMarkdownファイル基準の相対パス、`file:` URL、Windowsドライブパス、UNCパスを許可。
- `javascript:`, `vbscript:`, `data:text/html`, SVG data画像、プロトコル相対URL、外部リンク、外部画像はブロック。

### 4. 画像挿入の制限

画像埋め込みは PNG/JPEG/GIF/WebP のみで、2MB以下に制限しています。画像は Data URL としてMarkdown本文に埋め込まれるため、外部サーバーから画像を取得しません。

画像参照は PNG/JPEG/GIF/WebP の拡張子を持つローカル参照に限定しています。フォルダ選択でMarkdownを開いた場合、相対パスはMarkdownファイルの場所を基準にフォルダ内画像を Blob URL として表示します。対応ブラウザでは File System Access API のフォルダ選択を使い、未対応環境では `webkitdirectory` のファイル入力にフォールバックします。ブラウザ仕様上、絶対フォルダパスは取得せず、選択フォルダ内の相対パスだけを扱います。`file:` URL、`Z:\share\image.png` のようなWindowsドライブパス、`\\server\share\image.png` のようなUNCパスも許可します。`http`/`https` 画像は許可しません。

### 5. 外部リンク許可ドメイン

外部リンクはデフォルトではリンク化しません。「リンク許可」で登録したドメインの `http`/`https` URLだけをリンク化します。登録したドメインのサブドメインも許可されます。

### 6. ローカル同梱ライブラリ

Markdown解析、コードハイライト、Mermaid、KaTeXは `vendor/` 配下に同梱したブラウザ用ファイルだけを読み込みます。CDN、npm実行、実行時のパッケージ取得、外部API通信は使わず、CSPの `script-src 'self'` と `connect-src 'none'` は緩めません。ライセンスと同梱ファイルは `docs/third-party-licenses.md` と `vendor/manifest.json` に記録します。

Mermaidは `securityLevel: 'strict'`、`htmlLabels: false` で初期化します。Mermaid/KaTeXの生成スタイル表示のため `style-src 'self' 'unsafe-inline'` を許可しますが、`script-src` と `connect-src` は緩めず、raw HTMLは無効のままです。MermaidのSVG描画結果は挿入前にスクリプト、イベントハンドラ、危険URL、危険なCSS URLを除去します。描画やSVG安全化に失敗した場合は、元のMermaidコードをエスケープ済みのフォールバックとして表示します。

KaTeXのCSSとフォントは `vendor/katex/` からのみ読み込みます。`font-src 'self' data:` は維持し、数式描画に失敗した場合は数式ソースをエスケープして表示します。

## 残る注意点

- ブラウザ自体の脆弱性までは防げません。OSとブラウザは最新状態で使ってください。
- 自動復元は localStorage に保存します。機密文書では、作業後にブラウザのサイトデータを削除するか、Markdownファイルとして保存してから下書きを消してください。
- HTML出力ファイルも CSP を含みますが、貼り付け先のCMSやWebアプリがHTMLを再解釈する場合は、貼り付け先側の仕様に依存します。

## 報告

問題を見つけた場合は、GitHub Issueで再現手順、入力Markdown、期待結果、実際の結果を共有してください。機密情報は含めないでください。
