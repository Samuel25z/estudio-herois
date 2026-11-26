// Testes da API contra o Worker local de verdade (npx wrangler dev --port 8787 em api/).
// Usa os códigos de codigos-local.txt. Uso: node tests/api.test.mjs
import {readFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import assert from 'node:assert/strict';

const API = process.env.API || 'http://localhost:8787';
const COD = Object.fromEntries(readFileSync(new URL('../codigos-local.txt', import.meta.url), 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/)));
const FALAS = JSON.parse(readFileSync('C:/Edicao de Video/saga/cap03-falas.json', 'utf8'));
let ok = 0;

async function req(caminho, {token, method = 'GET', json, body, headers = {}} = {}) {
	const h = {...headers};
	if (token) h.Authorization = 'Bearer ' + token;
	if (json) h['Content-Type'] = 'application/json';
	const r = await fetch(API + caminho, {method, headers: h, body: json ? JSON.stringify(json) : body});
	const tipo = r.headers.get('content-type') || '';
	return {status: r.status, dados: tipo.includes('json') ? await r.json() : await r.arrayBuffer(), headers: r.headers};
}
async function teste(nome, fn) {
	await fn();
	ok++;
	console.log('  ok  ' + nome);
}
const entrar = async (quem) => (await req('/api/entrar', {method: 'POST', json: {quem, codigo: COD[quem]}})).dados.token;

function wav(seg = 1.2, sr = 48000) {
	const n = Math.round(seg * sr), b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
	const t = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
	t(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); t(8, 'WAVE'); t(12, 'fmt ');
	v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
	t(36, 'data'); v.setUint32(40, n * 2, true);
	for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin((i / sr) * 2 * Math.PI * 180) * 9000, true);
	return b;
}

const resetar = (quem) => execSync(`npx wrangler d1 execute estudio-herois --local --command "UPDATE acessos SET falhas=0, bloqueado_ate=0 WHERE quem='${quem}'"`, {cwd: new URL('../api', import.meta.url), stdio: 'ignore'});

console.log('API em ' + API);
let moon, erick, mestre, ep, falaMoon, tom1;

