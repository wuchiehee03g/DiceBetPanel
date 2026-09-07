/* 核心邏輯測試 —— 直接載入實際出貨的 app.js，不做任何 mock。
   涵蓋：定價、機率、池額、結算、三道限額、禁押規則、暱稱比對、
   基準點與獨立重置、賽前盤與單挑盤建立器。 */
const A = require('../app.js');

let pass = 0, fail = 0;
const ok = (c, l)=>{ if(c){ pass++; } else { fail++; console.log('  ✗ ' + l); } };
const near = (a, b, eps, l)=> ok(Math.abs(a - b) < eps, `${l}（得 ${a}，期望 ${b}）`);
const section = t => console.log('\n── ' + t + ' ──');

/* ============================================================
   1. 常數與屆數
   ============================================================ */
section('常數');
ok(A.PLAYER_COUNT === 16, '16 位選手');
ok(A.MULTI_ODDS === 12.80, '賽前盤開價 12.80');
ok(A.DUEL_WIN_ODDS === 1.95, '誰獲勝開價 1.95');
ok(A.SCORE_OVERROUND === 1.08, '大小單雙抽水 8%');
ok(A.MULTI_PRIOR_K === 300000, '賽前盤黏性 300,000');
ok(A.DUEL_PRIOR_K === 100000, '單挑盤黏性 100,000');
ok(A.MULTI_MAX_LIABILITY === 500000 && A.DUEL_MAX_LIABILITY === 500000, '曝險上限 500,000');
ok(A.DEFAULT_MAX_BET === 5000, '全域單筆上限 5,000');
ok(A.MAX_HP === 5, '5 血格');
ok(A.DEFAULT_BIG_MIN === 3, '大小盤口線 2.5（大 = 3 以上）');
ok(typeof A.TOURNAMENT_NAME === 'string' && /^第.+屆$/.test(A.TOURNAMENT_NAME),
   `屆數常數格式正確（${A.TOURNAMENT_NAME}）`);

/* ============================================================
   2. 血格機率
   ============================================================ */
section('血格機率');
const hp = A.hpDistribution();
near(hp.reduce((s, x)=> s + x.p, 0), 1, 1e-12, '無道具卡分布加總為 1');
near(hp.find(x=>x.hp===1).p, 0.2734375, 1e-9, '剩 1 格 = 27.34%');
near(hp.find(x=>x.hp===5).p, 0.0625,    1e-9, '剩 5 格 = 6.25%');
// bigSmallProbs(bigMin, items) —— 第一個參數是盤口線，不是道具卡旗標
const bs = A.bigSmallProbs(A.DEFAULT_BIG_MIN, false);
near(bs.big,   0.453125, 1e-9, '無卡：大 45.31%');
near(bs.small, 0.546875, 1e-9, '無卡：小 54.69%');
ok(A.bigSmallProbs(1, false).big === 1, '盤口線設 1 時全部算大（邊界）');
near(bs.big + bs.small, 1, 1e-12, '大 + 小 = 1');
const oe = A.oddEvenProbs(false);
near(oe.odd,  0.5703125, 1e-9, '無卡：單 57.03%');
near(oe.even, 0.4296875, 1e-9, '無卡：雙 42.97%');

const hpI = A.hpDistributionItems();
near(hpI.reduce((s, x)=> s + x.p, 0), 1, 1e-9, '道具卡分布加總為 1');
const bsI = A.bigSmallProbs(A.DEFAULT_BIG_MIN, true);
near(bsI.big,   0.3340, 1e-3, '有卡：大 33.40%');
near(bsI.small, 0.6660, 1e-3, '有卡：小 66.60%');
ok(bsI.small > bs.small, '道具卡讓分布更偏小（落後方能翻盤，比賽拖長）');

/* ============================================================
   3. 由機率導出賠率
   ============================================================ */
section('賠率導出');
const r2 = x => Math.round(x * 100) / 100;
ok(r2(A.oddsFromProb(bs.big))   === 2.04, '3-x 大 2.04');
ok(r2(A.oddsFromProb(bs.small)) === 1.69, '3-x 小 1.69');
ok(r2(A.oddsFromProb(oe.odd))   === 1.62, '3-x 單 1.62');
ok(r2(A.oddsFromProb(oe.even))  === 2.15, '3-x 雙 2.15');
ok(r2(A.oddsFromProb(bsI.big))   === 2.77, '4-x 大 2.77');
ok(r2(A.oddsFromProb(bsI.small)) === 1.39, '4-x 小 1.39');
const oeI = A.oddEvenProbs(true);
ok(r2(A.oddsFromProb(oeI.odd))  === 1.53, '4-x 單 1.53');
ok(r2(A.oddsFromProb(oeI.even)) === 2.35, '4-x 雙 2.35');
// 四捨五入後實際抽水仍在合理範圍
const ovr = (a, b)=> 1/a + 1/b;
near(ovr(2.04, 1.69), 1.0819, 1e-3, '3-x 大小實際抽水 ~8.2%');
near(ovr(2.77, 1.39), 1.0804, 1e-3, '4-x 大小實際抽水 ~8.0%');

