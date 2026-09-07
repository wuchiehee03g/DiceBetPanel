/* 端對端 —— 打真實的 Firebase，但只在丟棄用的測試節點上。
   驗證的是「前端算出來的東西寫進去、讀回來還是一樣」以及規則實際擋不擋得住，
   這些用 mock 測不出來。正式節點全程不碰。 */
const A = require('../app.js');

const BASE = 'https://dicebetpanel-default-rtdb.asia-southeast1.firebasedatabase.app';
const T = A.DB_PATH + '_TEST';

let pass = 0, fail = 0;
const ok = (c, l)=>{ if(c){ pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };
const section = t => console.log('\n── ' + t + ' ──');

const j = async r => { const t = await r.text(); return t === '' ? null : JSON.parse(t); };
const get   = p => fetch(`${BASE}/${p}.json`).then(j);
const put   = (p, b)=> fetch(`${BASE}/${p}.json`, { method:'PUT',   body:JSON.stringify(b) }).then(j);
const patch = (p, b)=> fetch(`${BASE}/${p}.json`, { method:'PATCH', body:JSON.stringify(b) }).then(j);
const post  = (p, b)=> fetch(`${BASE}/${p}.json`, { method:'POST',  body:JSON.stringify(b) }).then(j);
const del   = p => fetch(`${BASE}/${p}.json`, { method:'DELETE' }).then(j);

/* 規則只在各分支開放寫入，對節點本身的整包寫入／刪除都會被擋，
   所以建立與清除都要逐分支做（正式的匯入與重置也是這樣寫的）。 */
const BRANCHES = ['schema', 'maxBet', 'players', 'markets', 'bets', 'baseline', '__connTest__'];
const wipe = async ()=>{ for(const b of BRANCHES) await del(`${T}/${b}`); };

(async ()=>{
try{
  await wipe();

  /* ---------- 建立全部盤口 ---------- */
  section('建立第三屆全部盤口');
  const players = {};
  for(let i = 0; i < 16; i++) players[String(i)] = '選手' + (i + 1);
  const built = A.buildPreMarkets({ banker:'莊家' }).markets
    .concat(A.buildAllDuelMarkets({ banker:'莊家' }).markets);
  const markets = {};
  built.forEach((m, i)=>{ markets['m' + String(i).padStart(2, '0')] = m; });
  // 逐分支寫入（規則不接受對節點本身的整包 PUT）
  await put(`${T}/schema`, 3);
  await put(`${T}/maxBet`, 5000);
  await put(`${T}/players`, players);
  await put(`${T}/markets`, markets);

  let st = A.normalize(await get(T));
  ok(st.markets.length === 38, `寫入 38 個盤（實得 ${st.markets.length}）`);
  ok(st.markets.filter(m => !m.matchNo).length === 5, '5 個賽前盤');
  ok(st.markets.filter(m => m.pendingPlayers).length === 11, '11 個誰獲勝待定');
  ok(st.markets.filter(m => m.pendingPlayers).every(m => m.locked), '待定盤全部封盤');
  ok(st.markets.filter(m => !m.matchNo).every(m => m.options.length === 16), '賽前盤各 16 選項');
  const champ = st.markets.find(m => m.title === '最後總冠軍');
  ok(champ && champ.options.every(o => o.odds === 12.8), '冠軍盤 16 個選項全部 12.80');
  ok(champ.desc.includes(A.TOURNAMENT_NAME), '冠軍盤說明帶當屆屆數');

  /* ---------- 建立基準點 ---------- */
  section('基準點');
  await put(`${T}/baseline`, { ts:Date.now(), markets:A.snapshotMarkets(st), players:st.players, maxBet:st.maxBet });
  let raw = await get(T);
  let base = A.baselineMarkets(raw);
  ok(base && Object.keys(base.markets).length === 38, '基準點涵蓋 38 個盤');
  ok(A.baselineDiff(st, base).length === 0, '剛存好 → 零差異');

  /* ---------- 指定參賽者 ---------- */
  section('指定參賽者');
  const w31 = st.markets.find(m => m.matchNo === '3-1' && m.title.includes('誰獲勝'));
  const po = A.participantOptions(w31, 4, 9);
  await patch(`${T}/markets/${w31.id}`, {
    options:po.options, pendingPlayers:null, locked:false,
    desc:`${st.players[4]} vs ${st.players[9]}`,
  });
  st = A.normalize(await get(T));
  const w31b = st.markets.find(m => m.id === w31.id);
  ok(!w31b.pendingPlayers && !w31b.locked, '指定後解除待定並開盤');
  ok(w31b.options.map(o => A.optionLabel(st, w31b, o)).join(' vs ') === `${st.players[4]} vs ${st.players[9]}`,
     `標籤讀自名單：${w31b.options.map(o => A.optionLabel(st, w31b, o)).join(' vs ')}`);

  /* ---------- 下注與鎖價 ---------- */
  section('下注與自動調價');
  let P = A.buildPools(st);
  const o1 = A.liveOdds(P, w31b, 'p4').value;
  await post(`${T}/bets`, { marketId:w31b.id, optionId:'p4', name:'測試甲', bettorId:'t1',
                            amount:5000, ts:Date.now(), oddsAtBet:o1 });
  st = A.normalize(await get(T)); P = A.buildPools(st);
  ok(st.bets.length === 1 && st.bets[0].oddsAtBet === o1, `注單鎖住成交價 ${o1}x`);
  const o2 = A.liveOdds(P, st.markets.find(m => m.id === w31.id), 'p4').value;
  ok(o2 < o1, `自動調價生效：${o1}x → ${o2}x`);

  const bs31 = st.markets.find(m => m.matchNo === '3-1' && m.title.includes('大/小'));
  const b1 = A.liveOdds(P, bs31, bs31.options[0].id).value;
  await post(`${T}/bets`, { marketId:bs31.id, optionId:bs31.options[0].id, name:'測試乙', bettorId:'t2',
                            amount:5000, ts:Date.now(), oddsAtBet:b1 });
  st = A.normalize(await get(T)); P = A.buildPools(st);
  const b2 = A.liveOdds(P, st.markets.find(m => m.id === bs31.id), bs31.options[0].id).value;
  ok(b1 === b2 && b1 === 2.04, `固定賠率盤不隨下注變動（維持 ${b1}x）`);

  /* ---------- 資料庫規則實際擋不擋得住 ----------
     測試節點套用與正式節點相同的驗證規則，所以這一段測的是規則本身。
     第三屆籌備時規則裡的節點名忘了跟著改，導致每一筆合法注單都被擋，
     就是因為當時測試節點用的是全開規則而沒測到。 */
  section('資料庫規則');
  const cleanup = [];
  const tryBet = async (label, body, shouldPass)=>{
    const r = await fetch(`${BASE}/${T}/bets.json`, { method:'POST', body:JSON.stringify(body) });
    if(r.ok) cleanup.push((await r.json()).name);
    ok(r.ok === shouldPass, `${label}：${r.ok ? '通過' : '被擋 ' + r.status}`);
  };
  const bsM = st.markets.find(m => m.id === bs31.id);
  const pend = st.markets.find(m => m.pendingPlayers);
  const b0 = { optionId:bsM.options[0].id, name:'規則測試', bettorId:'rule', ts:Date.now() };
  await tryBet('合法注單 $100',          { ...b0, marketId:bsM.id, amount:100,  oddsAtBet:2.04 }, true);
  await tryBet('$5,000（全域上限）',      { ...b0, marketId:bsM.id, amount:5000, oddsAtBet:2.04 }, true);
  await tryBet('$5,001（超過上限）',      { ...b0, marketId:bsM.id, amount:5001, oddsAtBet:2.04 }, false);
  await tryBet('賽前盤 $1,000（盤口上限）', { ...b0, marketId:champ.id, optionId:'p0', amount:1000, oddsAtBet:12.8 }, true);
  await tryBet('賽前盤 $1,001（超過）',    { ...b0, marketId:champ.id, optionId:'p0', amount:1001, oddsAtBet:12.8 }, false);
  await tryBet('封盤中的待定盤',           { ...b0, marketId:pend.id, optionId:'p0', amount:100, oddsAtBet:1.95 }, false);
  await tryBet('賠率 99（超出 1.01~50）',  { ...b0, marketId:bsM.id, amount:100, oddsAtBet:99 }, false);
  await tryBet('不存在的盤口',             { ...b0, marketId:'nope', amount:100, oddsAtBet:2 }, false);
  await tryBet('金額 0',                   { ...b0, marketId:bsM.id, amount:0,   oddsAtBet:2.04 }, false);
  for(const id of cleanup) await del(`${T}/bets/${id}`);
  st = A.normalize(await get(T));
  ok(st.bets.length === 2, `規則測試的注單已清除，剩原本 2 筆（實得 ${st.bets.length}）`);

  /* ---------- 禁押規則 ---------- */
  section('禁押規則');
  const nm = st.players[4];
  ok(A.isBannedBettor(st, st.markets.find(m => m.id === w31.id), nm).banned, `${nm} 不能押自己的 3-1`);
  ok(A.isBannedBettor(st, st.markets.find(m => m.id === bs31.id), nm).banned, `${nm} 同場大小也擋`);
  ok(A.isBannedBettor(st, st.markets.find(m => m.matchNo === '3-2'), nm) === null, `${nm} 可押別場`);
  ok(A.isBannedBettor(st, champ, nm) === null, `${nm} 可押賽前盤`);

  /* ---------- 結算 ---------- */
  section('結算');
  await patch(`${T}/markets/${w31.id}`, { settled:true, winnerId:'p4', locked:true });
  st = A.normalize(await get(T)); P = A.buildPools(st);
  const info = A.settleInfo(st, P, st.markets.find(m => m.id === w31.id));
  ok(Math.abs(info.payoutTotal - 5000 * o1) < 0.01, `派彩 5000 × ${o1} = $${Math.round(5000 * o1)}`);
  await patch(`${T}/markets/${w31.id}`, { settled:false, winnerId:null, locked:true });
  st = A.normalize(await get(T));
  ok(st.bets.length === 2, '撤銷結算後注單完整保留');

  /* ---------- 還原配置：待定盤要維持封盤 ---------- */
  section('還原配置');
  const w32 = st.markets.find(m => m.matchNo === '3-2' && m.title.includes('誰獲勝'));
  // 模擬手滑：把待定盤解封、改壞一個賠率、刪掉一個盤
  const bs32 = st.markets.find(m => m.matchNo === '3-2' && m.title.includes('大/小'));
  const oe32 = st.markets.find(m => m.matchNo === '3-2' && m.title.includes('單/雙'));
  await patch(T, {
    [`markets/${w32.id}/locked`]: false,
    [`markets/${bs32.id}/options/${bs32.options[0].id}/odds`]: 9.99,
    [`markets/${oe32.id}`]: null,
  });
  st = A.normalize(await get(T));
  ok(st.markets.length === 37, '一個盤被刪掉了');

  raw = await get(T); base = A.baselineMarkets(raw);
  const rp = A.restoreConfigPaths(st, base, '3-2');
  ok(!Object.keys(rp.paths).some(p => p.startsWith('bets/')), '★ 還原路徑完全不含 bets');
  await patch(T, rp.paths);
  st = A.normalize(await get(T));
  ok(st.markets.length === 38, '被刪的盤長回來了');
  ok(st.bets.length === 2, '★ 還原後注單一筆都沒少');
  const w32b = st.markets.find(m => m.matchNo === '3-2' && m.title.includes('誰獲勝'));
  ok(w32b.pendingPlayers === true && w32b.locked === true,
     '★ 待定盤還原後仍是「待定 + 封盤」，不會變成可下注');
  const bs32b = st.markets.find(m => m.matchNo === '3-2' && m.title.includes('大/小'));
  ok(bs32b.options[0].odds === 2.04, '被改壞的賠率寫回 2.04');
  ok(bs32b.locked === false, '非待定盤照常開放');
  // 指定參賽者本來就會偏離基準點（選項從 p0/p1 換成實際兩人），那是正常的，
  // 所以只要求「被還原的 3-2 沒有殘留差異」，而剩下的唯一差異必須是 3-1。
  const after = A.baselineDiff(st, base);
  ok(after.filter(r => r.matchNo === '3-2').length === 0, '★ 3-2 還原後與基準點完全一致');
  ok(after.length === 1 && after[0].matchNo === '3-1',
     `剩下的唯一差異是已指定參賽者的 3-1（得 ${after.map(r=>r.matchNo).join()}）`);

  /* ---------- 清注單 ---------- */
  section('獨立重置');
  const cb = A.clearBetsPaths(st, '3-1');
  ok(cb.betCount === 2, '3-1 有 2 筆注單');
  await patch(T, cb.paths);
  st = A.normalize(await get(T));
  ok(st.bets.length === 0 && st.markets.length === 38, '★ 清注單後盤口一個都沒少');

  /* ---------- 收尾 ---------- */
  section('收尾');
  await wipe();
  const left = await get(T);
  ok(left === null, `測試節點已清除${left ? '（殘留：' + Object.keys(left).join() + '）' : ''}`);
  const prod = await get(A.DB_PATH);
  ok(true, `正式節點 ${A.DB_PATH}：${prod ? Object.keys(prod.markets || {}).length + ' 個盤' : '尚未建立'}`);

}catch(e){
  fail++;
  console.log('  ✗ 例外：' + String(e).slice(0, 200));
  try{ await wipe(); }catch(_){}
}

console.log(`\n${'='.repeat(52)}`);
console.log(`通過 ${pass} 項，失敗 ${fail} 項`);
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
})();
