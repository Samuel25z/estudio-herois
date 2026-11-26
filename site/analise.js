// Análise da fala gravada, feita no próprio aparelho: duração, silêncios, pausas, tom (YIN) e volume.

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

function reamostrar(x, sr, alvo) {
	if (sr <= alvo) return {y: x, sr};
	const r = sr / alvo;
	const n = Math.floor(x.length / r);
	const y = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const a = Math.floor(i * r), b = Math.min(x.length, Math.floor((i + 1) * r));
		let s = 0;
		for (let k = a; k < b; k++) s += x[k];
		y[i] = s / Math.max(1, b - a);
	}
	return {y, sr: sr / r};
}

// YIN (de Cheveigné & Kawahara): frequência fundamental de um trecho, ou null se não é voz com tom.
function yin(x, ini, W, sr, fmin, fmax) {
	const tMin = Math.floor(sr / fmax), tMax = Math.min(Math.ceil(sr / fmin), W - 1);
	const d = new Float32Array(tMax + 1);
	for (let t = 1; t <= tMax; t++) {
		let s = 0;
		for (let j = 0; j < W - tMax; j++) {
			const v = x[ini + j] - x[ini + j + t];
			s += v * v;
		}
		d[t] = s;
	}
	let soma = 0;
	const cm = new Float32Array(tMax + 1);
	cm[0] = 1;
	for (let t = 1; t <= tMax; t++) {
		soma += d[t];
		cm[t] = soma > 0 ? (d[t] * t) / soma : 1;
	}
	for (let t = tMin; t <= tMax; t++) {
		if (cm[t] < 0.15) {
			while (t + 1 <= tMax && cm[t + 1] < cm[t]) t++;
			const a = cm[t - 1], b = cm[t], c = t + 1 <= tMax ? cm[t + 1] : b;
			const den = a - 2 * b + c;
			const tt = den !== 0 ? t + (a - c) / (2 * den) : t;
			return sr / tt;
		}
	}
	return null;
}

export function analisar(amostras, sr, durIdeal) {
	const n = amostras.length;
	const total = n / sr;
	// volume em janelas de 20 ms a cada 10 ms
	const H = Math.round(sr * 0.01), J = Math.round(sr * 0.02);
	const rms = [];
	let pico = 0, estouros = 0;
	for (let i = 0; i < n; i++) {
		const a = Math.abs(amostras[i]);
		if (a > pico) pico = a;
		if (a > 0.985) estouros++;
	}
	for (let i = 0; i + J <= n; i += H) {
		let s = 0;
		for (let k = i; k < i + J; k++) s += amostras[k] * amostras[k];
		rms.push(db(Math.sqrt(s / J)));
	}
	const ord = [...rms].sort((a, b) => a - b);
	const fundo = ord[Math.floor(ord.length * 0.1)] ?? -90;
	const topo = ord[Math.floor(ord.length * 0.98)] ?? -90;
	const limiar = Math.max(fundo + 10, topo - 32);
	const voz = rms.map((v) => v > limiar);
	const primeiro = voz.indexOf(true), ultimo = voz.lastIndexOf(true);
	const passo = H / sr;
	const res = {total, pico, estouros, durIdeal, fundoDb: fundo, nivelDb: topo, pausas: [], tom: [], envelope: [], passo};
	// envelope para desenhar (0..1)
	for (const v of rms) res.envelope.push(Math.max(0, Math.min(1, (v + 60) / 60)));
	if (primeiro < 0 || topo - fundo < 8) {
		res.semVoz = true;
		return res;
	}
	res.ini = primeiro * passo;
	res.fim = Math.min(total, ultimo * passo + J / sr);
	res.fala = res.fim - res.ini;
	// pausas internas: silêncio de 0,25 s ou mais entre o começo e o fim da fala
	let k = primeiro;
	while (k <= ultimo) {
		if (!voz[k]) {
			let e = k;
			while (e <= ultimo && !voz[e]) e++;
			const dur = (e - k) * passo;
			if (dur >= 0.25) res.pausas.push({ini: k * passo, dur});
			k = e;
		} else k++;
	}
	// tom (YIN a 16 kHz, janela de 40 ms a cada 20 ms), só onde tem voz
	const {y, sr: s2} = reamostrar(amostras, sr, 16000);
	const W = Math.round(s2 * 0.04), P = Math.round(s2 * 0.02);
	for (let i = 0; i + W < y.length; i += P) {
		const t = i / s2;
		const fr = Math.min(rms.length - 1, Math.round((t + 0.02) / passo));
		if (!voz[fr]) {
			res.tom.push(null);
			continue;
		}
		const f = yin(y, i, W, s2, 70, 520);
		res.tom.push(f && f > 70 && f < 520 ? f : null);
	}
	res.passoTom = P / s2;
	// tira saltos isolados (oitava errada) com mediana de 5
	const f0 = res.tom.map((v, i, a) => {
		if (v == null) return null;
		const viz = a.slice(Math.max(0, i - 2), i + 3).filter((x) => x != null).sort((p, q) => p - q);
		return viz[Math.floor(viz.length / 2)];
	});
	res.tom = f0;
	const validos = f0.filter((v) => v != null).sort((a, b) => a - b);
	if (validos.length > 5) {
		res.tomMedio = validos[Math.floor(validos.length / 2)];
		const lo = validos[Math.floor(validos.length * 0.1)], hi = validos[Math.floor(validos.length * 0.9)];
		res.variacao = 12 * Math.log2(hi / lo); // em semitons
	}
	return res;
}

