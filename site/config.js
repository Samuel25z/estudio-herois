// Endereço da API. No PC (teste) usa o Worker local; no ar, o Worker publicado na Cloudflare.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
export const API = local ? 'http://localhost:8787' : 'https://estudio-herois-api.TROCAR.workers.dev';
