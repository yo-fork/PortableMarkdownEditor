import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = `${read('../app.js')}\n${read('../modules/markdown-renderer.js')}\n${read('../modules/rich-editor.js')}\n${read('../modules/rich-input-controller.js')}\n${read('../modules/file-manager.js')}\n${read('../modules/shortcut-manager.js')}`;
const index = read('../index.html');
const styles = read('../styles.css');
const project = read('../native/PortableMarkdownEditor.Desktop.csproj');
const windowCode = read('../native/MainWindow.xaml.cs');
const fileService = read('../native/PortableFileService.cs');
const windowXaml = read('../native/MainWindow.xaml');
const buildScript = read('../tools/Build-PortableWindows.ps1');
const releaseCheck = read('./Check-ReleasePackage.ps1');
const notice = read('../native/THIRD-PARTY-NOTICES.txt');
const nativeChecks = read('./native/PortableFileServiceChecks.cs');
const portableReadme = read('../native/README-WINDOWS.txt');
const projectReadme = read('../README.md');
const releaseReadme = read('../release/README.md');

assert.match(index, /img-src 'self' data: blob: https:\/\/document\.portable-markdown-editor\.local/);
assert.match(index, /connect-src 'none'/);
assert.match(styles, /body\[data-desktop-host="true"\][\s\S]+data-action="open-folder"/);

assert.match(app, /function\s+detectDesktopHost[\s\S]+currentLocation\?\.hostname === DESKTOP_APP_HOST[\s\S]+desktop=1/);
assert.match(app, /function\s+postDesktopMessage/);
assert.match(app, /function\s+onDesktopHostMessage/);
assert.match(app, /function\s+sendDesktopDocumentSnapshot/);
assert.match(app, /function\s+saveImageFileToDesktopAssets/);
assert.match(app, /type: 'desktop\.exportSettings'/);
assert.match(app, /function\s+desktopDocumentAssetUrl[\s\S]+encodeURIComponent/);
assert.doesNotMatch(app, /readAsDataURL/);

assert.doesNotMatch(project, /PackageReference|packages\.config|RestorePackages/);
assert.match(project, /<TargetFrameworkVersion>v4\.8<\/TargetFrameworkVersion>/);
assert.match(project, /<PlatformTarget>x64<\/PlatformTarget>/);
assert.match(project, /<ApplicationIcon>Assets\\AppIcon\.ico<\/ApplicationIcon>/);
assert.match(project, /<Resource Include="Assets\\AppIcon\.ico" \/>/);
assert.match(project, /Microsoft\.Web\.WebView2\.Core/);
assert.match(project, /Microsoft\.Web\.WebView2\.Wpf/);

assert.match(windowXaml, /xmlns:wv2=/);
assert.match(windowXaml, /Icon="Assets\/AppIcon\.ico"/);
assert.match(windowXaml, /名前を付けて保存/);
assert.match(windowXaml, /NewMenuItem[^\n]+Ctrl\+N/);
assert.match(windowXaml, /SaveAsMenuItem[^\n]+Ctrl\+Shift\+S/);
assert.match(windowXaml, /新規ウィンドウ[^\n]+Ctrl\+N[^\n]+New_Click/);
assert.match(windowXaml, /NewButton[^\n]+新規ウィンドウ/);
assert.match(windowXaml, /新しいウィンドウで開く[^\n]+Ctrl\+Shift\+O[^\n]+OpenInNewWindow_Click/);
assert.match(windowXaml, /OpenInNewWindowButton[^\n]+別窓で開く/);
assert.match(windowXaml, /キーボードショートカット[^\n]+Shortcuts_Click/);
assert.match(windowXaml, /<wv2:WebView2/);

