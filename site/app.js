import {API} from './config.js';
import {Gravador, paraWav, deWav, MAX_SEGUNDOS} from './gravador.js';
import {analisar, veredito, desenhar} from './analise.js';
import {montarZip} from './zip.js';

const HEROIS = {
	goubetti: {nome: 'Goubetti', cor: '#3f6e8c'},
	erick: {nome: 'Erick', cor: '#55782f'},
	samuel: {nome: 'Samuel', cor: '#8a5a2b'},
	flowtz: {nome: 'Flowtz', cor: '#4a4f6b'},
	znoob: {nome: 'Znoob', cor: '#7a3f6e'},
	caio: {nome: 'Caio', cor: '#b0552a'},
	moon: {nome: 'Moon', cor: '#8f7420'},
	milk: {nome: 'Milk', cor: '#4f7f7a'},
	viih: {nome: 'Viih', cor: '#9c3f5a'},
};
const OUTROS = {narrador: 'Narrador', capitao: 'Capitão', guarda: 'Guarda', arvore: 'Árvore', sapo: 'Sapo', bruxa: 'Bruxa Vibradora'};
const nomeDe = (q) => HEROIS[q]?.nome || OUTROS[q] || (q ? q[0].toUpperCase() + q.slice(1) : '');
const ESTADOS = {pendente: 'Falta gravar', gravada: 'Gravada', aprovada: 'Aprovada', refazer: 'Refazer'};

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const num = (x, d = 1) => x.toFixed(d).replace('.', ',');

const IC = {
	mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
	stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
	play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
	pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
	lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
	estrela: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6-4.5-4.2 6.1-.8z"/></svg>',
	mascara: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 5c5 2 11 2 16 0v6a8 8 0 0 1-16 0z"/><path d="M8.5 10.5h1M14.5 10.5h1M9 15c2 1.5 4 1.5 6 0"/></svg>',
	baixar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
	analise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h3l3-7 4 14 3-7h5"/></svg>',
};
const selo = (q) => `<span class="selo" style="--cor:${HEROIS[q]?.cor || '#6b5843'}" aria-hidden="true">${esc(nomeDe(q)[0] || '?')}</span>`;

// ---------- sessão (guardada só neste aparelho) ----------
const CHAVE = 'estudio_sessao';
function sessao() {
	try {
		return JSON.parse(localStorage.getItem(CHAVE) || 'null');
	} catch {
		return null;
	}
}
function salvarSessao(s) {
	try {
		s ? localStorage.setItem(CHAVE, JSON.stringify(s)) : localStorage.removeItem(CHAVE);
	} catch {}
	memoria = s;
}
let memoria = sessao();

async function api(caminho, op = {}) {
	const h = {...(op.headers || {})};
	if (memoria?.token) h.Authorization = 'Bearer ' + memoria.token;
	if (op.json !== undefined) {
		h['Content-Type'] = 'application/json';
		op.body = JSON.stringify(op.json);
	}
	let r;
	try {
		r = await fetch(API + caminho, {method: op.method || 'GET', headers: h, body: op.body});
	} catch {
		throw new Error('Sem conexão com o estúdio. Confira a internet e tente de novo.');
	}
	if (r.status === 401 && caminho !== '/api/entrar') {
		salvarSessao(null);
		location.hash = '#/';
		throw new Error('Sua entrada expirou. Entre de novo com o seu código.');
	}
	if (op.bruto && r.ok) return r;
	const d = await r.json().catch(() => ({}));
	if (!r.ok) throw new Error(d.erro || 'Algo deu errado. Tente de novo.');
	return d;
}

// ---------- aviso e modal ----------
let tAviso;
function aviso(txt, ruim = false) {
	const a = document.getElementById('aviso');
	a.textContent = txt;
	a.className = 'aviso' + (ruim ? ' ruim' : '');
	a.hidden = false;
	clearTimeout(tAviso);
	tAviso = setTimeout(() => (a.hidden = true), 4200);
}

function modal({titulo, texto = '', campo = null, confirmar, perigo = false}) {
	return new Promise((ok) => {
		const m = document.getElementById('modal');
		m.innerHTML = `<div class="caixa" role="dialog" aria-modal="true" aria-labelledby="m-tit">
			<h2 id="m-tit">${esc(titulo)}</h2>
			${texto ? `<p>${esc(texto)}</p>` : ''}
			${campo === 'texto' ? '<label class="sr" for="m-campo">Recado</label><textarea id="m-campo" maxlength="500" placeholder="Ex.: mais bravo no final, quase gritando"></textarea>' : ''}
			${campo && campo !== 'texto' ? `<label for="m-campo">Para confirmar, digite <b>${esc(campo)}</b></label><input id="m-campo" autocomplete="off">` : ''}
			<div class="acoes"><button class="btn fino" data-r="nao">Cancelar</button><button class="btn ${perigo ? 'vermelho' : 'ouro'}" data-r="sim">${esc(confirmar)}</button></div>
		</div>`;
		m.hidden = false;
		const f = m.querySelector('#m-campo') || m.querySelector('[data-r=sim]');
		f.focus();
		const fechar = (v) => {
			m.hidden = true;
			m.innerHTML = '';
			document.removeEventListener('keydown', tecla);
			ok(v);
		};
		const tecla = (e) => e.key === 'Escape' && fechar(null);
		document.addEventListener('keydown', tecla);
		m.onclick = (e) => {
			const r = e.target.closest('[data-r]')?.dataset.r;
			if (e.target === m || r === 'nao') return fechar(null);
			if (r === 'sim') {
				const v = m.querySelector('#m-campo')?.value ?? true;
				if (campo && campo !== 'texto' && v.trim() !== campo) {
					m.querySelector('#m-campo').focus();
					return;
				}
				fechar(v === '' ? '' : v);
			}
		};
	});
}

