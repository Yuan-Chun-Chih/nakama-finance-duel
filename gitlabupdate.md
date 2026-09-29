
### 1. 基本更新循環

當你修改了程式碼（例如在 Next.js 中新增了一個頁面，或是在 Nakama 中新增了一個 RPC 函式）後，請執行以下三步驟：

* **第一步：暫存變更 (Add)**
    將你修改過的檔案加入暫存區。
    ```bash
    git add .
    ```
    *或是只加入特定檔案：`git add src/app/page.tsx`*

* **第二步：提交變更 (Commit)**
    為這次的修改寫下一句簡單的說明。
    ```bash
    git commit -m "修正：調整登入頁面 UI 並新增資產顯示邏輯"
    ```

* **第三步：推送到遠端 (Push)**
    將本地的提交推送到 GitLab 伺服器。
    ```bash
    git push
    ```
    *因為之前已經設定過 `--set-upstream`，現在只需要輸入 `git push` 即可。*

---

### 2. 多人協作或多台電腦同步 (Pull)

如果在不同的電腦上開發，或者未來有朋友加入專案，在開始寫程式**之前**，務必先取得雲端最新的版本：

```bash
git pull origin main
```
這會把 GitLab 上的最新程式碼抓下來並與本地的檔案合併。

---

### 3. 進階建議：分支開發 (Branching)

當你要開發一個大功能（例如：實作實時交易市場）時，建議不要直接在 `main` 分支上改動，而是開一個新分支：

1.  **建立並切換分支：** `git checkout -b feat/trading-market`
2.  **開發與提交：** 照常使用 `git add` 和 `git commit`。
3.  **推送分支：** `git push origin feat/trading-market`
4.  **合併：** 在 GitLab 網頁上發起 **Merge Request**，確認沒問題後再併入 `main`。

```bash
# 1. 檢查目前狀態（看看改了哪些檔案）
git status

# 2. 加入所有變更
git add .

# 3. 提交變更，訊息盡量清晰
git commit -m "feat: implement asset summary display in frontend"

# 4. 推送到 GitLab
git push
```
