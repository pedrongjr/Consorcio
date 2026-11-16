// Ajustes no index.html gerado pelo `expo export --platform web`.
import fs from 'node:fs';
const file = 'dist-web/index.html';
let html = fs.readFileSync(file, 'utf8');
html = html.replace('<html lang="en">', '<html lang="pt-BR">');
fs.writeFileSync(file, html);
console.log('dist-web/index.html ajustado');
