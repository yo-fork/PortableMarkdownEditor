using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Input;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;

namespace PortableMarkdownEditor.Desktop
{
    public partial class MainWindow : Window
    {
        private const string AppHost = "portable-markdown-editor.local";
        private const string DocumentHost = "document.portable-markdown-editor.local";
        private const string NewDocumentArgument = "--new-document";
        private const int MaxBridgeMessageCharacters = 80 * 1024 * 1024;
        private const int SnapshotTimeoutMilliseconds = 10000;

        private readonly JavaScriptSerializer _json = new JavaScriptSerializer
        {
            MaxJsonLength = int.MaxValue,
            RecursionLimit = 32,
        };

        private readonly Dictionary<string, TaskCompletionSource<DocumentSnapshot>> _pendingSnapshots
            = new Dictionary<string, TaskCompletionSource<DocumentSnapshot>>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> _shortcutByCommand = CreateDefaultNativeShortcuts();
        private readonly Dictionary<string, string> _commandByShortcut
            = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        private string _documentPath;
        private string _webFileName = "untitled.md";
        private string _startupDocumentPath;
        private bool _startWithNewDocument;
        private bool _editorReady;
        private bool _dirty;
        private bool _operationInProgress;
        private bool _shortcutCaptureActive;

        public MainWindow()
        {
            InitializeComponent();
            string[] arguments = Environment.GetCommandLineArgs();
            if (arguments.Length > 1 && !string.IsNullOrWhiteSpace(arguments[1]))
            {
                if (string.Equals(arguments[1], NewDocumentArgument, StringComparison.Ordinal))
                {
                    _startWithNewDocument = true;
                }
                else
                {
                    _startupDocumentPath = arguments[1];
                }
            }

            RebuildNativeShortcutLookup();
            UpdateShortcutMenuLabels();
            UpdateWindowState();
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs eventArgs)
        {
            await RunOperationAsync(InitializeEditorAsync);
        }

        private void MainWindow_Closing(object sender, CancelEventArgs eventArgs)
        {
            if (!_dirty)
            {
                return;
            }

            MessageBoxResult result = MessageBox.Show(
                this,
                "未保存の変更があります。\n保存せずにアプリを終了しますか？",
                "未保存の変更",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning,
                MessageBoxResult.No);
            if (result != MessageBoxResult.Yes)
            {
                eventArgs.Cancel = true;
            }
        }

        private async void MainWindow_PreviewKeyDown(object sender, KeyEventArgs eventArgs)
        {
            if (_shortcutCaptureActive) return;
            string command = ShortcutCommandForKeyEvent(eventArgs);
            if (string.IsNullOrEmpty(command)) return;
            eventArgs.Handled = true;
            switch (command)
            {
                case "new-window":
                    OpenNewDocumentWindow();
                    break;
                case "open":
                    await RunOperationAsync(OpenDocumentAsync);
                    break;
                case "open-new-window":
                    OpenDocumentInNewWindow();
                    break;
                case "save":
                    await RunOperationAsync(() => SaveDocumentAsync(false));
                    break;
                case "save-as":
                    await RunOperationAsync(() => SaveDocumentAsync(true));
                    break;
                case "print":
                    await RunOperationAsync(PrintAsync);
                    break;
            }
        }

        private void New_Click(object sender, RoutedEventArgs eventArgs)
        {
            OpenNewDocumentWindow();
        }

        private async void Open_Click(object sender, RoutedEventArgs eventArgs)
        {
            await RunOperationAsync(OpenDocumentAsync);
        }

        private void OpenInNewWindow_Click(object sender, RoutedEventArgs eventArgs)
        {
            OpenDocumentInNewWindow();
        }

        private async void Save_Click(object sender, RoutedEventArgs eventArgs)
        {
            await RunOperationAsync(() => SaveDocumentAsync(false));
        }

        private async void SaveAs_Click(object sender, RoutedEventArgs eventArgs)
        {
            await RunOperationAsync(() => SaveDocumentAsync(true));
        }

        private async void Print_Click(object sender, RoutedEventArgs eventArgs)
        {
            await RunOperationAsync(PrintAsync);
        }

        private void Exit_Click(object sender, RoutedEventArgs eventArgs)
        {
            Close();
        }

