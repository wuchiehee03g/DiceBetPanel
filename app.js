/* ============================================================
   DiceBetPanel 共用核心
   ------------------------------------------------------------
   玩家頁 (index.html) 與莊家後台 (banker.html) 共用這一份。
   這裡只放不碰 DOM 的邏輯，所以測試可以直接載入這個檔案跑。

   資料模型：下注帳本 (bets) 是唯一真實來源，只用 push() 新增。
   注金、賠率、派彩、報表全部即時從帳本推導，不另存欄位——
   多人同時下注時才不會互相覆蓋，統計也不可能跟帳本對不起來。
   ============================================================ */

const DB_PATH        = 'diceLiarKingState';
const PLAYER_COUNT   = 16;
const DEFAULT_ODDS   = 2;       // 新選項的預設賠率（1:1 平賭）
/* 定價黏性：相當於莊家先押多少錢在自己開的價上。
   波動大小取決於「單筆上限 ÷ 黏性」的比值，不是上限本身——
   黏性 1000 配上限 5000 的話，一筆滿額注就會把 2.00 推到 1.09（砍掉 45%）。
   預設抓上限的 4 倍，開盤表單會即時顯示實際衝擊讓莊家自己調。 */
const DEFAULT_PRIOR_K= 20000;
const DEFAULT_MAX_BET= 5000;    // 單筆投注上限
const MAX_AUTO_ODDS  = 50;      // 自動定價上限，避免冷門選項出現荒謬賠率
const MIN_AUTO_ODDS  = 1.01;
const QUICK_AMOUNTS  = [100, 500, 1000];
const DICE_PIPS      = ['⚀','⚁','⚂','⚃','⚄','⚅'];

/* 單挑賽事的標準盤口 --------------------------------------------------
   每場單挑用「賽事編號」串起三個盤：誰獲勝、獲勝者剩餘血格大小、單雙。
   血量規則是每輪五格、歸零淘汰，所以獲勝者剩餘血格必然是 1~5。
   單雙固定：單 = 1,3,5　雙 = 2,4
   大小的分界可調（預設 3 以上為大），開盤時會寫進盤口說明讓大家看得到。
   -------------------------------------------------------------------- */
const MAX_HP = 5;
const DEFAULT_BIG_MIN = 3;

function bigSmallDesc(bigMin){
  const big = [], small = [];
  for(let i=1;i<=MAX_HP;i++) (i >= bigMin ? big : small).push(i);
  return `獲勝者剩餘血格：大 = ${big.join('、')}　小 = ${small.join('、')}`;
}
function oddEvenDesc(){
  const odd = [], even = [];
  for(let i=1;i<=MAX_HP;i++) (i % 2 ? odd : even).push(i);
  return `獲勝者剩餘血格：單 = ${odd.join('、')}　雙 = ${even.join('、')}`;
}

// 回傳一場單挑要建立的三個盤口（純資料，方便測試與重用）
function buildMatchMarkets(opts){
  const matchNo = String(opts.matchNo || '').trim();
  const a = String(opts.playerA || '').trim();
  const b = String(opts.playerB || '').trim();
  const banker = String(opts.banker || '').trim();
  const priorK = (typeof opts.priorK === 'number' && opts.priorK > 0) ? opts.priorK : DEFAULT_PRIOR_K;
  const bigMin = (typeof opts.bigMin === 'number' && opts.bigMin >= 2 && opts.bigMin <= MAX_HP)
    ? opts.bigMin : DEFAULT_BIG_MIN;

  if(!matchNo) return { error:'請輸入賽事編號' };
  if(!a || !b) return { error:'請輸入兩位參賽玩家' };
  if(a === b)  return { error:'兩位參賽玩家不能相同' };
  if(!banker)  return { error:'請輸入莊家名字' };

  const base = { category:'binary', banker, matchNo, autoPrice:true, priorK,
                 locked:false, settled:false, winnerId:null };
  const pair = (l1, l2) => ({
    [uid()]: { label:l1, order:0, odds:DEFAULT_ODDS },
    [uid()]: { label:l2, order:1, odds:DEFAULT_ODDS },
  });

  return { markets: [
    { ...base, title:`第 ${matchNo} 場 · 誰獲勝`,
      desc:`${a} vs ${b}`, options: pair(a, b) },
    { ...base, title:`第 ${matchNo} 場 · 結束比分 大/小`,
      desc: bigSmallDesc(bigMin), options: pair('大', '小') },
    { ...base, title:`第 ${matchNo} 場 · 結束比分 單/雙`,
      desc: oddEvenDesc(), options: pair('單', '雙') },
  ]};
}

