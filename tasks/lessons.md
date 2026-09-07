# Lessons

專案進行中被修正過、或實際踩到的坑。每條都寫「怎麼避免下次再犯」。

---

## Firebase 測試模式規則會在 30 天後自動鎖死

**發生**：2026-09-07 打開網站連不上。GitHub Pages 全部 200，但資料庫每個路徑
（包含不存在的路徑）都回 `401 Permission denied`。

**原因**：建立 Realtime Database 時選了「測試模式」，規則被寫成
`".read": "now < <時間戳>"`。30 天到期後條件永遠為 false，所有人都被擋在外面，
**包含擁有者自己**。8/2 比賽當天還在期限內所以一切正常。

**怎麼避免**：
- 建立資料庫一律選「鎖定模式」，然後 `firebase deploy --only database`
- 任何規則檔 commit 前 grep 一次 `now\s*[<>]`，出現就是有期限
- 診斷「連不上」時，先分清楚是**靜態檔案**還是**資料庫**：分別 curl 兩邊。
  連不存在的路徑都回 Permission denied → 一定是根層級規則問題，不是資料沒了

---

## Firebase 規則編輯器只接受頂層的 `rules`

`firebase-rules.json` 當初在頂層放了 `_說明` 註解陣列，導致整個檔案**不能直接
貼**（編輯器會報錯）—— 而這個檔案存在的唯一目的就是被貼。

**怎麼避免**：要被工具吃的設定檔就保持格式純淨，說明寫在 README 或另存一份
註解版。現在 `database.rules.json` 是純淨版，由 CLI 直接部署，人不必再手貼。

---

## 規則要用 CLI 部署，不要手貼

手貼主控台會讓「repo 裡的檔案」與「線上實際跑的規則」分離，而 CLI **沒有讀回
規則的指令**（`database:settings:get` 只支援 defaultWriteSizeLimit 和
strictTriggerValidation），所以兩邊不一致時你驗證不出來。

2026-09-07 已綁好 `firebase.json` + `.firebaserc`，改規則就是
`firebase deploy --only database`。順帶好處：`firebase database:get` 走管理員
憑證繞過規則，規則再鎖住也匯得出資料。

---

## 還原配置不能無條件解除封盤

`restoreConfigPaths` 一律寫 `locked: false`，但「誰獲勝」盤在參賽者未定時是
`pendingPlayers + locked` 兩個一起成立的。只解封會產生「待定但可下注」的狀態，
而玩家頁的 `canBet` 只看 `settled/locked`，不看 `pendingPlayers` —— 玩家會看到
下注框，選項卻還是佔位用的 p0/p1。

**已修正**（2026-09-07，第三屆籌備時）：`restoreConfigPaths` 依基準點的
`pendingPlayers` 決定寫回的 `locked`；玩家頁的 `canBet` 與 `placeBet` 也各加一條
`pendingPlayers` 檢查 —— 待定盤不該能下注，跟它有沒有被封盤無關（根因在此）。

**怎麼避免**：改狀態欄位時，先找出「哪些欄位是成組成立的」。單獨寫其中一個就是 bug。

---

## 測試要放進 repo，不要放暫存目錄

第二屆累積的 592 項測試（6 套）全寫在 session 的 scratchpad，從沒 commit。
session 一結束就全沒了，第三屆等於從零重建。

**怎麼避免**：測試是產品的一部分，第一次寫就放 `tests/` 並 commit。
現在有 `npm test`（語法 + 邏輯 + DOM）與 `npm run test:e2e`。

---

## 測試期望值要自己算兩次

多次把期望值寫錯（16.5 vs 16.7、2 個差異 vs 3 個差異），每次都是我的算術失誤而不是
程式錯誤，浪費了驗證回合。

**怎麼避免**：斷言的期望值先手算一遍、再從資料反推一遍，兩邊對上才寫進測試。

---

## 破壞性操作先算清楚再問

刪注單、刪盤口這類動作牽涉真實金額與別人的錢。做法：先備份 → 印出**具體**會刪掉
什麼（幾筆、多少錢、誰的）→ 確認 → 執行 → 讀回核對。確認文字裡寫實際數字，不要
寫通則。

「重置第三階段的下注與名單」這種指示有歧義（參賽者名單？16 人名單？）——
做無爭議的部分，明確說出沒做哪一半以及為什麼。