// ---------- áudio das gravações (busca com a chave de entrada) ----------
const cacheAudio = new Map();
async function audioDe(tomId) {
	if (!cacheAudio.has(tomId)) {
		const p = api(`/api/tomadas/${tomId}/audio`, {bruto: true}).then((r) => r.arrayBuffer());
		cacheAudio.set(tomId, p);
		p.catch(() => cacheAudio.delete(tomId));
	}
	return cacheAudio.get(tomId);
}
const tocador = new Audio();
let tocando = null;
async function tocar(botao, fonte) {
	if (tocando === botao) return parar();
	parar();
	tocando = botao;
	botao.innerHTML = IC.pause;
	botao.setAttribute('aria-label', 'Pausar');
	try {
		const buf = typeof fonte === 'function' ? await fonte() : fonte;
		tocador.src = URL.createObjectURL(new Blob([buf], {type: 'audio/wav'}));
		await tocador.play();
	} catch (e) {
		parar();
		aviso(e.message || 'Não deu para tocar o áudio.', true);
	}
}
function parar() {
	tocador.pause();
	if (tocador.src) URL.revokeObjectURL(tocador.src);
	tocador.removeAttribute('src');
	if (tocando) {
		tocando.innerHTML = IC.play;
		tocando.setAttribute('aria-label', 'Ouvir');
	}
	tocando = null;
}
tocador.onended = parar;

// ---------- painel de análise ----------
function htmlAnalise(a) {
	const v = veredito(a);
	return `<div class="analise">
		<canvas aria-label="Desenho da fala: volume, pausas e a linha do tom"></canvas>
		<div class="legenda"><span style="--c:var(--onda)">volume</span><span style="--c:var(--tom)">tom da voz</span><span style="--c:var(--faixa-pausa)">pausa</span><span style="--c:rgba(43,33,24,.18)">silêncio nas pontas</span></div>
		${a.semVoz ? '' : `<div class="numeros">
			<div><b>${num(a.fala)} s</b><small>fala${a.durIdeal ? ` (ideal ${num(a.durIdeal)})` : ''}</small></div>
			<div><b>${a.pausas.length}</b><small>${a.pausas.length === 1 ? 'pausa' : 'pausas'}</small></div>
			<div><b>${a.tomMedio ? Math.round(a.tomMedio) + ' Hz' : '–'}</b><small>tom médio</small></div>
		</div>`}
		<ul class="vered">${v.map((i) => `<li class="v-${i.tipo}">${esc(i.txt)}</li>`).join('')}</ul>
	</div>`;
}
function mostrarAnalise(alvo, a) {
	alvo.innerHTML = htmlAnalise(a);
	requestAnimationFrame(() => desenhar(alvo.querySelector('canvas'), a));
}

// ---------- telas ----------
function telaInicio() {
	$app.innerHTML = `<header class="capa"><h1>Estúdio dos Heróis</h1><p>Toque no seu nome para gravar as suas falas.</p></header>
		<nav class="herois" aria-label="Personagens">${Object.entries(HEROIS).map(([q, h]) => `<button class="heroi" data-q="${q}">${selo(q)}<span>${h.nome}</span></button>`).join('')}</nav>
		<button class="link-mestre" data-q="mestre">Entrar como mestre</button>`;
	$app.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => (location.hash = '#/entrar/' + b.dataset.q)));
}

function telaEntrar(quem) {
	const mestre = quem === 'mestre';
	if (!mestre && !HEROIS[quem]) return (location.hash = '#/');
	$app.innerHTML = `<button class="voltar" id="voltar">Voltar</button>
		<form class="cartao-entrar" id="f" novalidate>
			${mestre ? '' : selo(quem)}
			<h2>${mestre ? 'Mestre' : esc(HEROIS[quem].nome)}</h2>
			<label for="cod">Digite o seu código</label>
			<input class="codigo" id="cod" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="12" required>
			<p class="erro" id="erro" role="alert"></p>
			<button class="btn ouro" id="entrar">Entrar</button>
		</form>`;
	document.getElementById('voltar').onclick = () => (location.hash = '#/');
	const cod = document.getElementById('cod');
	cod.focus();
	cod.oninput = () => (cod.value = cod.value.replace(/\D/g, ''));
	document.getElementById('f').onsubmit = async (e) => {
		e.preventDefault();
		const erro = document.getElementById('erro');
		const bt = document.getElementById('entrar');
		if (cod.value.length < 5) return (erro.textContent = 'O código tem pelo menos 5 números.');
		bt.disabled = true;
		bt.textContent = 'Entrando…';
		erro.textContent = '';
		try {
			const s = await api('/api/entrar', {method: 'POST', json: {quem, codigo: cod.value}});
			salvarSessao(s);
			location.hash = mestre ? '#/mestre' : '#/falas';
		} catch (er) {
			erro.textContent = er.message;
			bt.disabled = false;
			bt.textContent = 'Entrar';
			cod.select();
		}
	};
}

