using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using DrawingColor = System.Drawing.Color;

namespace PortableMarkdownEditor.Desktop
{
    internal sealed class NativeThemeController
    {
        private const int DwmUseImmersiveDarkModeBefore20H1 = 19;
        private const int DwmUseImmersiveDarkMode = 20;

        private readonly Window _window;
        private readonly WebView2 _webView;
        private bool _isDarkTheme;

        [DllImport("dwmapi.dll", PreserveSig = true)]
        private static extern int DwmSetWindowAttribute(
            IntPtr windowHandle,
            int attribute,
            ref int attributeValue,
            int attributeSize);

        internal NativeThemeController(Window window, WebView2 webView)
        {
            _window = window ?? throw new ArgumentNullException(nameof(window));
            _webView = webView ?? throw new ArgumentNullException(nameof(webView));
        }

        internal void ApplyDefault()
        {
            Apply(DefaultDarkTheme());
        }

        internal void Apply(bool dark)
        {
            _isDarkTheme = dark;
            Color windowColor = dark ? Color.FromRgb(0x11, 0x18, 0x27) : Color.FromRgb(0xF5, 0xF6, 0xF8);
            Color surfaceColor = dark ? Color.FromRgb(0x18, 0x22, 0x35) : Colors.White;
            Color controlColor = dark ? Color.FromRgb(0x11, 0x18, 0x27) : Color.FromRgb(0xF0, 0xF2, 0xF5);
            Color textColor = dark ? Color.FromRgb(0xEE, 0xF2, 0xFF) : Color.FromRgb(0x20, 0x24, 0x2A);
            Color mutedTextColor = dark ? Color.FromRgb(0xA7, 0xB0, 0xC0) : Color.FromRgb(0x66, 0x70, 0x85);
            Color borderColor = dark ? Color.FromRgb(0x2D, 0x37, 0x48) : Color.FromRgb(0xD9, 0xDE, 0xE7);
            Color highlightColor = dark ? Color.FromRgb(0x1D, 0x2D, 0x50) : Color.FromRgb(0xDB, 0xEA, 0xFE);

            UpdateThemeBrush("NativeWindowBackgroundBrush", windowColor);
            UpdateThemeBrush("NativeSurfaceBrush", surfaceColor);
            UpdateThemeBrush("NativeControlBrush", controlColor);
            UpdateThemeBrush("NativeTextBrush", textColor);
            UpdateThemeBrush("NativeMutedTextBrush", mutedTextColor);
            UpdateThemeBrush("NativeBorderBrush", borderColor);

            ApplySystemThemeResources(surfaceColor, textColor, mutedTextColor, borderColor, highlightColor);
            _webView.DefaultBackgroundColor = DrawingColor.FromArgb(
                windowColor.A,
                windowColor.R,
                windowColor.G,
                windowColor.B);
            ApplyWebViewTheme();
            ApplyTitleBarTheme();
        }

        internal void ApplyWebViewTheme()
        {
            if (_webView.CoreWebView2 == null)
            {
                return;
            }

            _webView.CoreWebView2.Profile.PreferredColorScheme = _isDarkTheme
                ? CoreWebView2PreferredColorScheme.Dark
                : CoreWebView2PreferredColorScheme.Light;
        }

        internal void ApplyTitleBarTheme()
        {
            IntPtr handle = new WindowInteropHelper(_window).Handle;
            if (handle == IntPtr.Zero)
            {
                return;
            }

            int enabled = _isDarkTheme ? 1 : 0;
            try
            {
                int result = DwmSetWindowAttribute(
                    handle,
                    DwmUseImmersiveDarkMode,
                    ref enabled,
                    sizeof(int));
                if (result != 0)
                {
                    DwmSetWindowAttribute(
                        handle,
                        DwmUseImmersiveDarkModeBefore20H1,
                        ref enabled,
                        sizeof(int));
                }
            }
            catch (DllNotFoundException)
            {
            }
            catch (EntryPointNotFoundException)
            {
            }
        }

        private void UpdateThemeBrush(string key, Color color)
        {
            SolidColorBrush brush = _window.Resources[key] as SolidColorBrush;
            if (brush == null || brush.IsFrozen)
            {
                _window.Resources[key] = CreateBrush(color);
                return;
            }

            brush.Color = color;
        }

        private void ApplySystemThemeResources(
            Color surfaceColor,
            Color textColor,
            Color mutedTextColor,
            Color borderColor,
            Color highlightColor)
        {
            ResourceDictionary[] dictionaries = Application.Current == null
                ? new[] { _window.Resources }
                : new[] { Application.Current.Resources, _window.Resources };
            foreach (ResourceDictionary dictionary in dictionaries)
            {
                dictionary[SystemColors.ControlBrushKey] = CreateBrush(surfaceColor);
                dictionary[SystemColors.ControlTextBrushKey] = CreateBrush(textColor);
                dictionary[SystemColors.MenuBrushKey] = CreateBrush(surfaceColor);
                dictionary[SystemColors.MenuTextBrushKey] = CreateBrush(textColor);
                dictionary[SystemColors.WindowBrushKey] = CreateBrush(surfaceColor);
                dictionary[SystemColors.WindowTextBrushKey] = CreateBrush(textColor);
                dictionary[SystemColors.GrayTextBrushKey] = CreateBrush(mutedTextColor);
                dictionary[SystemColors.ActiveBorderBrushKey] = CreateBrush(borderColor);
                dictionary[SystemColors.InactiveBorderBrushKey] = CreateBrush(borderColor);
                dictionary[SystemColors.HighlightBrushKey] = CreateBrush(highlightColor);
                dictionary[SystemColors.HighlightTextBrushKey] = CreateBrush(textColor);
            }
        }

        private static SolidColorBrush CreateBrush(Color color)
        {
            SolidColorBrush brush = new SolidColorBrush(color);
            brush.Freeze();
            return brush;
        }

        private static bool DefaultDarkTheme()
        {
            try
            {
                object value = Registry.GetValue(
                    @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                    "AppsUseLightTheme",
                    1);
                return Convert.ToInt32(value) == 0;
            }
            catch (Exception)
            {
                return false;
            }
        }
    }
}
