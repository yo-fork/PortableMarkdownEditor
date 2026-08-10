using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

namespace PortableMarkdownEditor.Desktop
{
    internal sealed class AssetSaveResult
    {
        public AssetSaveResult(string fileName, string markdownPath)
        {
            FileName = fileName;
            MarkdownPath = markdownPath;
        }

        public string FileName { get; private set; }

        public string MarkdownPath { get; private set; }
    }

    internal static class PortableFileService
    {
        internal const int MaxDocumentBytes = 10 * 1024 * 1024;
        internal const int MaxDocumentCharacters = 10 * 1024 * 1024;
        internal const int MaxAssetBytes = 25 * 1024 * 1024;

        private static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);
        private static readonly UTF8Encoding Utf8WithoutBom = new UTF8Encoding(false);
        private const int MoveFileReplaceExisting = 0x1;
        private const int MoveFileWriteThrough = 0x8;
        private static readonly string[] ReservedWindowsNames =
        {
            "CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        };

        internal static string ReadDocument(string path)
        {
            string fullPath = RequireDocumentPath(path, true);
            FileInfo info = new FileInfo(fullPath);
            if (info.Length > MaxDocumentBytes)
            {
                throw new InvalidDataException("Markdownファイルは10MB以下にしてください。");
            }

            byte[] data;
            using (FileStream stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                data = new byte[checked((int)stream.Length)];
                int offset = 0;
                while (offset < data.Length)
                {
                    int read = stream.Read(data, offset, data.Length - offset);
                    if (read == 0)
                    {
                        throw new EndOfStreamException("Markdownファイルを最後まで読み込めませんでした。");
                    }
                    offset += read;
                }
            }

            int contentOffset = HasUtf8Bom(data) ? 3 : 0;
            string content = StrictUtf8.GetString(data, contentOffset, data.Length - contentOffset);
            if (content.Length > MaxDocumentCharacters)
            {
                throw new InvalidDataException("Markdown文書が大きすぎます。");
            }

            return NormalizeNewlines(content);
        }

        internal static void WriteDocument(string path, string markdown)
        {
            string fullPath = RequireDocumentPath(path, false);
            string content = NormalizeNewlines(markdown ?? string.Empty);
            if (content.Length > MaxDocumentCharacters)
            {
                throw new InvalidDataException("Markdown文書が大きすぎるため保存できません。");
            }

            WriteTextAtomically(fullPath, content);
        }

        internal static void WriteHtmlExport(string path, string html)
        {
            string fullPath = Path.GetFullPath(path ?? string.Empty);
            if (!string.Equals(Path.GetExtension(fullPath), ".html", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(Path.GetExtension(fullPath), ".htm", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("HTMLの保存先には .html または .htm を指定してください。");
            }

            string content = html ?? string.Empty;
            if (content.Length > MaxDocumentCharacters * 2)
            {
                throw new InvalidDataException("HTMLが大きすぎるため保存できません。");
            }

            WriteTextAtomically(fullPath, content);
        }

        internal static void WriteSettingsExport(string path, string content)
        {
            string fullPath = Path.GetFullPath(path ?? string.Empty);
            if (!string.Equals(Path.GetExtension(fullPath), ".json", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("設定ファイルの保存先には .json を指定してください。");
            }

            string value = content ?? string.Empty;
            if (value.Length > 256 * 1024)
            {
                throw new InvalidDataException("設定ファイルが256KBの上限を超えています。");
            }

            WriteTextAtomically(fullPath, value);
        }

        internal static AssetSaveResult SaveAsset(
            string documentPath,
            string requestedFileName,
            string mimeType,
            string dataBase64)
        {
            string fullDocumentPath = RequireDocumentPath(documentPath, false);
            ValidateAssetMimeType(mimeType);
            if (string.IsNullOrEmpty(dataBase64) || dataBase64.Length > MaximumBase64Length(MaxAssetBytes))
            {
                throw new InvalidDataException("画像データが空か、25MBの上限を超えています。");
            }

            byte[] data;
            try
            {
                data = Convert.FromBase64String(dataBase64);
            }
            catch (FormatException)
            {
                throw new InvalidDataException("画像データの形式が正しくありません。");
            }

            if (data.Length == 0 || data.Length > MaxAssetBytes)
            {
                throw new InvalidDataException("画像は25MB以下にしてください。");
            }

            string extension = DetectImageExtension(data);
            if (extension == null)
            {
                throw new InvalidDataException("PNG、JPEG、GIF、WebP以外の画像は保存できません。");
            }

            ValidateMimeMatchesImage(mimeType, extension);
            string documentDirectory = Path.GetDirectoryName(fullDocumentPath);
            if (string.IsNullOrEmpty(documentDirectory))
            {
                throw new InvalidDataException("Markdownファイルの保存先を確認できません。");
            }

            string documentBaseName = Path.GetFileNameWithoutExtension(fullDocumentPath);
            string assetDirectoryName = documentBaseName + ".assets";
            string assetDirectory = Path.Combine(documentDirectory, assetDirectoryName);
            RejectReparsePointDirectory(assetDirectory);
            Directory.CreateDirectory(assetDirectory);

            string requestedBaseName = Path.GetFileNameWithoutExtension(requestedFileName ?? string.Empty);
            string safeBaseName = SafeFileBaseName(requestedBaseName);
            for (int index = 0; index < 1000; index += 1)
            {
                string suffix = index == 0 ? string.Empty : "-" + (index + 1).ToString();
                string fileName = safeBaseName + suffix + extension;
                string destination = Path.Combine(assetDirectory, fileName);
                try
                {
                    using (FileStream stream = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    {
                        stream.Write(data, 0, data.Length);
                        stream.Flush(true);
                    }

                    return new AssetSaveResult(fileName, assetDirectoryName + "/" + fileName);
                }
                catch (IOException)
                {
                    if (!File.Exists(destination))
                    {
                        throw;
                    }
                }
            }

            throw new IOException("画像の保存名を確保できませんでした。");
        }

        internal static Dictionary<string, string> ResolveDocumentImageReferences(
            string documentPath,
            IEnumerable<string> references)
        {
            Dictionary<string, string> aliases
                = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (references == null)
            {
                return aliases;
            }

            string fullDocumentPath = RequireDocumentPath(documentPath, true);
            string documentDirectory = Path.GetDirectoryName(fullDocumentPath);
            if (string.IsNullOrEmpty(documentDirectory))
            {
                return aliases;
            }

            string directoryPrefix = documentDirectory.TrimEnd(
                Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            foreach (string reference in references.Where(value => !string.IsNullOrWhiteSpace(value)).Take(64))
            {
                if (reference.Length > 4096)
                {
                    continue;
                }

                string candidate;
                try
                {
                    candidate = DecodeLocalImageReference(reference);
                    if (!Path.IsPathRooted(candidate))
                    {
                        continue;
                    }
                    candidate = Path.GetFullPath(candidate);
                }
                catch (Exception exception) when (
                    exception is ArgumentException
                    || exception is NotSupportedException
                    || exception is UriFormatException)
                {
                    continue;
                }

                if (!candidate.StartsWith(directoryPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                bool supported;
                try
                {
                    supported = File.Exists(candidate) && IsSupportedRasterImageFile(candidate);
                }
                catch (Exception exception) when (
                    exception is IOException
                    || exception is UnauthorizedAccessException
                    || exception is System.Security.SecurityException)
                {
                    continue;
                }
                if (!supported)
                {
                    continue;
                }

                string relativePath = candidate.Substring(directoryPrefix.Length)
                    .Replace(Path.DirectorySeparatorChar, '/')
                    .Replace(Path.AltDirectorySeparatorChar, '/');
                if (relativePath.Length == 0 || relativePath.Split('/').Contains(".."))
                {
                    continue;
                }
                aliases[reference] = relativePath;
            }

            return aliases;
        }

        private static string RequireDocumentPath(string path, bool mustExist)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new InvalidDataException("Markdownファイルのパスがありません。");
            }

            string fullPath = Path.GetFullPath(path);
            string extension = Path.GetExtension(fullPath);
            if (!string.Equals(extension, ".md", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(extension, ".markdown", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(extension, ".txt", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException(".md、.markdown、.txt のファイルだけを扱えます。");
            }

            if (mustExist && !File.Exists(fullPath))
            {
                throw new FileNotFoundException("Markdownファイルが見つかりません。", fullPath);
            }

            return fullPath;
        }

        private static int MaximumBase64Length(int byteCount)
        {
            return checked(((byteCount + 2) / 3) * 4 + 8);
        }

        private static string DecodeLocalImageReference(string value)
        {
            string decoded = value ?? string.Empty;
            if (decoded.IndexOf('%') >= 0)
            {
                decoded = Uri.UnescapeDataString(decoded);
            }

            Uri fileUri;
            if (Uri.TryCreate(decoded, UriKind.Absolute, out fileUri) && fileUri.IsFile)
            {
                return fileUri.LocalPath;
            }
            return decoded;
        }

        private static bool IsSupportedRasterImageFile(string path)
        {
            string extension = Path.GetExtension(path).ToLowerInvariant();
            if (extension != ".png"
                && extension != ".jpg"
                && extension != ".jpeg"
                && extension != ".gif"
                && extension != ".webp")
            {
                return false;
            }

            FileInfo info = new FileInfo(path);
            if (info.Length == 0 || info.Length > MaxAssetBytes)
            {
                return false;
            }

            byte[] header = new byte[Math.Min(16, checked((int)info.Length))];
            using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                int offset = 0;
                while (offset < header.Length)
                {
                    int read = stream.Read(header, offset, header.Length - offset);
                    if (read == 0)
                    {
                        return false;
                    }
                    offset += read;
                }
            }

            string detected = DetectImageExtension(header);
            return detected == extension
                || detected == ".jpg" && extension == ".jpeg";
        }

        private static bool HasUtf8Bom(byte[] data)
        {
            return data.Length >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF;
        }

        private static void WriteTextAtomically(string fullPath, string content)
        {
            string directory = Path.GetDirectoryName(fullPath);
            if (string.IsNullOrEmpty(directory) || !Directory.Exists(directory))
            {
                throw new DirectoryNotFoundException("保存先フォルダが見つかりません。");
            }

            string temporaryPath = Path.Combine(
                directory,
                "." + Path.GetFileName(fullPath) + "." + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                using (FileStream stream = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (StreamWriter writer = new StreamWriter(stream, Utf8WithoutBom))
                {
                    writer.Write(content);
                    writer.Flush();
                    stream.Flush(true);
                }

                if (File.Exists(fullPath))
                {
                    if (!MoveFileEx(temporaryPath, fullPath, MoveFileReplaceExisting | MoveFileWriteThrough))
                    {
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "既存ファイルを安全に置き換えられませんでした。");
                    }
                }
                else
                {
                    File.Move(temporaryPath, fullPath);
                }
            }
            finally
            {
                if (File.Exists(temporaryPath))
                {
                    File.Delete(temporaryPath);
                }
            }
        }

        private static void ValidateAssetMimeType(string mimeType)
        {
            string normalized = (mimeType ?? string.Empty).Trim().ToLowerInvariant();
            if (normalized.Length == 0)
            {
                return;
            }

            if (normalized != "image/png"
                && normalized != "image/jpeg"
                && normalized != "image/jpg"
                && normalized != "image/gif"
                && normalized != "image/webp")
            {
                throw new InvalidDataException("許可されていない画像形式です。");
            }
        }

        private static void ValidateMimeMatchesImage(string mimeType, string extension)
        {
            string normalized = (mimeType ?? string.Empty).Trim().ToLowerInvariant();
            if (normalized.Length == 0)
            {
                return;
            }

            bool matches = extension == ".png" && normalized == "image/png"
                || extension == ".jpg" && (normalized == "image/jpeg" || normalized == "image/jpg")
                || extension == ".gif" && normalized == "image/gif"
                || extension == ".webp" && normalized == "image/webp";
            if (!matches)
            {
                throw new InvalidDataException("画像の内容と形式指定が一致しません。");
            }
        }

        private static string DetectImageExtension(byte[] data)
        {
            if (StartsWith(data, new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }))
            {
                return ".png";
            }

            if (data.Length >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF)
            {
                return ".jpg";
            }

            if (StartsWith(data, Encoding.ASCII.GetBytes("GIF87a"))
                || StartsWith(data, Encoding.ASCII.GetBytes("GIF89a")))
            {
                return ".gif";
            }

            if (data.Length >= 12
                && Encoding.ASCII.GetString(data, 0, 4) == "RIFF"
                && Encoding.ASCII.GetString(data, 8, 4) == "WEBP")
            {
                return ".webp";
            }

            return null;
        }

        private static bool StartsWith(byte[] data, byte[] signature)
        {
            if (data.Length < signature.Length)
            {
                return false;
            }

            for (int index = 0; index < signature.Length; index += 1)
            {
                if (data[index] != signature[index])
                {
                    return false;
                }
            }

            return true;
        }

        private static string SafeFileBaseName(string value)
        {
            char[] invalid = Path.GetInvalidFileNameChars();
            string cleaned = new string((value ?? string.Empty)
                .Select(character => invalid.Contains(character) || char.IsControl(character) ? '_' : character)
                .ToArray())
                .Trim()
                .TrimEnd('.', ' ');
            if (cleaned.Length > 80)
            {
                cleaned = cleaned.Substring(0, 80).TrimEnd('.', ' ');
            }

            if (string.IsNullOrWhiteSpace(cleaned) || cleaned.All(character => character == '.'))
            {
                cleaned = "image";
            }

            if (ReservedWindowsNames.Contains(cleaned, StringComparer.OrdinalIgnoreCase))
            {
                cleaned += "_";
            }

            return cleaned;
        }

        private static void RejectReparsePointDirectory(string path)
        {
            if (!Directory.Exists(path))
            {
                return;
            }

            FileAttributes attributes = File.GetAttributes(path);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
            {
                throw new IOException("assetsフォルダがリンクになっているため、安全のため画像を保存しませんでした。");
            }
        }

        private static string NormalizeNewlines(string value)
        {
            return (value ?? string.Empty).Replace("\r\n", "\n").Replace("\r", "\n");
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool MoveFileEx(string existingFileName, string newFileName, int flags);
    }
}
