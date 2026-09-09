/* 在真實 DOM（jsdom）裡載入兩個頁面並操作。
   只測邏輯會漏掉「畫面其實沒渲染出來」「按鈕沒接上」這類問題 ——
   第二屆就踩過舊 localStorage 值讓整頁空白卻沒有任何錯誤的狀況。 */
const fs = require('fs');
const path = require('path');

let JSDOM, VirtualConsole;
try{
  ({ JSDOM, VirtualConsole } = require('jsdom'));
}catch(e){
  console.log('  -- 找不到 jsdom，跳過 DOM 測試。安裝：npm install --no-save jsdom');
  process.exit(0);
}

const DIR = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, l)=>{ if(c){ pass++; } else { fail++; console.log('  ✗ ' + l); } };
const section = t => console.log('\n── ' + t + ' ──');

/* 假的 Firebase：回固定資料，記下所有寫入 */
function makeFirebase(data, writes){
  const at = p => p.split('/').filter(Boolean).reduce((o, k)=> (o == null ? undefined : o[k]), data);
  const ref = p => ({
    on(ev, cb){ if(ev === 'value') cb({ val:()=>at(p), exists:()=>at(p) != null }); return cb; },
    once(){ return Promise.resolve({ val:()=>at(p), exists:()=>at(p) != null }); },
    set(v){ writes.push({ op:'set', path:p, value:v }); return Promise.resolve(); },
    update(v){ writes.push({ op:'update', path:p, value:v }); return Promise.resolve(); },
    push(v){ writes.push({ op:'push', path:p, value:v }); return Promise.resolve({ name:'k' }); },
    remove(){ writes.push({ op:'remove', path:p }); return Promise.resolve(); },
    transaction(){ return Promise.resolve(); },
  });
  return { initializeApp(){}, database(){ return { ref }; } };
}

async function load(file, { storage = {}, data, confirmAnswer = true } = {}){
  let html = fs.readFileSync(path.join(DIR, file), 'utf8');
  const appJs = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
  // app.js 要當成真的 <script> 執行，才會和 inline script 共用全域語彙環境
  html = html
    .replace(/<script src="https:\/\/www\.gstatic\.com[^"]*"><\/script>/g, '')
    .replace('<script src="app.js"></script>', `<script>${appJs}</script>`);

  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(String((e && e.message) || e)));

  const writes = [], confirms = [];
  const dom = new JSDOM(html, {
    runScripts:'dangerously', virtualConsole:vc, url:'https://example.com/' + file,
    beforeParse(w){
      w.firebase = makeFirebase(data, writes);
      w.confirm = m => { confirms.push(m); return confirmAnswer; };
      w.alert = ()=>{};
      w.URL.createObjectURL = ()=> 'blob:x';
      w.URL.revokeObjectURL = ()=>{};
      Object.keys(storage).forEach(k => w.localStorage.setItem(k, storage[k]));
    },
  });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 120));
  // body.textContent 會包含 <script> 原始碼，拿來比對會誤判
  const text = ()=>{
    const c = w.document.body.cloneNode(true);
    c.querySelectorAll('script, style').forEach(n => n.remove());
    return c.textContent;
  };
  return { w, doc:w.document, errors, writes, confirms, text };
}

/* ---------- 測試資料：五個賽前盤 + 3-1 三個盤 ---------- */
const A = require('../app.js');
const players = {};
for(let i = 0; i < 16; i++) players[String(i)] = '選手' + (i + 1);

function toDbShape(list){
  const out = {};
  list.forEach((m, i)=>{ out['m' + i] = m; });
  return out;
}
function makeData(overrides){
  const markets = toDbShape(
    A.buildPreMarkets({ banker:'莊家' }).markets
      .concat(A.buildAllDuelMarkets({ banker:'莊家' }).markets)
  );
  return { [A.DB_PATH]: Object.assign({ schema:3, maxBet:5000, players, markets }, overrides || {}) };
}

