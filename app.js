/**
 * app.js — #議題井字棋 遊戲邏輯
 *
 * 核心迴圈(嚴格依 prompt 順序):
 *   1. 建立開格順序(依 CONFIG.revealMode)
 *   2. 取出下一個未填格,綁定一則議題並顯示
 *   3. 進入投票階段(CONFIG.voteDurationSeconds 秒)
 *   4. 時間到,多數者寫入格子並鎖定
 *   5. 檢查勝負 / 平局
 *   6. 未分勝負則回到步驟 2
 */

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/**
 * VoteSource — 投票來源的抽象介面。
 *
 * 第一版是「單機模擬」:畫面上的 O / X 按鈕,任何人都可以點,每次點擊算一票。
 * 之後要換成下列任一種來源時,只需要重寫這個物件(呼叫 onVote 的時機與參數不變),
 * 不需要動到遊戲邏輯(GameEngine)本身:
 *
 *   - 多人房間:每支手機掃碼加入同一個 room id,透過 WebSocket / Firebase 等
 *     即時通道把各自的 castVote() 轉送到主畫面,主畫面收到後一樣呼叫 onVote()。
 *     需加上「同一使用者/裝置限投一票」的節流邏輯。
 *   - 實體硬體(例如 ESP32 按鈕器):裝置透過序列埠或 MQTT 回報按鍵事件,
 *     由一個小型 bridge(Node.js 或瀏覽器 Web Serial API)接收後呼叫 castVote()。
 */
