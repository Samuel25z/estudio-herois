# Estúdio dos Heróis

Site onde os amigos gravam as falas dos próprios personagens da série *Heróis por Engano*.
Cada um entra com o seu código, vê só as suas falas (com a fala anterior, a emoção e o tempo ideal),
grava até 3 versões e vê na hora a duração, a linha do tom e as pausas. O mestre sobe as falas do
episódio, ouve, aprova ou pede para refazer com recado e baixa tudo num zip (`05-moon.wav`...).

- `site/`: as páginas (HTML, CSS e JS puros, sem build). Publicadas no GitHub Pages a cada push na `main`.
- `api/`: Cloudflare Worker (D1 guarda falas e códigos, KV guarda os áudios). Plano grátis, sem cartão.
- `scripts/gerar-codigos.mjs`: cria os códigos (6 números por amigo, 8 para o mestre). Só o hash vai para o banco; os códigos ficam em `codigos-*.txt`, fora do Git.
- `tests/`: `api.test.mjs` (24 testes da API) e `estudio.spec.mjs` (Playwright, celular e computador, com microfone falso tocando uma fala real).

## Rodar no PC

```
npm install
npm run migrar          # cria o banco local
npm run codigos         # gera codigos-local.txt
npm run api             # API em http://localhost:8787
npm run site            # site em http://localhost:5500
npm run teste           # API + ponta a ponta (com a API e o site ligados)
```

O teste ponta a ponta usa `tests/voz-teste.wav` (fora do Git). Copie qualquer fala, por exemplo
`C:\Edicao de Video\public\saga\cap03\voz\02-moon.wav`.

## Publicar a API (uma vez, depois que o Samuel criar a conta grátis da Cloudflare e rodar `npx wrangler login`)

```
cd api
npx wrangler d1 create estudio-herois           # copiar o database_id para o wrangler.toml
npx wrangler kv namespace create AUDIOS         # copiar o id para o wrangler.toml
npx wrangler d1 migrations apply estudio-herois --remote
npx wrangler deploy                             # mostra o endereço *.workers.dev
cd ..
node scripts/gerar-codigos.mjs --remoto         # códigos do site de verdade em codigos-site.txt
```

Depois troque o endereço em `site/config.js` e dê push.

Trocar o código de alguém: `node scripts/gerar-codigos.mjs --remoto --so moon`.

## Arquivo de falas de um episódio

O mesmo formato do `saga/cap0X-falas.json`: uma lista de `{id, quem, texto, jeito}`.
Campos opcionais que deixam o estúdio melhor:
- `emocao`: a direção para o amigo ("bravo, explode feito criança"). Sem ele, o site usa o `jeito` sem o começo "Voz de jovem...".
- `dur`: o tempo ideal da fala em segundos. Sem ele, o site estima pelo tamanho do texto.

Os 8 protagonistas e a Viih gravam. O narrador e os figurantes aparecem apenas como contexto.
Subir de novo o mesmo episódio atualiza as falas. Se o texto de uma fala gravada mudar, ela volta para "refazer".

## Receita de crescimento
- Personagem novo que grava (ex.: a Viih): incluir em `PROTAGONISTAS` (`api/src/index.js`) e em `HEROIS` (`site/app.js`), e gerar o código com `--so viih`.
- Rota nova na API: adicionar em `rotear()`, com o teste em `tests/api.test.mjs`, incluindo o teste com o papel errado.