/* ============================================================
   4. 賽制表
   ============================================================ */
section('賽制');
ok(A.allBracketMatches().length === 21, '21 場');
ok(A.duelMatches().length === 11, '11 場單挑');
ok(A.duelMatches().filter(m=>m.items).length === 5, '第四階段 5 場有道具卡');
ok(A.duelMatches().filter(m=>!m.items).length === 6, '第三階段 6 場無道具卡');
ok(A.bracketMatch('4-4').side === 'F', '4-4 是總決賽');
ok(A.bracketMatch('9-9') === null, '不存在的場次回 null');
// 排序鍵：4-10 要排在 4-5 之後（Number("4-1") 是 NaN 的老 bug）
ok(A.matchSortKey('4-10') > A.matchSortKey('4-5'), '4-10 排在 4-5 之後');
ok(A.matchSortKey('3-2')  < A.matchSortKey('4-1'), '3-2 排在 4-1 之前');

/* ============================================================
   5. 賽前盤建立器（第三屆新增）
   ============================================================ */
section('賽前盤建立器');
ok(A.buildPreMarkets({}).error, '沒有莊家名字就報錯');
ok(A.buildPreMarkets({ banker:'  ' }).error, '空白莊家名字也報錯');
const pre = A.buildPreMarkets({ banker:'莊家' }).markets;
ok(pre.length === 5, '產生 5 個賽前盤');
ok(pre.map(m=>m.title).join() === '最後總冠軍,總亞軍,總季軍,Bubble Guy,敗部冠軍', '五個標題與順序正確');
ok(pre.every((m, i)=> m.order === i), 'order 依序 0~4');
ok(pre.every(m=> m.category === 'multi'), '全部是 multi 分類');
ok(pre.every(m=> m.matchNo === null), '賽前盤沒有賽事編號');
ok(pre.every(m=> Object.keys(m.options).length === 16), '每盤 16 個選項');
ok(pre.every(m=> Object.keys(m.options).join() ===
     Array.from({length:16}, (_, i)=>'p'+i).join()), '選項 id 是 p0~p15');
ok(pre.every(m=> Object.values(m.options).every(o=> o.odds === A.MULTI_ODDS)), '全部開價 12.80');
ok(pre.every(m=> Object.values(m.options).every(o=> o.label === null)), '標籤留空，交給名單決定');
ok(pre.every(m=> m.priorK === A.MULTI_PRIOR_K), '黏性 300,000');
ok(pre.every(m=> m.maxBet === A.PRE_MAX_BET && m.maxBet === 1000), '單筆上限 1,000');
ok(pre.every(m=> m.maxPerBettor === A.PRE_MAX_PER_BETTOR && m.maxPerBettor === 5000), '每人上限 5,000');
ok(pre.every(m=> m.maxLiability === A.MULTI_MAX_LIABILITY), '曝險上限 500,000');
ok(pre.every(m=> m.autoPrice === true), '自動調價開啟');
ok(pre[0].desc.includes(A.TOURNAMENT_NAME), '冠軍盤說明帶當屆屆數');
// 各盤的 options 必須是獨立物件，不能共用同一個參考
pre[0].options.p0.odds = 99;
ok(pre[1].options.p0.odds === A.MULTI_ODDS, '各盤的選項互相獨立（不是共用參考）');

/* ============================================================
   6. 單挑盤建立器
   ============================================================ */
section('單挑盤建立器');
const duel = A.buildAllDuelMarkets({ banker:'莊家' }).markets;
ok(duel.length === 33, '11 場 × 3 = 33 個盤');
const win = duel.filter(m=> m.title.includes('誰獲勝'));
ok(win.length === 11, '11 個誰獲勝盤');
ok(win.every(m=> m.pendingPlayers === true && m.locked === true),
   '誰獲勝一律「待定 + 封盤」兩個同時成立');