const VoteSource = {
  onVote: null,
  init(onVote) {
    this.onVote = onVote;
  },
  castVote(choice) {
    if (this.onVote) this.onVote(choice);
  },
};

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const GameEngine = {
  topics: [],
  cells: [], // { status, topic, oxMap, symbol, votes, finalRatio }
  cellOrder: [],   // preShuffled 模式使用的固定順序佇列
  orderPointer: 0,
  remainingCells: [], // liveRandom / requeue 都從這裡取值
  topicPool: [],
  currentVote: null, // { cellIndex, timeLeft, timerId }
  winningLine: null,
  gameOver: false,

  async loadTopics() {
    const res = await fetch('topics.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('無法讀取 topics.json');
    const data = await res.json();
    return data.topics || [];
  },

  setup(topics) {
    this.topics = topics;
    this.cells = Array.from({ length: 9 }, () => ({
      status: 'empty',
      topic: null,
      oxMap: null,
      symbol: null,
      votes: { O: 0, X: 0 },
      finalRatio: null,
    }));
    this.topicPool = shuffle(topics).slice(0, 9);
    this.gameOver = false;
    this.winningLine = null;

    const order = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    if (CONFIG.revealMode === 'preShuffled') {
      this.cellOrder = order;
      this.orderPointer = 0;
    } else {
      // liveRandom:每次即時從剩餘未開格中抽選
      this.remainingCells = order;
    }
  },

  nextCellIndex() {
    if (CONFIG.revealMode === 'preShuffled') {
      while (this.orderPointer < this.cellOrder.length) {
        const idx = this.cellOrder[this.orderPointer++];
        if (this.cells[idx].status === 'empty') return idx;
      }
      return null;
    }
    // liveRandom
    const pool = this.remainingCells.filter(i => this.cells[i].status === 'empty');
    if (pool.length === 0) return null;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.remainingCells = this.remainingCells.filter(i => i !== pick);
    return pick;
  },

  requeueCell(idx) {
    // tieBreakRule === 'requeue':把這格重新排回佇列尾端,議題保留不換
    if (CONFIG.revealMode === 'preShuffled') {
      this.cellOrder.push(idx);
    } else {
      this.remainingCells.push(idx);
    }
  },

  drawOxMap(topic) {
    if (CONFIG.oxMapping === 'fixed') {
      return { O: 'positive', X: 'negative' };
    }
    return Math.random() < 0.5
      ? { O: 'positive', X: 'negative' }
      : { O: 'negative', X: 'positive' };
  },

  openCell(idx) {
    const cell = this.cells[idx];
    if (!cell.topic) {
      cell.topic = this.topicPool.pop();
      cell.oxMap = this.drawOxMap(cell.topic);
    }
    cell.status = 'active';
    cell.votes = { O: 0, X: 0 };
    this.currentVote = {
      cellIndex: idx,
      timeLeft: CONFIG.voteDurationSeconds,
      timerId: null,
    };
  },

  vote(choice) {
    if (!this.currentVote) return;
    const cell = this.cells[this.currentVote.cellIndex];
    cell.votes[choice]++;
  },

  resolveVote() {
    const idx = this.currentVote.cellIndex;
    const cell = this.cells[idx];
    const { O, X } = cell.votes;
    const total = O + X;
    cell.finalRatio = total > 0
      ? { O: O / total, X: X / total }
      : { O: 0, X: 0 };

    if (O === X) {
      this.handleTie(idx, cell);
    } else {
      cell.symbol = O > X ? 'O' : 'X';
      cell.status = 'filled';
    }

    this.currentVote = null;
  },

  handleTie(idx, cell) {
    switch (CONFIG.tieBreakRule) {
      case 'random':
        cell.symbol = Math.random() < 0.5 ? 'O' : 'X';
        cell.status = 'filled';
        break;
      case 'requeue':
        cell.status = 'empty';
        this.requeueCell(idx);
        break;
      case 'suspended':
      default:
        cell.status = 'suspended';
        break;
    }
  },

  checkOutcome() {
    for (const line of WIN_LINES) {
      const [a, b, c] = line;
      const sa = this.cells[a].symbol;
      const sb = this.cells[b].symbol;
      const sc = this.cells[c].symbol;
      if (sa && sa === sb && sb === sc) {
        this.winningLine = line;
        this.gameOver = true;
        return { type: 'win', symbol: sa, line };
      }
    }
    const allResolved = this.cells.every(c => c.status === 'filled' || c.status === 'suspended');
    if (allResolved) {
      this.gameOver = true;
      return { type: 'draw' };
    }
    return null;
  },
};

/* ────────────────────────────────────────────────────────────
   UI 綁定
   ──────────────────────────────────────────────────────────── */

const el = {
  errorScreen: document.getElementById('errorScreen'),
  errorText: document.getElementById('errorText'),
  startScreen: document.getElementById('startScreen'),
  gameScreen: document.getElementById('gameScreen'),
  endScreen: document.getElementById('endScreen'),
  board: document.getElementById('board'),
  panel: document.getElementById('panel'),
  roundCounter: document.getElementById('roundCounter'),
  startBtn: document.getElementById('startBtn'),
  restartBtn: document.getElementById('restartBtn'),
  endKicker: document.getElementById('endKicker'),
  endHeadline: document.getElementById('endHeadline'),
  endSub: document.getElementById('endSub'),
};

let detailOpenIndex = null;

function showScreen(name) {
  [el.errorScreen, el.startScreen, el.gameScreen, el.endScreen].forEach(s => s.classList.add('hidden'));
  ({ error: el.errorScreen, start: el.startScreen, game: el.gameScreen, end: el.endScreen }[name]).classList.remove('hidden');
}

function ozLabel(topic, oxMap, symbol) {
  const key = oxMap[symbol]; // 'positive' | 'negative'
  return key === 'positive' ? topic.positiveLabel : topic.negativeLabel;
}

function renderBoard() {
  el.board.innerHTML = '';
  GameEngine.cells.forEach((cell, idx) => {
    const div = document.createElement('div');
    div.className = 'cell ' + cell.status;
    if (GameEngine.winningLine && GameEngine.winningLine.includes(idx) && cell.status === 'filled') {
      div.classList.add('winning');
      if (CONFIG.victoryTone === 'celebratory') div.classList.add('celebrate');
    }

    if (cell.status === 'empty') {
      div.innerHTML = `<span class="cell-mark">?</span>`;
    } else if (cell.status === 'active') {
      div.innerHTML = `<span class="cell-mark">${cell.topic ? cell.topic.hashtag : ''}</span>`;
    } else if (cell.status === 'filled') {
      div.innerHTML = `
        <span class="cell-mark">${cell.symbol}</span>
        <span class="cell-tag">${cell.topic.hashtag}</span>
        <button class="cell-detail-btn" data-idx="${idx}" aria-label="查看議題詳情">i</button>
      `;
    } else if (cell.status === 'suspended') {
      div.innerHTML = `
        <span class="cell-mark">–</span>
        <span class="cell-tag">懸置 · ${cell.topic ? cell.topic.hashtag : ''}</span>
        <button class="cell-detail-btn" data-idx="${idx}" aria-label="查看議題詳情">i</button>
      `;
    }
    el.board.appendChild(div);
  });

  el.board.querySelectorAll('.cell-detail-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      detailOpenIndex = Number(btn.dataset.idx);
      renderPanel();
    });
  });

  const resolved = GameEngine.cells.filter(c => c.status === 'filled' || c.status === 'suspended').length;
  el.roundCounter.textContent = String(resolved).padStart(2, '0') + ' / 09';
}

