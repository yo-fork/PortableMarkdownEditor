# Portable Markdown Editor

Windowsでインストールせずに使える、完全ローカル実行のMarkdownエディタです。

推奨するWindowsアプリ版と、従来のブラウザ版を同じ編集基盤で提供します。

Windowsアプリ版では、WPFがファイル操作と印刷を担当し、同梱WebView2がProseMirror、CodeMirror、Mermaid、KaTeXを使った編集画面を表示します。

CDN、外部配信JavaScript、外部配信CSS、外部API通信は使いません。

## Windowsアプリ版をそのまま使う

完成済みの [`release/PortableMarkdownEditor-win-x64.zip`](release/PortableMarkdownEditor-win-x64.zip) をダウンロードして展開します。

展開した `PortableMarkdownEditor` フォルダ内の `PortableMarkdownEditor.exe` をダブルクリックすると起動します。

Visual Studio、Visual Studio Installer、MSBuildは、利用するWindows端末には不要です。

`BuildPortableWindows.cmd`はソースから再ビルドする開発者向けのファイルであり、アプリの起動には使いません。

配布ZIPのSHA-256は [`release/SHA256SUMS.txt`](release/SHA256SUMS.txt) で確認できます。

MIT Licenseと第三者ライセンス通知は、配布ZIP内に加えて [`release/LICENSE`](release/LICENSE) と [`release/THIRD-PARTY-NOTICES.txt`](release/THIRD-PARTY-NOTICES.txt) にも配置しています。

## Windowsアプリ版の機能

インストーラー、管理者権限、ユーザー登録、ログインは不要です。

初回起動時も、Webサイトのフォルダ権限を許可する操作はありません。

ファイル選択と保存先選択にはWindows標準ダイアログを使います。

これはOSに対するユーザーの選択操作であり、Webサイトの認証や永続的なフォルダ権限付与ではありません。

Windowsアプリ版では、次の操作をネイティブ側が担当します。

* Markdownの新規作成、読み込み、上書き保存、名前を付けて保存を行います。
* 未保存の文書を閉じる場合や別文書へ切り替える場合に確認します。
* HTMLと外部リンク許可設定をWindows標準ダイアログから書き出します。
* Windowsの印刷画面を開き、プリンターまたはMicrosoft Print to PDFへ出力します。
* 選択、貼り付け、ドラッグアンドドロップした画像を `MarkdownFileName.assets/` へ保存します。
* 開いているMarkdownファイルの場所を基準として、相対画像を表示します。

WebViewへはMarkdown本文、表示用ファイル名、限定された命令だけを渡します。

実ファイルの絶対パスや任意のファイルアクセスAPIはWebViewへ渡しません。

### 動作条件

Windowsアプリ版の動作条件は次のとおりです。

* Windows 10またはWindows 11のx64環境。
* .NET Framework 4.8以降。
* Microsoft Edge WebView2 Evergreen Runtime。

現在のWindows 10/11ではWebView2 Runtimeが導入済みであることが多いものの、未導入環境では別途Runtimeが必要です。

完全な単一EXEではなく、EXE、WebView2 SDK DLL、ローカルWeb資産をまとめたポータブルフォルダとして配布します。

固定版WebView2 Runtimeは容量が大きいため同梱していません。

アプリの下書きとWebView2プロファイルは、EXEと同じ場所の `data/WebView2/` に保存します。

アプリを別の場所へ移す場合は、下書きを維持するなら `data/` も一緒に移してください。

### 開発者向けビルド

この手順は、ソースを変更してWindowsアプリを再ビルドする場合だけ必要です。

完成済みZIPを利用する端末では実行しません。

プロジェクト直下で次を実行します。

```powershell
.\BuildPortableWindows.cmd
```

ビルドスクリプトは、導入済みのVisual Studio Build Tools、WebView2 SDK、.NET Frameworkを検出します。

パッケージマネージャー、依存関係の復元、ネットワーク取得は実行しません。

