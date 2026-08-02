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
/* 單挑盤的定價策略 ----------------------------------------------------
   關鍵認知：自動調價把「錢流」當成「資訊」。錢帶有資訊時它保護莊家，
   錢只是隨機噪音時它反而害莊家——因為它會把冷門那邊的賠率推到公平值以上。

   實測：真實 50/50 的盤，兩邊各押一筆 $5,000、黏性 20,000，
   莊家期望是 −400。黏性拉到 200,000 才變成 +625。

   所以依「錢有沒有資訊」分開處理：

   · 大小 / 單雙 —— 血格分布是從賽制算出來的，沒有人比公式更懂，
     錢流不帶資訊。用固定賠率（關掉自動調價），莊家穩拿開價時的水。
   · 誰獲勝 —— 我不知道兩位選手的相對強弱，但下注的人知道，錢流帶資訊。
     保留自動調價，但黏性要高，避免被隨機的錢推歪。
   · 總冠軍盤 —— 大家知道上屆前四是誰，錢流帶資訊，維持自動調價。
   -------------------------------------------------------------------- */
const MATCH_OVERROUND       = 1.10;    // 誰獲勝、以及無道具場次的大小單雙
const MATCH_OVERROUND_ITEMS = 1.20;    // 有道具卡的場次：血格分布不確定，加厚緩衝
const DUEL_PRIOR_K          = 100000;  // 誰獲勝的預設黏性（高，抗隨機噪音）
const DUEL_MAX_LIABILITY    = 10000;   // 每個單挑盤的預設曝險上限

/* 獲勝者剩餘血格的機率分布 ------------------------------------------
   假設雙方實力相當、每手 50/50、每次輸掉一格。比賽打到一方歸零為止，
   所以這是負二項分布：敗方剛好累積 MAX_HP 次失血，勝方失血 j 次。

     P(勝方剩 MAX_HP − j) = C(MAX_HP−1+j, j) × (1/2)^(MAX_HP−1+j)

   結果是「險勝」比「完勝」常見得多——剩 1 格的機率是剩 5 格的 4.4 倍。
   所以大/小、單/雙本來就不是五五波，用 2.00 開價會被玩家吃掉。
   -------------------------------------------------------------------- */
function hpDistribution(){
  const comb = (n,k)=>{ let r=1; for(let i=0;i<k;i++) r = r*(n-i)/(i+1); return r; };
  const out = [];
  for(let j=0;j<MAX_HP;j++){
    out.push({ hp: MAX_HP - j, p: comb(MAX_HP-1+j, j) * Math.pow(0.5, MAX_HP-1+j) });
  }
  return out.sort((a,b)=>a.hp-b.hp);
}
function bigSmallProbs(bigMin){
  const d = hpDistribution();
  const big = d.filter(x=>x.hp >= bigMin).reduce((s,x)=>s+x.p, 0);
  return { big, small: 1 - big };
}
function oddEvenProbs(){
  const d = hpDistribution();
  const odd = d.filter(x=>x.hp % 2 === 1).reduce((s,x)=>s+x.p, 0);
  return { odd, even: 1 - odd };
}
// 由機率換算成含莊家水錢的賠率
function oddsFromProb(p, overround){
  const O = (Number(overround) > 0) ? Number(overround) : MATCH_OVERROUND;
  if(!(p > 0)) return MAX_AUTO_ODDS;
  return Math.max(1.01, Math.round((1 / (p * O)) * 100) / 100);
}

const pct = p => (p*100).toFixed(1) + '%';

function bigSmallDesc(bigMin){
  const big = [], small = [];
  for(let i=1;i<=MAX_HP;i++) (i >= bigMin ? big : small).push(i);
  const pr = bigSmallProbs(bigMin);
  return `獲勝者剩餘血格：大 = ${big.join('、')}　小 = ${small.join('、')}`
       + `（實力相當時 大 ${pct(pr.big)} / 小 ${pct(pr.small)}）`;
}
function oddEvenDesc(){
  const odd = [], even = [];
  for(let i=1;i<=MAX_HP;i++) (i % 2 ? odd : even).push(i);
  const pr = oddEvenProbs();
  return `獲勝者剩餘血格：單 = ${odd.join('、')}　雙 = ${even.join('、')}`
       + `（實力相當時 單 ${pct(pr.odd)} / 雙 ${pct(pr.even)}）`;
}