ok(duel.filter(m=>!m.title.includes('誰獲勝')).every(m=> !m.locked),
   '大小／單雙直接開放收注');
ok(win.every(m=> Object.values(m.options).every(o=> o.odds === A.DUEL_WIN_ODDS)), '誰獲勝兩邊 1.95');
ok(duel.every(m=> m.maxLiability === A.DUEL_MAX_LIABILITY), '單挑盤曝險 500,000');
const m31 = duel.filter(m=> m.matchNo === '3-1');
const m41 = duel.filter(m=> m.matchNo === '4-1');
const oddsOf = (arr, kw)=> Object.values(arr.find(m=>m.title.includes(kw)).options).map(o=>o.odds);
ok(String(oddsOf(m31, '大/小')) === '2.04,1.69', '3-1 大小 2.04/1.69');
ok(String(oddsOf(m41, '大/小')) === '2.77,1.39', '4-1 大小 2.77/1.39（有道具卡）');
ok(String(oddsOf(m31, '單/雙')) === '1.62,2.15', '3-1 單雙 1.62/2.15');
ok(String(oddsOf(m41, '單/雙')) === '1.53,2.35', '4-1 單雙 1.53/2.35');

/* ============================================================
   7. 指定參賽者
   ============================================================ */
section('指定參賽者');
const fakeWin = { options:[{id:'p0', odds:1.95}, {id:'p1', odds:1.95}] };
ok(A.participantOptions(fakeWin, 3, 3).error, '兩邊同一人要報錯');
ok(A.participantOptions(fakeWin, -1, 2).error, '索引越界要報錯');
ok(A.participantOptions(fakeWin, 0, 16).error, '索引超過 15 要報錯');
const po = A.participantOptions(fakeWin, 4, 9);
ok(Object.keys(po.options).join() === 'p4,p9', '產生 p4 / p9 兩個選項');
ok(Object.values(po.options).every(o=> o.odds === 1.95), '沿用原本的賠率');

/* ============================================================
   8. 池額、賠率、結算
   ============================================================ */
section('池額與結算');
function mk(extra){
  return A.normalize(Object.assign({
    schema:3, maxBet:5000,
    players:{0:'阿龍', 1:'小華', 2:'阿東'},
    markets:{
      duel:{ title:'誰獲勝', category:'binary', matchNo:'3-1', banker:'莊家',
             autoPrice:true, priorK:100000, maxLiability:500000,
             options:{ p0:{order:0, odds:1.95}, p1:{order:1, odds:1.95} } },
      fixed:{ title:'大/小', category:'binary', matchNo:'3-1', banker:'莊家',
              autoPrice:false, priorK:100000,
              options:{ b:{label:'大', order:0, odds:2.04}, s:{label:'小', order:1, odds:1.69} } },
    },
  }, extra || {}));
}
let st = mk({ bets:{
  b1:{ marketId:'duel', optionId:'p0', name:'阿龍', bettorId:'d1', amount:1000, ts:1, oddsAtBet:1.95 },
  b2:{ marketId:'duel', optionId:'p1', name:'小華', bettorId:'d2', amount:3000, ts:2, oddsAtBet:1.90 },
}});
let P = A.buildPools(st);
const duelM = st.markets.find(m=>m.id === 'duel');
ok(A.poolOf(P, 'duel', 'p0') === 1000, 'p0 池額 1,000');
ok(A.poolOf(P, 'duel', 'p1') === 3000, 'p1 池額 3,000');
ok(A.marketTotal(P, duelM) === 4000, '盤口總注金 4,000');
ok(A.poolOf(P, 'duel', 'nope') === 0, '沒人押的選項回 0');

// 自動調價：熱門邊賠率下降、冷門邊上升，且倒數和守恆
const l0 = A.liveOdds(P, duelM, 'p0').value;
const l1 = A.liveOdds(P, duelM, 'p1').value;
ok(l1 < 1.95 && l0 > 1.95, '押多的一邊賠率降、押少的升');
near(1/l0 + 1/l1, 1/1.95 + 1/1.95, 2e-3, '自動調價後倒數和守恆（抽水不變）');

// 固定賠率盤不受下注影響
const fixedM = st.markets.find(m=>m.id === 'fixed');
ok(A.liveOdds(P, fixedM, 'b').value === 2.04, '關閉自動調價的盤不隨下注變動');