.NET Framework 4.8 Targeting Packがある場合はそれを使い、ない場合は導入済みの.NET Framework 4.8ランタイムアセンブリを使います。

再現性を重視するビルド環境では、Visual Studio Build ToolsのMSBuild、.NET Framework 4.8 Targeting Pack、同一バージョンのWebView2 Core/WPF/Loaderを用意してください。

生成物は次の場所に出力します。

* ポータブルフォルダ: `dist/PortableMarkdownEditor/`
* 配布ZIP: `dist/PortableMarkdownEditor-win-x64.zip`

ビルド時にはネイティブのファイル処理検査も実行します。

検査内容は、UTF-8の往復、BOMなし保存、画像署名とMIMEの一致、assetsファイル名の重複回避、Windows予約名の無害化です。

配布用ZIPを `release/` へ更新し、SHA-256を生成する場合は次を実行します。

```powershell
.\BuildPortableWindows.cmd -Publish
```

`-Publish`は配布ZIPとSHA-256に加え、MIT Licenseと第三者ライセンス通知も `release/` へ同期します。

## ブラウザ版

ブラウザ版は、Visual StudioやWebView2 SDKを使わずに実行できます。

推奨ブラウザはMicrosoft EdgeまたはGoogle Chromeです。

1. ZIPを展開します。
2. `OpenMarkdownEditor.cmd` または `index.html` をダブルクリックします。
3. 「ファイルから開く」でMarkdownを読み込みます。
4. 元ファイルへの上書き、相対画像の表示、assets画像保存を使う場合は「フォルダから開く」または「フォルダ許可」で対象フォルダを許可します。
5. 「保存」で、フォルダ許可済みなら元ファイルへ上書きし、未許可ならダウンロード保存します。

ブラウザ版の上書き保存とassets画像保存にはFile System Access APIを使います。

未対応ブラウザでは、フォルダ入力とダウンロード保存へフォールバックします。

フォルダ走査は最大5,000ファイル、最大8階層に制限します。

上限を超えた部分は読み飛ばし、警告ダイアログとステータスに表示します。

必要に応じてローカルHTTPで確認する場合は、プロジェクト直下で次を実行し、`http://127.0.0.1:8773/index.html` を開きます。

```powershell
py -m http.server 8773 --bind 127.0.0.1
```

`py` が使えない環境では、Pythonが入っていれば次でも起動できます。

```powershell
python -m http.server 8773 --bind 127.0.0.1
```

## 主な機能

* vendored ProseMirrorによるリッチ編集と、vendored CodeMirror 6によるMarkdownソース編集を切り替えます。
* リッチ、分割、ソース、プレビュー、集中の5モードを備えます。
* Markdown、Mermaid図、KaTeX数式、コードハイライトをローカル同梱ライブラリだけで処理します。
* Markdown内のraw HTMLは実行せず、文字として扱います。
* 外部リンクは許可ドメイン制とし、危険なスキームをリンク化しません。
* 遠隔画像、SVG data画像、文書フォルダ外のローカル絶対パス画像をブロックします。
* PNG、JPEG、GIF、WebPの相対画像とassets画像保存に対応します。
* Windowsアプリ版は、既存文書内の絶対画像パスが開いているMarkdownと同じフォルダ内を指す場合だけ、安全な相対参照へ解決して表示します。
* 下書きと表示設定をローカルに自動保存します。

Windowsアプリ版ではMarkdownを10MB以下、挿入画像を1ファイル25MB以下に制限します。

MarkdownファイルはUTF-8として読み込み、BOMなしUTF-8で保存します。

## ショートカット

