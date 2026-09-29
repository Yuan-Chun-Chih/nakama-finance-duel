# 路由與 App Shell Code Review

本文件從 Next.js route 由上到下說明頁面如何進入 client component。

## 1. Root Layout

檔案：[app/layout.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/app/layout.tsx)

- `import type { Metadata } from "next"`：只在 TypeScript 編譯期使用 Next metadata 型別。
- `import "./globals.css"`：把全站 CSS 載入 root layout，因此所有 route 共用主題、reset 與 reduced-motion 規則。
- `import { Geist } from "next/font/google"`：由 Next 管理字型載入，避免前端自行插入外部 `<link>`。
- `const geist = Geist(...)`：建立字型設定；`variable: "--font-sans"` 讓 CSS 透過變數使用字型。
- `metadata`：提供瀏覽器標題與 description。這是 SEO 與瀏覽器 tab 資訊，不是遊戲狀態。
- `RootLayout({ children })`：Next App Router 的最上層 layout，所有頁面都會收到 `children`。
- `<html lang="en" className="dark ...">`：設定文件語系、dark theme 與字型 class。若產品改為中文，`lang` 應同步改成 `zh-Hant`。
- `<body className="min-h-full flex flex-col">`：提供頁面最小高度與垂直 layout。
- `{children}`：插入目前 route 的 page component；layout 不直接知道目前是 dashboard 或 match。

## 2. 首頁

檔案：[app/page.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/app/page.tsx)

- `import { PhaseOneDashboard } ...`：首頁只依賴 dashboard feature，不直接依賴 Nakama client。
- `Home()`：server component 入口。
- `return <PhaseOneDashboard />`：把互動交給 client component；auth form、好友、公會、聊天與 leaderboard 狀態都在下層管理。

## 3. Finance route

檔案：[app/matches/page.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/app/matches/page.tsx)

- `import { MatchArenaClient } ...`：route 不處理 match state，只選擇 arena shell。
- `MatchesPage()`：`/matches` 的 server component。
- `return <MatchArenaClient />`：沒有 community context，代表 global practice arena。

檔案：[app/matches/[kind]/[id]/page.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/app/matches/[kind]/[id]/page.tsx)

- `params: Promise<{ kind: string; id: string }>`：Next 16 route params 以 Promise 傳入，先 await 才能讀取。
- `const { kind, id } = await params`：取得 URL 中的 community 類型與識別碼。
- `kind === "guild" ? "guild" : "group"`：把外部字串收斂成前端允許的 `GroupKind`；未知類型目前會落到 group，正式環境可考慮改成 not-found。
- `<MatchArenaClient communityId={id} communityKind={communityKind} />`：將 route context 傳給 arena shell。

## 4. Arena shell

檔案：[components/match-arena-client.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/match-arena-client.tsx)

- `useState(snapshot)`：保存 bootstrap 後的 dashboard snapshot。
- `useState(communityName)`：保存 optional community detail 的顯示名稱。
- `useState(loading)`：控制初始資料載入狀態。
- `useState(error)`：保存 shell 載入錯誤。
- `useState(duelPresentation)`：由 finance panel 通知目前是否進入 countdown/running；用於隱藏 workspace 標題、保留返回列。
- `useState(loadRevision)`：重試時增加 revision，觸發 load effect 重新執行。
- `useEffect(... bootstrapPhaseOne())`：載入 auth/profile/community 基礎資料。`cancelled` flag 防止 component 卸載後寫入 state。
- `fetchCommunityDetail(communityId)`：只有有 community context 時才讀取詳細名稱。
- `communityContext`：以 `useMemo` 把 route props 與名稱組成下層可用 context。
- `<main aria-busy={loading}>`：讓輔助工具知道整個 arena 正在載入。
- error `<Alert>`：顯示錯誤與 Retry 按鈕，retry 只重跑前端 bootstrap，不直接修改後端資料。
- `<FinanceDuelMatchPanel disabled={...} snapshot={snapshot} />`：將 shell loading/error 轉成 finance panel 的 disabled 邊界。

## 5. 社群 detail routes

- [app/communities/[id]/page.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/app/communities/[id]/page.tsx)：await `id` 後渲染 `CommunityDetailClient`。
- [app/guilds/[id]/page.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/app/guilds/[id]/page.tsx)：await `id` 後渲染 `GuildDetailClient`。
- route page 只負責解析 URL；membership、audit、join request 與操作按鈕都留在 client feature。

## 6. Next 設定

檔案：[next.config.ts](/C:/Users/kdsam/Documents/nakama-duel/apps/web/next.config.ts)

- `webRoot`：由 `import.meta.url` 取得 apps/web 的絕對路徑。
- `turbopack.root`：明確限制編譯根目錄，避免 monorepo 同時存在 backend 與 frontend 時 Next 錯誤推斷 workspace root。

## 7. Review 結論

路由層責任清楚：page 解 URL、shell 載入 context、feature component 管互動。下一步可將 `MatchArenaClient` 的 bootstrap 與 community detail 讀取抽成 route-level loader 或 hook，並把未知 `kind` 改成明確錯誤頁。
