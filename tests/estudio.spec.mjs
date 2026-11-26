// Ponta a ponta: mestre sobe o episódio, Moon grava com o microfone (falso, tocando uma fala real),
// vê a análise, guarda; mestre ouve, pede para refazer, baixa o zip. Roda contra a API local de verdade.
import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

const COD = Object.fromEntries(readFileSync('codigos-local.txt', 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/)));
const API = 'http://localhost:8787';
const NUM = 90 + Math.floor(Math.random() * 9);

async function entrar(page, quem) {
	await page.goto('/');
	if (quem === 'mestre') await page.getByRole('button', {name: 'Entrar como mestre'}).click();
	else await page.getByRole('button', {name: new RegExp('^\\S?\\s*' + quem, 'i')}).click();
	await page.getByLabel('Digite o seu código').fill(COD[quem]);
	await page.getByRole('button', {name: 'Entrar'}).click();
}

test.afterAll(async ({request}) => {
	const t = (await (await request.post(API + '/api/entrar', {data: {quem: 'mestre', codigo: COD.mestre}})).json()).token;
	const eps = (await (await request.get(API + '/api/episodios', {headers: {Authorization: 'Bearer ' + t}})).json()).episodios;
	for (const e of eps.filter((e) => e.numero >= 90)) await request.delete(`${API}/api/episodios/${e.id}`, {headers: {Authorization: 'Bearer ' + t}});
});

test('fluxo completo: subir, gravar, analisar, revisar, baixar', async ({browser}, info) => {
	const erros = [];
	const ctxM = await browser.newContext({...info.project.use});
	const m = await ctxM.newPage();
	m.on('pageerror', (e) => erros.push(e.message));

	// código errado mostra erro na tela
	await m.goto('/');
	await m.getByRole('button', {name: 'Entrar como mestre'}).click();
	await m.getByLabel('Digite o seu código').fill('12345678');
	await m.getByRole('button', {name: 'Entrar'}).click();
	await expect(m.getByRole('alert')).toContainText('errado');

	await entrar(m, 'mestre');
	await expect(m.getByRole('heading', {name: 'Painel do mestre'})).toBeVisible();
	await m.getByLabel('Número do episódio').fill(String(NUM));
	await m.getByLabel('Título').fill('A Floresta Encantada (teste)');
	await m.getByLabel(/Arquivo de falas/).setInputFiles('C:/Edicao de Video/saga/cap03-falas.json');
	await m.getByRole('button', {name: 'Subir falas'}).click();
	await expect(m.getByText(/falas para os amigos gravarem/)).toBeVisible();
	await expect(m.getByText('Quem já gravou')).toBeVisible();
	await m.screenshot({path: `test-results/mestre-${info.project.name}.png`, fullPage: false});

	// Moon entra e só vê as falas dela
	const ctxA = await browser.newContext({...info.project.use});
	const a = await ctxA.newPage();
	a.on('pageerror', (e) => erros.push(e.message));
	await entrar(a, 'moon');
	await expect(a.getByRole('heading', {name: 'Moon'})).toBeVisible();
	if (await a.locator('#ep').count()) await a.locator('#ep').selectOption({label: new RegExp(`^${NUM}\\.`)});
	const folha = a.locator('article.folha').first();
	await expect(folha).toContainText('Mano... que lindo');
	await expect(folha.locator('.antes')).toContainText('Narrador');
	await expect(folha.locator('.emocao')).toContainText(/encantada/i);
	await expect(a.locator('article.folha .texto', {hasText: 'vaso de planta'})).toHaveCount(0); // fala do Milk não aparece

	// grava ~3 s com o microfone falso (que toca uma fala real)
	await folha.getByRole('button', {name: 'Gravar'}).click();
	await expect(folha.getByText(/Gravando/)).toBeVisible();
	await a.waitForTimeout(3200);
	await folha.getByRole('button', {name: 'Parar gravação'}).click();
	const an = folha.locator('.analise');
	await expect(an).toBeVisible();
	await expect(an.locator('.numeros')).toContainText('fala');
	await expect(an.locator('.numeros')).toContainText('Hz');
	await expect(an.locator('.vered li').first()).toBeVisible();
	await a.screenshot({path: `test-results/gravou-${info.project.name}.png`, fullPage: false});
	await folha.getByRole('button', {name: 'Guardar esta versão'}).click();
	await expect(a.getByRole('status')).toContainText('Versão guardada');
	const folha2 = a.locator('article.folha').first();
	await expect(folha2.locator('.tomada')).toHaveCount(1);
	await expect(folha2.locator('.estado')).toHaveText('Gravada');
	await expect(a.locator('.progresso')).toContainText('1 de');

	// análise de uma versão guardada
	await folha2.getByRole('button', {name: 'Ver análise'}).click();
	await expect(folha2.locator('.analise canvas')).toBeVisible();

	// mestre recarrega, ouve, pede para refazer com recado
	await m.reload();
	if (await m.locator('#ep').count()) await m.locator('#ep').selectOption({label: new RegExp(`^${NUM}\\.`)});
	const fm = m.locator('article.folha', {hasText: 'Mano... que lindo'});
	await expect(fm.locator('.tomada')).toHaveCount(1);
	await fm.getByRole('button', {name: 'Pedir para refazer'}).click();
	await m.getByLabel('Recado').fill('Mais boquiaberta, mano');
	await m.getByRole('button', {name: 'Mandar recado'}).click();
	await expect(m.getByRole('status')).toContainText('Recado enviado');

	// zip com a preferida
	const [down] = await Promise.all([m.waitForEvent('download'), m.getByRole('button', {name: /Baixar as preferidas/}).click()]);
	expect(down.suggestedFilename()).toBe(`herois-ep${NUM}-vozes.zip`);
	const zip = readFileSync(await down.path());
	expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304');
	expect(zip.toString('latin1')).toContain('02-moon.wav');

	// Moon vê o recado
	await a.reload();
	if (await a.locator('#ep').count()) await a.locator('#ep').selectOption({label: new RegExp(`^${NUM}\\.`)});
	await expect(a.locator('article.folha').first().locator('.recado')).toContainText('Mais boquiaberta');
	await expect(a.locator('article.folha').first().locator('.estado')).toHaveText('Refazer');
	await a.screenshot({path: `test-results/recado-${info.project.name}.png`, fullPage: false});

	// sem rolagem para o lado
	const larg = await a.evaluate(() => document.documentElement.scrollWidth - innerWidth);
	expect(larg).toBeLessThanOrEqual(0);
	expect(erros).toEqual([]);
	await ctxA.close();
	await ctxM.close();
});

test('tela inicial mostra os 8 heróis e nada de botão morto', async ({page}) => {
	await page.goto('/');
	for (const n of ['Goubetti', 'Erick', 'Samuel', 'Flowtz', 'Znoob', 'Caio', 'Moon', 'Milk']) await expect(page.getByRole('button', {name: new RegExp(n)})).toBeVisible();
	await page.getByRole('button', {name: /Caio/}).click();
	await expect(page.getByRole('heading', {name: 'Caio'})).toBeVisible();
	await page.getByRole('button', {name: 'Voltar'}).click();
	await expect(page.getByRole('heading', {name: 'Estúdio dos Heróis'})).toBeVisible();
	await page.screenshot({path: 'test-results/inicio.png'});
});