async function escolherEpisodio() {
	const {episodios} = await api('/api/episodios');
	const pedido = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('ep'));
	const ep = episodios.find((e) => e.id === pedido) || episodios[0];
	return {episodios, ep};
}
const seletorEp = (episodios, ep) =>
	episodios.length > 1
		? `<div class="ep-escolha"><label for="ep">Episódio</label><select id="ep">${episodios.map((e) => `<option value="${e.id}" ${e.id === ep.id ? 'selected' : ''}>${e.numero}. ${esc(e.titulo)}</option>`).join('')}</select></div>`
		: `<div class="ep-escolha"><span>Episódio ${ep.numero}: ${esc(ep.titulo)}</span></div>`;
function ligarSeletor(base) {
	const s = document.getElementById('ep');
	if (s) s.onchange = () => (location.hash = `${base}?ep=${s.value}`);
}

async function telaFalas() {
	const s = memoria;
	if (!s || !HEROIS[s.quem]) return (location.hash = s?.quem === 'mestre' ? '#/mestre' : '#/');
	const topo = `<header class="topo">${selo(s.quem)}<h1>${esc(HEROIS[s.quem].nome)}</h1><button class="sair" id="sair">Sair</button></header>`;
	$app.innerHTML = topo + '<p class="carregando">Buscando as suas falas…</p>';
	ligarSair();
	try {
		const {episodios, ep} = await escolherEpisodio();
		await carregaAvulsas();
		if (!ep) {
			$app.innerHTML = topo + avisoAvulsa(s.quem) + '<div class="vazio"><h2>Nenhuma fala ainda</h2><p>Quando o próximo episódio estiver pronto, as suas falas aparecem aqui.</p></div>';
			return ligarSair();
		}
		const {falas} = await api(`/api/episodios/${ep.id}/falas`);
		await carregaAvulsas();
		const feitas = falas.filter((f) => f.tomadas.length).length;
		$app.innerHTML = topo + avisoAvulsa(s.quem) + seletorEp(episodios, ep) +
			(falas.length
				? `<div class="progresso">${feitas} de ${falas.length} ${falas.length === 1 ? 'fala gravada' : 'falas gravadas'}<div class="barra"><i style="width:${(feitas / falas.length) * 100}%"></i></div></div>
				<section id="lista">${falas.map(htmlFala).join('')}</section>`
				: '<div class="vazio"><h2>Nada para você neste episódio</h2><p>O seu personagem não fala neste. Descanse a voz.</p></div>');
		ligarSair();
		ligarSeletor('#/falas');
		falas.forEach((f) => ligarFala(f));
	} catch (e) {
		$app.innerHTML = topo + `<div class="falha">${esc(e.message)}</div>`;
		ligarSair();
	}
}
function ligarSair() {
	const b = document.getElementById('sair');
	if (b)
		b.onclick = async () => {
			try {
				await api('/api/sair', {method: 'POST'});
			} catch {}
			salvarSessao(null);
			location.hash = '#/';
		};
}

function htmlTomadas(f, dono) {
	return f.tomadas
		.map(
			(t, i) => `<li class="tomada" data-t="${t.id}">
			<button class="ico play" data-acao="ouvir" aria-label="Ouvir">${IC.play}</button>
			<span class="rotulo">Versão ${i + 1} <small>${num(t.duracao)} s${t.preferida ? ', a preferida' : ''}</small></span>
			<button class="ico" data-acao="analise" aria-label="Ver análise">${IC.analise}</button>
			${dono ? `<button class="ico" data-acao="baixar" aria-label="Baixar o áudio">${IC.baixar}</button>` : ''}
			${dono ? `<button class="ico fav" data-acao="fav" aria-pressed="${t.preferida ? 'true' : 'false'}" aria-label="Marcar como preferida">${IC.estrela}</button>
			<button class="ico" data-acao="apagar" aria-label="Apagar esta versão">${IC.lixo}</button>` : `<span class="ico fav" aria-pressed="${t.preferida ? 'true' : 'false'}" title="${t.preferida ? 'Preferida' : ''}">${t.preferida ? IC.estrela : ''}</span>`}
		</li>`
		)
		.join('');
}

