// Gera um código de 6 números para cada protagonista e um de 8 para o mestre,
// grava os hashes no banco (local ou remoto) e salva os códigos num .txt fora do Git.
// Uso: node scripts/gerar-codigos.mjs [--remoto] [--so quem1,quem2]
import {writeFileSync, mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomInt} from 'node:crypto';
import {hashCodigo, aleatorioHex} from '../api/src/senha.js';
import {PROTAGONISTAS} from '../api/src/index.js';

const remoto = process.argv.includes('--remoto');
const iSo = process.argv.indexOf('--so');
const todos = [...PROTAGONISTAS, 'mestre'];
const lista = iSo > 0 ? process.argv[iSo + 1].split(',') : todos;

const codigo = (n) => String(randomInt(10 ** (n - 1), 10 ** n));
const linhas = [], sql = [];
for (const quem of lista) {
	if (!todos.includes(quem)) throw new Error('nome desconhecido: ' + quem);
	const c = codigo(quem === 'mestre' ? 8 : 6);
	const sal = aleatorioHex(16);
	const h = await hashCodigo(c, sal);
	sql.push(`INSERT INTO acessos (quem, sal, hash) VALUES ('${quem}', '${sal}', '${h}') ON CONFLICT(quem) DO UPDATE SET sal = excluded.sal, hash = excluded.hash, falhas = 0, bloqueado_ate = 0;`);
	sql.push(`DELETE FROM sessoes WHERE quem = '${quem}';`);
	linhas.push(`${quem.padEnd(9)} ${c}`);
}
const tmp = join(mkdtempSync(join(tmpdir(), 'estudio-')), 'codigos.sql');
writeFileSync(tmp, sql.join('\n'));
execFileSync('npx', ['wrangler', 'd1', 'execute', 'estudio-herois', remoto ? '--remote' : '--local', '--file', tmp], {cwd: new URL('../api', import.meta.url), stdio: 'inherit', shell: true});
const arq = `codigos-${remoto ? 'site' : 'local'}.txt`;
writeFileSync(new URL('../' + arq, import.meta.url), linhas.join('\n') + '\n');
console.log(`\nCódigos salvos em ${arq} (fora do Git).`);
