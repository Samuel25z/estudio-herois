// API do Estúdio dos Heróis (Cloudflare Worker + D1 para os dados + KV para os áudios).
import {hashCodigo, sha256, aleatorioHex, iguais} from './senha.js';

export const PROTAGONISTAS = ['goubetti', 'erick', 'samuel', 'flowtz', 'znoob', 'caio', 'moon', 'milk'];
const MESTRE = 'mestre';
const MAX_TOMADAS = 3;
const MAX_BYTES = 12 * 1024 * 1024; // ~2 min de WAV 48 kHz mono
const MAX_FALHAS = 5;
const BLOQUEIO_S = 15 * 60;
const SESSAO_S = 30 * 24 * 3600;

const agora = () => Math.floor(Date.now() / 1000);

class Erro extends Error {
	constructor(status, msg) {
		super(msg);
		this.status = status;
	}
}

function cors(req, env) {
	const origem = req.headers.get('Origin') || '';
	const ok = (env.ORIGENS || '').split(',').map((s) => s.trim()).includes(origem);
	return ok
		? {'Access-Control-Allow-Origin': origem, 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin'}
		: {Vary: 'Origin'};
}

const json = (dados, status = 200) => new Response(JSON.stringify(dados), {status, headers: {'Content-Type': 'application/json; charset=utf-8'}});

async function corpoJson(req) {
	try {
		return await req.json();
	} catch {
		throw new Erro(400, 'Pedido mal formado.');
	}
}

// ---------- emoção e duração a partir do arquivo de falas da série ----------
export function emocaoDe(f) {
	if (f.emocao && String(f.emocao).trim()) return String(f.emocao).trim();
	let j = String(f.jeito || '').trim();
	j = j.replace(/^voz [^,]*,\s*/i, ''); // tira "Voz de jovem brasileiro de uns 20 anos,"
	return j ? j[0].toUpperCase() + j.slice(1) : '';
}

export function duracaoIdeal(f) {
	const d = Number(f.dur);
	if (d > 0) return Math.round(d * 10) / 10;
	const t = String(f.texto || '');
	const pausas = (t.match(/\.\.\.|…/g) || []).length;
	return Math.round((0.5 + t.length / 14 + pausas * 0.4) * 10) / 10;
}

// ---------- login ----------
async function login(req, env) {
	const {quem, codigo} = await corpoJson(req);
	if (typeof quem !== 'string' || typeof codigo !== 'string' || !/^\d{5,12}$/.test(codigo)) throw new Erro(400, 'Digite o código de 5 a 12 números.');
	const a = await env.DB.prepare('SELECT * FROM acessos WHERE quem = ?').bind(quem).first();
	if (!a) throw new Erro(401, 'Nome ou código errado.');
	const t = agora();
	if (a.bloqueado_ate > t) throw new Erro(429, `Muitas tentativas erradas. Tente de novo em ${Math.ceil((a.bloqueado_ate - t) / 60)} min.`);
	const h = await hashCodigo(codigo, a.sal);
	if (!iguais(h, a.hash)) {
		const falhas = a.falhas + 1;
		const bloq = falhas >= MAX_FALHAS ? t + BLOQUEIO_S : 0;
		await env.DB.prepare('UPDATE acessos SET falhas = ?, bloqueado_ate = ? WHERE quem = ?').bind(bloq ? 0 : falhas, bloq, quem).run();
		throw new Erro(401, bloq ? 'Código errado. Acesso travado por 15 min.' : 'Nome ou código errado.');
	}
	const token = aleatorioHex(32);
	await env.DB.batch([
		env.DB.prepare('UPDATE acessos SET falhas = 0, bloqueado_ate = 0 WHERE quem = ?').bind(quem),
		env.DB.prepare('DELETE FROM sessoes WHERE expira < ?').bind(t),
		env.DB.prepare('INSERT INTO sessoes (token_hash, quem, expira) VALUES (?, ?, ?)').bind(await sha256(token), quem, t + SESSAO_S),
	]);
	return json({token, quem});
}

async function quemE(req, env) {
	const m = (req.headers.get('Authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
	if (!m) throw new Erro(401, 'Entre de novo com o seu código.');
	const s = await env.DB.prepare('SELECT quem, expira FROM sessoes WHERE token_hash = ?').bind(await sha256(m[1])).first();
	if (!s || s.expira < agora()) throw new Erro(401, 'Entre de novo com o seu código.');
	return s.quem;
}

function soMestre(quem) {
	if (quem !== MESTRE) throw new Erro(403, 'Só o mestre pode fazer isso.');
}

// ---------- leitura ----------
async function listarEpisodios(env) {
	const {results} = await env.DB.prepare('SELECT id, numero, titulo FROM episodios ORDER BY numero DESC').all();
	return results;
}

async function falasDoEpisodio(env, epId, quem) {
	const {results: falas} = await env.DB.prepare('SELECT * FROM falas WHERE episodio_id = ? ORDER BY ordem').bind(epId).all();
	const {results: toms} = await env.DB.prepare('SELECT t.id, t.fala_id, t.duracao, t.pico, t.preferida, t.criado FROM tomadas t JOIN falas f ON f.id = t.fala_id WHERE f.episodio_id = ? ORDER BY t.id').bind(epId).all();
	const porFala = {};
	for (const t of toms) (porFala[t.fala_id] ||= []).push(t);
	const saida = [];
	falas.forEach((f, i) => {
		if (quem && f.quem !== quem) return;
		const antes = i > 0 ? {quem: falas[i - 1].quem, texto: falas[i - 1].texto} : null;
		const depois = i < falas.length - 1 ? {quem: falas[i + 1].quem, texto: falas[i + 1].texto} : null;
		saida.push({id: f.id, cod: f.cod, quem: f.quem, texto: f.texto, emocao: f.emocao, dur_ideal: f.dur_ideal, status: f.status, recado: f.recado, antes, depois, tomadas: porFala[f.id] || []});
	});
	return saida;
}

async function falaComDono(env, falaId, quem) {
	const f = await env.DB.prepare('SELECT * FROM falas WHERE id = ?').bind(falaId).first();
	if (!f) throw new Erro(404, 'Fala não encontrada.');
	if (quem !== MESTRE && f.quem !== quem) throw new Erro(403, 'Essa fala não é sua.');
	return f;
}

async function tomadaComDono(env, tomId, quem) {
	const t = await env.DB.prepare('SELECT t.*, f.quem AS dono FROM tomadas t JOIN falas f ON f.id = t.fala_id WHERE t.id = ?').bind(tomId).first();
	if (!t) throw new Erro(404, 'Gravação não encontrada.');
	if (quem !== MESTRE && t.dono !== quem) throw new Erro(403, 'Essa gravação não é sua.');
	return t;
}

// ---------- gravação ----------
export function lerWav(buf) {
	const v = new DataView(buf);
	const txt = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
	if (buf.byteLength < 44 || txt(0) !== 'RIFF' || txt(8) !== 'WAVE') throw new Erro(400, 'O arquivo não é um WAV.');
	let o = 12, fmt = null, dados = 0;
	while (o + 8 <= buf.byteLength) {
		const id = txt(o), tam = v.getUint32(o + 4, true);
		if (id === 'fmt ') fmt = {formato: v.getUint16(o + 8, true), canais: v.getUint16(o + 10, true), taxa: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true)};
		if (id === 'data') {
			dados = Math.min(tam, buf.byteLength - o - 8);
			break;
		}
		o += 8 + tam + (tam % 2);
	}
	if (!fmt || fmt.formato !== 1 || fmt.bits !== 16 || fmt.canais < 1 || fmt.taxa < 8000 || fmt.taxa > 96000) throw new Erro(400, 'Formato de áudio não aceito.');
	const duracao = dados / (fmt.taxa * fmt.canais * 2);
	if (duracao < 0.3) throw new Erro(400, 'A gravação ficou curta demais.');
	return {duracao: Math.round(duracao * 100) / 100};
}

async function novaTomada(req, env, falaId, quem) {
	const f = await falaComDono(env, falaId, quem);
	if (quem === MESTRE) throw new Erro(403, 'Quem grava é o dono da fala.');
	const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM tomadas WHERE fala_id = ?').bind(f.id).first('n');
	if (n >= MAX_TOMADAS) throw new Erro(409, `Já tem ${MAX_TOMADAS} versões. Apague uma para gravar outra.`);
	const tam = Number(req.headers.get('Content-Length') || 0);
	if (tam > MAX_BYTES) throw new Erro(413, 'Gravação longa demais (máximo 2 minutos).');
	const buf = await req.arrayBuffer();
	if (buf.byteLength > MAX_BYTES) throw new Erro(413, 'Gravação longa demais (máximo 2 minutos).');
	const {duracao} = lerWav(buf);
	const pico = Math.max(0, Math.min(1, Number(new URL(req.url).searchParams.get('pico')) || 0));
	const chave = `t/${f.id}/${aleatorioHex(8)}`;
	await env.AUDIOS.put(chave, buf);
	const r = await env.DB.prepare('INSERT INTO tomadas (fala_id, chave, duracao, pico, bytes, preferida, criado) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
		.bind(f.id, chave, duracao, pico, buf.byteLength, n === 0 ? 1 : 0, agora()).first();
	// nova versão depois de "refazer" volta para a fila do mestre (o recado continua visível)
	await env.DB.prepare("UPDATE falas SET status = 'gravada' WHERE id = ? AND status IN ('pendente','refazer','aprovada')").bind(f.id).run();
	return json({id: r.id, duracao}, 201);
}

async function apagarTomada(env, t) {
	await env.AUDIOS.delete(t.chave);
	await env.DB.prepare('DELETE FROM tomadas WHERE id = ?').bind(t.id).run();
	const resto = await env.DB.prepare('SELECT id, preferida FROM tomadas WHERE fala_id = ? ORDER BY id DESC').bind(t.fala_id).all();
	if (!resto.results.length) {
		await env.DB.prepare("UPDATE falas SET status = CASE WHEN status = 'refazer' THEN 'refazer' ELSE 'pendente' END WHERE id = ?").bind(t.fala_id).run();
	} else if (!resto.results.some((x) => x.preferida)) {
		await env.DB.prepare('UPDATE tomadas SET preferida = 1 WHERE id = ?').bind(resto.results[0].id).run();
	}
}

// ---------- mestre ----------
async function importarEpisodio(req, env) {
	const d = await corpoJson(req);
	const numero = Number(d.numero);
	const titulo = String(d.titulo || '').trim().slice(0, 120);
	if (!Number.isInteger(numero) || numero < 1 || numero > 999) throw new Erro(400, 'Número do episódio inválido.');
	if (!titulo) throw new Erro(400, 'Falta o título do episódio.');
	if (!Array.isArray(d.falas) || !d.falas.length || d.falas.length > 500) throw new Erro(400, 'O arquivo precisa ter a lista de falas.');
	const falas = d.falas.map((f, i) => {
		const id = String(f.id ?? '').trim();
		const quem = String(f.quem ?? '').trim().toLowerCase();
		const texto = String(f.texto ?? '').trim();
		if (!id || !quem || !texto) throw new Erro(400, `A fala nº ${i + 1} está sem id, quem ou texto.`);
		return {ordem: i, cod: `${id}-${quem}`.slice(0, 60), quem: quem.slice(0, 30), texto: texto.slice(0, 600), emocao: emocaoDe(f).slice(0, 300), dur: duracaoIdeal(f)};
	});
	const cods = new Set();
	for (const f of falas) {
		if (cods.has(f.cod)) throw new Erro(400, `A fala ${f.cod} aparece duas vezes.`);
		cods.add(f.cod);
	}
	let ep = await env.DB.prepare('SELECT id FROM episodios WHERE numero = ?').bind(numero).first();
	if (!ep) ep = await env.DB.prepare('INSERT INTO episodios (numero, titulo, criado) VALUES (?, ?, ?) RETURNING id').bind(numero, titulo, agora()).first();
	else await env.DB.prepare('UPDATE episodios SET titulo = ? WHERE id = ?').bind(titulo, ep.id).run();
	const {results: velhas} = await env.DB.prepare('SELECT id, cod, texto FROM falas WHERE episodio_id = ?').bind(ep.id).all();
	const velhaPorCod = Object.fromEntries(velhas.map((v) => [v.cod, v]));
	const ops = [];
	for (const f of falas) {
		const v = velhaPorCod[f.cod];
		if (!v) {
			ops.push(env.DB.prepare('INSERT INTO falas (episodio_id, ordem, cod, quem, texto, emocao, dur_ideal) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(ep.id, f.ordem, f.cod, f.quem, f.texto, f.emocao, f.dur));
		} else if (v.texto !== f.texto) {
			ops.push(env.DB.prepare("UPDATE falas SET ordem = ?, texto = ?, emocao = ?, dur_ideal = ?, status = CASE WHEN EXISTS (SELECT 1 FROM tomadas WHERE fala_id = falas.id) THEN 'refazer' ELSE 'pendente' END, recado = CASE WHEN EXISTS (SELECT 1 FROM tomadas WHERE fala_id = falas.id) THEN 'O texto desta fala mudou. Grave de novo, por favor.' ELSE recado END WHERE id = ?").bind(f.ordem, f.texto, f.emocao, f.dur, v.id));
		} else {
			ops.push(env.DB.prepare('UPDATE falas SET ordem = ?, emocao = ?, dur_ideal = ? WHERE id = ?').bind(f.ordem, f.emocao, f.dur, v.id));
		}
	}
	const sairam = velhas.filter((v) => !cods.has(v.cod));
	for (const v of sairam) {
		const {results: ts} = await env.DB.prepare('SELECT chave FROM tomadas WHERE fala_id = ?').bind(v.id).all();
		for (const t of ts) await env.AUDIOS.delete(t.chave);
		ops.push(env.DB.prepare('DELETE FROM tomadas WHERE fala_id = ?').bind(v.id));
		ops.push(env.DB.prepare('DELETE FROM falas WHERE id = ?').bind(v.id));
	}
	await env.DB.batch(ops);
	const paraGravar = falas.filter((f) => PROTAGONISTAS.includes(f.quem)).length;
	return json({id: ep.id, numero, titulo, falas: falas.length, para_gravar: paraGravar, removidas: sairam.length});
}

async function revisar(req, env, falaId) {
	const {status, recado} = await corpoJson(req);
	if (!['aprovada', 'refazer'].includes(status)) throw new Erro(400, 'Escolha aprovada ou refazer.');
	const f = await env.DB.prepare('SELECT id FROM falas WHERE id = ?').bind(falaId).first();
	if (!f) throw new Erro(404, 'Fala não encontrada.');
	await env.DB.prepare('UPDATE falas SET status = ?, recado = ? WHERE id = ?').bind(status, String(recado || '').trim().slice(0, 500), falaId).run();
	return json({ok: true});
}

async function apagarAudiosDoEpisodio(env, epId, tambemEpisodio) {
	const {results: ts} = await env.DB.prepare('SELECT t.chave FROM tomadas t JOIN falas f ON f.id = t.fala_id WHERE f.episodio_id = ?').bind(epId).all();
	for (const t of ts) await env.AUDIOS.delete(t.chave);
	const ops = [
		env.DB.prepare('DELETE FROM tomadas WHERE fala_id IN (SELECT id FROM falas WHERE episodio_id = ?)').bind(epId),
		env.DB.prepare("UPDATE falas SET status = 'pendente', recado = '' WHERE episodio_id = ?").bind(epId),
	];
	if (tambemEpisodio) ops.push(env.DB.prepare('DELETE FROM falas WHERE episodio_id = ?').bind(epId), env.DB.prepare('DELETE FROM episodios WHERE id = ?').bind(epId));
	await env.DB.batch(ops);
	return json({apagadas: ts.length});
}

// ---------- rotas ----------
async function rotear(req, env) {
	const url = new URL(req.url);
	const p = url.pathname.replace(/\/+$/, '');
	const M = req.method;
	let m;
	if (M === 'GET' && p === '/api/saude') return json({ok: true});
	if (M === 'GET' && p === '/api/personagens') return json({personagens: PROTAGONISTAS});
	if (M === 'POST' && p === '/api/entrar') return login(req, env);

	const quem = await quemE(req, env);
	if (M === 'POST' && p === '/api/sair') {
		const tok = req.headers.get('Authorization').slice(7);
		await env.DB.prepare('DELETE FROM sessoes WHERE token_hash = ?').bind(await sha256(tok)).run();
		return json({ok: true});
	}
	if (M === 'GET' && p === '/api/eu') return json({quem});
	if (M === 'GET' && p === '/api/episodios') return json({episodios: await listarEpisodios(env)});
	if (M === 'GET' && (m = p.match(/^\/api\/episodios\/(\d+)\/falas$/))) {
		const ep = await env.DB.prepare('SELECT id, numero, titulo FROM episodios WHERE id = ?').bind(m[1]).first();
		if (!ep) throw new Erro(404, 'Episódio não encontrado.');
		return json({episodio: ep, falas: await falasDoEpisodio(env, ep.id, quem === MESTRE ? null : quem)});
	}
	if (M === 'POST' && (m = p.match(/^\/api\/falas\/(\d+)\/tomadas$/))) return novaTomada(req, env, Number(m[1]), quem);
	if ((m = p.match(/^\/api\/tomadas\/(\d+)$/)) && M === 'DELETE') {
		const t = await tomadaComDono(env, Number(m[1]), quem);
		await apagarTomada(env, t);
		return json({ok: true});
	}
	if (M === 'GET' && (m = p.match(/^\/api\/tomadas\/(\d+)\/audio$/))) {
		const t = await tomadaComDono(env, Number(m[1]), quem);
		const a = await env.AUDIOS.get(t.chave, 'arrayBuffer');
		if (!a) throw new Erro(404, 'Áudio não encontrado.');
		return new Response(a, {headers: {'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=3600'}});
	}
	if (M === 'POST' && (m = p.match(/^\/api\/tomadas\/(\d+)\/preferida$/))) {
		const t = await tomadaComDono(env, Number(m[1]), quem);
		await env.DB.batch([
			env.DB.prepare('UPDATE tomadas SET preferida = 0 WHERE fala_id = ?').bind(t.fala_id),
			env.DB.prepare('UPDATE tomadas SET preferida = 1 WHERE id = ?').bind(t.id),
		]);
		return json({ok: true});
	}

	// daqui para baixo, só o mestre
	soMestre(quem);
	if (M === 'POST' && p === '/api/episodios') return importarEpisodio(req, env);
	if (M === 'POST' && (m = p.match(/^\/api\/falas\/(\d+)\/revisao$/))) return revisar(req, env, Number(m[1]));
	if (M === 'DELETE' && (m = p.match(/^\/api\/episodios\/(\d+)\/audios$/))) return apagarAudiosDoEpisodio(env, Number(m[1]), false);
	if (M === 'DELETE' && (m = p.match(/^\/api\/episodios\/(\d+)$/))) return apagarAudiosDoEpisodio(env, Number(m[1]), true);
	if (M === 'GET' && p === '/api/uso') {
		const r = await env.DB.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes, COUNT(*) AS n FROM tomadas').first();
		return json({bytes: r.bytes, tomadas: r.n, limite: 1024 * 1024 * 1024});
	}
	throw new Erro(404, 'Caminho não encontrado.');
}

export default {
	async fetch(req, env) {
		const h = cors(req, env);
		if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: h});
		let res;
		try {
			res = await rotear(req, env);
		} catch (e) {
			if (e instanceof Erro) res = json({erro: e.message}, e.status);
			else {
				console.error(e);
				res = json({erro: 'Deu um erro aqui no servidor. Tente de novo.'}, 500);
			}
		}
		const r = new Response(res.body, res);
		for (const [k, v] of Object.entries(h)) r.headers.set(k, v);
		r.headers.set('X-Content-Type-Options', 'nosniff');
		return r;
	},
};
