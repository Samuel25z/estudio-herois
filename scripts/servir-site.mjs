// Servidor estático simples para testar o site no PC (porta 5500).
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
const raiz = fileURLToPath(new URL('../site/', import.meta.url));
const tipos = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'};
createServer(async (req, res) => {
	let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
	if (p.endsWith('/')) p += 'index.html';
	const arq = normalize(join(raiz, p));
	if (!arq.startsWith(normalize(raiz))) return res.writeHead(403).end();
	try {
		const d = await readFile(arq);
		res.writeHead(200, {'Content-Type': tipos[extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-store'}).end(d);
	} catch {
		res.writeHead(404).end('404');
	}
}).listen(Number(process.env.PORTA || 5500), () => console.log('site em http://localhost:' + (process.env.PORTA || 5500)));