        private void About_Click(object sender, RoutedEventArgs eventArgs)
        {
            MessageBox.Show(
                this,
                "Portable Markdown Editor\n\nWindows側がファイル操作を担当し、編集画面は同梱WebアプリをWebView2で表示します。\nネットワーク通信やCDNは使用しません。",
                "このアプリについて",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
        }

        private void Shortcuts_Click(object sender, RoutedEventArgs eventArgs)
        {
            SendHostMessage(new Dictionary<string, object>
            {
                { "type", "host.showShortcutSettings" },
            });
        }

        private void Appearance_Click(object sender, RoutedEventArgs eventArgs)
        {
            SendHostMessage(new Dictionary<string, object>
            {
                { "type", "host.showAppearanceSettings" },
            });
        }

        private async Task InitializeEditorAsync()
        {
            NativeStatusText.Text = "WebView2を初期化しています...";
            string executableDirectory = AppDomain.CurrentDomain.BaseDirectory;
            string appDirectory = Path.Combine(executableDirectory, "app");
            string indexPath = Path.Combine(appDirectory, "index.html");
            if (!File.Exists(indexPath))
            {
                throw new FileNotFoundException("appフォルダに index.html が見つかりません。配布フォルダを崩さずに実行してください。", indexPath);
            }

            string userDataDirectory = Path.Combine(executableDirectory, "data", "WebView2");
            Directory.CreateDirectory(userDataDirectory);
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, userDataDirectory, null);
            await EditorWebView.EnsureCoreWebView2Async(environment);

            CoreWebView2 core = EditorWebView.CoreWebView2;
            ConfigureWebViewSettings(core.Settings);
            core.SetVirtualHostNameToFolderMapping(AppHost, appDirectory, CoreWebView2HostResourceAccessKind.DenyCors);
            core.NavigationStarting += Core_NavigationStarting;
            core.NewWindowRequested += Core_NewWindowRequested;
            core.WebMessageReceived += Core_WebMessageReceived;
            core.PermissionRequested += Core_PermissionRequested;
            core.AddWebResourceRequestedFilter(
                "https://" + DocumentHost + "/*",
                CoreWebView2WebResourceContext.Image);
            core.WebResourceRequested += Core_WebResourceRequested;
            EditorWebView.Source = new Uri("https://" + AppHost + "/index.html?desktop=1");
            NativeStatusText.Text = "編集画面を読み込んでいます...";
        }

        private async void Core_WebResourceRequested(
            object sender,
            CoreWebView2WebResourceRequestedEventArgs eventArgs)
        {
            Uri requestUri;
            if (eventArgs.ResourceContext != CoreWebView2WebResourceContext.Image
                || !Uri.TryCreate(eventArgs.Request.Uri, UriKind.Absolute, out requestUri)
                || requestUri.Scheme != Uri.UriSchemeHttps
                || !string.Equals(requestUri.Host, DocumentHost, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            using (CoreWebView2Deferral deferral = eventArgs.GetDeferral())
            {
                try
                {
                    DocumentImageContent image = await TryReadDocumentImageAsync(requestUri);
                    eventArgs.Response = CreateDocumentImageResponse(image);
                }
                catch (Exception)
                {
                    try
                    {
                        eventArgs.Response = CreateDocumentImageResponse(null);
                    }
                    catch (Exception)
                    {
                    }
                }
            }
        }

        private async Task<DocumentImageContent> TryReadDocumentImageAsync(Uri requestUri)
        {
            string documentPath = _documentPath;
            if (string.IsNullOrEmpty(documentPath))
            {
                return null;
            }

            string relativePath = requestUri.GetComponents(
                UriComponents.Path,
                UriFormat.UriEscaped);
            try
            {
                return await Task.Run(
                    () => PortableFileService.ReadDocumentImage(documentPath, relativePath));
            }
            catch (Exception)
            {
                return null;
            }
        }

        private CoreWebView2WebResourceResponse CreateDocumentImageResponse(DocumentImageContent image)
        {
            CoreWebView2Environment environment = EditorWebView.CoreWebView2.Environment;
            if (image == null)
            {
                return environment.CreateWebResourceResponse(
                    new MemoryStream(new byte[0], false),
                    404,
                    "Not Found",
                    "Content-Type: text/plain\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
            }

            return environment.CreateWebResourceResponse(
                new MemoryStream(image.Data, false),
                200,
                "OK",
                "Content-Type: " + image.ContentType
                    + "\r\nCache-Control: no-store"
                    + "\r\nX-Content-Type-Options: nosniff");
        }

        private static void ConfigureWebViewSettings(CoreWebView2Settings settings)
        {
            settings.IsScriptEnabled = true;
            settings.IsWebMessageEnabled = true;
            settings.IsStatusBarEnabled = false;
            settings.AreDevToolsEnabled = false;
            settings.AreDefaultContextMenusEnabled = true;
            settings.AreHostObjectsAllowed = false;
            settings.IsZoomControlEnabled = true;
            settings.AreBrowserAcceleratorKeysEnabled = true;
        }

        private void Core_NavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs eventArgs)
        {
            if (!IsAppSource(eventArgs.Uri))
            {
                eventArgs.Cancel = true;
                NativeStatusText.Text = "編集画面外への移動をブロックしました。";
            }
        }

        private void Core_NewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs eventArgs)
        {
            eventArgs.Handled = true;
            if (!eventArgs.IsUserInitiated)
            {
                return;
            }

            Uri target;
            if (!Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out target)
                || (target.Scheme != Uri.UriSchemeHttp && target.Scheme != Uri.UriSchemeHttps))
            {
                NativeStatusText.Text = "許可されていないリンクをブロックしました。";
                return;
            }

            try
            {
                Process.Start(new ProcessStartInfo(target.AbsoluteUri) { UseShellExecute = true });
            }
            catch (Exception exception)
            {
                ShowOperationError("リンクを開けませんでした。", exception);
            }
        }

