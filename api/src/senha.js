// Código de acesso: PBKDF2-SHA256 com sal próprio por pessoa (o banco nunca guarda o código).
// Usado pelo Worker e pelo script que gera os códigos (Node 20+ tem o mesmo crypto.subtle).
const ITER = 100000;

export const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function aleatorioHex(n) {
	const b = new Uint8Array(n);
	crypto.getRandomValues(b);
	return hex(b);
}

export async function hashCodigo(codigo, sal) {
	const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(codigo), 'PBKDF2', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(sal), iterations: ITER}, chave, 256);
	return hex(bits);
}

export async function sha256(texto) {
	return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}

// comparação em tempo constante
export function iguais(a, b) {
	if (a.length !== b.length) return false;
	let d = 0;
	for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return d === 0;
}