|キー|操作|
|-|-|
|`Ctrl + N`|空の新規ウィンドウを開く、Windowsアプリ版のみ|
|`Ctrl + S`|Markdown保存|
|`Ctrl + Shift + S`|名前を付けて保存、Windowsアプリ版のみ|
|`Ctrl + O`|Markdownを開く|
|`Ctrl + Shift + O`|Markdownを新しいウィンドウで開く、Windowsアプリ版のみ|
|`Ctrl + P`|PDF/印刷|
|`Ctrl + B`|太字|
|`Ctrl + I`|斜体|
|`Ctrl + K`|インラインコード|
|`Ctrl + M`|インライン数式|
|`Ctrl + Shift + K`|コードブロック|
|`Ctrl + Shift + M`|数式ブロック|
|`Ctrl + Shift + L`|リンク挿入|
|`Ctrl + 0`|段落へ戻す|
|`Ctrl + 1`〜`Ctrl + 6`|見出し1〜6|
|`Ctrl + Shift + 7`|番号リスト|
|`Ctrl + Shift + 8`|箇条書き|
|`Ctrl + Shift + 9`|引用|
|`Ctrl + Alt + T`|表を挿入|
|`Ctrl + Alt + I`|目次を挿入|
|`Ctrl + Alt + M`|Mermaid図を挿入|
|`Ctrl + Alt + O`|アウトラインの表示切り替え|

## 対応Markdown

見出し、段落、引用、箇条書き、番号リスト、チェックリスト、表、コードブロック、インラインコード、太字、斜体、打ち消し線、リンク、画像、折りたたみ可能な目次 `[toc]` に対応します。

`js`、`ts`、`python`、`html`、`css`、`json`、`bash`、`powershell`、`sql`、`yaml` などの主要言語をハイライトします。

`mermaid` コードブロックと、`$...$`、`\(...\)`のインライン数式に対応します。

表示数式は、`$$...$$`または`\[...\]`を独立したブロックとして記述します。

コードスパンとコードブロック内の数式記号は変換しません。

対応例は [`samples/math-syntax-gallery.md`](samples/math-syntax-gallery.md) に記載しています。

## 開発時の検査

アプリの実行にNode.jsは不要ですが、Web側の開発時検査にはNode.jsを使います。

依存関係の追加やパッケージマネージャーの実行は不要です。

プロジェクト直下で `RunChecks.cmd` を実行すると、構文、セキュリティ、デスクトップ境界、描画、同梱ライブラリの整合性を検査します。

Windows配布物の実ビルドとネイティブファイル処理検査は `BuildPortableWindows.cmd` が担当します。

ブラウザでの確認項目は [`tests/manual-checklist.md`](tests/manual-checklist.md) に記載しています。

同梱ライブラリの簡易確認は、ローカルHTTPサーバーで [`tests/browser-selftest.html`](tests/browser-selftest.html) を開いて実行できます。

Windowsアプリ版の構成と信頼境界は [`docs/windows-portable-app.md`](docs/windows-portable-app.md) に記載しています。

## セキュリティ設計

詳しくは [`SECURITY.md`](SECURITY.md)、[`docs/security-model.md`](docs/security-model.md)、[`docs/windows-portable-app.md`](docs/windows-portable-app.md) を参照してください。

主な防御方針は次のとおりです。

* Content Security Policyで外部通信、外部埋め込み、フォーム送信を禁止します。
* raw HTMLを無効化し、リンクと画像のURLを別々に検証します。
* WindowsホストはWebView2のホストオブジェクトを無効化し、限定したJSONメッセージだけを受け付けます。
* WebViewからのメッセージは、固定したアプリオリジンから届いた場合だけ処理します。
* Windowsホストは実ファイルパスをWebViewへ送らず、画像専用URLへの要求ごとに文書フォルダ内の画像を検証して返します。
* 画像は拡張子だけでなくバイト署名とMIMEを照合し、任意の保存名や上書きを許可しません。
* `eval`、`new Function`、Web Worker、fetch、XHRを使いません。

## ライセンス

本プロジェクトはMIT Licenseです。

詳細は [`LICENSE`](LICENSE) を確認してください。

Windows配布物に含めるWebView2 SDKのライセンスは [`native/THIRD-PARTY-NOTICES.txt`](native/THIRD-PARTY-NOTICES.txt) に収録しています。