        private void Core_PermissionRequested(object sender, CoreWebView2PermissionRequestedEventArgs eventArgs)
        {
            eventArgs.SavesInProfile = false;
            eventArgs.Handled = true;
            if (IsAppSource(eventArgs.Uri)
                && eventArgs.IsUserInitiated
                && eventArgs.PermissionKind == CoreWebView2PermissionKind.ClipboardRead)
            {
                eventArgs.State = CoreWebView2PermissionState.Allow;
                return;
            }

            eventArgs.State = CoreWebView2PermissionState.Deny;
        }

        private async void Core_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
        {
            if (!IsAppSource(eventArgs.Source))
            {
                return;
            }

            string json = eventArgs.WebMessageAsJson;
            if (string.IsNullOrEmpty(json) || json.Length > MaxBridgeMessageCharacters)
            {
                NativeStatusText.Text = "大きすぎるメッセージを拒否しました。";
                return;
            }

            Dictionary<string, object> message;
            try
            {
                message = _json.Deserialize<Dictionary<string, object>>(json);
            }
            catch (Exception)
            {
                NativeStatusText.Text = "編集画面から不正なメッセージを受信しました。";
                return;
            }

            if (message == null)
            {
                return;
            }

            string type = GetString(message, "type");
            try
            {
                switch (type)
                {
                    case "desktop.ready":
                        await HandleEditorReadyAsync(message);
                        break;
                    case "desktop.documentState":
                        HandleDocumentState(message);
                        break;
                    case "desktop.documentSnapshot":
                        HandleDocumentSnapshot(message);
                        break;
                    case "desktop.command":
                        await RunOperationAsync(() => ExecuteEditorCommandAsync(GetString(message, "command")));
                        break;
                    case "desktop.shortcutsChanged":
                        ApplyShortcutSettings(message);
                        break;
                    case "desktop.shortcutCaptureState":
                        _shortcutCaptureActive = GetBoolean(message, "active");
                        break;
                    case "desktop.saveAsset":
                        HandleAssetSave(message);
                        break;
                    case "desktop.resolveImageReferences":
                        await HandleImageReferenceResolutionAsync(message);
                        break;
                    case "desktop.exportHtml":
                        await RunOperationAsync(() => SaveHtmlExportAsync(message));
                        break;
                    case "desktop.exportSettings":
                        await RunOperationAsync(() => SaveSettingsExportAsync(message));
                        break;
                }
            }
            catch (Exception exception)
            {
                ShowOperationError("編集画面からの操作に失敗しました。", exception);
            }
        }

        private async Task HandleEditorReadyAsync(Dictionary<string, object> message)
        {
            _editorReady = true;
            _shortcutCaptureActive = false;
            _dirty = GetBoolean(message, "dirty");
            _webFileName = SafeDisplayFileName(GetString(message, "fileName"));
            ApplyShortcutSettings(message);
            NativeStatusText.Text = "準備完了";
            UpdateWindowState();

            if (_startWithNewDocument)
            {
                _startWithNewDocument = false;
                LoadNewDocument();
                return;
            }

            string startupPath = _startupDocumentPath;
            _startupDocumentPath = null;
            if (!string.IsNullOrWhiteSpace(startupPath))
            {
                await OpenDocumentPathAsync(startupPath, true);
            }
        }

        private void ApplyShortcutSettings(Dictionary<string, object> message)
        {
            object rawShortcuts;
            Dictionary<string, object> shortcuts;
            if (!message.TryGetValue("shortcuts", out rawShortcuts)
                || (shortcuts = rawShortcuts as Dictionary<string, object>) == null)
            {
                return;
            }

            Dictionary<string, string> next = CreateDefaultNativeShortcuts();
            HashSet<string> used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string[] commands = { "new-window", "open", "open-new-window", "save", "save-as", "print" };
            foreach (string command in commands)
            {
                object rawValue;
                string value;
                if (shortcuts.TryGetValue(command, out rawValue) && rawValue is string)
                {
                    value = (string)rawValue;
                    if (value.Length == 0)
                    {
                        next[command] = string.Empty;
                    }
                    else
                    {
                        string normalized = NormalizeShortcut(value);
                        if (!string.IsNullOrEmpty(normalized)) next[command] = normalized;
                    }
                }

                string shortcut = next[command];
                if (!string.IsNullOrEmpty(shortcut) && !used.Add(shortcut)) next[command] = string.Empty;
            }

            _shortcutByCommand.Clear();
            foreach (KeyValuePair<string, string> entry in next) _shortcutByCommand[entry.Key] = entry.Value;
            RebuildNativeShortcutLookup();
            UpdateShortcutMenuLabels();
        }