await teste('saúde responde', async () => assert.equal((await req('/api/saude')).status, 200));
await teste('código errado é recusado', async () => assert.equal((await req('/api/entrar', {method: 'POST', json: {quem: 'moon', codigo: '000000'}})).status, 401));
await teste('código com letras é recusado', async () => assert.equal((await req('/api/entrar', {method: 'POST', json: {quem: 'moon', codigo: '12a45'}})).status, 400));
await teste('código certo entra', async () => {
	moon = await entrar('moon');
	erick = await entrar('erick');
	mestre = await entrar('mestre');
	assert.match(moon, /^[0-9a-f]{64}$/);
	assert.equal((await req('/api/eu', {token: moon})).dados.quem, 'moon');
});
await teste('sem entrar não lê nada', async () => {
	assert.equal((await req('/api/episodios')).status, 401);
	assert.equal((await req('/api/episodios', {token: 'f'.repeat(64)})).status, 401);
});
await teste('amigo não sobe episódio (só o mestre)', async () => assert.equal((await req('/api/episodios', {token: moon, method: 'POST', json: {numero: 98, titulo: 'x', falas: FALAS}})).status, 403));
await teste('mestre sobe o episódio', async () => {
	const r = await req('/api/episodios', {token: mestre, method: 'POST', json: {numero: 99, titulo: 'Teste da floresta', falas: FALAS}});
	assert.equal(r.status, 200, JSON.stringify(r.dados));
	ep = r.dados.id;
	assert.equal(r.dados.falas, FALAS.length);
	assert.ok(r.dados.para_gravar > 20);
});
await teste('arquivo com fala repetida é recusado', async () => {
	const r = await req('/api/episodios', {token: mestre, method: 'POST', json: {numero: 97, titulo: 'x', falas: [FALAS[1], FALAS[1]]}});
	assert.equal(r.status, 400);
});
await teste('amigo só vê as próprias falas, com contexto e emoção', async () => {
	const r = await req(`/api/episodios/${ep}/falas`, {token: moon});
	assert.ok(r.dados.falas.length > 0);
	assert.ok(r.dados.falas.every((f) => f.quem === 'moon'));
	falaMoon = r.dados.falas[0];
	assert.equal(falaMoon.cod, '02-moon');
	assert.equal(falaMoon.antes.quem, 'narrador');
	assert.ok(!/^voz de/i.test(falaMoon.emocao) && falaMoon.emocao.length > 5, falaMoon.emocao);
	assert.ok(falaMoon.dur_ideal > 1);
});
await teste('mestre vê todas as falas', async () => assert.equal((await req(`/api/episodios/${ep}/falas`, {token: mestre})).dados.falas.length, FALAS.length));
await teste('amigo não grava na fala de outro', async () => assert.equal((await req(`/api/falas/${falaMoon.id}/tomadas`, {token: erick, method: 'POST', body: wav(), headers: {'Content-Type': 'audio/wav'}})).status, 403));
await teste('arquivo que não é WAV é recusado', async () => assert.equal((await req(`/api/falas/${falaMoon.id}/tomadas`, {token: moon, method: 'POST', body: new TextEncoder().encode('isso nao e audio nenhum, so texto aqui dentro ok ok ok'), headers: {'Content-Type': 'audio/wav'}})).status, 400));
await teste('dono grava até 3 versões', async () => {
	for (let i = 0; i < 3; i++) {
		const r = await req(`/api/falas/${falaMoon.id}/tomadas?pico=0.3`, {token: moon, method: 'POST', body: wav(1 + i * 0.5), headers: {'Content-Type': 'audio/wav'}});
		assert.equal(r.status, 201, JSON.stringify(r.dados));
		if (i === 0) tom1 = r.dados.id;
		assert.equal(r.dados.duracao, Math.round((1 + i * 0.5) * 100) / 100);
	}
	assert.equal((await req(`/api/falas/${falaMoon.id}/tomadas`, {token: moon, method: 'POST', body: wav(), headers: {'Content-Type': 'audio/wav'}})).status, 409);
});
await teste('a primeira versão vira preferida e a fala fica "gravada"', async () => {
	const f = (await req(`/api/episodios/${ep}/falas`, {token: moon})).dados.falas[0];
	assert.equal(f.status, 'gravada');
	assert.equal(f.tomadas.filter((t) => t.preferida).length, 1);
	assert.equal(f.tomadas.find((t) => t.preferida).id, tom1);
});
await teste('outro amigo não ouve a gravação; o dono e o mestre ouvem', async () => {
	assert.equal((await req(`/api/tomadas/${tom1}/audio`, {token: erick})).status, 403);
	const r = await req(`/api/tomadas/${tom1}/audio`, {token: mestre});
	assert.equal(r.status, 200);
	assert.equal(new TextDecoder().decode(r.dados.slice(0, 4)), 'RIFF');
	assert.equal((await req(`/api/tomadas/${tom1}/audio`, {token: moon})).status, 200);
});
await teste('outro amigo não apaga nem marca preferida', async () => {
	assert.equal((await req(`/api/tomadas/${tom1}`, {token: erick, method: 'DELETE'})).status, 403);
	assert.equal((await req(`/api/tomadas/${tom1}/preferida`, {token: erick, method: 'POST'})).status, 403);
});
await teste('apagar a preferida passa a estrela para outra', async () => {
	assert.equal((await req(`/api/tomadas/${tom1}`, {token: moon, method: 'DELETE'})).status, 200);
	const f = (await req(`/api/episodios/${ep}/falas`, {token: moon})).dados.falas[0];
	assert.equal(f.tomadas.length, 2);
	assert.equal(f.tomadas.filter((t) => t.preferida).length, 1);
});
await teste('amigo não aprova a própria fala', async () => assert.equal((await req(`/api/falas/${falaMoon.id}/revisao`, {token: moon, method: 'POST', json: {status: 'aprovada'}})).status, 403));
await teste('mestre pede para refazer e o amigo vê o recado', async () => {
	assert.equal((await req(`/api/falas/${falaMoon.id}/revisao`, {token: mestre, method: 'POST', json: {status: 'refazer', recado: 'Mais encantada, mano'}})).status, 200);
	const f = (await req(`/api/episodios/${ep}/falas`, {token: moon})).dados.falas[0];
	assert.equal(f.status, 'refazer');
	assert.equal(f.recado, 'Mais encantada, mano');
});
await teste('subir de novo com texto mudado põe a fala gravada em "refazer"', async () => {
	await req(`/api/falas/${falaMoon.id}/revisao`, {token: mestre, method: 'POST', json: {status: 'aprovada'}});
	const novas = FALAS.map((f) => (f.id === '02' ? {...f, texto: f.texto + ' Sério.'} : f));
	assert.equal((await req('/api/episodios', {token: mestre, method: 'POST', json: {numero: 99, titulo: 'Teste da floresta', falas: novas}})).status, 200);
	const f = (await req(`/api/episodios/${ep}/falas`, {token: moon})).dados.falas[0];
	assert.equal(f.status, 'refazer');
	assert.match(f.recado, /texto/);
	assert.equal(f.tomadas.length, 2);
});
await teste('5 códigos errados travam o acesso', async () => {
	resetar('milk');
	for (let i = 0; i < 5; i++) await req('/api/entrar', {method: 'POST', json: {quem: 'milk', codigo: '11111' + i}});
	const r = await req('/api/entrar', {method: 'POST', json: {quem: 'milk', codigo: COD.milk}});
	assert.equal(r.status, 429);
	resetar('milk');
	assert.equal((await req('/api/entrar', {method: 'POST', json: {quem: 'milk', codigo: COD.milk}})).status, 200);
});
await teste('CORS só libera o site', async () => {
	const bom = await fetch(API + '/api/saude', {headers: {Origin: 'http://localhost:5500'}});
	assert.equal(bom.headers.get('access-control-allow-origin'), 'http://localhost:5500');
	const mau = await fetch(API + '/api/saude', {headers: {Origin: 'https://site-estranho.com'}});
	assert.equal(mau.headers.get('access-control-allow-origin'), null);
});
await teste('sair invalida a entrada', async () => {
	const t = await entrar('erick');
	await req('/api/sair', {token: t, method: 'POST'});
	assert.equal((await req('/api/eu', {token: t})).status, 401);
});
await teste('mestre apaga o episódio de teste com os áudios', async () => {
	assert.equal((await req(`/api/episodios/${ep}`, {token: mestre, method: 'DELETE'})).status, 200);
	assert.equal((await req('/api/uso', {token: mestre})).dados.tomadas, 0);
});
console.log(`\n${ok} testes passaram.`);