const CATEGORIES = [
  { key:'multi',   label:'多選項', hint:'從 16 人名單選，例如誰奪冠、誰最先淘汰' },
  { key:'binary',  label:'雙選項', hint:'兩個選項，例如單挑誰贏、單雙、大小' },
  { key:'special', label:'特殊盤口', hint:'自由設定選項' },
];
const CATEGORY_KEYS = CATEGORIES.map(c=>c.key);
function categoryLabel(key){
  const c = CATEGORIES.find(x=>x.key===key);
  return c ? c.label : key;
}

/* ---------- 小工具 ---------- */
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function fmt(n){ return Math.round(n || 0).toLocaleString('zh-Hant'); }
function uid(){ return Math.random().toString(36).slice(2,10); }

/* ---------- 播種 ----------
   不預建任何盤口：每個盤口都必須有莊家，預建只會產生佔位用的假莊家。
   莊家從後台開第一個盤。 */
function seed(){
  const players = {};
  for(let i=0;i<PLAYER_COUNT;i++) players[String(i)] = `選手${i+1}`;
  return { schema:3, maxBet:DEFAULT_MAX_BET, players };
}

// 賽事編號的排序鍵：數字就照數字比，非數字排在數字之後，沒編號的排最後
function matchSortKey(matchNo){
  if(matchNo == null) return Number.MAX_SAFE_INTEGER;
  const n = Number(matchNo);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER - 1;
}

/* ---------- 正規化 ----------
   Firebase 會把稠密的數字鍵物件變成陣列、丟掉空值，這裡一次補平。 */
function normalize(raw){
  raw = raw || {};

  const rawPlayers = raw.players || {};
  const players = [];
  for(let i=0;i<PLAYER_COUNT;i++){
    const v = Array.isArray(rawPlayers) ? rawPlayers[i] : rawPlayers[String(i)];
    players[i] = (typeof v === 'string' && v.trim()) ? v : `選手${i+1}`;
  }

  const markets = Object.entries(raw.markets || {}).map(([id,m])=>{
    m = m || {};
    const options = Object.entries(m.options || {}).map(([oid,o])=>({
      id: oid,
      label: (o && typeof o.label === 'string') ? o.label : null,
      order: (o && typeof o.order === 'number') ? o.order : 0,
      odds:  (o && typeof o.odds === 'number' && o.odds > 1) ? o.odds : DEFAULT_ODDS
    })).sort((a,b)=>a.order - b.order);
    return {
      id,
      title: m.title || '(未命名盤口)',
      desc: m.desc || '',
      category: CATEGORY_KEYS.includes(m.category) ? m.category : 'special',
      banker: (typeof m.banker === 'string' && m.banker.trim()) ? m.banker.trim() : '(未指定莊家)',
      matchNo: (m.matchNo != null && String(m.matchNo).trim()) ? String(m.matchNo).trim() : null,
      autoPrice: m.autoPrice !== false,
      priorK: (typeof m.priorK === 'number' && m.priorK > 0) ? m.priorK : DEFAULT_PRIOR_K,
      order: typeof m.order === 'number' ? m.order : 0,
      locked: !!m.locked,
      settled: !!m.settled,
      winnerId: m.winnerId || null,
      options
    };
  }).sort((a,b)=>{
    // 同一場單挑的三個盤要排在一起，沒有賽事編號的盤排在最後
    const ka = matchSortKey(a.matchNo), kb = matchSortKey(b.matchNo);
    if(ka !== kb) return ka - kb;
    return a.order - b.order || a.title.localeCompare(b.title);
  });

  const bets = Object.entries(raw.bets || {}).map(([id,b])=>({ id, ...(b||{}) }))
    .filter(b => b.marketId && b.optionId && typeof b.amount === 'number' && b.amount > 0)
    .sort((a,b)=>(a.ts||0)-(b.ts||0));

  const maxBet = (typeof raw.maxBet === 'number' && raw.maxBet > 0) ? raw.maxBet : DEFAULT_MAX_BET;

  return { schema: raw.schema || 3, maxBet, players, markets, bets };
}

/* ---------- 池額索引 ---------- */
function buildPools(st){
  const p = {};
  st.bets.forEach(b=>{
    const k = b.marketId + '|' + b.optionId;
    p[k] = (p[k] || 0) + b.amount;
  });
  return p;
}

/* ============================================================
   以下推導函式都吃 (state, pools) 而不是讀全域變數，
   這樣測試可以任意組場景，兩個頁面也不必共用同一份可變狀態。
   ============================================================ */

function poolOf(pools, marketId, optId){ return pools[marketId + '|' + optId] || 0; }
function marketTotal(pools, market){
  return market.options.reduce((s,o)=> s + poolOf(pools, market.id, o.id), 0);
}

// 多選項盤才用 16 人名單，批次結算只鎖定這一類
function usesPlayerRoster(market){ return market.category === 'multi'; }

