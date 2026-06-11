# Painel de Receitas Municipais — TCE-PE (versão pública / Google Sites)

Este é um projeto **estático** (HTML + CSS + JS puro, sem backend), derivado do
projeto `API`, pronto para ser publicado em um host estático e embutido em uma
página do Google Sites via iframe.

Diferenças em relação ao projeto original:
- A aba **"Visão Geral"** (atualização de dados via API do TCE-PE, tabela
  bruta, gráfico por categoria e população/receita per capita) foi removida.
- Os dados não são mais buscados de um servidor Node — são lidos de arquivos
  **CSV** (locais ou publicados no Google Sheets).
- Permanecem as 4 abas: **Detalhamento por Município**, **Dependência de
  Receita Própria**, **Dependência por Grupo Populacional** e **Distribuição
  por População** (Cota-Parte do ICMS).

## Estrutura

```
Painel-Receitas-PE/
├── index.html
├── app.js
├── data/
│   ├── receitas_resumo.csv   (30.449 linhas, ~5,4 MB — agregado anual por
│   │                           município/categoria/origem/espécie/descrição)
│   └── populacao.csv         (população Censo 2022 — IBGE, por município)
└── README.md
```

`receitas_resumo.csv` é gerado a partir do dataset completo do projeto `API`
pelo script `gerar-resumo.js` (no projeto `API`), que soma `VALORLANCAMENTO`
removendo a granularidade mensal — suficiente para todas as 4 abas deste
painel.

## 1. Testar localmente

Qualquer servidor estático funciona, por exemplo:

```bash
npx http-server . -p 8080
```

Depois acesse `http://localhost:8080`.

> Não dá para abrir `index.html` direto com `file://`, pois o navegador
> bloqueia o `fetch()` dos arquivos CSV por CORS/segurança. É preciso um
> servidor HTTP (local ou hospedado).

## 2. Fonte de dados: arquivos locais x Google Sheets

Por padrão, `app.js` lê os CSVs locais:

```js
const URL_RECEITAS  = 'data/receitas_resumo.csv';
const URL_POPULACAO = 'data/populacao.csv';
```

### Opção recomendada: publicar via Google Sheets ("Publicar na Web")

Isso permite atualizar os dados sem precisar recriar/republicar todo o site:

1. Suba os arquivos `receitas_resumo.csv` e `populacao.csv` para o Google
   Drive (pasta já compartilhada) e abra cada um com o Google Planilhas
   ("Abrir com → Google Planilhas"), ou crie planilhas novas e importe os CSVs.
2. Em cada planilha: **Arquivo → Compartilhar → Publicar na Web**.
   - Selecione a aba correspondente.
   - Formato: **Valores separados por vírgula (.csv)**.
   - Clique em **Publicar**.
3. Copie o link gerado (algo como
   `https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?gid=0&single=true&output=csv`).
4. Em `app.js`, substitua:

   ```js
   const URL_RECEITAS  = 'https://docs.google.com/spreadsheets/d/e/SUA_URL_1/pub?output=csv';
   const URL_POPULACAO = 'https://docs.google.com/spreadsheets/d/e/SUA_URL_2/pub?output=csv';
   ```

5. Pronto — para atualizar os dados no futuro, basta substituir o conteúdo das
   planilhas (ex.: colar um novo CSV gerado por `gerar-resumo.js`); o painel
   passará a refletir os novos dados automaticamente, sem precisar mexer no
   código/hospedagem.

> Nota: links de "Publicar na Web" do Google Sheets são públicos para quem
> tiver o link. Não inclua dados sensíveis.

### Alternativa: manter os CSVs como arquivos estáticos

Se preferir não depender do Google Sheets, basta manter/atualizar os arquivos
em `data/` e re-hospedar o site (passo 3). Mais simples, porém qualquer
atualização de dados exige um novo deploy.

## 3. Hospedagem (sugestão: GitHub Pages)

1. Crie um repositório no GitHub e suba o conteúdo desta pasta
   (`index.html`, `app.js`, `data/`).
2. Em **Settings → Pages**, selecione a branch (ex.: `main`) e a pasta raiz
   (`/`).
3. O GitHub publicará em uma URL como:
   `https://SEU_USUARIO.github.io/NOME_DO_REPOSITORIO/`

Alternativas equivalentes: Netlify, Vercel ou Cloudflare Pages — basta
arrastar a pasta do projeto na interface de deploy.

## 4. Incorporar no Google Sites

1. No Google Sites, edite a página desejada.
2. No menu lateral (Inserir), escolha **Incorporar** → **Por URL**.
3. Cole a URL pública do passo anterior (ex.:
   `https://SEU_USUARIO.github.io/painel-receitas-pe/`).
4. Ajuste o tamanho do quadro de incorporação (recomenda-se altura grande,
   ex.: 1400–1800px, já que o painel tem várias seções por aba).

## 5. Atualizando os dados no futuro

No projeto `API`:

```bash
node gerar-resumo.js      # gera data/receitas_resumo.csv atualizado
node gerar-populacao.js   # gera data/populacao.json (se necessário, converter para CSV)
```

Depois:
- Se estiver usando Google Sheets: cole o novo CSV na planilha publicada
  (o painel atualiza sozinho).
- Se estiver usando arquivos estáticos: substitua os arquivos em `data/` deste
  projeto e republique (novo commit/deploy).