function htmlFala(f) {
	const cheio = f.tomadas.length >= 3;
	return `<article class="folha ${f.status}" id="fala-${f.id}">
		<div class="cab"><span>Fala ${esc(f.cod.split('-')[0])}</span><span class="estado ${f.status}">${ESTADOS[f.status] || ''}</span></div>
		${f.antes ? `<p class="antes"><b>${esc(nomeDe(f.antes.quem))}:</b> ${esc(f.antes.texto)}</p>` : ''}
		<p class="texto">${esc(f.texto)}</p>
		${f.emocao ? `<p class="emocao">${IC.mascara}<span>${esc(f.emocao)}</span></p>` : ''}
		${f.dur_ideal ? `<p class="ideal">Tempo ideal: uns ${num(f.dur_ideal)} segundos</p>` : ''}
		${f.recado && (f.status === 'refazer' || f.status === 'gravada') ? `<div class="recado"><b>Recado do mestre</b>${esc(f.recado)}</div>` : ''}
		<ul class="tomadas">${htmlTomadas(f, true)}</ul>
		<div class="analise-alvo"></div>
		<div class="gravar">
			<button class="selo-rec" data-acao="gravar" ${cheio ? 'disabled' : ''} aria-label="Gravar">${IC.mic}</button>
			<div class="medidor"><span class="dica">${cheio ? 'Já tem 3 versões. Apague uma para gravar outra.' : f.tomadas.length ? 'Gravar outra versão' : 'Toque para gravar'}</span></div>
		</div>
	</article>`;
}

let gravando = null;
function ligarFala(f) {
	const el = document.getElementById('fala-' + f.id);
	const alvo = el.querySelector('.analise-alvo');
	const medidor = el.querySelector('.medidor');
	const rec = el.querySelector('[data-acao=gravar]');

	el.querySelector('.tomadas').onclick = async (e) => {
		const b = e.target.closest('[data-acao]');
		if (!b) return;
		const tid = Number(b.closest('[data-t]').dataset.t);
		const t = f.tomadas.find((x) => x.id === tid);
		if (b.dataset.acao === 'ouvir') tocar(b, () => audioDe(tid));
		if (b.dataset.acao === 'baixar') {
			const nome = `${f.cod || 'fala'}-versao${f.tomadas.indexOf(t) + 1}.wav`;
			const blob = new Blob([await audioDe(tid)], {type: 'audio/wav'});
			const arq = new File([blob], nome, {type: 'audio/wav'});
			if (navigator.canShare?.({files: [arq]})) {
				try {
					return await navigator.share({files: [arq], title: nome});
				} catch (e2) {
					if (e2.name === 'AbortError') return;
				}
			}
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = nome;
			document.body.appendChild(a);
			a.click();
			a.remove();
		}
		if (b.dataset.acao === 'analise') {
			alvo.innerHTML = '<p class="dica">Medindo…</p>';
			try {
				const {amostras, sr} = deWav(await audioDe(tid));
				mostrarAnalise(alvo, analisar(amostras, sr, f.dur_ideal));
			} catch (er) {
				alvo.innerHTML = `<p class="erro">${esc(er.message)}</p>`;
			}
		}
		if (b.dataset.acao === 'fav') {
			try {
				await api(`/api/tomadas/${tid}/preferida`, {method: 'POST'});
				f.tomadas.forEach((x) => (x.preferida = x.id === tid ? 1 : 0));
				el.querySelector('.tomadas').innerHTML = htmlTomadas(f, true);
				aviso('Versão marcada como preferida.');
			} catch (er) {
				aviso(er.message, true);
			}
		}
		if (b.dataset.acao === 'apagar') {
			const n = f.tomadas.indexOf(t) + 1;
			if (!(await modal({titulo: `Apagar a versão ${n}?`, texto: 'Ela some do estúdio e não dá para recuperar.', confirmar: 'Apagar versão', perigo: true}))) return;
			try {
				await api(`/api/tomadas/${tid}`, {method: 'DELETE'});
				aviso('Versão apagada.');
				recarregarFala(f.id);
			} catch (er) {
				aviso(er.message, true);
			}
		}
	};

	rec.onclick = async () => {
		if (gravando && gravando.el !== el) return aviso('Termine a gravação que está aberta primeiro.', true);
		if (gravando) return pararGravacao();
		parar();
		alvo.innerHTML = '';
		const g = new Gravador(
			(p, seg) => {
				const i = medidor.querySelector('.nivel i');
				if (i) {
					i.style.width = Math.min(100, p * 110) + '%';
					i.classList.toggle('alto', p > 0.95);
				}
				const tm = medidor.querySelector('.tempo');
				if (tm) tm.textContent = num(seg) + ' s';
			},
			() => pararGravacao()
		);
		gravando = {el, g, f, alvo, medidor, rec};
		rec.disabled = true;
		medidor.innerHTML = '<span class="dica">Abrindo o microfone…</span>';
		try {
			await g.comecar();
		} catch (er) {
			gravando = null;
			rec.disabled = false;
			medidor.innerHTML = `<span class="erro">${esc(er.message)}</span>`;
			return;
		}
		rec.disabled = false;
		rec.classList.add('ao-vivo');
		rec.innerHTML = IC.stop;
		rec.setAttribute('aria-label', 'Parar gravação');
		medidor.innerHTML = `<span class="tempo">0,0 s</span><div class="nivel" aria-hidden="true"><i></i></div><span class="dica">Gravando… toque de novo para parar (máx. ${MAX_SEGUNDOS} s)</span>`;
	};
}

