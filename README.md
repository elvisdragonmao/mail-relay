# Mail Relay

透過 Cloudflare Email Routing 與 Email Worker，將無法通過 SPF / DKIM 驗證、因此不能被 Cloudflare 直接 Forward 的郵件重新封裝後寄送到已驗證的收件信箱。

這個專案最初是為了解決自然人憑證 MOICA 郵件的問題：

```text
Sender: cse@moica.nat.gov.tw

SPF:   none
DKIM:  neutral
DMARC: none
```

Cloudflare Email Routing 對未通過寄件者驗證的郵件不允許執行直接轉寄，因此會出現：

```text
Cannot forward emails that are not authenticated.
```

本專案改為：

```text
MOICA
  ↓
info@example.com
  ↓
Cloudflare Email Routing
  ↓
Email Worker
  ↓
解析原始 MIME 郵件
  ↓
重新建立一封郵件
  ↓
Cloudflare Email Sending
  ↓
Verified Destination Address
```

## 原理

一般 Cloudflare Email Routing 使用：

```js
message.forward("user@gmail.com");
```

這仍屬於郵件轉寄，因此受到 Cloudflare 的 SPF / DKIM 驗證限制。

本專案不使用 `message.forward()`。

Worker 會：

1. 接收原始 Email
2. 從 `message.raw` 取得完整 MIME 郵件
3. 使用 `postal-mime` 解析 Subject、Text、HTML 等內容
4. 使用自己的 Email Routing 網域重新建立郵件
5. 寄送至 Cloudflare 帳號中的 Verified Destination Address

因此來源郵件即使沒有 SPF / DKIM，也不影響重新寄出的郵件。

## Requirements

需要：

* Cloudflare 帳號
* 已啟用 Cloudflare Email Routing 的 Domain
* 一個 Verified Destination Address
* Node.js
* pnpm
* Wrangler

例如：

```text
Incoming address:
info@example.com

Relay sender:
relay@example.com

Destination:
user@gmail.com
```

## Installation

Clone 專案後安裝 dependency：

```bash
pnpm install
```

如果是新建專案：

```bash
pnpm init -y
pnpm install postal-mime
pnpm install -D wrangler
```

登入 Cloudflare：

```bash
npx wrangler login
```

## Configuration

### `wrangler.jsonc`

`destination_address` 必須是 Cloudflare Email Routing 裡已經完成驗證的 Destination Address。

可以在：

```text
Cloudflare Dashboard
→ Email Service
→ Email Routing
→ Destination Addresses
```

確認狀態為：

```text
Verified
```

## Worker

請修改：

```js
const DESTINATION = "user@gmail.com";
const RELAY_FROM = "relay@example.com";
```

其中：

* `DESTINATION`：Cloudflare 已驗證的 Destination Address
* `RELAY_FROM`：自己的 Email Routing Domain

例如：

```js
const DESTINATION = "example@gmail.com";
const RELAY_FROM = "relay@elvismao.com";
```

不要把 `RELAY_FROM` 設定成原始寄件者，例如：

```text
cse@moica.nat.gov.tw
```

Worker 並不是代替 MOICA 寄信，而是將收到的郵件內容重新封裝。

## Deploy

部署至 Cloudflare：

```bash
npx wrangler deploy
```

成功後應該會建立：

```text
moica-mail-relay
```

Worker。

## Email Routing

進入：

```text
Cloudflare Dashboard
→ Email Service
→ Email Routing
→ Routing Rules
```

將原本：

```text
info@example.com
→ Send to an email
→ user@gmail.com
```

改成：

```text
info@example.com
→ Send to a Worker
→ moica-mail-relay
```

不要同時建立多條相同 Email Pattern 的 Rule。

## Why PostalMime?

部分舊式政府資訊系統的郵件可能：

* 使用較舊的 MIME 格式
* 使用非 UTF-8 Charset
* Subject 採用 MIME Encoded-Word
* 同時包含 Text / HTML multipart
* 使用 quoted-printable 或 Base64

直接讀取 Header 或 Raw Email 容易遇到：

```text
�u�W�ק�Τ�N�X-���ҽX
```

這類 mojibake。

`postal-mime` 可以負責解析 MIME、Charset 與郵件內容，避免自行處理大量 Email 格式細節。

## Security

這個 Worker 本質上具有「收到郵件後重新寄送」的能力，因此建議：

* `destination_address` 固定指定，不接受來信動態控制
* 不允許寄件者指定新的 Destination
* `RELAY_FROM` 固定使用自己的 Domain
* 不要將 Worker 做成公開 SMTP Relay
* 不要根據 Email Body 任意決定寄件目標
* 定期檢查 Cloudflare Worker Logs

目前設計中的：

```jsonc
"destination_address": "user@gmail.com"
```

本身也限制了 Email Binding 可以寄送的 Destination。

## Troubleshooting

### `Cannot forward emails that are not authenticated`

代表仍然使用：

```js
message.forward()
```

或 Routing Rule 仍設定為：

```text
Send to an email
```

應改為：

```text
Send to a Worker
```

並使用：

```js
env.EMAIL.send()
```

重新寄送。

### Worker 無法寄出 Email

確認 Destination Address：

```text
Cloudflare
→ Email Routing
→ Destination Addresses
```

狀態為：

```text
Verified
```

並確認 `wrangler.jsonc`：

```jsonc
{
  "send_email": [
    {
      "name": "EMAIL",
      "destination_address": "user@gmail.com"
    }
  ]
}
```

與 Worker：

```js
const DESTINATION = "user@gmail.com";
```

一致。

### 收不到任何信

確認 Routing Rule：

```text
info@example.com
→ Send to a Worker
→ moica-mail-relay
```

並檢查：

```text
Cloudflare
→ Workers
→ moica-mail-relay
→ Logs
```

### 中文 Subject 亂碼

如果是 `email.subject` 已經亂碼，可能是原始郵件本身使用特殊 Charset 或不標準 MIME Encoding。

可以從 Worker Logs 檢查：

```js
message.headers.get("subject")
```

以及 PostalMime 的：

```js
email.subject
```

兩者結果。

## Limitations

目前版本主要處理：

* Subject
* Plain Text
* HTML

尚未重新附加：

* Attachments
* Inline Images / CID Images
* 原始 Reply-To
* CC / BCC
* 完整原始 Headers

如果需要作為一般用途的 Email Relay，可以進一步加入附件與完整 MIME 重建功能。

## License

本專案以[你他媽的想幹嘛就幹嘛](LICENSE)公用許可證釋出。