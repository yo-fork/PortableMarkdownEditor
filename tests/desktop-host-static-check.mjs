import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = read('../app.js');
const index = read('../index.html');
const styles = read('../styles.css');
const project = read('../native/PortableMarkdownEditor.Desktop.csproj');
const windowCode = read('../native/MainWindow.xaml.cs');
const fileService = read('../native/PortableFileService.cs');
const windowXaml = read('../native/MainWindow.xaml');
const buildScript = read('../tools/Build-PortableWindows.ps1');
const notice = read('../native/THIRD-PARTY-NOTICES.txt');
const nativeChecks = read('./native/PortableFileServiceChecks.cs');
const portableReadme = read('../native/README-WINDOWS.txt');

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
assert.match(project, /Microsoft\.Web\.WebView2\.Core/);
assert.match(project, /Microsoft\.Web\.WebView2\.Wpf/);

assert.match(windowXaml, /xmlns:wv2=/);
assert.match(windowXaml, /名前を付けて保存/);
assert.match(windowXaml, /<wv2:WebView2/);

assert.match(windowCode, /SetVirtualHostNameToFolderMapping\(AppHost,[\s\S]+DenyCors/);
assert.match(windowCode, /SetVirtualHostNameToFolderMapping\([\s\S]+DocumentHost,[\s\S]+DenyCors/);
assert.match(windowCode, /AreHostObjectsAllowed = false/);
assert.match(windowCode, /if \(!IsAppSource\(eventArgs\.Source\)\)/);
assert.match(windowCode, /Core_NavigationStarting[\s\S]+eventArgs\.Cancel = true/);
assert.match(windowCode, /Core_PermissionRequested[\s\S]+CoreWebView2PermissionState\.Deny/);
assert.match(windowCode, /PostWebMessageAsJson/);
assert.doesNotMatch(windowCode, /AddHostObjectToScript/);

assert.match(fileService, /MaxDocumentBytes = 10 \* 1024 \* 1024/);
assert.match(fileService, /MaxAssetBytes = 25 \* 1024 \* 1024/);
assert.match(fileService, /DetectImageExtension/);
assert.match(fileService, /FileMode\.CreateNew/);
assert.match(fileService, /FileAttributes\.ReparsePoint/);
assert.match(fileService, /UTF8Encoding\(false, true\)/);
assert.match(fileService, /MoveFileEx/);
assert.match(fileService, /WriteSettingsExport/);

assert.match(buildScript, /vswhere\.exe/);
assert.match(buildScript, /Microsoft\.Web\.WebView2\.Core\.dll/);
assert.match(buildScript, /requiredWebView2Version = '1\.0\.2903\.40'/);
assert.match(buildScript, /WebView2Loader\.dll/);
assert.match(buildScript, /Assert-GeneratedPath/);
assert.match(buildScript, /PortableMarkdownEditor\.NativeChecks\.exe/);
assert.match(buildScript, /README-WINDOWS\.txt/);
assert.doesNotMatch(buildScript, /\b(?:npm|npx|pnpm|yarn|pip|uv|nuget|dotnet)\s+(?:install|add|restore|sync)\b/i);

assert.match(notice, /Microsoft\.Web\.WebView2 1\.0\.2903\.40/);
assert.match(notice, /Redistribution and use in source and binary forms/);
assert.match(notice, /THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS/);

assert.match(nativeChecks, /CheckDocumentRoundTrip/);
assert.match(nativeChecks, /CheckAssetValidationAndAllocation/);
assert.match(nativeChecks, /MIME and image signature mismatch was accepted/);

assert.match(portableReadme, /WebView2 Evergreen Runtime/);
assert.match(portableReadme, /data\\WebView2/);

console.log('desktop host static checks passed');

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}
