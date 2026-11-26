// Gravação em qualidade de estúdio: som cru do microfone (sem compressão) salvo em WAV 16 bits mono.

const WORKLET = `class Coletor extends AudioWorkletProcessor {
	process(ent) {
		const c = ent[0];
		if (c && c[0]) {
			const n = c[0].length, m = new Float32Array(n);
			for (let k = 0; k < c.length; k++) for (let i = 0; i < n; i++) m[i] += c[k][i] / c.length;
			this.port.postMessage(m, [m.buffer]);
		}
		return true;
	}
}
registerProcessor('coletor', Coletor);`;

export const MAX_SEGUNDOS = 60;

export async function abrirMicrofone() {
	if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não grava áudio. Abra o link no Chrome ou no Safari.');
	try {
		return await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1}});
	} catch (e) {
		if (e.name === 'NotAllowedError') throw new Error('O microfone foi bloqueado. Libere o microfone para este site nas configurações do navegador e tente de novo.');
		if (e.name === 'NotFoundError') throw new Error('Nenhum microfone encontrado neste aparelho.');
		throw new Error('Não deu para abrir o microfone: ' + e.message);
	}
}

export class Gravador {
	constructor(aoNivel, aoLimite) {
		this.aoNivel = aoNivel;
		this.aoLimite = aoLimite;
		this.pedacos = [];
		this.n = 0;
	}
	async comecar() {
		this.stream = await abrirMicrofone();
		this.ctx = new AudioContext({latencyHint: 'interactive'});
		const url = URL.createObjectURL(new Blob([WORKLET], {type: 'text/javascript'}));
		await this.ctx.audioWorklet.addModule(url);
		URL.revokeObjectURL(url);
		this.fonte = this.ctx.createMediaStreamSource(this.stream);
		this.no = new AudioWorkletNode(this.ctx, 'coletor');
		this.no.port.onmessage = (ev) => {
			const m = ev.data;
			this.pedacos.push(m);
			this.n += m.length;
			let p = 0;
			for (let i = 0; i < m.length; i++) p = Math.max(p, Math.abs(m[i]));
			this.aoNivel?.(p, this.n / this.ctx.sampleRate);
			if (this.n / this.ctx.sampleRate >= MAX_SEGUNDOS) this.aoLimite?.();
		};
		const mudo = this.ctx.createGain();
		mudo.gain.value = 0;
		this.fonte.connect(this.no).connect(mudo).connect(this.ctx.destination);
		if (this.ctx.state === 'suspended') await this.ctx.resume();
	}
	async parar() {
		const sr = this.ctx.sampleRate;
		this.stream.getTracks().forEach((t) => t.stop());
		try {
			this.fonte.disconnect();
			this.no.disconnect();
		} catch {}
		await this.ctx.close();
		const amostras = new Float32Array(this.n);
		let o = 0;
		for (const p of this.pedacos) {
			amostras.set(p, o);
			o += p.length;
		}
		return {amostras, sr};
	}
	cancelar() {
		try {
			this.stream?.getTracks().forEach((t) => t.stop());
			this.ctx?.close();
		} catch {}
	}
}

export function paraWav(amostras, sr) {
	const buf = new ArrayBuffer(44 + amostras.length * 2);
	const v = new DataView(buf);
	const txt = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
	txt(0, 'RIFF');
	v.setUint32(4, 36 + amostras.length * 2, true);
	txt(8, 'WAVE');
	txt(12, 'fmt ');
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true);
	v.setUint16(22, 1, true);
	v.setUint32(24, sr, true);
	v.setUint32(28, sr * 2, true);
	v.setUint16(32, 2, true);
	v.setUint16(34, 16, true);
	txt(36, 'data');
	v.setUint32(40, amostras.length * 2, true);
	for (let i = 0; i < amostras.length; i++) {
		const s = Math.max(-1, Math.min(1, amostras[i]));
		v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}
	return new Blob([buf], {type: 'audio/wav'});
}

export function deWav(buf) {
	const v = new DataView(buf);
	const txt = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
	let o = 12, sr = 48000, canais = 1;
	while (o + 8 <= buf.byteLength) {
		const id = txt(o), tam = v.getUint32(o + 4, true);
		if (id === 'fmt ') {
			canais = v.getUint16(o + 10, true);
			sr = v.getUint32(o + 12, true);
		}
		if (id === 'data') {
			const n = Math.floor(Math.min(tam, buf.byteLength - o - 8) / (2 * canais));
			const a = new Float32Array(n);
			for (let i = 0; i < n; i++) {
				let s = 0;
				for (let c = 0; c < canais; c++) s += v.getInt16(o + 8 + (i * canais + c) * 2, true);
				a[i] = s / canais / 32768;
			}
			return {amostras: a, sr};
		}
		o += 8 + tam + (tam % 2);
	}
	throw new Error('WAV sem dados');
}