// 下一個賽事編號：現有數字編號的最大值 + 1
function nextMatchNo(state){
  const nums = (state.markets || [])
    .map(m => Number(m.matchNo))
    .filter(n => Number.isFinite(n) && n > 0);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

/* 回傳一場單挑要建立的三個盤口（純資料，方便測試與重用）

   兩位參賽者用**玩家名單的索引**指定，不是打字輸入 —— 選項 id 因此是 p<i>，
   之後在後台改名單，所有場次的盤口標籤都會跟著同步。

   賠率依「雙方實力相當」的機率分布計算，不是一律 2.00：
   誰獲勝 50/50，大小與單雙則依 hpDistribution() 推導。 */
function buildMatchMarkets(opts){
  const matchNo = String(opts.matchNo || '').trim();
  const ai = Number(opts.playerAIndex);
  const bi = Number(opts.playerBIndex);
  const banker = String(opts.banker || '').trim();
  const priorK = (typeof opts.priorK === 'number' && opts.priorK > 0) ? opts.priorK : DUEL_PRIOR_K;
  const bigMin = (typeof opts.bigMin === 'number' && opts.bigMin >= 2 && opts.bigMin <= MAX_HP)
    ? opts.bigMin : DEFAULT_BIG_MIN;
  const items = !!opts.items;
  // 誰獲勝用標準水錢；大小單雙在有道具的場次加厚緩衝（血格分布不確定）
  const overround = (typeof opts.overround === 'number' && opts.overround > 1)
    ? opts.overround : MATCH_OVERROUND;
  const scoreOverround = items ? MATCH_OVERROUND_ITEMS : overround;

  const validIdx = i => Number.isInteger(i) && i >= 0 && i < PLAYER_COUNT;
  if(!matchNo)                    return { error:'缺少賽事編號' };
  if(!validIdx(ai) || !validIdx(bi)) return { error:'請選擇兩位參賽玩家' };
  if(ai === bi)                   return { error:'兩位參賽玩家不能相同' };
  if(!banker)                     return { error:'請輸入莊家名字' };

  const maxLiability = (typeof opts.maxLiability === 'number' && opts.maxLiability > 0)
    ? opts.maxLiability : DUEL_MAX_LIABILITY;
  const base = { category:'binary', banker, matchNo, maxLiability,
                 locked:false, settled:false, winnerId:null };
  const bs = bigSmallProbs(bigMin);
  const oe = oddEvenProbs();
  const itemNote = items ? '　※ 這場有道具卡，血格分布會偏移，已加厚水錢緩衝' : '';

  return { markets: [
    // 誰獲勝：我不知道兩人強弱，讓錢流去修正 → 自動調價，高黏性
    { ...base, autoPrice:true, priorK,
      title:`第 ${matchNo} 場 · 誰獲勝`,
      desc:`開價假設雙方實力相當（各 50.0%），會依下注情況自動調整`,
      options: {
        ['p'+ai]: { order:0, odds: oddsFromProb(0.5, overround) },
        ['p'+bi]: { order:1, odds: oddsFromProb(0.5, overround) },
      }},
    // 大小 / 單雙：分布是算出來的，錢流不帶資訊 → 固定賠率
    { ...base, autoPrice:false, priorK,
      title:`第 ${matchNo} 場 · 結束比分 大/小`,
      desc: bigSmallDesc(bigMin) + itemNote,
      options: {
        [uid()]: { label:'大', order:0, odds: oddsFromProb(bs.big,   scoreOverround) },
        [uid()]: { label:'小', order:1, odds: oddsFromProb(bs.small, scoreOverround) },
      }},
    { ...base, autoPrice:false, priorK,
      title:`第 ${matchNo} 場 · 結束比分 單/雙`,
      desc: oddEvenDesc() + itemNote,
      options: {
        [uid()]: { label:'單', order:0, odds: oddsFromProb(oe.odd,  scoreOverround) },
        [uid()]: { label:'雙', order:1, odds: oddsFromProb(oe.even, scoreOverround) },
      }},
  ]};
}

/* ============================================================
   第二屆賽制：雙敗淘汰，21 場
   ------------------------------------------------------------
   編號沿用主辦方的格式（1-1、3-5、4-4…），開盤時直接從這裡挑，
   賽事編號才會跟看板一致。

   format 'table4' = 四人桌（取前 2 晉級）
   format 'duel'   = 單挑 1v1
   items  true     = 有道具卡（會改變獲勝者剩餘血格的分布）
   ============================================================ */
const PRIZE_SPLIT = { first:0.60, second:0.30, third:0.10 };

const BRACKET = [
  { stage:1, title:'第一階段 · 常規四人桌', note:'可跳抓，跳抓時輸贏加倍；喊牌較上家大於兩顆時可選擇迴轉。',
    matches:[
      { id:'1-1', side:'W', name:'勝部 A 桌', format:'table4', from:'抽籤分組',
        win:'前 2 晉級勝部第二階段', lose:'後 2 掉入敗部' },
      { id:'1-2', side:'W', name:'勝部 B 桌', format:'table4', from:'抽籤分組',
        win:'前 2 晉級勝部第二階段', lose:'後 2 掉入敗部' },
      { id:'1-3', side:'W', name:'勝部 C 桌', format:'table4', from:'抽籤分組',
        win:'前 2 晉級勝部第二階段', lose:'後 2 掉入敗部' },
      { id:'1-4', side:'W', name:'勝部 D 桌', format:'table4', from:'抽籤分組',
        win:'前 2 晉級勝部第二階段', lose:'後 2 掉入敗部' },
      { id:'1-5', side:'L', name:'敗部 A 桌', format:'table4', from:'1-1、1-2 的敗者',
        win:'前 2 復活', lose:'後 2 永久淘汰' },
      { id:'1-6', side:'L', name:'敗部 B 桌', format:'table4', from:'1-3、1-4 的敗者',
        win:'前 2 復活', lose:'後 2 永久淘汰' },
    ],
    after:'勝部 8 人、敗部生還 4 人' },

  { stage:2, title:'第二階段 · 反向揭露四人桌', note:'看得到別人的骰子、看不到自己的；不可跳抓；每次最多加喊上家 +2 顆（喊飛不限）。',
    matches:[
      { id:'2-1', side:'W', name:'勝部 8 強 A 桌', format:'table4', from:'第一階段勝部晉級者',
        win:'前 2 晉級勝部第三階段', lose:'後 2 掉入敗部' },
      { id:'2-2', side:'W', name:'勝部 8 強 B 桌', format:'table4', from:'第一階段勝部晉級者',
        win:'前 2 晉級勝部第三階段', lose:'後 2 掉入敗部' },
      { id:'2-3', side:'L', name:'敗部反向 A 桌', format:'table4', from:'勝部掉下的 4 人 + 敗部生還的 4 人',
        win:'前 2 復活', lose:'後 2 永久淘汰' },
      { id:'2-4', side:'L', name:'敗部反向 B 桌', format:'table4', from:'勝部掉下的 4 人 + 敗部生還的 4 人',
        win:'前 2 復活', lose:'後 2 永久淘汰' },
    ],
    after:'勝部 4 人、敗部生還 4 人' },

  { stage:3, title:'第三階段 · 單挑無道具桌', note:'可喊哉；含 1 的天牌算六顆、不含 1 的天牌算七顆。無道具卡。',
    matches:[
      { id:'3-1', side:'W', name:'勝部 4 強單挑 A', format:'duel', from:'第二階段勝部晉級者',
        win:'晉級勝部決賽 4-1', lose:'掉入敗部' },
      { id:'3-2', side:'W', name:'勝部 4 強單挑 B', format:'duel', from:'第二階段勝部晉級者',
        win:'晉級勝部決賽 4-1', lose:'掉入敗部' },
      { id:'3-3', side:'L', name:'敗部單挑 A（自相殘殺）', format:'duel', from:'2-3、2-4 生還者',
        win:'晉級 3-5', lose:'永久淘汰' },
      { id:'3-4', side:'L', name:'敗部單挑 B（自相殘殺）', format:'duel', from:'2-3、2-4 生還者',
        win:'晉級 3-6', lose:'永久淘汰' },
      { id:'3-5', side:'L', name:'敗部單挑 C（迎戰降級者）', format:'duel', from:'3-1 敗者 vs 3-3 勝者',
        win:'晉級 4-2', lose:'永久淘汰' },
      { id:'3-6', side:'L', name:'敗部單挑 D（迎戰降級者）', format:'duel', from:'3-2 敗者 vs 3-4 勝者',
        win:'晉級 4-2', lose:'永久淘汰' },
    ],
    after:'勝部 2 人、敗部生還 2 人' },

  { stage:4, title:'第四階段 · 單挑道具桌', note:'每人三張道具卡（A 重骰 / K 看牌 / Q 調骰），各限用一次，同一手牌只能用一張。',
    matches:[
      { id:'4-1', side:'W', name:'勝部冠軍戰', format:'duel', items:true, from:'3-1、3-2 勝者',
        win:'直接晉級總冠軍賽 4-4', lose:'掉入敗部，爭奪季軍 4-3' },
      { id:'4-2', side:'L', name:'敗部準決賽（泡沫戰）', format:'duel', items:true, from:'3-5、3-6 勝者',
        win:'保底前三名，進入錢圈', lose:'第四名 —— 最後一個無法進錢圈的泡沫' },
      { id:'4-3', side:'L', name:'季軍戰', format:'duel', items:true, from:'4-1 敗者 vs 4-2 勝者',
        win:'敗部冠軍，晉級總冠軍賽', lose:'季軍，獲得獎池 10%' },
      { id:'4-4', side:'F', name:'總冠軍戰 第一場', format:'duel', items:true, from:'勝部冠軍 vs 敗部冠軍',
        win:'勝部冠軍贏 → 比賽結束奪冠', lose:'敗部冠軍贏 → 進入 Bracket Reset，打 4-5' },
      { id:'4-5', side:'F', name:'總冠軍戰 第二場（Bracket Reset）', format:'duel', items:true,
        from:'僅在 4-4 由敗部冠軍獲勝時舉行',
        win:'勝者即為總冠軍', lose:'敗者為亞軍' },
    ],
    after:'冠軍 60% / 亞軍 30% / 季軍 10%' },
];

const SIDE_LABEL = { W:'勝部', L:'敗部', F:'總決賽' };

// 攤平成一維，方便查找
function allBracketMatches(){
  return BRACKET.flatMap(s => s.matches.map(m => ({ ...m, stage:s.stage, stageTitle:s.title })));
}
function bracketMatch(id){
  return allBracketMatches().find(m => m.id === id) || null;
}
// 只有單挑場次適用「獲勝者剩餘血格」的大小／單雙盤
function duelMatches(){ return allBracketMatches().filter(m => m.format === 'duel'); }

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
      // 這盤自己的單筆上限；null 表示沿用全域設定
      maxBet: (typeof m.maxBet === 'number' && m.maxBet > 0) ? m.maxBet : null,
      // 單一選項的莊家賠付上限；null 表示不限制
      maxLiability: (typeof m.maxLiability === 'number' && m.maxLiability > 0) ? m.maxLiability : null,
      // 每人在這盤的下注總額上限；null 表示不限制
      maxPerBettor: (typeof m.maxPerBettor === 'number' && m.maxPerBettor > 0) ? m.maxPerBettor : null,
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

/* 一筆滿額注會把賠率推到哪裡 —— 讓莊家對「定價黏性」有體感。
   以 n 個等價選項來估（overround = 1，所以每個選項的起始賠率就是 n）。

   選項數很重要：先驗權重是 K/n，16 人盤每個選項分到的權重只有兩選項盤的 1/8，
   同樣的黏性下價格會敏感得多。只用兩選項估會嚴重低估 16 人盤的波動。 */
function maxBetImpact(priorK, maxBet, optionCount){
  const K = Number(priorK), S = Number(maxBet);
  const n = (Number(optionCount) >= 2) ? Math.floor(Number(optionCount)) : 2;
  if(!(K > 0) || !(S > 0)) return null;
  const before = n;
  const after = (K + S) / (K / n + S);
  return {
    optionCount: n,
    before,
    after: Math.round(after * 100) / 100,
    dropPct: Math.round((1 - after / before) * 1000) / 10
  };
}

// 想讓一筆滿額注的移動不超過 targetDrop（例如 0.2 ＝ 20%）時，黏性至少要多少
function suggestPriorK(maxBet, optionCount, targetDrop){
  const S = Number(maxBet);
  const n = (Number(optionCount) >= 2) ? Math.floor(Number(optionCount)) : 2;
  const d = (Number(targetDrop) > 0 && Number(targetDrop) < 1) ? Number(targetDrop) : 0.2;
  // 解 (K+S)/(K/n+S) = n(1-d)  →  K(1 - (1-d)) = S(n(1-d) - 1)
  const K = S * (n * (1 - d) - 1) / d;
  return K > 0 ? Math.ceil(K / 1000) * 1000 : null;
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

/* ---------- 下注驗證（兩頁共用同一套規則） ---------- */

// 這盤實際適用的單筆上限：盤口自己有設就用自己的，否則沿用全域
function effectiveMaxBet(state, market){
  return (market && market.maxBet) ? market.maxBet : state.maxBet;
}

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

/* 單一選項曝險上限 --------------------------------------------------
   莊家最怕的不是賠率高，是「錢全部集中在同一個選項」。
   這裡在下注前先試算：如果這筆注成立、而且該選項開出，莊家要賠多少。
   超過該盤設定的上限就擋下這一筆，其他選項不受影響照常開放。
   ------------------------------------------------------------------ */
function liabilityIfBetPlaced(state, pools, market, optId, amount, oddsAtBet){
  const staked = marketTotal(pools, market) + amount;
  const payout = state.bets
    .filter(b => b.marketId === market.id && b.optionId === optId)
    .reduce((s,b)=> s + b.amount * betOdds(b), 0) + amount * oddsAtBet;
  return staked - payout;   // 負值＝莊家要賠
}

function checkLiability(state, pools, market, optId, amount, oddsAtBet){
  if(!market.maxLiability) return { ok:true };
  const net = liabilityIfBetPlaced(state, pools, market, optId, amount, oddsAtBet);
  if(-net > market.maxLiability){
    const current = bankerNetIfWins(state, pools, market, optId);
    const room = market.maxLiability + current;   // current 是負的
    return {
      ok: false,
      reason: room > 0
        ? `這個選項已接近莊家承受上限，最多還能再押 $${fmt(Math.floor(room / Math.max(oddsAtBet - 1, 0.01)))}`
        : `這個選項已達莊家承受上限，請改押其他選項`,
      room
    };
  }
  return { ok:true };
}

/* 禁止下注的身分 ----------------------------------------------------
   兩條規則，都是自動判斷，不需要手動維護名單：

   1. 該盤標記的莊家不能在自己的盤上下注（他是對手方）
   2. 選手不能押自己參賽的場次 —— 押自己的比賽有放水疑慮

   第 2 條靠「下注暱稱與 16 人名單同名」認人，所以參賽者要用真名當暱稱。
   只擋他參賽的那個賽事編號底下的盤（誰獲勝、大小、單雙），
   別人的場次與總冠軍盤照常可以下注。
   ------------------------------------------------------------------ */
const norm = s => String(s || '').trim().toLowerCase();

// 這個暱稱對應到第幾位選手；不是選手回 -1
function playerIndexByName(state, name){
  const nm = norm(name);
  if(!nm) return -1;
  return state.players.findIndex(p => norm(p) === nm);
}

// 這位選手參賽的所有賽事編號
function matchNosOfPlayer(state, playerIndex){
  if(playerIndex < 0) return [];
  const optId = 'p' + playerIndex;
  const set = new Set();
  state.markets.forEach(m=>{
    if(m.matchNo && m.options.some(o => o.id === optId)) set.add(m.matchNo);
  });
  return [...set];
}

function isBannedBettor(state, market, name){
  const nm = norm(name);
  if(!nm) return null;

  if(market && norm(market.banker) === nm){
    return { banned:true, reason:'你是這盤的莊家，不能在自己的盤上下注' };
  }

  const idx = playerIndexByName(state, name);
  if(idx >= 0 && market && market.matchNo){
    if(matchNosOfPlayer(state, idx).includes(market.matchNo)){
      return { banned:true, reason:`你是第 ${market.matchNo} 場的參賽者，不能押自己的場次` };
    }
  }
  return null;
}

/* 每人限額 ----------------------------------------------------------
   身分同時比對 bettorId（裝置）與暱稱，任一相符就算同一個人——
   換裝置但用同名字、或同裝置改名字，兩種繞法都會被算進去。

   這是「防止一個人把額度吃光」的軟性限制，不是嚴格的身分驗證：
   資料庫是開放的，真要繞還是繞得過（換裝置又改名字）。跟整個專案的
   信任制假設一致。
   ------------------------------------------------------------------ */
function bettorStakeOn(state, marketId, bettorId, name){
  const nm = String(name || '').trim();
  return state.bets
    .filter(b => b.marketId === marketId &&
                 (b.bettorId === bettorId || (nm && String(b.name || '').trim() === nm)))
    .reduce((s,b)=> s + b.amount, 0);
}

function checkPerBettor(state, market, bettorId, name, amount){
  if(!market.maxPerBettor) return { ok:true };
  const already = bettorStakeOn(state, market.id, bettorId, name);
  const room = market.maxPerBettor - already;
  if(amount > room){
    return {
      ok: false,
      reason: room > 0
        ? `這盤每人上限 $${fmt(market.maxPerBettor)}，你已下 $${fmt(already)}，最多還能押 $${fmt(room)}`
        : `這盤每人上限 $${fmt(market.maxPerBettor)}，你已經押滿了`,
      room
    };
  }
  return { ok:true };
}

// 盤口整體的曝險使用率（給後台顯示進度用）
function liabilityUsage(state, pools, market){
  if(!market.maxLiability) return null;
  const worst = worstCase(state, pools, market);
  return {
    used: Math.max(0, -worst),
    cap: market.maxLiability,
    pct: Math.min(100, Math.round(Math.max(0, -worst) / market.maxLiability * 100))
  };
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
    PRIZE_SPLIT, BRACKET, SIDE_LABEL, allBracketMatches, bracketMatch, duelMatches,
    MAX_HP, DEFAULT_BIG_MIN, MATCH_OVERROUND, MATCH_OVERROUND_ITEMS,
    DUEL_PRIOR_K, DUEL_MAX_LIABILITY, bigSmallDesc, oddEvenDesc,
    hpDistribution, bigSmallProbs, oddEvenProbs, oddsFromProb,
    buildMatchMarkets, matchSortKey, nextMatchNo,
    esc, fmt, uid, seed, normalize, buildPools,
    poolOf, marketTotal, usesPlayerRoster, optionLabel, betOdds,
    bookOverround, bookMargin, autoOdds, liveOdds, maxBetImpact, suggestPriorK,
    bankerNetIfWins, worstCase, settleInfo, betOutcome,
    effectiveMaxBet, validateBetAmount, liabilityIfBetPlaced, checkLiability, liabilityUsage,
    bettorStakeOn, checkPerBettor, isBannedBettor, playerIndexByName, matchNosOfPlayer,
    reportByBettor, reportByCategory, reportByTime, bankerExposure
  };
}