function optionLabel(state, market, opt){
  if(!opt) return '—';
  if(/^p\d+$/.test(opt.id)){
    const idx = parseInt(opt.id.slice(1), 10);
    if(idx >= 0 && idx < PLAYER_COUNT) return state.players[idx] || opt.id;
  }
  return opt.label || opt.id;
}

// 每筆注單成立當下鎖住的賠率。莊家事後改價只影響之後的新注單，
// 不能回頭動已成立的注——否則莊家可以看完大家押哪邊再把賠率改低。
function betOdds(bet){
  return (typeof bet.oddsAtBet === 'number' && bet.oddsAtBet > 1) ? bet.oddsAtBet : DEFAULT_ODDS;
}

// 莊家開的那組初始賠率隱含的總機率。大於 1 才代表莊家有理論利潤空間。
function bookOverround(market){
  const sum = market.options.reduce((s,o)=> s + 1/o.odds, 0);
  return sum > 0 ? sum : 1;
}
function bookMargin(market){ return bookOverround(market) - 1; }

/* 自動定價 ------------------------------------------------------------
   把莊家開的初始賠率當成「先驗」，換算成虛擬注額 K×q 再和真實注額相加。
   錢押去哪邊，那邊的賠率就降、另一邊就升。

     q_i     = (1/初始賠率_i) / O
     賠率_i  = (K + S) / (O × (K×q_i + s_i))

   兩個性質：
   · 還沒有人下注時 (S=0) 算出來剛好等於莊家開的初始賠率
   · Σ(1/賠率_i) 恆等於 O，也就是不管錢怎麼流動，莊家的理論利潤率不變
   -------------------------------------------------------------------- */
function autoOdds(pools, market, optId){
  const opt = market.options.find(o=>o.id === optId);
  if(!opt) return DEFAULT_ODDS;
  const O = bookOverround(market);
  const K = market.priorK;
  const S = marketTotal(pools, market);
  const v = K * ((1/opt.odds) / O);
  const s = poolOf(pools, market.id, optId);
  const raw = (K + S) / (O * (v + s));
  return Math.min(MAX_AUTO_ODDS, Math.max(MIN_AUTO_ODDS, Math.round(raw * 100) / 100));
}

/* 一筆滿額注會把 2.00 的賠率推到哪裡 —— 讓莊家對「定價黏性」有體感。
   以最單純的兩選項、雙方都開 2.00（overround = 1）來估。 */
function maxBetImpact(priorK, maxBet){
  const K = Number(priorK), S = Number(maxBet);
  if(!(K > 0) || !(S > 0)) return null;
  const after = (K + S) / (K * 0.5 + S);
  return {
    after: Math.round(after * 100) / 100,
    dropPct: Math.round((1 - after / 2) * 1000) / 10   // 相對 2.00 掉了幾 %
  };
}

// 目前掛牌價
function liveOdds(pools, market, optId){
  const opt = market.options.find(o=>o.id === optId);
  const opening = opt ? opt.odds : DEFAULT_ODDS;
  return market.autoPrice
    ? { value: autoOdds(pools, market, optId), auto:true,  opening }
    : { value: opening,                        auto:false, opening };
}

// 如果某個選項開出，莊家的淨收益（正＝莊家賺，負＝莊家要賠）
function bankerNetIfWins(state, pools, market, optId){
  const staked = marketTotal(pools, market);
  const payout = state.bets
    .filter(b => b.marketId === market.id && b.optionId === optId)
    .reduce((s,b)=> s + b.amount * betOdds(b), 0);
  return staked - payout;
}

// 未結算盤口的最壞情況：所有可能結果中莊家淨收益最小的那個
function worstCase(state, pools, market){
  if(market.options.length === 0) return 0;
  return Math.min(...market.options.map(o => bankerNetIfWins(state, pools, market, o.id)));
}

// 結算結論。莊家盤不抽水，也沒有退款或作廢的概念：
// 每筆中獎注按自己鎖住的賠率派彩，莊家收下所有未中的注。
function settleInfo(state, pools, market){
  const total = marketTotal(pools, market);
  const payoutTotal = state.bets
    .filter(b => b.marketId === market.id && b.optionId === market.winnerId)
    .reduce((s,b)=> s + b.amount * betOdds(b), 0);
  return {
    total,
    payoutTotal,
    bankerNet: total - payoutTotal,
    winPool: market.winnerId ? poolOf(pools, market.id, market.winnerId) : 0,
    empty: total <= 0
  };
}