async function pararGravacao() {
	const G = gravando;
	if (!G || G.parando) return;
	G.parando = true;
	const {el, g, f, alvo, medidor, rec} = G;
	rec.classList.remove('ao-vivo');
	rec.innerHTML = IC.mic;
	rec.setAttribute('aria-label', 'Gravar');
	const {amostras, sr} = await g.parar();
	gravando = null;
	const a = analisar(amostras, sr, f.dur_ideal);
	const wav = paraWav(amostras, sr);
	mostrarAnalise(alvo, a);
	medidor.innerHTML = '<span class="dica">Ouça e veja se ficou bom.</span>';
	rec.disabled = true;
	const acoes = document.createElement('div');
	acoes.className = 'acoes';
	acoes.innerHTML = `<button class="ico play" data-acao="ouvir-nova" aria-label="Ouvir">${IC.play}</button>
		<button class="btn ouro" data-acao="guardar" ${a.semVoz ? 'disabled' : ''}>Guardar esta versão</button>
		<button class="btn fino" data-acao="descartar">Descartar</button>`;
	alvo.querySelector('.analise').appendChild(acoes);
	const bufNova = await wav.arrayBuffer();
	acoes.onclick = async (e) => {
		const b = e.target.closest('[data-acao]');
		if (!b) return;
		if (b.dataset.acao === 'ouvir-nova') tocar(b, bufNova);
		if (b.dataset.acao === 'descartar') {
			parar();
			alvo.innerHTML = '';
			rec.disabled = false;
			medidor.innerHTML = '<span class="dica">Toque para gravar</span>';
		}
		if (b.dataset.acao === 'guardar') {
			parar();
			b.disabled = true;
			b.textContent = 'Enviando…';
			try {
				await api(`/api/falas/${f.id}/tomadas?pico=${a.pico.toFixed(3)}`, {method: 'POST', body: wav, headers: {'Content-Type': 'audio/wav'}});
				aviso('Versão guardada.');
				recarregarFala(f.id);
			} catch (er) {
				b.disabled = false;
				b.textContent = 'Tentar enviar de novo';
				aviso(er.message, true);
			}
		}
	};
}

async function recarregarFala(id) {
	// relê o episódio e troca só a folha desta fala (mantém o resto da tela como está)
	const ep = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('ep'));
	try {
		const {episodios} = await api('/api/episodios');
		const e = episodios.find((x) => x.id === ep) || episodios[0];
		const {falas} = await api(`/api/episodios/${e.id}/falas`);
		const f = falas.find((x) => x.id === id);
		const el = document.getElementById('fala-' + id);
		if (f && el) {
			el.outerHTML = htmlFala(f);
			ligarFala(f);
		}
		const feitas = falas.filter((x) => x.tomadas.length).length;
		const pr = document.querySelector('.progresso');
		if (pr) pr.innerHTML = `${feitas} de ${falas.length} ${falas.length === 1 ? 'fala gravada' : 'falas gravadas'}<div class="barra"><i style="width:${(feitas / falas.length) * 100}%"></i></div>`;
	} catch (er) {
		aviso(er.message, true);
	}
}