function renderPanel() {
  if (detailOpenIndex !== null) {
    const cell = GameEngine.cells[detailOpenIndex];
    const t = cell.topic;
    const oLabel = ozLabel(t, cell.oxMap, 'O');
    const xLabel = ozLabel(t, cell.oxMap, 'X');
    const ratio = cell.finalRatio;
    el.panel.innerHTML = `
      <div class="detail-block">
        <div class="d-hashtag">${t.hashtag}</div>
        <div>${t.criteria}</div>
        <div class="detail-row"><span>O =</span><span>${oLabel}</span></div>
        <div class="detail-row"><span>X =</span><span>${xLabel}</span></div>
        ${cell.status === 'filled' ? `
          <div class="detail-row"><span>結果</span><span>${cell.symbol}(${ozLabel(t, cell.oxMap, cell.symbol)}）</span></div>
          <div class="detail-row"><span>票數比例</span><span>O ${(ratio.O * 100).toFixed(0)}% / X ${(ratio.X * 100).toFixed(0)}%</span></div>
        ` : `
          <div class="detail-row"><span>結果</span><span>懸置(平票)</span></div>
        `}
        <div class="detail-close" id="closeDetail">關閉</div>
      </div>
    `;
    document.getElementById('closeDetail').addEventListener('click', () => {
      detailOpenIndex = null;
      renderPanel();
    });
    return;
  }

  if (!GameEngine.currentVote) {
    el.panel.innerHTML = `<div class="panel-idle">STANDBY — 等待下一格開啟</div>`;
    return;
  }

  const idx = GameEngine.currentVote.cellIndex;
  const cell = GameEngine.cells[idx];
  const t = cell.topic;
  const oLabel = ozLabel(t, cell.oxMap, 'O');
  const xLabel = ozLabel(t, cell.oxMap, 'X');
  const timeLeft = GameEngine.currentVote.timeLeft;
  const pct = Math.max(0, (timeLeft / CONFIG.voteDurationSeconds) * 100);
  const total = cell.votes.O + cell.votes.X;

  el.panel.innerHTML = `
    <div class="vote-block">
      <p class="vote-hashtag">${t.hashtag}</p>
      <p class="vote-criteria">${t.criteria}</p>
      <div class="vote-timer-row">
        <div class="vote-timer-bar"><div class="vote-timer-fill" style="width:${pct}%"></div></div>
        <span class="vote-timer-num">${timeLeft}s</span>
      </div>
      <div class="vote-buttons">
        <button class="vote-btn" id="btnO">
          <span class="sym">O</span>
          <span class="label">${oLabel}</span>
        </button>
        <button class="vote-btn" id="btnX">
          <span class="sym">X</span>
          <span class="label">${xLabel}</span>
        </button>
      </div>
      <div class="vote-tally">
        <span>O: ${cell.votes.O}</span>
        <span>總票數: ${total}</span>
        <span>X: ${cell.votes.X}</span>
      </div>
    </div>
  `;
  document.getElementById('btnO').addEventListener('click', () => { VoteSource.castVote('O'); renderPanel(); });
  document.getElementById('btnX').addEventListener('click', () => { VoteSource.castVote('X'); renderPanel(); });
}

function render() {
  renderBoard();
  renderPanel();
}

/* ────────────────────────────────────────────────────────────
   遊戲迴圈控制
   ──────────────────────────────────────────────────────────── */

function tick() {
  if (!GameEngine.currentVote) return;
  GameEngine.currentVote.timeLeft--;
  if (GameEngine.currentVote.timeLeft <= 0) {
    clearInterval(GameEngine.currentVote.timerId);
    GameEngine.resolveVote();
    const outcome = GameEngine.checkOutcome();
    render();
    if (outcome) {
      setTimeout(() => endGame(outcome), CONFIG.victoryTone === 'celebratory' ? 1400 : 600);
    } else {
      setTimeout(advance, 500);
    }
  } else {
    render();
  }
}

function advance() {
  const idx = GameEngine.nextCellIndex();
  if (idx === null) {
    // 理論上不會發生(checkOutcome 會先攔截平局),保底處理
    endGame({ type: 'draw' });
    return;
  }
  GameEngine.openCell(idx);
  render();
  GameEngine.currentVote.timerId = setInterval(tick, 1000);
}

function endGame(outcome) {
  render();
  showScreen('end');
  if (outcome.type === 'win') {
    el.endKicker.textContent = CONFIG.victoryTone === 'celebratory' ? 'WINNER' : 'RESULT';
    el.endHeadline.textContent = `${outcome.symbol} 連線成立`;
    el.endSub.textContent = CONFIG.victoryTone === 'celebratory'
      ? '三連線達成 — 恭喜！'
      : '三連線出現。這只是多輪多數決依序疊加後,恰好落在同一直線上的結果 —— 勝負本身不帶有額外意義。';
  } else {
    el.endKicker.textContent = 'RESULT';
    el.endHeadline.textContent = '九格填滿,無連線';
    el.endSub.textContent = '所有格子已進入最終狀態(含懸置格),未形成三連線。';
  }
}

function startGame() {
  detailOpenIndex = null;
  GameEngine.setup(GameEngine.topics);
  showScreen('game');
  render();
  advance();
}

VoteSource.init((choice) => GameEngine.vote(choice));

el.startBtn.addEventListener('click', startGame);
el.restartBtn.addEventListener('click', startGame);

(async function init() {
  try {
    const topics = await GameEngine.loadTopics();
    if (topics.length < 9) {
      throw new Error(
        `議題數量不足:topics.json 目前只有 ${topics.length} 則,至少需要 9 則才能開始遊戲。\n` +
        `請編輯 topics.json,新增議題後再重新整理頁面。`
      );
    }
    GameEngine.topics = topics;
    showScreen('start');
  } catch (err) {
    el.errorText.textContent = '無法啟動遊戲\n\n' + err.message;
    showScreen('error');
  }
})();