// 單一注單的結果
function betOutcome(state, pools, bet){
  const market = state.markets.find(m => m.id === bet.marketId);
  if(!market)         return { status:'gone',    label:'盤口已刪除', payout:0, profit:0 };
  if(!market.settled) return { status:'pending', label:'待開',       payout:0, profit:0, market };
  if(bet.optionId !== market.winnerId){
    return { status:'lose', label:'未中', payout:0, profit:-bet.amount, market };
  }
  const payout = Math.round(bet.amount * betOdds(bet));
  return { status:'win', label:'中獎', payout, profit: payout - bet.amount, market };
}

/* ---------- 下注金額驗證（兩頁共用同一套規則） ---------- */
function validateBetAmount(raw, maxBet){
  const amount = Math.floor(parseFloat(raw));
  if(!amount || amount <= 0 || !isFinite(amount)){
    return { ok:false, reason:'請輸入正整數金額' };
  }
  if(amount > maxBet){
    return { ok:false, reason:`單筆上限 $${fmt(maxBet)}，請分次下注` };
  }
  return { ok:true, amount };
}

/* ============================================================
   後台報表：全部即時從帳本推導
   ============================================================ */

// by 玩家
function reportByBettor(state, pools){
  const rows = {};
  state.bets.forEach(b=>{
    const key = b.bettorId || b.name;
    if(!rows[key]) rows[key] = { key, name:b.name, bets:0, staked:0, settledProfit:0, pending:0 };
    const r = rows[key];
    r.name = b.name;                    // 以最新一筆的暱稱為準
    r.bets++;
    r.staked += b.amount;
    const o = betOutcome(state, pools, b);
    if(o.status === 'pending') r.pending += b.amount;
    else r.settledProfit += o.profit;
  });
  return Object.values(rows)
    .map(r => ({ ...r, bankerNet: -r.settledProfit }))   // 莊家的收益是玩家損益的反面
    .sort((a,b)=> b.staked - a.staked);
}

// by 盤口類型
function reportByCategory(state, pools){
  return CATEGORIES.map(c=>{
    const markets = state.markets.filter(m=>m.category === c.key);
    const ids = new Set(markets.map(m=>m.id));
    const bets = state.bets.filter(b=>ids.has(b.marketId));
    const staked = bets.reduce((s,b)=>s+b.amount, 0);
    const bankerNet = markets
      .filter(m=>m.settled)
      .reduce((s,m)=> s + settleInfo(state, pools, m).bankerNet, 0);
    return {
      key: c.key, label: c.label,
      markets: markets.length,
      settled: markets.filter(m=>m.settled).length,
      bets: bets.length,
      staked,
      avgBet: bets.length ? staked / bets.length : 0,
      bankerNet
    };
  });
}

// by 時間（bucketMinutes 分鐘一格）
function reportByTime(state, bucketMinutes){
  const ms = bucketMinutes * 60 * 1000;
  const buckets = {};
  state.bets.forEach(b=>{
    const t = Math.floor((b.ts || 0) / ms) * ms;
    if(!buckets[t]) buckets[t] = { t, bets:0, staked:0 };
    buckets[t].bets++;
    buckets[t].staked += b.amount;
  });
  let cum = 0;
  return Object.values(buckets)
    .sort((a,b)=>a.t - b.t)
    .map(r => { cum += r.staked; return { ...r, cumulative: cum }; });
}

// 全場莊家曝險：各盤最壞情況的加總（未結算盤）＋ 已結算盤的實際淨收益
function bankerExposure(state, pools){
  let settledNet = 0, worstOpen = 0, staked = 0;
  state.markets.forEach(m=>{
    staked += marketTotal(pools, m);
    if(m.settled) settledNet += settleInfo(state, pools, m).bankerNet;
    else          worstOpen  += worstCase(state, pools, m);
  });
  return { settledNet, worstOpen, staked, worstTotal: settledNet + worstOpen };
}

/* ---------- 匯出給瀏覽器與測試 ---------- */
if(typeof module !== 'undefined' && module.exports){
  module.exports = {
    DB_PATH, PLAYER_COUNT, DEFAULT_ODDS, DEFAULT_PRIOR_K, DEFAULT_MAX_BET,
    MAX_AUTO_ODDS, MIN_AUTO_ODDS, QUICK_AMOUNTS, DICE_PIPS,
    CATEGORIES, CATEGORY_KEYS, categoryLabel,
    MAX_HP, DEFAULT_BIG_MIN, bigSmallDesc, oddEvenDesc, buildMatchMarkets, matchSortKey,
    esc, fmt, uid, seed, normalize, buildPools,
    poolOf, marketTotal, usesPlayerRoster, optionLabel, betOdds,
    bookOverround, bookMargin, autoOdds, liveOdds, maxBetImpact,
    bankerNetIfWins, worstCase, settleInfo, betOutcome, validateBetAmount,
    reportByBettor, reportByCategory, reportByTime, bankerExposure
  };
}
