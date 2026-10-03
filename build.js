// 빌드: src/ 의 섹션 파일들을 하나의 index.html 로 묶는다.  사용법: node build.js
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const shell = fs.readFileSync(path.join(SRC, 'shell.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8');
const js = fs.readdirSync(SRC)
  .filter(f => /^\d\d-.*\.js$/.test(f))
  .sort()
  .map(f => `/* ===== ${f} ===== */\n` + fs.readFileSync(path.join(SRC, f), 'utf8'))
  .join('\n');

const out = shell.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
fs.writeFileSync(path.join(__dirname, 'index.html'), out);
console.log(`index.html 생성 완료 (${(out.length / 1024).toFixed(1)} KB, ${out.split('\n').length} 줄)`);