const s1 = (x) => x.toFixed(1).replace('.', ',');

// frases curtas para quem está gravando
export function veredito(a) {
	const itens = [];
	if (a.semVoz) return [{tipo: 'ruim', txt: 'Não deu para ouvir a sua voz. Confira o microfone e grave de novo.'}];
	if (a.durIdeal) {
		const dif = a.fala - a.durIdeal;
		const folga = Math.max(0.6, a.durIdeal * 0.25);
		if (Math.abs(dif) <= folga) itens.push({tipo: 'bom', txt: `Tempo certo: ${s1(a.fala)} s (o ideal é uns ${s1(a.durIdeal)} s).`});
		else if (dif > 0) itens.push({tipo: 'aviso', txt: `Ficou ${s1(dif)} s mais longa que o ideal (${s1(a.fala)} s de ${s1(a.durIdeal)} s). Tente falar um pouco mais rápido.`});
		else itens.push({tipo: 'aviso', txt: `Ficou ${s1(-dif)} s mais curta que o ideal (${s1(a.fala)} s de ${s1(a.durIdeal)} s). Pode respirar mais entre as palavras.`});
	}
	if (a.estouros > 20) itens.push({tipo: 'ruim', txt: 'O áudio estourou (distorceu). Afaste um pouco o celular da boca.'});
	else if (a.pico < 0.08) itens.push({tipo: 'aviso', txt: 'Ficou baixinho. Chegue o celular mais perto ou fale mais forte.'});
	else itens.push({tipo: 'bom', txt: 'Volume bom.'});
	if (a.nivelDb - a.fundoDb < 20) itens.push({tipo: 'aviso', txt: 'Tem bastante barulho no fundo. Se der, grave num lugar mais quieto.'});
	if (a.pausas.length) {
		const maior = Math.max(...a.pausas.map((p) => p.dur));
		itens.push({tipo: maior > 1.2 ? 'aviso' : 'info', txt: `${a.pausas.length} ${a.pausas.length > 1 ? 'pausas' : 'pausa'} no meio (a maior com ${s1(maior)} s).`});
	} else itens.push({tipo: 'info', txt: 'Sem pausas no meio: falou de uma vez.'});
	if (a.variacao != null) {
		if (a.variacao < 3) itens.push({tipo: 'aviso', txt: 'Tom bem reto, quase sem subir e descer. Se a cena pede emoção, solte mais a voz.'});
		else if (a.variacao > 10) itens.push({tipo: 'info', txt: 'Voz bem solta, subindo e descendo bastante.'});
		else itens.push({tipo: 'bom', txt: 'Tom com variação natural.'});
	}
	if (a.ini > 1.5 || a.total - a.fim > 1.5) itens.push({tipo: 'info', txt: 'Sobrou silêncio no começo ou no fim. Tudo bem, isso é cortado na edição.'});
	return itens;
}

// desenha volume (barras), pausas (faixas) e a linha do tom
export function desenhar(canvas, a) {
	const dpr = window.devicePixelRatio || 1;
	const w = canvas.clientWidth, h = canvas.clientHeight;
	canvas.width = w * dpr;
	canvas.height = h * dpr;
	const g = canvas.getContext('2d');
	g.scale(dpr, dpr);
	const css = getComputedStyle(document.documentElement);
	const cor = (n) => css.getPropertyValue(n).trim();
	g.clearRect(0, 0, w, h);
	const X = (t) => (t / a.total) * w;
	if (!a.semVoz) {
		g.fillStyle = cor('--faixa-silencio');
		g.fillRect(0, 0, X(a.ini), h);
		g.fillRect(X(a.fim), 0, w - X(a.fim), h);
		g.fillStyle = cor('--faixa-pausa');
		for (const p of a.pausas) g.fillRect(X(p.ini), 0, Math.max(2, X(p.dur)), h);
	}
	g.fillStyle = cor('--onda');
	const meio = h / 2;
	const barra = Math.max(1, w / a.envelope.length);
	a.envelope.forEach((v, i) => {
		const alt = v * h * 0.8;
		g.fillRect(i * barra, meio - alt / 2, Math.max(1, barra * 0.8), alt);
	});
	if (a.tom && a.tomMedio) {
		const vs = a.tom.filter((v) => v != null);
		const lo = Math.min(...vs) * 0.9, hi = Math.max(...vs) * 1.1;
		const Y = (f) => h - 6 - ((Math.log2(f) - Math.log2(lo)) / (Math.log2(hi) - Math.log2(lo))) * (h - 12);
		g.strokeStyle = cor('--tom');
		g.lineWidth = 2.5;
		g.lineJoin = 'round';
		g.beginPath();
		let aberto = false;
		a.tom.forEach((f, i) => {
			const x = X(i * a.passoTom + 0.02);
			if (f == null) {
				aberto = false;
				return;
			}
			if (!aberto) g.moveTo(x, Y(f));
			else g.lineTo(x, Y(f));
			aberto = true;
		});
		g.stroke();
	}
}