// 結算用的是注單鎖住的賠率，不是當下賠率
st = mk({ bets:{
  b1:{ marketId:'duel', optionId:'p0', name:'阿龍', bettorId:'d1', amount:1000, ts:1, oddsAtBet:1.95 },
  b2:{ marketId:'duel', optionId:'p1', name:'小華', bettorId:'d2', amount:3000, ts:2, oddsAtBet:1.90 },
}});
st.markets.find(m=>m.id==='duel').settled = true;
st.markets.find(m=>m.id==='duel').winnerId = 'p0';
P = A.buildPools(st);
const info = A.settleInfo(st, P, st.markets.find(m=>m.id==='duel'));
near(info.payoutTotal, 1950, 1e-6, '派彩 = 1000 × 1.95 = 1,950');
near(info.total, 4000, 1e-6, '總注金 4,000');
const o1 = A.betOutcome(st, P, st.bets.find(b=>b.id==='b1'));
const o2 = A.betOutcome(st, P, st.bets.find(b=>b.id==='b2'));
ok(o1.status === 'win'  && Math.abs(o1.profit - 950)  < 1e-6, '中獎淨利 +950');
ok(o2.status === 'lose' && Math.abs(o2.profit + 3000) < 1e-6, '沒中淨損 -3,000');
ok(A.betOdds({ oddsAtBet:1.90 }) === 1.90, '結算永遠用鎖定的成交價');

/* ============================================================
   9. 三道限額
   ============================================================ */
section('限額');
ok(A.validateBetAmount('5000', 5000).ok,  '5,000 剛好通過');
ok(!A.validateBetAmount('5001', 5000).ok, '5,001 被擋');
ok(!A.validateBetAmount('0', 5000).ok,    '0 元被擋');
ok(!A.validateBetAmount('-100', 5000).ok, '負數被擋');
ok(!A.validateBetAmount('abc', 5000).ok,  '非數字被擋');
ok(!A.validateBetAmount('', 5000).ok,     '空值被擋');

const capped = mk({});
const mm = capped.markets.find(m=>m.id === 'duel');
mm.maxBet = 1000;
ok(A.effectiveMaxBet(capped, mm) === 1000, '盤口自己的上限覆寫全域');
mm.maxBet = null;
ok(A.effectiveMaxBet(capped, mm) === 5000, '沒設就沿用全域');

// 曝險上限只擋觸頂的那個選項
const liab = mk({ bets:{
  x:{ marketId:'duel', optionId:'p0', name:'甲', bettorId:'d1', amount:5000, ts:1, oddsAtBet:1.95 },
}});
const lm = liab.markets.find(m=>m.id==='duel');
const LP = A.buildPools(liab);
// 已有 5000 押在 p0 @1.95。再押 5000 @1.95 → p0 賠付 19,500、收 10,000，淨賠 9,500
lm.maxLiability = 20000;
ok(A.checkLiability(liab, LP, lm, 'p0', 5000, 1.95).ok,  '淨賠 9,500 < 上限 20,000 → 放行');
lm.maxLiability = 5000;
ok(!A.checkLiability(liab, LP, lm, 'p0', 5000, 1.95).ok, '淨賠 9,500 > 上限 5,000 → 擋下');
ok(A.checkLiability(liab, LP, lm, 'p1', 5000, 1.95).ok,  '同一盤的另一個選項照常開放');
ok(A.checkLiability(liab, LP, Object.assign({}, lm, { maxLiability:null }), 'p0', 999999, 1.95).ok,
   '沒設曝險上限就不限制');
near(A.liabilityIfBetPlaced(liab, LP, lm, 'p0', 5000, 1.95), -9500, 1e-6,
     '淨額算式：收 10,000 − 賠 19,500');

/* ============================================================
   10. 禁押規則與暱稱比對
   ============================================================ */
section('禁押與暱稱');
const banSt = A.normalize({
  players:{ 0:'小明', 1:'小華' },
  markets:{
    w:{ title:'誰獲勝', category:'binary', matchNo:'3-1', banker:'莊家',
        options:{ p0:{order:0, odds:1.95}, p1:{order:1, odds:1.95} } },
    b:{ title:'大/小', category:'binary', matchNo:'3-1', banker:'莊家',
        options:{ x:{label:'大', order:0, odds:2}, y:{label:'小', order:1, odds:2} } },
    o:{ title:'誰獲勝', category:'binary', matchNo:'3-2', banker:'莊家',
        options:{ x:{order:0, odds:2}, y:{order:1, odds:2} } },
    m:{ title:'最後總冠軍', category:'multi', banker:'莊家',
        options:{ p0:{order:0, odds:12.8}, p1:{order:1, odds:12.8} } },
  },
});
const M = id => banSt.markets.find(x=>x.id === id);
ok(A.isBannedBettor(banSt, M('w'), '小明').banned, '選手不能押自己的誰獲勝');
ok(A.isBannedBettor(banSt, M('b'), '小明').banned, '同場的大小也擋');
ok(A.isBannedBettor(banSt, M('o'), '小明') === null, '別人的場次可以押');
ok(A.isBannedBettor(banSt, M('m'), '小明') === null, '賽前盤可以押');
ok(A.isBannedBettor(banSt, M('w'), '路人') === null, '非選手不受限');
ok(A.isBannedBettor(banSt, M('w'), '莊家').banned, '莊家不能押自己的盤');
ok(A.isBannedBettor(banSt, M('w'), '') === null, '空暱稱不觸發禁押');

