using System;
using System.IO;
using System.Text;

namespace PortableMarkdownEditor.Desktop
{
    internal static class PortableFileServiceChecks
    {
        private static int Main()
        {
            string testRoot = Path.Combine(
                Path.GetTempPath(),
                "PortableMarkdownEditor-native-check-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(testRoot);
            try
            {
                CheckDocumentRoundTrip(testRoot);
                CheckAssetValidationAndAllocation(testRoot);
                Console.WriteLine("native file service checks passed");
                return 0;
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine(exception.ToString());
                return 1;
            }
            finally
            {
                if (Directory.Exists(testRoot))
                {
                    Directory.Delete(testRoot, true);
                }
            }
        }

        private static void CheckDocumentRoundTrip(string testRoot)
        {
            string documentPath = Path.Combine(testRoot, "validation.md");
            string markdown = "# validation\r\n\r\nUTF-8 日本語\r\n";
            PortableFileService.WriteDocument(documentPath, markdown);
            byte[] bytes = File.ReadAllBytes(documentPath);
            Require(bytes.Length >= 3, "saved document is unexpectedly empty");
            Require(!(bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF), "saved UTF-8 must not include a BOM");
            Require(
                PortableFileService.ReadDocument(documentPath) == "# validation\n\nUTF-8 日本語\n",
                "UTF-8 document round-trip failed");

            PortableFileService.WriteDocument(documentPath, "# replaced\n");
            Require(PortableFileService.ReadDocument(documentPath) == "# replaced\n", "atomic replacement failed");
            Require(Directory.GetFiles(testRoot, "*.tmp").Length == 0, "temporary save file was left behind");

            string utf16Path = Path.Combine(testRoot, "utf16.md");
            File.WriteAllBytes(utf16Path, new byte[] { 0xFF, 0xFE, 0x41, 0x00 });
            Expect<DecoderFallbackException>(
                () => PortableFileService.ReadDocument(utf16Path),
                "UTF-16 document was accepted as UTF-8");

            Expect<InvalidDataException>(
                () => PortableFileService.WriteDocument(Path.Combine(testRoot, "invalid.exe"), markdown),
                "unsupported document extension was accepted");
        }

        private static void CheckAssetValidationAndAllocation(string testRoot)
        {
            string documentPath = Path.Combine(testRoot, "validation.md");
            byte[] pngSignature = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00 };
            string dataBase64 = Convert.ToBase64String(pngSignature);
            AssetSaveResult first = PortableFileService.SaveAsset(
                documentPath,
                "pasted.png",
                "image/png",
                dataBase64);
            AssetSaveResult second = PortableFileService.SaveAsset(
                documentPath,
                "pasted.png",
                "image/png",
                dataBase64);
            Require(first.MarkdownPath == "validation.assets/pasted.png", "first asset path is incorrect");
            Require(second.MarkdownPath == "validation.assets/pasted-2.png", "duplicate asset name was not allocated safely");

            AssetSaveResult reserved = PortableFileService.SaveAsset(
                documentPath,
                "CON.png",
                "image/png",
                dataBase64);
            Require(reserved.FileName == "CON_.png", "Windows reserved file name was not sanitized");

            Expect<InvalidDataException>(
                () => PortableFileService.SaveAsset(documentPath, "bad.png", "image/jpeg", dataBase64),
                "MIME and image signature mismatch was accepted");
            Expect<InvalidDataException>(
                () => PortableFileService.SaveAsset(documentPath, "bad.png", "image/png", "not-base64"),
                "malformed base64 was accepted");
        }

        private static void Expect<TException>(Action action, string message)
            where TException : Exception
        {
            try
            {
                action();
            }
            catch (TException)
            {
                return;
            }

            throw new InvalidOperationException(message);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition)
            {
                throw new InvalidOperationException(message);
            }
        }
    }
}
