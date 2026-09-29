# 共用 UI、主題與 RWD Code Review

## 1. 全域樣式

檔案：[app/globals.css](/C:/Users/kdsam/Documents/nakama-duel/apps/web/app/globals.css)

- `:root` / dark variables：集中定義 background、foreground、card、border、ring、chart 與 sidebar 顏色。
- `@theme inline`：將 CSS variable 暴露給 Tailwind theme。
- `@media (prefers-reduced-motion: reduce)`：使用者要求減少動態時，停用大部分 transition、animation 與 smooth scrolling。
- base layer：設定 `box-sizing`、body background、text color 與字型。

交易對局目前使用 `bg-card`、`bg-muted` 與 semantic text class，避免每個 component 重複硬編背景色；圖表 SVG 的 candle 顏色仍是市場語意色，應保留明確對比。

## 2. 共用 primitive

### Button

檔案：[components/ui/button.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/ui/button.tsx)

- `buttonVariants`：用 CVA 統一 variant、size、focus ring、disabled state。
- `asChild`：讓 Link 可以使用同一套按鈕視覺。
- `Button`：透過 `Slot` 或 button element 轉發 props，所有主要操作應使用此 primitive。
- finance mobile ticket 額外設定 `min-h-11` 或 `min-h-12`，符合觸控目標需求。

### Card

檔案：[components/ui/card.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/ui/card.tsx)

- `Card`：外框與圓角容器。
- `CardHeader`：標題與操作區。
- `CardTitle`：語意標題。
- `CardDescription`：輔助說明。
- `CardContent`：主要內容。
- `CardFooter`：底部操作區。

### Alert

檔案：[components/ui/alert.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/ui/alert.tsx)

- `alertVariants`：default/destructive 視覺變體。
- `Alert`：預設帶 `role="alert"`，適合錯誤與重要狀態；一般背景提示若不希望打斷螢幕閱讀器，可另加 polite live region。
- `AlertAction`：提供右側 retry/action 位置。

### Dialog

檔案：[components/ui/dialog.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/ui/dialog.tsx)

- `Dialog`：Radix root，管理 open state。
- `DialogPortal`：把內容移到 body 層，避免被 arena overflow 截斷。
- `DialogOverlay`：統一遮罩與 backdrop blur。
- `DialogContent`：提供 focus management、escape、portal 與可選 close button。
- `DialogHeader`、`DialogTitle`、`DialogDescription`、`DialogFooter`：建立正確的 dialog 語意。
- finance 的 match confirmation、countdown、resign/leave 均使用此 primitive，而不是自行建立 fixed div。

### Input、Select、Tabs、ScrollArea

- [input.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/ui/input.tsx)：統一 focus、invalid、disabled 與 mobile text size。
- [select.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/ui/select.tsx)：Radix select 相關 trigger/content/item。
- [tabs.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/ui/tabs.tsx)：適合 dashboard section；finance mobile tab 目前有自訂 `role="tablist"`，後續可統一使用 primitive。
- [scroll-area.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/ui/scroll-area.tsx)：長列表或 chat 內容使用，避免頁面整體滾動取代局部 scroll。

## 3. Finance RWD

檔案：[components/finance-duel/finance-trade-ticket.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/finance-duel/finance-trade-ticket.tsx)

- `mobileOpen`：手機版顯示 bottom sheet，桌面版回到 aside card。
- fixed overlay：點擊遮罩可關閉交易票券。
- `body.style.overflow = "hidden"`：bottom sheet 開啟時鎖住背景 scroll。
- Escape listener：支援鍵盤關閉。
- `env(safe-area-inset-bottom)`：處理 iPhone home indicator 空間。
- numeric input + range input：讓手機使用者可以直接輸入精確 BTC 數量，也能用 slider 快速操作。
- sticky CTA：送單按鈕在手機底部保持可見。

## 4. 可存取性檢查表

- 每個 icon-only button 要有 `aria-label`。
- modal 要有 `DialogTitle` 與 `DialogDescription`。
- server error 使用 `role="alert"`；狀態更新使用 `aria-live="polite"` 或 `assertive`。
- slider、number input、button 必須有可見 focus ring。
- tab 要有 selected state，不只依靠顏色。
- 對局倒數不能只用動畫，必須有文字與 live region。
- RWD 不應依賴 hover 才能完成交易。

## 5. Review 結論

共用 primitive 已能支撐目前 UI。後續最值得做的是把 finance mobile tabs 改用共用 Tabs，並建立 `Field`、`StatusBadge`、`AsyncButton` 等更高階語意元件，避免 dashboard 與 finance 重複定義 loading/error/field 視覺。
