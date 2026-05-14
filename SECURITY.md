# Security Policy

Portable Markdown Editer は、Markdownファイルを完全ローカルで編集するための小さなブラウザアプリです。ネットワークに送信しないこと、Markdown内のHTMLを実行しないことを最優先にしています。

## 想定する利用環境

- Windows + Microsoft Edge / Chrome などの標準ブラウザ
- `index.html` をローカルファイルとして開く運用
- サーバー、Electron、npm、CDNを使わない運用

## 主な防御

### 1. 外部通信の遮断

`index.html` に CSP を設定しています。

- `default-src 'none'`
- `connect-src 'none'`
- `script-src 'self'`
- `style-src 'self'`
- `object-src 'none'`
- `form-action 'none'`
- `base-uri 'none'`

これにより、外部API通信、外部スクリプト、フォーム送信、object/embedの利用を禁止します。

### 2. Markdown内HTMLの無効化

Markdown本文に含まれる `<script>`, `<img onerror=...>`, `<iframe>` などのHTMLは、DOMにHTMLとして挿入する前にエスケープします。ユーザーのMarkdown由来で生成されるHTMLは、アプリ内レンダラーが作った限定タグだけです。

### 3. URLの許可制

リンクと画像のURLは別々に検証します。

- リンク: 完全ローカル性を優先し、相対リンクとアンカーのみ許可。`http`, `https`, `mailto`, `tel`, `file` などのスキーム付きURLはリンク化しません。
- 画像: `data:image/png`, `data:image/jpeg`, `data:image/gif`, `data:image/webp`, `blob:` のみ許可。
- `javascript:`, `vbscript:`, `data:text/html`, SVG data画像、プロトコル相対URL、外部リンク、外部画像はブロック。

### 4. 画像挿入の制限

画像挿入は PNG/JPEG/GIF/WebP のみで、2MB以下に制限しています。画像は Data URL としてMarkdown本文に埋め込まれるため、外部サーバーから画像を取得しません。

### 5. 依存関係ゼロ

外部ライブラリを読み込まないため、サプライチェーン攻撃やCDN改ざんの影響を受けにくい構成です。

## 残る注意点

- ブラウザ自体の脆弱性までは防げません。OSとブラウザは最新状態で使ってください。
- 自動復元は localStorage に保存します。機密文書では、作業後にブラウザのサイトデータを削除するか、Markdownファイルとして保存してから下書きを消してください。
- HTML出力ファイルも CSP を含みますが、貼り付け先のCMSやWebアプリがHTMLを再解釈する場合は、貼り付け先側の仕様に依存します。

## 報告

問題を見つけた場合は、GitHub Issueで再現手順、入力Markdown、期待結果、実際の結果を共有してください。機密情報は含めないでください。