// ---------- mestre ----------
async function telaMestre() {
	const s = memoria;
	if (!s || s.quem !== 'mestre') return (location.hash = '#/entrar/mestre');
	const topo = `<header class="topo"><h1>Painel do mestre</h1><button class="sair" id="sair">Sair</button></header>`;
	$app.innerHTML = topo + '<p class="carregando">Abrindo o painel…</p>';
	ligarSair();
	try {
		const [{episodios, ep}, uso] = await Promise.all([escolherEpisodio(), api('/api/uso')]);
		let corpo = '';
		let falas = [];
		if (ep) {
			falas = (await api(`/api/episodios/${ep.id}/falas`)).falas;
			const minhas = falas.filter((f) => HEROIS[f.quem]);
			const pref = minhas.filter((f) => f.tomadas.some((t) => t.preferida));
			corpo = seletorEp(episodios, ep) +
				`<h2>Quem já gravou</h2><div class="placar">${Object.keys(HEROIS)
					.map((q) => {
						const d = minhas.filter((f) => f.quem === q);
						if (!d.length) return '';
						return `<div>${selo(q)}<span>${HEROIS[q].nome}<small>${d.filter((f) => f.tomadas.length).length} de ${d.length} gravadas, ${d.filter((f) => f.status === 'aprovada').length} aprovadas</small></span></div>`;
					})
					.join('')}</div>
				<div class="acoes"><button class="btn ouro" id="zip" ${pref.length ? '' : 'disabled'}>${IC.baixar} Baixar as preferidas (${pref.length})</button></div>
				<h2>Falas do episódio</h2>
				<section id="lista">${falas.map((f) => (HEROIS[f.quem] ? htmlFalaMestre(f) : `<article class="folha ia"><div class="cab"><span>${esc(f.cod.split('-')[0])} · ${esc(nomeDe(f.quem))}, voz da IA</span></div><p class="texto">${esc(f.texto)}</p></article>`)).join('')}</section>`;
		} else corpo = '<div class="vazio"><h2>Nenhum episódio ainda</h2><p>Suba o arquivo de falas do episódio aqui embaixo para os amigos começarem a gravar.</p></div>';
		const mb = (b) => num(b / 1048576, 0) + ' MB';
		$app.innerHTML = topo + `<div class="painel">${corpo}
			<h2>Subir falas de um episódio</h2>
			<form class="bloco" id="subir" novalidate>
				<label for="s-num">Número do episódio</label><input type="number" id="s-num" min="1" max="999" required value="${ep ? '' : 5}">
				<label for="s-tit">Título</label><input type="text" id="s-tit" maxlength="120" required>
				<label for="s-arq">Arquivo de falas (.json, igual ao cap0X-falas.json)</label><input type="file" id="s-arq" accept=".json,application/json" required>
				<p class="erro" id="s-erro" role="alert"></p>
				<button class="btn ouro">Subir falas</button>
				<p class="uso">Subir de novo o mesmo episódio atualiza as falas. Se o texto de uma fala mudar, ela volta para "refazer".</p>
			</form>
			<p class="uso">Espaço usado: ${mb(uso.bytes)} de ${mb(uso.limite)} (${uso.tomadas} gravações).</p>
			${ep ? `<div class="perigo"><button class="btn vermelho" id="limpar">${IC.lixo} Apagar os áudios do episódio ${ep.numero}</button></div>` : ''}
		</div>`;
		ligarSair();
		ligarSeletor('#/mestre');
		ligarSubir();
		if (ep) ligarMestre(ep, falas);
	} catch (e) {
		$app.innerHTML = topo + `<div class="falha">${esc(e.message)}</div>`;
		ligarSair();
	}
}

function htmlFalaMestre(f) {
	return `<article class="folha ${f.status}" id="fala-${f.id}" data-f="${f.id}">
		<div class="cab">${selo(f.quem)}<span>${esc(f.cod.split('-')[0])} · ${esc(nomeDe(f.quem))}</span><span class="estado ${f.status}">${ESTADOS[f.status]}</span></div>
		<p class="texto">${esc(f.texto)}</p>
		${f.emocao ? `<p class="emocao">${IC.mascara}<span>${esc(f.emocao)}</span></p>` : ''}
		${f.recado ? `<div class="recado"><b>Seu recado</b>${esc(f.recado)}</div>` : ''}
		${f.tomadas.length ? `<ul class="tomadas">${htmlTomadas(f, false)}</ul>` : '<p class="ideal">Ainda não gravou.</p>'}
		<div class="analise-alvo"></div>
		${f.tomadas.length ? `<div class="acoes"><button class="btn" data-acao="aprovar">Aprovar</button><button class="btn fino" data-acao="refazer">Pedir para refazer</button></div>` : ''}
	</article>`;
}

function ligarMestre(ep, falas) {
	document.getElementById('lista').onclick = async (e) => {
		const b = e.target.closest('[data-acao]');
		if (!b) return;
		const art = b.closest('[data-f]');
		if (!art) return;
		const f = falas.find((x) => x.id === Number(art.dataset.f));
		const tl = b.closest('[data-t]');
		const tid = tl && Number(tl.dataset.t);
		if (b.dataset.acao === 'ouvir') return tocar(b, () => audioDe(tid));
		if (b.dataset.acao === 'analise') {
			const alvo = art.querySelector('.analise-alvo');
			alvo.innerHTML = '<p class="dica">Medindo…</p>';
			try {
				const {amostras, sr} = deWav(await audioDe(tid));
				mostrarAnalise(alvo, analisar(amostras, sr, f.dur_ideal));
			} catch (er) {
				alvo.innerHTML = `<p class="erro">${esc(er.message)}</p>`;
			}
			return;
		}
		let corpo = null;
		if (b.dataset.acao === 'aprovar') corpo = {status: 'aprovada', recado: ''};
		if (b.dataset.acao === 'refazer') {
			const recado = await modal({titulo: `Pedir para ${nomeDe(f.quem)} refazer`, texto: 'Escreva o que mudar. Ele vê o recado na fala dele.', campo: 'texto', confirmar: 'Mandar recado'});
			if (recado === null) return;
			corpo = {status: 'refazer', recado};
		}
		if (!corpo) return;
		try {
			await api(`/api/falas/${f.id}/revisao`, {method: 'POST', json: corpo});
			Object.assign(f, corpo);
			art.outerHTML = htmlFalaMestre(f);
			aviso(corpo.status === 'aprovada' ? 'Fala aprovada.' : 'Recado enviado.');
		} catch (er) {
			aviso(er.message, true);
		}
	};
	document.getElementById('zip').onclick = async (e) => {
		const b = e.currentTarget;
		const lista = falas.filter((f) => HEROIS[f.quem]).map((f) => ({f, t: f.tomadas.find((t) => t.preferida)})).filter((x) => x.t);
		b.disabled = true;
		try {
			const arqs = [];
			for (const [i, {f, t}] of lista.entries()) {
				b.textContent = `Juntando ${i + 1} de ${lista.length}…`;
				arqs.push({nome: `${f.cod}.wav`, dados: new Uint8Array(await audioDe(t.id))});
			}
			const zip = montarZip(arqs);
			const a = document.createElement('a');
			a.href = URL.createObjectURL(zip);
			a.download = `herois-ep${String(ep.numero).padStart(2, '0')}-vozes.zip`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(a.href), 10000);
			aviso(`Zip com ${arqs.length} falas baixado.`);
		} catch (er) {
			aviso(er.message, true);
		}
		b.disabled = false;
		b.innerHTML = `${IC.baixar} Baixar as preferidas (${lista.length})`;
	};
	document.getElementById('limpar').onclick = async () => {
		const ok = await modal({titulo: `Apagar os áudios do episódio ${ep.numero}?`, texto: 'Todas as gravações deste episódio somem para sempre. As falas continuam lá. Baixe o zip antes.', campo: String(ep.numero), confirmar: 'Apagar áudios', perigo: true});
		if (!ok) return;
		try {
			const r = await api(`/api/episodios/${ep.id}/audios`, {method: 'DELETE'});
			cacheAudio.clear();
			aviso(`${r.apagadas} gravações apagadas.`);
			telaMestre();
		} catch (er) {
			aviso(er.message, true);
		}
	};
}

