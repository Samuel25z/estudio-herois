// Zip simples (sem compressão, WAV não comprime quase nada) feito no navegador.
const TAB = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(b) {
	let c = 0xffffffff;
	for (let i = 0; i < b.length; i++) c = TAB[(c ^ b[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

export function montarZip(arquivos) {
	// arquivos: [{nome, dados: Uint8Array}]
	const partes = [], central = [];
	let off = 0;
	const enc = new TextEncoder();
	for (const a of arquivos) {
		const nome = enc.encode(a.nome);
		const crc = crc32(a.dados);
		const h = new DataView(new ArrayBuffer(30));
		h.setUint32(0, 0x04034b50, true);
		h.setUint16(4, 20, true);
		h.setUint16(6, 0x0800, true);
		h.setUint32(14, crc, true);
		h.setUint32(18, a.dados.length, true);
		h.setUint32(22, a.dados.length, true);
		h.setUint16(26, nome.length, true);
		partes.push(h.buffer, nome, a.dados);
		const c = new DataView(new ArrayBuffer(46));
		c.setUint32(0, 0x02014b50, true);
		c.setUint16(4, 20, true);
		c.setUint16(6, 20, true);
		c.setUint16(8, 0x0800, true);
		c.setUint32(16, crc, true);
		c.setUint32(20, a.dados.length, true);
		c.setUint32(24, a.dados.length, true);
		c.setUint16(28, nome.length, true);
		c.setUint32(42, off, true);
		central.push(c.buffer, nome);
		off += 30 + nome.length + a.dados.length;
	}
	const tamCentral = central.reduce((s, p) => s + p.byteLength, 0);
	const fim = new DataView(new ArrayBuffer(22));
	fim.setUint32(0, 0x06054b50, true);
	fim.setUint16(8, arquivos.length, true);
	fim.setUint16(10, arquivos.length, true);
	fim.setUint32(12, tamCentral, true);
	fim.setUint32(16, off, true);
	return new Blob([...partes, ...central, fim.buffer], {type: 'application/zip'});
}
