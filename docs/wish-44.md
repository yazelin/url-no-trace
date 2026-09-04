# Wish Pool #44 交接紀錄

## 認領句

> 我來實作這版台灣／亞洲導向的網址無痕清理器。市調中的 ClearURLs、laststance/clean-url、newhouse/url-tracking-stripper 都是相近品：前者規則成熟但不聚焦本願望的亞洲參數與整合流程，後兩者各自缺少本願望要求的自訂精確／萬用／Regex、JSON／TXT 訂閱、SPA history.replaceState、白名單組合；本版補齊這些落差，並維持清理邏輯在本機。

## 規格狀態

已依 Wish Pool Agent refinement protocol 提交一輪規格收斂，狀態為 `ready`，`implementation_ready=true`。本版採用的 MVP 邊界：

- 桌面 Chromium MV3 為主要載入目標；核心清理器維持標準 WebExtension 格式。
- 內建規則、使用者規則與訂閱規則合併套用；未知參數預設保留。
- 網址列整理是頁面載入後的 `history.replaceState`，不重新載入頁面；不承諾阻止初始 HTTP 請求。
- 訂閱只下載資料，不執行遠端程式碼；同步失敗保留上一份有效規則。
- 不做手機 App、伺服器代理、AI 分析、短網址展開或全域剪貼簿攔截。

## 市調落差

| 現成品 | 已做到 | 本願望／本版仍補的格子 |
| --- | --- | --- |
| [ClearURLs 相近工具整理](https://docs.clearurls.xyz/1.27.3/further_readings/similar_addons/) | 成熟的追蹤參數規則與外掛生態 | 本版提供較直接的自訂規則、亞洲情境預設、白名單與同一個 Popup 工作流 |
| [laststance/clean-url](https://github.com/laststance/clean-url) | 本機清理、25+ 參數、Popup、右鍵複製 | README 的 roadmap 仍列自訂規則與 whitelist；本版補上自訂 exact／prefix／regex、訂閱、SPA 自動整理與白名單 |
| [newhouse/url-tracking-stripper](https://github.com/newhouse/url-tracking-stripper) | 可選 history change、重新載入清理與跳過已知 redirect | 本版聚焦不重新載入的 SPA `history.replaceState`，並加上可管理規則、訂閱、右鍵複製與白名單 |

沒有找到同時符合完整組合的同款成品，因此繼續實作，而不是以「已有現成」指路交回。

## 完成範圍

- `shared/cleaner.js`：URL 解析、規則推導、regex 驗證、清單解析、白名單邊界與清理結果 diff。
- `content.js`：初始網址與 SPA history 變化監看、無重新載入替換、頁面剪貼簿 fallback、提示 toast。
- `background.js`：右鍵複製、快捷鍵、訂閱同步、6 小時 alarm、badge 和特殊頁面 fallback。
- `popup.*`：目前網址預覽、複製、套用、網域白名單、全域暫停。
- `options.*`：自訂規則、規則清單訂閱、白名單與隱私說明。
- `tests/`：9 項 Node 內建測試全數通過。

## 尚未承諾的部分

- 尚未上架 Chrome Web Store 或 Firefox Add-ons；目前以開發者模式載入。
- 右鍵複製受瀏覽器頁面權限與剪貼簿策略影響；失敗時會提示使用者從 Popup 複製。
- 初始 URL 的追蹤資訊可能在 `history.replaceState` 前已送給目標網站；若需要請搭配網路層阻擋工具。
