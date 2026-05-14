# セキュリティ確認用Markdown

以下は実行されず、文字またはブロック表示になります。

<script>alert('xss')</script>

<img src=x onerror=alert(1)>

[危険なリンク](javascript:alert(1))

[難読化された危険なリンク](java
script:alert(1))

![外部画像](https://example.com/tracker.png)

![SVG data画像](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)

以下のようなローカル画像参照は、PNG/JPEG/GIF/WebPに限って許可されます。

![相対画像](./images/local-sample.png)

![ネットワークドライブ画像](<\\server\share\local sample.webp>)