(async ()=>{

/* ============================================================ */
section('玩家頁');
{
  const p = await load('index.html', { data: makeData() });
  ok(p.errors.length === 0, `載入無錯誤${p.errors.length ? '：' + p.errors[0] : ''}`);
  const t = p.text();
  ok(t.includes(A.TOURNAMENT_NAME), `抬頭顯示屆數（${A.TOURNAMENT_NAME}）`);
  ok(t.includes('最後總冠軍'), '看得到最後總冠軍盤');
  ok(t.includes('Bubble Guy'), '看得到 Bubble Guy 盤');
  ok(t.includes('賽前盤'), '有賽前盤分類');
  ok(t.includes('第三階段'), '有第三階段分類');
  ok(t.includes('第四階段'), '有第四階段分類');
  // 玩家頁不能洩漏真實機率
  ok(!/45\.3|54\.7|33\.4|66\.6|真實機率/.test(t), '★ 玩家頁沒有揭露任何真實機率');
  ok(p.doc.querySelectorAll('.market-card').length > 0, '有渲染出盤口卡');
}

section('待定盤不可下注（第三屆修的 bug）');
{
  // 誰獲勝盤刻意設成「待定但沒封盤」—— 還原配置曾經留下這個狀態
  const data = makeData();
  const ms = data[A.DB_PATH].markets;
  const winKey = Object.keys(ms).find(k => ms[k].pendingPlayers);
  ok(!!winKey, '測試資料裡有待定的誰獲勝盤');
  ms[winKey].locked = false;                     // 只解封、仍待定
  const p = await load('index.html', { data });
  ok(p.errors.length === 0, '載入無錯誤');
  const card = p.doc.querySelector(`.market-card`);
  ok(!!card, '盤口有渲染');
  // 找出那張待定盤的卡：它的橫幅寫「對戰組合還沒確定」
  const cards = [...p.doc.querySelectorAll('.market-card')]
    .filter(c => c.textContent.includes('對戰組合還沒確定'));
  ok(cards.length > 0, '待定盤顯示「對戰組合還沒確定」橫幅');
  const anyForm = cards.some(c => c.querySelector('.bet-form'));
  ok(!anyForm, '★ 待定盤即使沒封盤也不出現下注框');
  ok(p.text().includes('待定'), '標題有「待定」標記');
}

section('參賽者只能押自己獲勝');
{
  // 名單填成「真名+編號」，3-1 指定 阿龍11(p0) vs 保羅12(p1)
  const names = {};
  ['阿龍11','保羅12','小梅2','國國9','老林5','Gary6','葉師傅7','吳杰8',
   '小高10','Jimer1','小V3','偉恩13','小葉14','偉傑15','阿傑16','淑明4']
    .forEach((p, i)=>{ names[i] = p; });
  const data = { [A.DB_PATH]: { schema:3, maxBet:5000, players:names, markets:{
    w:{ title:'3-1 · 誰獲勝', category:'binary', matchNo:'3-1', banker:'莊家', order:0,
        options:{ p0:{order:0, odds:1.95}, p1:{order:1, odds:1.95} } },
    b:{ title:'3-1 · 結束比分 大/小', category:'binary', matchNo:'3-1', banker:'莊家', order:1,
        options:{ x:{label:'大', order:0, odds:2.04}, y:{label:'小', order:1, odds:1.69} } },
    n:{ title:'3-2 · 誰獲勝', category:'binary', matchNo:'3-2', banker:'莊家', order:2,
        options:{ p2:{order:0, odds:1.95}, p3:{order:1, odds:1.95} } },
  } } };

  // 阿龍11 本人來下注
  const p = await load('index.html', { storage:{ 'dbp-name':'阿龍11' }, data });
  ok(p.errors.length === 0, `載入無錯誤${p.errors.length ? '：' + p.errors[0] : ''}`);

  const rowsOf = title => [...p.doc.querySelectorAll('.market-card')]
    .find(c => c.textContent.includes(title));
  const winCard = rowsOf('誰獲勝');
  ok(!!winCard, '看得到 3-1 誰獲勝盤');

  const optRows = [...winCard.querySelectorAll('.option-row')];
  ok(optRows.length === 2, '誰獲勝有兩個選項');
  const mine = optRows.find(r => r.textContent.includes('阿龍11'));
  const foe  = optRows.find(r => r.textContent.includes('保羅12'));
  ok(!!mine && !!foe, '兩個選項都讀到名單的真名');
  ok(!!mine.querySelector('.bet-form'), '★ 自己那一欄有下注框');
  ok(!foe.querySelector('.bet-form'),   '★ 對手那一欄沒有下注框');
  ok(!!foe.querySelector('.opt-ban'),   '★ 對手那一欄顯示禁押說明');
  ok(foe.textContent.includes('只能押自己獲勝'), '禁押說明講清楚原因');

  const bigCard = [...p.doc.querySelectorAll('.market-card')].find(c => c.textContent.includes('大/小'));
  ok(bigCard && bigCard.querySelectorAll('.bet-form').length === 0, '★ 自己場次的大小盤兩欄都不能押');
  ok(bigCard && bigCard.querySelectorAll('.opt-ban').length === 2, '大小盤兩欄都顯示禁押說明');

  // 全站共 6 個選項：3-1 誰獲勝 2 + 3-1 大小 2 + 3-2 誰獲勝 2
  ok(p.doc.querySelectorAll('.bet-form').length === 3,
     `★ 阿龍11 可押 3 欄：自己獲勝 + 3-2 兩欄（實得 ${p.doc.querySelectorAll('.bet-form').length}）`);
  ok(p.doc.querySelectorAll('.opt-ban').length === 3,
     '★ 被擋 3 欄：對手獲勝 + 自己場次的大小兩欄');
  ok(p.text().includes('只能押自己獲勝'), '身分列提示只能押自己獲勝');

  // 換成兩場都沒上場的人（老林5 是 p4，不在 3-1 也不在 3-2）
  const q = await load('index.html', { storage:{ 'dbp-name':'老林5' }, data });
  ok(q.doc.querySelectorAll('.bet-form').length === 6, '★ 非參賽者六個選項全部可押');
  ok(q.doc.querySelectorAll('.opt-ban').length === 0, '非參賽者沒有任何禁押提示');

  // 3-2 的參賽者：只能押自己那一欄，3-1 完全不受限
  const r = await load('index.html', { storage:{ 'dbp-name':'小梅2' }, data });
  ok(r.doc.querySelectorAll('.bet-form').length === 5,
     `★ 小梅2 可押 5 欄：3-1 全部 4 欄 + 3-2 自己 1 欄（實得 ${r.doc.querySelectorAll('.bet-form').length}）`);
  ok(r.doc.querySelectorAll('.opt-ban').length === 1, '只有 3-2 的對手那一欄被擋');
}

section('莊家頁');
{
  const p = await load('banker.html', { storage:{ 'dbp-banker-tab':'markets' }, data: makeData() });
  ok(p.errors.length === 0, `載入無錯誤${p.errors.length ? '：' + p.errors[0] : ''}`);
  const t = p.text();
  ok(t.includes(A.TOURNAMENT_NAME), '抬頭顯示屆數');
  ok(t.includes('38') || t.includes('都已開好'), '盤口已齊時顯示完成訊息');
  ok(!p.doc.getElementById('openAllBtn'), '盤口都在時不顯示建立按鈕');
}

section('一鍵建立全部盤口');
{
  // 空資料庫 → 應該提示要建 38 個
  const empty = { [A.DB_PATH]: { schema:3, maxBet:5000, players } };
  const p = await load('banker.html', { storage:{ 'dbp-banker-tab':'markets' }, data: empty });
  ok(p.errors.length === 0, '空資料庫載入無錯誤');
  const btn = p.doc.getElementById('openAllBtn');
  ok(!!btn, '顯示建立按鈕');
  ok(btn.textContent.includes('38'), `按鈕寫明 38 個盤（實際：${btn && btn.textContent.trim()}）`);
  const t = p.text();
  ok(t.includes('最後總冠軍') && t.includes('敗部冠軍'), '列出缺的賽前盤');
  ok(t.includes('3-1') && t.includes('4-5'), '列出缺的單挑場次');

  btn.click();
  await new Promise(r => setTimeout(r, 200));
  const pushes = p.writes.filter(x => x.op === 'push');
  ok(pushes.length === 38, `送出 38 次 push（實際 ${pushes.length}）`);
  const pre = pushes.filter(x => x.value.category === 'multi');
  ok(pre.length === 5, '其中 5 個是賽前盤');
  ok(pre.every(x => Object.keys(x.value.options).length === 16), '賽前盤各 16 個選項');
  ok(pre.every(x => x.value.maxBet === 1000 && x.value.maxPerBettor === 5000), '賽前盤上限正確');
  const wins = pushes.filter(x => x.value.title.includes('誰獲勝'));
  ok(wins.length === 11, '11 個誰獲勝盤');
  ok(wins.every(x => x.value.pendingPlayers === true && x.value.locked === true),
     '★ 誰獲勝一律待定 + 封盤');
  ok(p.confirms.some(m => m.includes('賽前盤') && m.includes('單挑')), '確認文字同時說明兩類');
}

section('只補缺的，不動已存在的');
{
  // 只有賽前盤存在 → 應該只補 33 個單挑盤
  const data = { [A.DB_PATH]: { schema:3, maxBet:5000, players,
    markets: toDbShape(A.buildPreMarkets({ banker:'莊家' }).markets) } };
  const p = await load('banker.html', { storage:{ 'dbp-banker-tab':'markets' }, data });
  const btn = p.doc.getElementById('openAllBtn');
  ok(btn && btn.textContent.includes('33'), `只缺 33 個（實際：${btn && btn.textContent.trim()}）`);
  btn.click();
  await new Promise(r => setTimeout(r, 200));
  const pushes = p.writes.filter(x => x.op === 'push');
  ok(pushes.length === 33, `只 push 33 次（實際 ${pushes.length}）`);
  ok(pushes.every(x => x.value.category !== 'multi'), '★ 已存在的賽前盤沒有被重複建立');
}

section('獨立重置面板');
{
  const p = await load('banker.html', { storage:{ 'dbp-banker-tab':'settings' }, data: makeData() });
  ok(p.errors.length === 0, '設定頁載入無錯誤');
  const t = p.text();
  ok(t.includes('獨立重置'), '有獨立重置區塊');
  ok(!!p.doc.getElementById('resetScope'), '有範圍選單');
  ok(!!p.doc.getElementById('snapBtn'), '有建立基準點按鈕');
  ok(p.doc.getElementById('restoreBtn').disabled === true, '沒有基準點時還原停用');
  ok(p.doc.getElementById('clearBetsBtn').disabled === true, '沒有注單時清注單停用');
  const opts = [...p.doc.getElementById('resetScope').options].map(o => o.value);
  ok(opts[0] === 'all' && opts[1] === 'pre', '範圍選單前兩項是 all / pre');
  ok(opts.includes('3-1') && opts.includes('4-5'), '範圍選單含所有場次');
}

section('玩家頁沒有任何管理功能');
{
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  ['snapBtn','restoreBtn','clearBetsBtn','dropScopeBtn','resetPlayersBtn','resetBtn','openAllBtn']
    .forEach(id => ok(!html.includes(`id="${id}"`), `玩家頁沒有 ${id}`));
}

console.log(`\n${'='.repeat(52)}`);
console.log(`通過 ${pass} 項，失敗 ${fail} 項`);
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
})();
