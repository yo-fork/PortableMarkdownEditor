Portable Markdown Editor for Windows x64

PortableMarkdownEditor.exe をダブルクリックすると起動します。

インストール、管理者権限、ユーザー登録、ログインは不要です。

Visual Studio、Visual Studio Installer、MSBuildは不要です。

BuildPortableWindows.cmdは開発者向けです。利用する端末では実行しないでください。

このフォルダ内のEXE、DLL、appフォルダを分離せずに使ってください。

動作にはWindows 10またはWindows 11、.NET Framework 4.8以降、Microsoft Edge WebView2 Evergreen Runtimeが必要です。

WebView2 Runtimeが導入されていないPCでは起動できません。

MarkdownはUTF-8の .md、.markdown、.txt に対応し、1ファイル10MBを上限とします。

ファイルメニューの「新規ウィンドウ」、またはCtrl+Nで、現在の文書を残したまま空の文書を別ウィンドウで開けます。

ファイルメニューの「新しいウィンドウで開く」、またはCtrl+Shift+Oで、別のMarkdownを独立したウィンドウで開けます。

同時に開いた各ウィンドウの下書きは分離され、別ウィンドウの下書きを上書きしません。

ショートカットは、ヘルプメニューの「キーボードショートカット」から変更できます。

同じキーを複数の操作へ割り当てることはできず、設定画面から解除または既定値への復元ができます。

本文フォントは、ヘルプメニューの「表示設定」からゴシックまたは明朝を選べます。

選択した本文フォントはリッチ、プレビュー、集中モードへ共通適用し、通常のソースモードと文書内のコードは等幅フォントのままです。

ダークモードへ切り替えると、編集画面に加えてメニュー、ファイルツールバー、ステータスバー、タイトルバーも暗い配色になります。

保存時は改行をLFへ正規化し、BOMなしUTF-8で書き込みます。

画像はPNG、JPEG、GIF、WebPに対応し、1ファイル25MBを上限とします。

画像参照はMarkdownファイル基準の相対パスを推奨します。

既存の絶対画像パスは、開いたMarkdownと同じフォルダ内の画像だけ表示します。

インライン数式は $...$ または \(...\)、表示数式は独立した $$...$$ または \[...\] に対応します。

挿入画像はMarkdownファイルと同じ場所の MarkdownFileName.assets フォルダへ保存します。

下書きとWebView2プロファイルは、初回起動時にこのフォルダの data\WebView2 以下へ作成します。

下書きを維持したまま移動する場合は、dataフォルダも一緒に移してください。

別PCでは、コード署名されていないアプリとしてWindows SmartScreenが警告する可能性があります。

本アプリのライセンスはLICENSE、WebView2 SDKのライセンスはTHIRD-PARTY-NOTICES.txtを確認してください。
