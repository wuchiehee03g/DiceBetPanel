/* 抽出 HTML 裡的 inline <script> 丟給 node --check。
   瀏覽器對語法錯誤是靜默的（整個 script 不執行、畫面一片空白），
   所以每次改完 HTML 都要跑這個。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = process.argv.slice(2);
if(files.length === 0){
  console.error('用法：node tests/syntaxcheck.js <file.html> [...]');
  process.exit(2);
}

let fail = 0;
for(const f of files){
  const html = fs.readFileSync(f, 'utf8');
  // 只取沒有 src 的 <script>
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, n = 0;
  while((m = re.exec(html))){
    n++;
    const code = m[1];
    const lines = code.split('\n').length;
    try{
      new vm.Script(code, { filename: `${path.basename(f)}#script${n}` });
      console.log(`  ok   ${path.basename(f)} inline script #${n} (${lines} lines)`);
    }catch(e){
      fail++;
      console.log(`  FAIL ${path.basename(f)} inline script #${n}: ${e.message}`);
    }
  }
  if(n === 0) console.log(`  --   ${path.basename(f)}：沒有 inline script`);
}
process.exit(fail ? 1 : 0);