        private void HandleDocumentState(Dictionary<string, object> message)
        {
            _dirty = GetBoolean(message, "dirty");
            _webFileName = SafeDisplayFileName(GetString(message, "fileName"));
            UpdateWindowState();
        }

        private void HandleDocumentSnapshot(Dictionary<string, object> message)
        {
            string requestId = GetString(message, "requestId");
            TaskCompletionSource<DocumentSnapshot> completion;
            if (string.IsNullOrEmpty(requestId) || !_pendingSnapshots.TryGetValue(requestId, out completion))
            {
                return;
            }

            _pendingSnapshots.Remove(requestId);
            string markdown = GetString(message, "markdown");
            if (markdown.Length > PortableFileService.MaxDocumentCharacters)
            {
                completion.TrySetException(new InvalidDataException("Markdown文書が大きすぎます。"));
                return;
            }

            completion.TrySetResult(new DocumentSnapshot(markdown, SafeDisplayFileName(GetString(message, "fileName"))));
        }

        private void HandleAssetSave(Dictionary<string, object> message)
        {
            string requestId = GetString(message, "requestId");
            if (!IsValidRequestId(requestId))
            {
                return;
            }

            try
            {
                if (string.IsNullOrEmpty(_documentPath))
                {
                    throw new InvalidDataException("先にMarkdownファイルを保存してください。");
                }

                AssetSaveResult result = PortableFileService.SaveAsset(
                    _documentPath,
                    GetString(message, "fileName"),
                    GetString(message, "mimeType"),
                    GetString(message, "dataBase64"));
                SendHostMessage(new Dictionary<string, object>
                {
                    { "type", "host.assetSaved" },
                    { "requestId", requestId },
                    { "fileName", result.FileName },
                    { "markdownPath", result.MarkdownPath },
                });
                NativeStatusText.Text = result.FileName + " をassetsフォルダへ保存しました。";
            }
            catch (Exception exception)
            {
                SendHostError(requestId, SafeAssetErrorMessage(exception));
            }
        }

        private async Task HandleImageReferenceResolutionAsync(Dictionary<string, object> message)
        {
            string requestId = GetString(message, "requestId");
            if (!IsValidRequestId(requestId))
            {
                return;
            }

            string[] references = GetStringArray(message, "references", 64, 4096);
            Dictionary<string, string> aliases = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (!string.IsNullOrEmpty(_documentPath) && references.Length > 0)
            {
                string documentPath = _documentPath;
                aliases = await Task.Run(
                    () => PortableFileService.ResolveDocumentImageReferences(documentPath, references));
            }

            SendHostMessage(new Dictionary<string, object>
            {
                { "type", "host.imageReferencesResolved" },
                { "requestId", requestId },
                { "aliases", aliases },
            });
        }

        private async Task ExecuteEditorCommandAsync(string command)
        {
            switch (command)
            {
                case "new":
                    OpenNewDocumentWindow();
                    break;
                case "open":
                    await OpenDocumentAsync();
                    break;
                case "openNewWindow":
                    OpenDocumentInNewWindow();
                    break;
                case "save":
                    await SaveDocumentAsync(false);
                    break;
                case "saveAs":
                    await SaveDocumentAsync(true);
                    break;
                case "print":
                    await PrintAsync();
                    break;
            }
        }

        private void LoadNewDocument()
        {
            if (!_editorReady)
            {
                return;
            }

            _documentPath = null;
            _webFileName = "untitled.md";
            _dirty = false;
            SendHostMessage(new Dictionary<string, object>
            {
                { "type", "host.newDocument" },
                { "markdown", "# 無題\n\nここにMarkdownを書いてください。\n" },
                { "fileName", _webFileName },
                { "hasDocumentFolder", false },
                { "dirty", false },
            });
            NativeStatusText.Text = "新規文書を作成しました。";
            UpdateWindowState();
        }

        private async Task OpenDocumentAsync()
        {
            if (!_editorReady)
            {
                return;
            }

            string path = SelectMarkdownDocumentPath("Markdownファイルを開く");
            if (string.IsNullOrEmpty(path))
            {
                return;
            }

            await OpenDocumentPathAsync(path, true);
        }