// 暱稱帶選手編號
ok(A.sameNickname('小明', '小明7'),   '名單無編號 vs 下注帶編號 → 同一人');
ok(A.sameNickname('小明7', '小明 7'), '空白與分隔符不影響');
ok(A.sameNickname('小明7', '小明-7'), '連字號也認');
ok(!A.sameNickname('小明1', '小明9'), '同名不同編號 → 不同人');
ok(!A.sameNickname('7', '小明7'),     '只打編號認不出人（寧可放過也不誤鎖）');
ok(!A.sameNickname('小明', '小華'),   '不同名 → 不同人');
ok(A.isBannedBettor(banSt, M('w'), '小明7').banned, '「小明7」一樣被擋');
ok(A.playerIndexByName(banSt, '小明7') === 0, '帶編號認得出名單位置');
ok(A.playerIndexByName(banSt, '路人') === -1, '不是選手回 -1');

// 每人限額：換寫法不能繞過
const perSt = A.normalize({
  players:{ 0:'阿龍' },
  markets:{ m:{ title:'大/小', category:'binary', matchNo:'3-1', banker:'莊家',
    maxPerBettor:5000, options:{ b:{label:'大', order:0, odds:2}, s:{label:'小', order:1, odds:2} } } },
  bets:{ b1:{ marketId:'m', optionId:'b', name:'阿龍3', bettorId:'dev1', amount:3000, ts:1, oddsAtBet:2 } },
});
ok(A.bettorStakeOn(perSt, 'm', 'other', '阿龍')  === 3000, '「阿龍」認得出「阿龍3」下過的注');
ok(A.bettorStakeOn(perSt, 'm', 'other', '阿龍5') === 0,    '同名不同編號視為不同人');
ok(A.bettorStakeOn(perSt, 'm', 'dev1', '')       === 3000, '同裝置不論暱稱都算');
const pm = perSt.markets[0];
ok(!A.checkPerBettor(perSt, pm, 'other', '阿龍', 2001).ok, '再押 2,001 超過每人上限');
ok(A.checkPerBettor(perSt, pm, 'other', '阿龍', 2000).ok,  '押 2,000 剛好通過');

/* ============================================================
   11. 基準點與獨立重置
   ============================================================ */
section('基準點與獨立重置');
const resetRaw = {
  schema:3, maxBet:5000, players:{ 0:'阿龍', 1:'小華' },
  markets:{
    champ:{ title:'最後總冠軍', category:'multi', banker:'莊家', order:0, priorK:300000,
            maxBet:1000, maxPerBettor:5000, maxLiability:500000, autoPrice:true,
            options:{ p0:{order:0, odds:12.8}, p1:{order:1, odds:12.8} } },
    w31:{ title:'誰獲勝', category:'binary', banker:'莊家', matchNo:'3-1', order:0,
          priorK:100000, autoPrice:true, pendingPlayers:true, locked:true,
          options:{ p0:{order:0, odds:1.95}, p1:{order:1, odds:1.95} } },
    bs31:{ title:'大/小', category:'binary', banker:'莊家', matchNo:'3-1', order:1,
           autoPrice:false, priorK:100000,
           options:{ b:{label:'大', order:0, odds:2.04}, s:{label:'小', order:1, odds:1.69} } },
  },
  bets:{
    a:{ marketId:'champ', optionId:'p0', name:'阿龍', bettorId:'d1', amount:1000, ts:1, oddsAtBet:12.8 },
    b:{ marketId:'bs31',  optionId:'b',  name:'小華', bettorId:'d2', amount:2000, ts:2, oddsAtBet:2.04 },
  },
};
const rst  = A.normalize(resetRaw);
const snap = A.snapshotMarkets(rst);
ok(Object.keys(snap).length === 3, '快照涵蓋 3 個盤口');
ok(!('locked' in snap.w31) && !('settled' in snap.w31), '快照不含賽程進度（locked/settled）');
ok(snap.w31.pendingPlayers === true, '快照保留待定狀態');
ok(snap.bs31.options.s.odds === 1.69, '快照存下賠率');