function ligarSubir() {
	document.getElementById('subir').onsubmit = async (e) => {
		e.preventDefault();
		const erro = document.getElementById('s-erro');
		const numero = Number(document.getElementById('s-num').value);
		const titulo = document.getElementById('s-tit').value.trim();
		const arq = document.getElementById('s-arq').files[0];
		erro.textContent = '';
		if (!numero) return (erro.textContent = 'Coloque o número do episódio.');
		if (!titulo) return (erro.textContent = 'Coloque o título do episódio.');
		if (!arq) return (erro.textContent = 'Escolha o arquivo de falas.');
		let falas;
		try {
			const d = JSON.parse(await arq.text());
			falas = Array.isArray(d) ? d : d.falas;
			if (!Array.isArray(falas)) throw new Error();
		} catch {
			return (erro.textContent = 'Esse arquivo não é uma lista de falas em JSON.');
		}
		const bt = e.target.querySelector('button');
		bt.disabled = true;
		try {
			const r = await api('/api/episodios', {method: 'POST', json: {numero, titulo, falas}});
			aviso(`Episódio ${r.numero}: ${r.para_gravar} falas para os amigos gravarem.`);
			location.hash = `#/mestre?ep=${r.id}`;
			telaMestre();
		} catch (er) {
			erro.textContent = er.message;
			bt.disabled = false;
		}
	};
}