        private void OpenDocumentInNewWindow()
        {
            if (!_editorReady)
            {
                return;
            }

            string path = SelectMarkdownDocumentPath("新しいウィンドウでMarkdownファイルを開く");
            if (string.IsNullOrEmpty(path))
            {
                return;
            }

            try
            {
                string fullPath = Path.GetFullPath(path);
                if (!File.Exists(fullPath))
                {
                    throw new FileNotFoundException("選択したMarkdownファイルが見つかりません。", fullPath);
                }

                StartNewEditorProcess(QuoteCommandLineArgument(fullPath));
                NativeStatusText.Text = "新しいウィンドウでファイルを開きました。";
            }
            catch (Exception exception)
            {
                ShowOperationError("新しいウィンドウを開けませんでした。", exception);
            }
        }

        private void OpenNewDocumentWindow()
        {
            if (!_editorReady)
            {
                return;
            }

            try
            {
                StartNewEditorProcess(NewDocumentArgument);
                NativeStatusText.Text = "新規ウィンドウを開きました。";
            }
            catch (Exception exception)
            {
                ShowOperationError("新規ウィンドウを開けませんでした。", exception);
            }
        }

        private static void StartNewEditorProcess(string arguments)
        {
            string executablePath = Path.GetFullPath(Environment.GetCommandLineArgs()[0]);
            if (!File.Exists(executablePath))
            {
                throw new FileNotFoundException("実行中のアプリ本体が見つかりません。", executablePath);
            }

            Process process = Process.Start(new ProcessStartInfo
            {
                FileName = executablePath,
                Arguments = arguments,
                WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory,
                UseShellExecute = false,
            });
            if (process == null)
            {
                throw new InvalidOperationException("新しいウィンドウの起動結果を確認できませんでした。");
            }

            process.Dispose();
        }

        private string SelectMarkdownDocumentPath(string title)
        {
            OpenFileDialog dialog = new OpenFileDialog
            {
                Title = title,
                Filter = "Markdown (*.md;*.markdown;*.txt)|*.md;*.markdown;*.txt|すべてのファイル (*.*)|*.*",
                Multiselect = false,
                CheckFileExists = true,
                DereferenceLinks = true,
                RestoreDirectory = true,
            };
            return dialog.ShowDialog(this) == true ? dialog.FileName : null;
        }

        private static string QuoteCommandLineArgument(string value)
        {
            if (string.IsNullOrEmpty(value) || value.IndexOf('"') >= 0)
            {
                throw new ArgumentException("起動引数として使用できないファイルパスです。", "value");
            }

            return "\"" + value + "\"";
        }

        private static Dictionary<string, string> CreateDefaultNativeShortcuts()
        {
            return new Dictionary<string, string>(StringComparer.Ordinal)
            {
                { "new-window", "Ctrl+N" },
                { "open", "Ctrl+O" },
                { "open-new-window", "Ctrl+Shift+O" },
                { "save", "Ctrl+S" },
                { "save-as", "Ctrl+Shift+S" },
                { "print", "Ctrl+P" },
            };
        }

        private void RebuildNativeShortcutLookup()
        {
            _commandByShortcut.Clear();
            foreach (KeyValuePair<string, string> entry in _shortcutByCommand)
            {
                if (!string.IsNullOrEmpty(entry.Value)) _commandByShortcut[entry.Value] = entry.Key;
            }
        }

        private void UpdateShortcutMenuLabels()
        {
            NewMenuItem.InputGestureText = _shortcutByCommand["new-window"];
            OpenMenuItem.InputGestureText = _shortcutByCommand["open"];
            OpenInNewWindowMenuItem.InputGestureText = _shortcutByCommand["open-new-window"];
            SaveMenuItem.InputGestureText = _shortcutByCommand["save"];
            SaveAsMenuItem.InputGestureText = _shortcutByCommand["save-as"];
            PrintMenuItem.InputGestureText = _shortcutByCommand["print"];
        }

        private string ShortcutCommandForKeyEvent(KeyEventArgs eventArgs)
        {
            string shortcut = ShortcutFromKeyEvent(eventArgs);
            string command;
            return !string.IsNullOrEmpty(shortcut) && _commandByShortcut.TryGetValue(shortcut, out command)
                ? command
                : null;
        }

        private static string ShortcutFromKeyEvent(KeyEventArgs eventArgs)
        {
            ModifierKeys modifiers = Keyboard.Modifiers;
            if ((modifiers & ModifierKeys.Control) == 0 || (modifiers & ModifierKeys.Windows) != 0) return null;
            Key key = eventArgs.Key == Key.System ? eventArgs.SystemKey : eventArgs.Key;
            string keyName = ShortcutKeyName(key);
            if (string.IsNullOrEmpty(keyName)) return null;
            StringBuilder shortcut = new StringBuilder("Ctrl");
            if ((modifiers & ModifierKeys.Shift) != 0) shortcut.Append("+Shift");
            if ((modifiers & ModifierKeys.Alt) != 0) shortcut.Append("+Alt");
            shortcut.Append('+').Append(keyName);
            return shortcut.ToString();
        }

