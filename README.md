# #議題井字棋 / Hashtag Tic-Tac-Toe

九宮格中每一格對應一個 #議題,開格順序隨機。每輪觀眾針對該議題投 O 或 X,多數決結果寫入格子,直到三連線或九格填滿。

單機模擬版:純 HTML/CSS/JS,不需建置工具,靜態伺服器即可跑。視覺風格為白底黑字、資訊性、近似新聞快訊/資料視覺化介面,刻意避開遊戲化 UI(無卡通配色、無圓角糖果風、無勝利彩帶動畫)。

## 如何執行

瀏覽器對 `file://` 開啟本機 JSON 有 CORS 限制,請用任一種簡單的靜態伺服器啟動:

```bash
# 任選一種
python3 -m http.server 8000
npx serve .
```

然後打開 `http://localhost:8000/index.html`(建議用手機直向畫面或縮小視窗模擬,設計上是給多人圍繞一台裝置操作)。

## 檔案結構

| 檔案 | 用途 |
|---|---|
| `index.html` | 頁面結構 |
| `style.css` | 白底黑字、簡潔資訊風格 |
| `config.js` | 三個 HDP 設定區塊(見下) |
| `topics.json` | 議題資料池,可自行編輯替換 |
| `app.js` | 遊戲邏輯(`GameEngine`)與投票來源抽象(`VoteSource`) |

## 目前三個 HDP 各自的預設值

都定義在 `config.js`,附有中文註解,改完存檔重新整理頁面即可生效:

1. **平票規則**(`tieBreakRule`):預設 `'suspended'` —— O、X 票數相同時,該格永久「懸置」,不寫入 O/X,格子以斜紋底 + `–` 符號 + 「懸置」字樣特殊標示,不參與勝負連線判斷。另有 `'requeue'`(重新排入佇列尾端,議題不變,稍後再投一次)與 `'random'`(系統亂數決定 O 或 X)可選。
2. **O/X 與正反立場的對應**(`oxMapping`):預設 `'random'` —— 每則議題開格時隨機決定 O 代表 `positiveLabel` 還是 `negativeLabel`,並在投票畫面與格子詳情中清楚標示當下對應。另有 `'fixed'`(固定 O = 支持、X = 反對)可選。
3. **勝負揭曉的視覺語氣**(`victoryTone`):預設 `'flat'` —— 三連線出現時無音效、無彩帶、無慶祝動畫,結算文字刻意平淡(「勝負本身不帶有額外意義」)。另有 `'celebratory'`(格子發光動畫、結算標題改為 WINNER)可選。

另外 `revealMode` 控制開格順序的產生方式,預設 `'liveRandom'`(每次即時抽選下一格),可切換為 `'preShuffled'`(開局就決定整個順序但不對外揭露)。

## 議題資料

`topics.json` 格式:

```json
{
  "topics": [
    {
      "id": "topic_001",
      "hashtag": "#炎上究責",
      "criteria": "此行為是否應該被公開究責?",
      "positiveLabel": "應該究責",
      "negativeLabel": "不應究責"
    }
  ]
}
```

目前內建 12 則範例議題,主題圍繞社群媒體輿論、公審、炎上、集體判斷,措辭保持中性。少於 9 則時遊戲啟動畫面會明確報錯,不會靜默重複使用同一則議題。直接編輯這個檔案即可替換內容。

## 投票機制與未來擴充

第一版是「單機模擬觀眾投票」:畫面上的大型 O / X 按鈕,任何人都可以點擊,每次點擊算一票,時間到(預設 15 秒,可在 `config.js` 調整 `voteDurationSeconds`)結算。

擴充接口已預留在 `app.js` 的 `VoteSource` 物件——遊戲邏輯只透過 `VoteSource.castVote(choice)` 接收投票,不關心票是從哪裡來的:

- **多人房間投票**:每支手機掃碼加入同一個房間 ID,透過 WebSocket(例如搭配一個輕量 Node 後端)或 Firebase Realtime Database 之類的即時通道,把各自的 `castVote()` 呼叫轉送到主畫面。主畫面收到後一樣呼叫既有的 `VoteSource.onVote(choice)`。需額外加上「同一使用者/裝置限投一票」的節流或身分辨識邏輯。
- **實體硬體(例如 ESP32 按鈕器)**:硬體端透過序列埠、MQTT 或 HTTP 上報按鍵事件,由一個小型 bridge(Node.js 搭配 Web Serial API,或一個 MQTT client)接收後呼叫 `castVote()`。可行性高,不需更動 `GameEngine` 的任何邏輯。

兩種擴充都不需要修改核心遊戲狀態機(`GameEngine`)或畫面渲染邏輯,只需要替換 `VoteSource` 的實作。