// ---------- rotas ----------
function rota() {
	if (gravando) {
		gravando.g.cancelar();
		gravando = null;
	}
	parar();
	const h = location.hash.replace(/^#/, '').split('?')[0] || '/';
	let m;
	if ((m = h.match(/^\/entrar\/(\w+)$/))) return telaEntrar(m[1]);
	if ((m = h.match(/^\/gravar\/(\w+)$/))) return telaAvulsa(m[1]);
	if (h === '/falas') return telaFalas();
	if (h === '/mestre') return telaMestre();
	if (memoria?.quem === 'mestre') return (location.hash = '#/mestre');
	if (memoria && HEROIS[memoria.quem]) return (location.hash = '#/falas');
	telaInicio();
}

// ---------- gravação avulsa (sem login): grava, ouve e baixa o WAV para mandar direto ----------
// ---------- gravação rápida sem login: as falas novas de um capítulo (site/ep06.json) ----------
// Cada amigo abre #/gravar/<quem>, grava as falas dele e baixa (uma por uma ou todas num zip) para mandar ao Samuel.
let AVULSAS = null;
const carregaAvulsas = async () => {
	if (AVULSAS) return AVULSAS;
	try {
		AVULSAS = await (await fetch('ep06.json?v=11', {cache: 'no-store'})).json();
	} catch {
		AVULSAS = {falas: []};
	}
	return AVULSAS;
};
function avisoAvulsa(quem) {
	const L = AVULSAS?.falas.filter((f) => f.quem === quem) || [];
	if (!L.length) return '';
	return `<a class="folha pendente" href="#/gravar/${quem}" style="display:block;text-decoration:none;color:inherit;margin-bottom:16px;box-shadow:inset 4px 0 0 #b3261e">
		<div class="cab"><span>${esc(AVULSAS.ep)}</span><span class="estado refazer">${L.length} ${L.length > 1 ? 'falas novas' : 'fala nova'}</span></div>
		<p class="texto">${esc(L[0].texto)}${L.length > 1 ? ' …' : ''}</p>
		<p class="dica"><b>Toque aqui para gravar</b> e depois baixe os áudios para mandar ao Samuel.</p>
	</a>`;
}
async function telaAvulsa(quem) {
	await carregaAvulsas();
	const L = AVULSAS.falas.filter((f) => f.quem === quem);
	if (!L.length) return (location.hash = '#/');
	const wavs = {};
	let tocador = null;
	const nomeArq = (f) => `${AVULSAS.prefixo}-${f.id}-${f.quem}.wav`;
	const baixar = async (blob, nome) => {
		const arq = new File([blob], nome, {type: blob.type || 'application/octet-stream'});
		if (navigator.canShare?.({files: [arq]})) {
			try {
				return await navigator.share({files: [arq], title: nome});
			} catch (e) {
				if (e.name === 'AbortError') return;
			}
		}
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = nome;
		document.body.appendChild(a);
		a.click();
		a.remove();
	};
	$app.innerHTML = `<header class="topo">${selo(quem)}<h1>${esc(nomeDe(quem))}</h1></header>
	<p class="dica" style="margin:0 0 14px">${esc(AVULSAS.ep)}: ${L.length} ${L.length > 1 ? 'falas' : 'fala'} para gravar. Grave todas e no fim toque em <b>Baixar todas</b> (não feche a página antes de baixar).</p>
	${L.map((f, i) => `<article class="folha pendente" data-i="${i}">
		<div class="cab"><span>Fala ${esc(f.id)}</span><span class="estado pendente" data-estado>Falta gravar</span></div>
		${f.antes ? `<p class="antes">Antes: ${esc(f.antes)}</p>` : ''}
		<p class="texto">${esc(f.texto)}</p>
		<p class="emocao">${IC.mascara}<span>${esc(f.emocao)}</span></p>
		<p class="ideal">Tempo ideal: uns ${num(f.dur)} segundos</p>
		<div class="gravar">
			<button class="selo-rec" data-rec aria-label="Gravar">${IC.mic}</button>
			<div class="medidor"><span class="dica" data-dica>Toque para gravar</span></div>
		</div>
		<div data-pronto hidden>
			<div class="acoes" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:14px">
				<button class="btn fino" data-ouvir>${IC.play} Ouvir</button>
				<button class="btn fino" data-baixar>${IC.baixar} Baixar esta</button>
			</div>
		</div>
	</article>`).join('')}
	<div class="acoes" style="margin:18px 0 40px"><button class="btn ouro" id="todas" disabled>${IC.baixar} Baixar todas (0 de ${L.length})</button></div>`;
	const btTodas = document.getElementById('todas');
	const atualiza = () => {
		const n = Object.keys(wavs).length;
		btTodas.disabled = !n;
		btTodas.innerHTML = `${IC.baixar} Baixar todas (${n} de ${L.length})`;
	};
	document.querySelectorAll('article[data-i]').forEach((art) => {
		const f = L[Number(art.dataset.i)];
		const rec = art.querySelector('[data-rec]'), dica = art.querySelector('[data-dica]'), pronto = art.querySelector('[data-pronto]'), est = art.querySelector('[data-estado]');
		rec.onclick = async () => {
			if (gravando) {
				if (gravando.rec !== rec) return;
				const g = gravando.g;
				gravando = null;
				rec.innerHTML = IC.mic;
				const {amostras, sr} = await g.parar();
				wavs[f.id] = paraWav(amostras, sr);
				dica.textContent = `Gravado: ${num(amostras.length / sr)} s. Toque para gravar de novo`;
				est.textContent = 'Gravada';
				est.className = 'estado gravada';
				pronto.hidden = false;
				atualiza();
				return;
			}
			try {
				const g = new Gravador((p, seg) => (dica.textContent = `Gravando… ${num(seg)} s ${'▮'.repeat(Math.min(12, Math.round(p * 14)))}`), () => rec.click());
				await g.comecar();
				gravando = {g, rec};
				rec.innerHTML = IC.stop;
			} catch (e) {
				dica.textContent = e.message;
			}
		};
		art.querySelector('[data-ouvir]').onclick = () => {
			if (!wavs[f.id]) return;
			tocador?.pause();
			tocador = new Audio(URL.createObjectURL(wavs[f.id]));
			tocador.play();
		};
		art.querySelector('[data-baixar]').onclick = () => wavs[f.id] && baixar(wavs[f.id], nomeArq(f));
	});
	btTodas.onclick = async () => {
		const arqs = [];
		for (const f of L) if (wavs[f.id]) arqs.push({nome: nomeArq(f), dados: new Uint8Array(await wavs[f.id].arrayBuffer())});
		if (!arqs.length) return;
		if (arqs.length === 1) return baixar(wavs[L.find((f) => wavs[f.id]).id], arqs[0].nome);
		await baixar(montarZip(arqs), `${AVULSAS.prefixo}-${quem}-vozes.zip`);
	};
}
window.addEventListener('hashchange', rota);
rota();
