# 無痕清理器｜Clean Trail

一個本機優先的 Manifest V3 WebExtension：自動移除網址中的追蹤參數，讓分享與複製出去的連結更乾淨。它支援台灣／亞洲常見情境、自訂規則、遠端規則清單訂閱、網域白名單，以及連結右鍵「複製無痕連結」。

這是 AI 願望池 #44「網址無痕清理器」的實作版本。

## 功能

- 頁面載入後以 `history.replaceState` 整理網址，不重新載入頁面。
- 監看 `pushState`、`replaceState`、`popstate` 與 `hashchange`，適合 SPA 網站。
- 內建 UTM、Facebook、Google Ads、Instagram `igsh*`、TikTok、郵件與亞洲平台追蹤參數；另有 Shopee、PTT、Dcard 的網域限定範例。
- 自訂精確名稱、萬用字首（如 `utm_*`）或正則表達式規則。
- 訂閱 JSON／純文字規則清單，也能解析常見的 ClearURLs `providers` 格式；同步失敗會保留上一份有效版本。
- 連結右鍵選單複製清理後的 URL，不用先造訪連結。
- 以 `Ctrl+Shift+Y`（macOS 為 `Command+Shift+Y`）快速複製目前分頁的無痕連結，也可在瀏覽器快捷鍵設定中改鍵。
- 全域暫停與網域白名單；未知參數預設保留。
- 所有清理、規則比對與設定資料都留在瀏覽器本機，沒有分析、登入或自有後端。

## 安裝（Chrome／Edge）

1. 下載或 clone 這個 repo。
2. 開啟 `chrome://extensions` 或 Edge 的 `edge://extensions`。
3. 打開右上角「開發人員模式」。
4. 按「載入解壓縮」，選擇本 repo 根目錄（包含 `manifest.json` 的資料夾）。
5. 開一個帶有 `utm_source`、`fbclid` 或 `igsh` 的網址測試；網址列會在頁面載入後整理。

也可以在 Firefox 的 `about:debugging#/runtime/this-firefox` 載入同一份目錄測試。核心邏輯使用標準 WebExtension API；瀏覽器對剪貼簿與特殊頁面的限制仍可能不同。

## 規則格式

設定頁可新增三種規則：

| 寫法 | 意義 |
| --- | --- |
| `fbclid` | 只移除名稱完全相同的參數 |
| `utm_*` | 移除以 `utm_` 開頭的參數 |
| `/^mc_/i` | 以正則表達式比對參數名稱 |

規則也可以用 `regex:` 前綴，例如 `regex:/^x_[0-9]+$/i`。正則規則限制長度與旗標，編譯失敗的規則會被拒絕。可選填網域，讓規則只在指定網域及其子網域生效。

### 規則清單訂閱

設定頁的「規則清單訂閱」接受 HTTP(S) 網址。內容可以是：

```json
["utm_*", "fbclid", "/^campaign_/i"]
```

或：

```json
{
  "rules": ["utm_*", "gclid"],
  "parameters": ["igsh"]
}
```

也支援常見的 ClearURLs 形式：

```json
{
  "providers": {
    "community": {
      "urlPattern": "^https://example.com",
      "rules": ["utm_source", "affiliate_id"]
    }
  }
}
```

純文字則是一行一條規則，空白行和 `#`／`!` 開頭的註解會忽略。擴充功能每 6 小時自動同步，也可以在設定頁手動同步。回應大小上限為 512 KiB，規則上限為 2,000 條；無效清單不會覆蓋已經成功同步的版本。

## 隱私與安全邊界

- 核心清理器不呼叫外部 API，不記錄瀏覽歷程，也不把目前網址傳給本工具的伺服器。
- 訂閱功能只會連線到使用者明確加入的規則網址；遠端內容只當作資料解析，不使用 `eval`、`new Function` 或 script 注入。
- `history.replaceState` 是頁面載入後的網址整理。它不能撤回網站在初始請求時可能已經收到的原始 URL，所以這個工具主要改善分享、複製與網址列曝光，不宣稱能取代完整的網路層防追蹤工具。
- 未知參數、路徑和 `#` 片段預設保留，以降低破壞網站功能和 SPA 狀態的風險。
- 網銀、公司內部系統或其他需要特殊參數的網站，可以從 Popup 按一下加入白名單；也可以暫停全域清理。
- `chrome://`、`edge://`、擴充功能頁等特殊頁面不能注入 content script。這些頁面不會被假裝成已清理成功。

## 專案結構

```text
manifest.json       WebExtension Manifest V3
background.js       右鍵選單、訂閱同步、排程與 badge
content.js          history API 監看、網址列整理與頁面剪貼簿 fallback
popup.*             目前分頁的預覽、複製、白名單與暫停
options.*           自訂規則、規則訂閱、白名單管理
shared/cleaner.js   無依賴的規則引擎與 URL 清理器
tests/              Node 內建測試
docs/               願望規格與市調交接紀錄
```

## 開發與測試

本 repo 不需要建置工具或套件安裝。需要 Node.js 18 以上：

```bash
npm test
npm run check
```

`npm test` 會測試 URL 清理、規則型別、正則驗證、白名單邊界、暫停、規則清單解析和 Manifest 檔案；`npm run check` 會檢查所有擴充功能 JavaScript 的語法。

### Google Chrome E2E

`npm run test:e2e` 會啟動獨立的 Google Chrome，從 `chrome://extensions` 以開發人員模式載入未封裝項目，再測試初始網址、SPA、設定頁、自訂與訂閱規則、暫停、白名單和快捷鍵剪貼簿。它不會使用 `--load-extension`，避免目前 Chrome 對命令列載入的限制。

這條測試需要 Google Chrome、Xvfb、xdotool、xclip，以及測試用的 [filechooser-portal-mock](https://pypi.org/project/filechooser-portal-mock/)：

```bash
pip install filechooser-portal-mock
FILECHOOSER_PORTAL_BIN="$(command -v filechooser-portal)" npm run test:e2e
```

E2E 是獨立測試，不會由 `npm test` 自動執行；沒有桌面測試依賴時，仍可執行前面的 Node 單元測試與語法檢查。

## 為什麼不是直接重複現有工具？

動工前查過 [ClearURLs 的相近工具整理](https://docs.clearurls.xyz/1.27.3/further_readings/similar_addons/)、[laststance/clean-url](https://github.com/laststance/clean-url) 和 [newhouse/url-tracking-stripper](https://github.com/newhouse/url-tracking-stripper)。它們與本作相近，但沒有同時交付本願望指定的亞洲參數焦點、自訂精確／萬用／Regex 規則、JSON／TXT 訂閱、SPA `history.replaceState`、白名單與右鍵複製整合，因此本 repo 補的是這個組合落差；不是宣稱 URL 清理這個概念本身沒有前例。詳細比較見 [`docs/wish-44.md`](docs/wish-44.md)。

## 授權

MIT License。見 [`LICENSE`](LICENSE)。