        private static string ShortcutKeyName(Key key)
        {
            if (key >= Key.A && key <= Key.Z) return key.ToString();
            if (key >= Key.D0 && key <= Key.D9) return key.ToString().Substring(1);
            if (key >= Key.F1 && key <= Key.F12) return key.ToString();
            return null;
        }

        private static string NormalizeShortcut(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Length > 32) return null;
            string[] parts = value.Split('+');
            bool control = false;
            bool shift = false;
            bool alt = false;
            string key = null;
            foreach (string rawPart in parts)
            {
                string part = rawPart.Trim();
                if (part.Equals("Ctrl", StringComparison.OrdinalIgnoreCase)
                    || part.Equals("Control", StringComparison.OrdinalIgnoreCase))
                {
                    if (control) return null;
                    control = true;
                }
                else if (part.Equals("Shift", StringComparison.OrdinalIgnoreCase))
                {
                    if (shift) return null;
                    shift = true;
                }
                else if (part.Equals("Alt", StringComparison.OrdinalIgnoreCase))
                {
                    if (alt) return null;
                    alt = true;
                }
                else
                {
                    if (key != null) return null;
                    key = NormalizeShortcutKey(part);
                    if (key == null) return null;
                }
            }

            if (!control || key == null) return null;
            return "Ctrl" + (shift ? "+Shift" : string.Empty) + (alt ? "+Alt" : string.Empty) + "+" + key;
        }

        private static string NormalizeShortcutKey(string value)
        {
            string key = (value ?? string.Empty).Trim().ToUpperInvariant();
            if (key.Length == 1 && ((key[0] >= 'A' && key[0] <= 'Z') || (key[0] >= '0' && key[0] <= '9')))
            {
                return key;
            }

            int functionNumber;
            if (key.Length >= 2 && key[0] == 'F'
                && int.TryParse(key.Substring(1), out functionNumber)
                && functionNumber >= 1 && functionNumber <= 12)
            {
                return "F" + functionNumber;
            }
            return null;
        }

        private async Task OpenDocumentPathAsync(string path, bool confirmDiscard)
        {
            if (confirmDiscard && !ConfirmDiscardChanges("選択したファイルへ切り替え"))
            {
                return;
            }

            NativeStatusText.Text = "Markdownファイルを読み込んでいます...";
            string fullPath = Path.GetFullPath(path);
            string markdown = await Task.Run(() => PortableFileService.ReadDocument(fullPath));
            _documentPath = fullPath;
            _webFileName = Path.GetFileName(fullPath);
            _dirty = false;
            bool mapped = HasUsableDocumentDirectory(fullPath);
            SendHostMessage(new Dictionary<string, object>
            {
                { "type", "host.loadDocument" },
                { "markdown", markdown },
                { "fileName", _webFileName },
                { "hasDocumentFolder", mapped },
                { "dirty", false },
            });
            NativeStatusText.Text = mapped
                ? "ファイルを開きました。"
                : "ファイルを開きましたが、相対画像の参照先を設定できませんでした。";
            UpdateWindowState();
        }

        private async Task SaveDocumentAsync(bool saveAs)
        {
            if (!_editorReady)
            {
                return;
            }

            DocumentSnapshot snapshot = await RequestDocumentSnapshotAsync();
            string targetPath = _documentPath;
            if (saveAs || string.IsNullOrEmpty(targetPath))
            {
                SaveFileDialog dialog = new SaveFileDialog
                {
                    Title = "Markdownファイルを保存",
                    Filter = "Markdown (*.md)|*.md|Markdown (*.markdown)|*.markdown|テキスト (*.txt)|*.txt",
                    DefaultExt = ".md",
                    AddExtension = true,
                    OverwritePrompt = true,
                    RestoreDirectory = true,
                    FileName = SafeDisplayFileName(snapshot.FileName),
                };
                if (dialog.ShowDialog(this) != true)
                {
                    return;
                }

                targetPath = dialog.FileName;
            }

            NativeStatusText.Text = "保存しています...";
            string fullPath = Path.GetFullPath(targetPath);
            await Task.Run(() => PortableFileService.WriteDocument(fullPath, snapshot.Markdown));
            _documentPath = fullPath;
            _webFileName = Path.GetFileName(fullPath);
            _dirty = false;
            bool mapped = HasUsableDocumentDirectory(fullPath);
            SendHostMessage(new Dictionary<string, object>
            {
                { "type", "host.documentSaved" },
                { "fileName", _webFileName },
                { "hasDocumentFolder", mapped },
            });
            NativeStatusText.Text = mapped
                ? "保存しました。"
                : "保存しましたが、相対画像の参照先を設定できませんでした。";
            UpdateWindowState();
        }