assert.match(windowCode, /SetVirtualHostNameToFolderMapping\(AppHost,[\s\S]+DenyCors/);
assert.match(windowCode, /AddWebResourceRequestedFilter\([\s\S]+DocumentHost[\s\S]+CoreWebView2WebResourceContext\.Image/);
assert.match(windowCode, /Core_WebResourceRequested[\s\S]+ReadDocumentImage[\s\S]+CreateWebResourceResponse/);
assert.match(windowCode, /using \(CoreWebView2Deferral deferral = eventArgs\.GetDeferral\(\)\)/);
assert.doesNotMatch(windowCode, /deferral\.Complete\(\)/);
assert.doesNotMatch(windowCode, /SetVirtualHostNameToFolderMapping\(\s*DocumentHost/);
assert.match(windowCode, /AreHostObjectsAllowed = false/);
assert.match(windowCode, /if \(!IsAppSource\(eventArgs\.Source\)\)/);
assert.match(windowCode, /Core_NavigationStarting[\s\S]+eventArgs\.Cancel = true/);
assert.match(windowCode, /Core_PermissionRequested[\s\S]+CoreWebView2PermissionState\.Deny/);
assert.match(windowCode, /PostWebMessageAsJson/);
assert.match(windowCode, /Shortcuts_Click[\s\S]+host\.showShortcutSettings/);
assert.match(windowCode, /Appearance_Click[\s\S]+host\.showAppearanceSettings/);
assert.match(windowXaml, /Header="表示設定" Click="Appearance_Click"/);
assert.match(windowCode, /NewDocumentArgument = "--new-document"/);
assert.match(windowCode, /MainWindow_PreviewKeyDown[\s\S]+ShortcutCommandForKeyEvent[\s\S]+case "new-window":[\s\S]+OpenNewDocumentWindow/);
assert.match(windowCode, /MainWindow_PreviewKeyDown[\s\S]+case "open-new-window":[\s\S]+OpenDocumentInNewWindow/);
assert.match(windowCode, /desktop\.shortcutsChanged[\s\S]+ApplyShortcutSettings/);
assert.match(windowCode, /desktop\.shortcutCaptureState[\s\S]+_shortcutCaptureActive = GetBoolean\(message, "active"\)/);
assert.match(windowCode, /MainWindow_PreviewKeyDown[\s\S]+if \(_shortcutCaptureActive\) return;/);
assert.match(windowCode, /ApplyShortcutSettings[\s\S]+NormalizeShortcut[\s\S]+RebuildNativeShortcutLookup[\s\S]+UpdateShortcutMenuLabels/);
assert.match(windowCode, /ShortcutFromKeyEvent[\s\S]+ModifierKeys\.Control[\s\S]+ModifierKeys\.Shift[\s\S]+ModifierKeys\.Alt/);
assert.match(windowCode, /HandleEditorReadyAsync[\s\S]+_startWithNewDocument[\s\S]+LoadNewDocument/);
assert.match(windowCode, /ExecuteEditorCommandAsync[\s\S]+case "new":[\s\S]+OpenNewDocumentWindow/);
assert.match(windowCode, /OpenDocumentInNewWindow[\s\S]+File\.Exists\(fullPath\)[\s\S]+StartNewEditorProcess\(QuoteCommandLineArgument\(fullPath\)\)/);
assert.match(windowCode, /OpenNewDocumentWindow[\s\S]+StartNewEditorProcess\(NewDocumentArgument\)/);
assert.match(windowCode, /StartNewEditorProcess[\s\S]+File\.Exists\(executablePath\)[\s\S]+Process\.Start\(new ProcessStartInfo[\s\S]+UseShellExecute = false/);
assert.match(windowCode, /QuoteCommandLineArgument[\s\S]+value\.IndexOf\('"'\)[\s\S]+return "\\\"" \+ value \+ "\\\""/);
assert.match(windowCode, /desktop\.resolveImageReferences/);
assert.match(windowCode, /HandleImageReferenceResolutionAsync/);
assert.doesNotMatch(windowCode, /AddHostObjectToScript/);

assert.match(fileService, /MaxDocumentBytes = 10 \* 1024 \* 1024/);
assert.match(fileService, /MaxAssetBytes = 25 \* 1024 \* 1024/);
assert.match(fileService, /DetectImageExtension/);
assert.match(fileService, /FileMode\.CreateNew/);
assert.match(fileService, /FileAttributes\.ReparsePoint/);
assert.match(fileService, /UTF8Encoding\(false, true\)/);
assert.match(fileService, /MoveFileEx/);
assert.match(fileService, /WriteSettingsExport/);
assert.match(fileService, /ResolveDocumentImageReferences/);
assert.match(fileService, /ReadDocumentImage/);
assert.match(fileService, /ReadBoundedImageFile/);
assert.match(fileService, /RejectReparsePointsWithinDirectory/);
assert.match(fileService, /IsSupportedRasterImageFile/);
assert.match(fileService, /StartsWith\(directoryPrefix, StringComparison\.OrdinalIgnoreCase\)/);

assert.match(buildScript, /vswhere\.exe/);
assert.match(buildScript, /Microsoft\.Web\.WebView2\.Core\.dll/);
assert.match(buildScript, /requiredWebView2Version = '1\.0\.2903\.40'/);
assert.match(buildScript, /WebView2Loader\.dll/);
assert.match(buildScript, /Assert-GeneratedPath/);
assert.match(buildScript, /PortableMarkdownEditor\.NativeChecks\.exe/);
assert.match(buildScript, /README-WINDOWS\.txt/);
assert.match(buildScript, /\[switch\]\$Publish/);
assert.match(buildScript, /function Get-Sha256Hex/);
assert.match(buildScript, /Security\.Cryptography\.SHA256/);
assert.match(buildScript, /release[^\n]+PortableMarkdownEditor-win-x64\.zip/i);
assert.match(buildScript, /publishedLicensePath[\s\S]+Copy-Item[^\n]+LICENSE/);
assert.match(buildScript, /publishedNoticesPath[\s\S]+Copy-Item[^\n]+THIRD-PARTY-NOTICES\.txt/);
assert.doesNotMatch(buildScript, /\b(?:npm|npx|pnpm|yarn|pip|uv|nuget|dotnet)\s+(?:install|add|restore|sync)\b/i);
assert.match(releaseCheck, /publishedLicensePath[\s\S]+Published legal file differs from its source/);
assert.match(releaseCheck, /publishedNoticesPath[\s\S]+Published legal file differs from its source/);
assert.match(releaseCheck, /PortableMarkdownEditor\/app\/modules\/shortcut-manager\.js/);

assert.match(notice, /Microsoft\.Web\.WebView2 1\.0\.2903\.40/);
assert.match(notice, /Redistribution and use in source and binary forms/);
assert.match(notice, /THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS/);

assert.match(nativeChecks, /CheckDocumentRoundTrip/);
assert.match(nativeChecks, /CheckAssetValidationAndAllocation/);
assert.match(nativeChecks, /CheckDocumentImageReferenceResolution/);
assert.match(nativeChecks, /document PNG content type is incorrect/);
assert.match(nativeChecks, /document image with an invalid signature was served/);
assert.match(nativeChecks, /parent-relative document image was served/);
assert.match(nativeChecks, /image outside the document folder was resolved/);
assert.match(nativeChecks, /MIME and image signature mismatch was accepted/);

assert.match(portableReadme, /WebView2 Evergreen Runtime/);
assert.match(portableReadme, /Ctrl\+N[^\n]+空の文書を別ウィンドウ/);
assert.match(portableReadme, /Ctrl\+Shift\+O[^\n]+独立したウィンドウ/);
assert.match(portableReadme, /data\\WebView2/);
assert.match(portableReadme, /Visual Studio[^\n]+不要/);
assert.match(projectReadme, /release\/PortableMarkdownEditor-win-x64\.zip/);
assert.match(projectReadme, /BuildPortableWindows\.cmd[^\n]+開発者向け/);
assert.match(projectReadme, /release\/LICENSE/);
assert.match(releaseReadme, /PortableMarkdownEditor\.exe/);
assert.match(releaseReadme, /Ctrl\+N[^\n]+空の文書を別ウィンドウ/);
assert.match(releaseReadme, /Ctrl\+Shift\+O[^\n]+独立したウィンドウ/);
assert.match(releaseReadme, /BuildPortableWindows\.cmd[^\n]+実行しない/);
assert.match(releaseReadme, /THIRD-PARTY-NOTICES\.txt/);

console.log('desktop host static checks passed');

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}