const base = A.baselineMarkets({ baseline:{ ts:1, markets:snap } });
ok(A.baselineDiff(rst, base).length === 0, '沒動過 → 零差異');

// 改壞後偵測得到
const bad = JSON.parse(JSON.stringify(resetRaw));
bad.markets.bs31.options.b.odds = 9.9;
bad.markets.champ.priorK = 100;
delete bad.markets.w31;
const badSt = A.normalize(bad);
const diff = A.baselineDiff(badSt, base);
ok(diff.length === 3, `偵測到 3 個盤口有異（得 ${diff.length}）`);
ok(diff.find(r=>r.id==='w31').kind === 'missing', '抓到被刪掉的盤口');
ok(diff.find(r=>r.id==='bs31').changes.some(c=>c.includes('9.9')), '抓到被改壞的賠率');

// ★ 還原：待定盤必須維持封盤（第三屆修掉的 bug）
const rp = A.restoreConfigPaths(badSt, base, 'all');
ok(rp.marketCount === 3, '還原涵蓋 3 個盤口');
ok(rp.paths['markets/w31'].locked === true,
   '★ 被刪掉的待定盤整包長回來時仍是封盤（不會變成待定但可下注）');
ok(rp.paths['markets/w31'].pendingPlayers === true, '長回來仍是待定');
ok(rp.paths['markets/bs31/locked'] === false, '非待定盤照常解封');
ok(rp.paths['markets/bs31/options'].b.odds === 2.04, '賠率寫回 2.04');
ok(rp.paths['markets/champ/priorK'] === 300000, '黏性寫回 300,000');
ok(!Object.keys(rp.paths).some(p=>p.startsWith('bets/')), '★ 還原配置完全不碰 bets');

// 逐欄位還原分支也要維持封盤
const pendingPresent = A.normalize(resetRaw);
const rp2 = A.restoreConfigPaths(pendingPresent, base, '3-1');
ok(rp2.paths['markets/w31/locked'] === true,
   '★ 盤口還在時，待定盤還原後仍是封盤');
ok(rp2.paths['markets/bs31/locked'] === false, '同場的大小盤照常解封');
ok(rp2.marketCount === 2, '限定場次只還原那一場');

// 清注單 / 整組刪除
const cb = A.clearBetsPaths(rst, 'all');
ok(cb.betCount === 2 && cb.amount === 3000, '全部注單 2 筆 $3,000');
ok(Object.keys(cb.paths).every(p=>p.startsWith('bets/')), '★ 清注單不碰 markets');
const cb31 = A.clearBetsPaths(rst, '3-1');
ok(cb31.betCount === 1 && cb31.amount === 2000, '3-1 只有 1 筆 $2,000');
const dp = A.deleteScopePaths(rst, '3-1');
ok(dp.marketCount === 2 && dp.betCount === 1, '整組刪除 3-1：2 盤 1 注');
ok(dp.paths['bets/b'] === null && !('bets/a' in dp.paths), '只刪該場的注單');

// 範圍選單
const scopes = A.resetScopes(rst);
ok(scopes.map(s=>s.value).join() === 'all,pre,3-1', `範圍：${scopes.map(s=>s.value).join()}`);
ok(A.inScope('pre', null) && !A.inScope('pre', '3-1'), 'pre 只涵蓋沒有編號的盤');

/* ============================================================
   12. 跳脫與工具
   ============================================================ */
section('工具');
ok(A.esc('<script>') === '&lt;script&gt;', 'HTML 跳脫');
ok(A.esc('a&b') === 'a&amp;b', '& 跳脫');
ok(A.esc(null) === '', 'null 跳脫成空字串');
ok(A.fmt(1234567) === '1,234,567', '千分位');
ok(A.uid() !== A.uid(), 'uid 不重複');
const seed = A.seed();
ok(seed.players[0] === '選手1' && seed.players[15] === '選手16', '種子名單 選手1~16');
ok(seed.maxBet === 5000 && seed.schema === 3, '種子全域設定');

console.log(`\n${'='.repeat(52)}`);
console.log(`通過 ${pass} 項，失敗 ${fail} 項`);
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