        private Task PrintAsync()
        {
            if (_editorReady && EditorWebView.CoreWebView2 != null)
            {
                EditorWebView.CoreWebView2.ShowPrintUI(CoreWebView2PrintDialogKind.System);
                NativeStatusText.Text = "Windowsの印刷画面を開きました。";
            }

            return Task.CompletedTask;
        }

        private Task SaveHtmlExportAsync(Dictionary<string, object> message)
        {
            string html = GetString(message, "html");
            if (html.Length > PortableFileService.MaxDocumentCharacters * 2)
            {
                throw new InvalidDataException("HTMLが大きすぎるため保存できません。");
            }

            string suggestedName = SafeDisplayFileName(GetString(message, "fileName"));
            SaveFileDialog dialog = new SaveFileDialog
            {
                Title = "HTMLを書き出す",
                Filter = "HTML (*.html)|*.html|HTML (*.htm)|*.htm",
                DefaultExt = ".html",
                AddExtension = true,
                OverwritePrompt = true,
                RestoreDirectory = true,
                FileName = suggestedName,
            };
            if (dialog.ShowDialog(this) != true)
            {
                return Task.CompletedTask;
            }

            PortableFileService.WriteHtmlExport(dialog.FileName, html);
            NativeStatusText.Text = "HTMLを書き出しました。";
            SendHostMessage(new Dictionary<string, object>
            {
                { "type", "host.status" },
                { "message", "HTMLを書き出しました" },
            });
            return Task.CompletedTask;
        }

        private Task SaveSettingsExportAsync(Dictionary<string, object> message)
        {
            string content = GetString(message, "content");
            if (content.Length > 256 * 1024)
            {
                throw new InvalidDataException("設定ファイルが256KBの上限を超えています。");
            }

            SaveFileDialog dialog = new SaveFileDialog
            {
                Title = "設定を書き出す",
                Filter = "JSON (*.json)|*.json",
                DefaultExt = ".json",
                AddExtension = true,
                OverwritePrompt = true,
                RestoreDirectory = true,
                FileName = "portable-markdown-editor-settings.json",
            };
            if (dialog.ShowDialog(this) != true)
            {
                return Task.CompletedTask;
            }

            PortableFileService.WriteSettingsExport(dialog.FileName, content);
            NativeStatusText.Text = "設定を書き出しました。";
            SendHostMessage(new Dictionary<string, object>
            {
                { "type", "host.status" },
                { "message", "設定を書き出しました" },
            });
            return Task.CompletedTask;
        }

        private async Task<DocumentSnapshot> RequestDocumentSnapshotAsync()
        {
            string requestId = "snapshot-" + Guid.NewGuid().ToString("N");
            TaskCompletionSource<DocumentSnapshot> completion
                = new TaskCompletionSource<DocumentSnapshot>(TaskCreationOptions.RunContinuationsAsynchronously);
            _pendingSnapshots.Add(requestId, completion);
            SendHostMessage(new Dictionary<string, object>
            {
                { "type", "host.requestSnapshot" },
                { "requestId", requestId },
            });

            Task timeout = Task.Delay(SnapshotTimeoutMilliseconds);
            Task completed = await Task.WhenAny(completion.Task, timeout);
            if (completed != completion.Task)
            {
                _pendingSnapshots.Remove(requestId);
                throw new TimeoutException("編集内容を取得できませんでした。もう一度保存してください。");
            }

            return await completion.Task;
        }

        private static bool HasUsableDocumentDirectory(string documentPath)
        {
            try
            {
                string directory = Path.GetDirectoryName(Path.GetFullPath(documentPath));
                return !string.IsNullOrEmpty(directory) && Directory.Exists(directory);
            }
            catch (Exception)
            {
                return false;
            }
        }

        private bool ConfirmDiscardChanges(string action)
        {
            if (!_dirty)
            {
                return true;
            }

            MessageBoxResult result = MessageBox.Show(
                this,
                "未保存の変更があります。\n保存せずに" + action + "ますか？",
                "未保存の変更",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning,
                MessageBoxResult.No);
            return result == MessageBoxResult.Yes;
        }

        private async Task RunOperationAsync(Func<Task> operation)
        {
            if (_operationInProgress)
            {
                NativeStatusText.Text = "別の操作を処理しています。";
                return;
            }

            _operationInProgress = true;
            UpdateWindowState();
            try
            {
                await operation();
            }
            catch (Exception exception)
            {
                ShowOperationError("操作に失敗しました。", exception);
            }
            finally
            {
                _operationInProgress = false;
                UpdateWindowState();
            }
        }

