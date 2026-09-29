const fs = require('fs');
const src = fs.readFileSync('shared/api.interface.ts', 'utf8');
function findBlock(s, idx) {
  const ob = s.indexOf('{', idx);
  if (ob < 0) return null;
  let d = 0, j = ob;
  for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}') { d--; if (d === 0) { j++; break; } } }
  return s.slice(ob + 1, j - 1);
}
for (const w of ['MrpResult', 'MrpResultItem']) {
  const re = new RegExp('(interface|type)\\s+' + w + '\\b');
  const m = re.exec(src);
  if (m) {
    console.log('=== ' + w + ' (' + m[1] + ')');
    for (const l of findBlock(src, m.index).split('\n')) { const t = l.trim(); if (t) console.log('  ' + t); }
    console.log('');
  } else console.log('=== ' + w + ' NOT FOUND');
}