        private void SendHostMessage(Dictionary<string, object> message)
        {
            if (!_editorReady && GetString(message, "type") != "host.status")
            {
                return;
            }

            EditorWebView.CoreWebView2.PostWebMessageAsJson(_json.Serialize(message));
        }

        private void SendHostError(string requestId, string message)
        {
            SendHostMessage(new Dictionary<string, object>
            {
                { "type", "host.error" },
                { "requestId", requestId },
                { "message", message },
            });
            NativeStatusText.Text = message;
        }

        private void UpdateWindowState()
        {
            string name = !string.IsNullOrEmpty(_documentPath)
                ? Path.GetFileName(_documentPath)
                : SafeDisplayFileName(_webFileName);
            Title = (_dirty ? "* " : string.Empty) + name + " - Portable Markdown Editor";
            DocumentPathText.Text = !string.IsNullOrEmpty(_documentPath) ? _documentPath : "未保存の文書";

            bool enabled = _editorReady && !_operationInProgress;
            NewButton.IsEnabled = enabled;
            OpenButton.IsEnabled = enabled;
            OpenInNewWindowButton.IsEnabled = enabled;
            SaveButton.IsEnabled = enabled;
            SaveAsButton.IsEnabled = enabled;
            PrintButton.IsEnabled = enabled;
        }

        private void ShowOperationError(string heading, Exception exception)
        {
            string detail = exception is DecoderFallbackException
                ? "UTF-8として読み込めませんでした。ファイルの文字コードをUTF-8へ変換してください。"
                : exception.Message;
            NativeStatusText.Text = heading;
            MessageBox.Show(
                this,
                heading + "\n\n" + detail,
                "Portable Markdown Editor",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }

        private static bool IsAppSource(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri)
                && uri.Scheme == Uri.UriSchemeHttps
                && string.Equals(uri.Host, AppHost, StringComparison.OrdinalIgnoreCase);
        }

        private static string GetString(Dictionary<string, object> message, string key)
        {
            object value;
            return message != null && message.TryGetValue(key, out value) && value != null
                ? Convert.ToString(value)
                : string.Empty;
        }

        private static bool GetBoolean(Dictionary<string, object> message, string key)
        {
            object value;
            if (message == null || !message.TryGetValue(key, out value) || value == null)
            {
                return false;
            }

            if (value is bool)
            {
                return (bool)value;
            }

            bool parsed;
            return bool.TryParse(Convert.ToString(value), out parsed) && parsed;
        }

        private static string[] GetStringArray(
            Dictionary<string, object> message,
            string key,
            int maximumItems,
            int maximumItemLength)
        {
            object value;
            object[] items = message != null && message.TryGetValue(key, out value)
                ? value as object[]
                : null;
            if (items == null || items.Length == 0)
            {
                return new string[0];
            }

            List<string> values = new List<string>();
            int count = Math.Min(items.Length, maximumItems);
            for (int index = 0; index < count; index += 1)
            {
                string item = Convert.ToString(items[index]) ?? string.Empty;
                if (item.Length > 0 && item.Length <= maximumItemLength)
                {
                    values.Add(item);
                }
            }
            return values.ToArray();
        }

        private static bool IsValidRequestId(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length > 100)
            {
                return false;
            }

            foreach (char character in value)
            {
                if (!char.IsLetterOrDigit(character) && character != '-')
                {
                    return false;
                }
            }

            return true;
        }

        private static string SafeDisplayFileName(string value)
        {
            try
            {
                string fileName = Path.GetFileName(value ?? string.Empty);
                if (string.IsNullOrWhiteSpace(fileName))
                {
                    return "untitled.md";
                }

                string cleaned = fileName.Replace("\r", string.Empty).Replace("\n", string.Empty).Trim();
                return cleaned.Length > 240 ? cleaned.Substring(0, 240) : cleaned;
            }
            catch (ArgumentException)
            {
                return "untitled.md";
            }
        }

        private static string SafeAssetErrorMessage(Exception exception)
        {
            if (exception is InvalidDataException)
            {
                return exception.Message;
            }

            if (exception is IOException
                && exception.Message.StartsWith("assetsフォルダ", StringComparison.Ordinal))
            {
                return exception.Message;
            }

            return "Windows側で画像を保存できませんでした。保存先を確認してください。";
        }

        private sealed class DocumentSnapshot
        {
            internal DocumentSnapshot(string markdown, string fileName)
            {
                Markdown = markdown;
                FileName = fileName;
            }

            internal string Markdown { get; private set; }

            internal string FileName { get; private set; }
        }
    }
}
