// ── Configuração das fontes de dados ──────────────────────────────
// Por padrão, os dados são lidos dos arquivos CSV locais (pasta data/).
// Para consumir dados publicados via Google Sheets ("Publicar na Web"),
// basta substituir estas URLs pelos links .csv gerados pelo Sheets, por
// exemplo:
//   const URL_RECEITAS  = 'https://docs.google.com/spreadsheets/d/e/SUA_URL/pub?gid=0&single=true&output=csv';
//   const URL_POPULACAO = 'https://docs.google.com/spreadsheets/d/e/SUA_URL/pub?gid=1&single=true&output=csv';
const _v = Date.now(); // cache-busting: garante que o browser sempre busca a versão mais recente
const URL_RECEITAS  = `data/receitas_resumo.csv?v=${_v}`;
const URL_POPULACAO = `data/populacao.csv?v=${_v}`;

let municipios = [];
let populacao = [];
let dataset = [];
const expandidos = new Set(); // chaves dos nós expandidos na árvore de detalhamento

const fmtMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ── Parser de CSV (suporta BOM, campos entre aspas, vírgulas e quebras de linha) ──
function parseCSV(texto) {
  // Remove BOM, se presente
  if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);

  const linhas = [];
  let campo = '';
  let linha = [];
  let dentroAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (dentroAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else dentroAspas = false;
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') {
      dentroAspas = true;
    } else if (c === ',') {
      linha.push(campo);
      campo = '';
    } else if (c === '\r') {
      // ignora; \n trata a quebra de linha
    } else if (c === '\n') {
      linha.push(campo);
      campo = '';
      linhas.push(linha);
      linha = [];
    } else {
      campo += c;
    }
  }
  // última linha (caso o arquivo não termine com quebra de linha)
  if (campo !== '' || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }

  // remove linhas totalmente vazias
  const linhasValidas = linhas.filter(l => !(l.length === 1 && l[0] === ''));
  if (!linhasValidas.length) return [];

  const cabecalho = linhasValidas[0];
  return linhasValidas.slice(1).map(campos => {
    const obj = {};
    cabecalho.forEach((nomeCol, idx) => { obj[nomeCol] = campos[idx] !== undefined ? campos[idx] : ''; });
    return obj;
  });
}

async function carregarCSV(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Falha ao carregar ${url}: ${resp.status}`);
  const texto = await resp.text();
  return parseCSV(texto);
}

// ── Inicialização ────────────────────────────────────────────────
async function init() {
  initAbas();
  initDetalhamento();
  initDependencia();
  initDependenciaGrupo();
  initDistribuicao();

  await carregarDataset();
}

// ── Abas ──────────────────────────────────────────────────────────
function initAbas() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// ── Dataset consolidado ──────────────────────────────────────────
async function carregarDataset() {
  const [receitasCsv, populacaoCsv] = await Promise.all([
    carregarCSV(URL_RECEITAS),
    carregarCSV(URL_POPULACAO),
  ]);

  // Normaliza tipos: o CSV resumido traz VALORLANCAMENTO como texto
  dataset = receitasCsv.map(r => ({
    ...r,
    VALORLANCAMENTO: Number(r.VALORLANCAMENTO) || 0,
  }));

  // Recife não possui dados de receita no dataset (TCE-PE) e por isso é
  // excluído de todo o painel: tabela/KPIs de distribuição, grupos
  // populacionais e seleção de município nas demais abas.
  populacao = populacaoCsv
    .map(p => ({ ...p, populacao_2022: Number(p.populacao_2022) || 0 }))
    .filter(p => p.municipio !== 'Recife');

  dataset = dataset.filter(r => r.MUNICIPIO !== 'Recife');

  municipios = [...new Set(dataset.map(r => r.MUNICIPIO))].filter(Boolean);

  preencherFiltrosDetalhamento();
  renderizarDetalhamento();
  preencherFiltrosDependencia();
  renderizarDependencia();
  renderizarDependenciaGrupo();
  preencherFiltrosDistribuicao();
  renderizarDistribuicao();
}

// ── Aba: Detalhamento por município ──────────────────────────────
const NIVEIS_DETALHAMENTO = ['CATEGORIARECEITA', 'ORIGEMRECEITA', 'ESPECIERECEITA', 'DESCRICAO'];
const ROTULOS_NIVEL = ['Categoria', 'Origem', 'Espécie', 'Descrição'];

function initDetalhamento() {
  document.getElementById('detMunicipio').addEventListener('change', () => {
    preencherAnosDetalhamento();
    expandidos.clear();
    renderizarDetalhamento();
  });
  document.getElementById('detAno').addEventListener('change', () => {
    expandidos.clear();
    renderizarDetalhamento();
  });
  document.getElementById('btnExpandirTudo').addEventListener('click', () => {
    expandirTudo(true);
    renderizarDetalhamento();
  });
  document.getElementById('btnRecolherTudo').addEventListener('click', () => {
    expandidos.clear();
    renderizarDetalhamento();
  });
}

function preencherFiltrosDetalhamento() {
  const selMunicipio = document.getElementById('detMunicipio');
  const valorAtual = selMunicipio.value;

  const municipiosUnicos = [...new Set(dataset.map(r => r.MUNICIPIO))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  selMunicipio.innerHTML = municipiosUnicos.map(m => `<option value="${m}">${m}</option>`).join('');

  if (municipiosUnicos.includes(valorAtual)) {
    selMunicipio.value = valorAtual;
  }

  preencherAnosDetalhamento();
}

function preencherAnosDetalhamento() {
  const municipio = document.getElementById('detMunicipio').value;
  const selAno = document.getElementById('detAno');
  const valorAtual = selAno.value;

  const anosUnicos = [...new Set(dataset.filter(r => r.MUNICIPIO === municipio).map(r => r.ANOREFERENCIA))]
    .sort((a, b) => b.localeCompare(a)); // mais recente primeiro

  selAno.innerHTML = anosUnicos.map(a => `<option value="${a}">${a}</option>`).join('');

  if (anosUnicos.includes(valorAtual)) {
    selAno.value = valorAtual;
  }
}

// Monta a árvore Categoria -> Origem -> Espécie -> Descrição, somando VALORLANCAMENTO
function montarArvore(registros) {
  const raiz = { filhos: new Map(), total: 0 };

  for (const r of registros) {
    let no = raiz;
    let chave = '';
    for (const campo of NIVEIS_DETALHAMENTO) {
      const valor = (r[campo] || '(Sem informação)').trim() || '(Sem informação)';
      chave = chave ? `${chave}>${valor}` : valor;
      if (!no.filhos.has(valor)) {
        no.filhos.set(valor, { nome: valor, chave, total: 0, filhos: new Map() });
      }
      no = no.filhos.get(valor);
      no.total += Number(r.VALORLANCAMENTO) || 0;
    }
    raiz.total += Number(r.VALORLANCAMENTO) || 0;
  }

  return raiz;
}

function expandirTudo(valor) {
  const municipio = document.getElementById('detMunicipio').value;
  const ano = document.getElementById('detAno').value;
  const registros = dataset.filter(r => r.MUNICIPIO === municipio && r.ANOREFERENCIA === ano);
  const raiz = montarArvore(registros);

  const percorrer = (no) => {
    if (no.chave) expandidos.add(no.chave);
    for (const filho of no.filhos.values()) percorrer(filho);
  };
  percorrer(raiz);
}

function renderizarDetalhamento() {
  const municipio = document.getElementById('detMunicipio').value;
  const ano = document.getElementById('detAno').value;
  const tbody = document.getElementById('detTbody');
  const resumo = document.getElementById('detResumo');

  if (!municipio || !ano) {
    tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;color:var(--muted)">
      Nenhum dado disponível.</td></tr>`;
    resumo.textContent = '';
    return;
  }

  const registros = dataset.filter(r => r.MUNICIPIO === municipio && r.ANOREFERENCIA === ano);
  const raiz = montarArvore(registros);

  resumo.textContent = `${municipio} — ${ano} — Total lançado: ${fmtMoeda(raiz.total)} (${registros.length} lançamentos)`;

  const linhas = [];

  const percorrer = (no, nivel) => {
    for (const filho of [...no.filhos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))) {
      const temFilhos = filho.filhos.size > 0;
      const aberto = expandidos.has(filho.chave);
      linhas.push({ ...filho, nivel, temFilhos, aberto });
      if (temFilhos && aberto) percorrer(filho, nivel + 1);
    }
  };
  percorrer(raiz, 0);

  tbody.innerHTML = linhas.map(l => `
    <tr class="tree-row nivel-${l.nivel}" data-chave="${encodeURIComponent(l.chave)}">
      <td>
        <span class="tree-label" style="--nivel:${l.nivel}">
          <span class="tree-toggle">${l.temFilhos ? (l.aberto ? '▾' : '▸') : '·'}</span>
          ${l.nome}
        </span>
      </td>
      <td class="valor">${fmtMoeda(l.total)}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.tree-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const chave = decodeURIComponent(tr.dataset.chave);
      if (expandidos.has(chave)) expandidos.delete(chave);
      else expandidos.add(chave);
      renderizarDetalhamento();
    });
  });
}

// ── Aba: Dependência de Receita Própria ───────────────────────────
const ANOS_DEPENDENCIA = ['2023', '2024', '2025'];
const COR_ANO = { '2023': '#95a5a6', '2024': '#c9762f', '2025': '#102a43' };

const LINHAS_DEPENDENCIA = [
  { chave: 'IPTU', rotulo: 'IPTU', tipo: 'descricao',
    prefixo: 'Imposto sobre a Propriedade Predial e Territorial Urbana' },
  { chave: 'ITBI', rotulo: 'ITBI', tipo: 'descricao',
    prefixo: 'Impostos sobre Transmissão "Inter Vivos" de Bens Imóveis e de Direitos Reais sobre Imóveis' },
  { chave: 'ISS', rotulo: 'ISS', tipo: 'descricao',
    prefixo: 'Imposto sobre Serviços de Qualquer Natureza - ISSQN' },
  { chave: 'IRPF', rotulo: 'IRPF', tipo: 'descricao',
    prefixo: 'Imposto sobre a Renda - Retido na Fonte' },
  { chave: 'OUTROS_IMPOSTOS', rotulo: 'Outros Impostos', tipo: 'descricao',
    prefixo: 'Outros Impostos' },
  { chave: 'TAXAS', rotulo: 'Taxas', tipo: 'especie', valor: 'Taxas' },
  { chave: 'TRANSFERENCIAS', rotulo: 'Transferências Correntes', tipo: 'origem', valor: 'Transferências Correntes' },
];

const fmtPct = v => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

function initDependencia() {
  document.getElementById('depMunicipio').addEventListener('change', renderizarDependencia);
}

function preencherFiltrosDependencia() {
  const sel = document.getElementById('depMunicipio');
  const valorAtual = sel.value;

  const municipiosUnicos = [...new Set(dataset.map(r => r.MUNICIPIO))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  sel.innerHTML = '<option value="">Selecione...</option>' +
    municipiosUnicos.map(m => `<option value="${m}">${m}</option>`).join('');

  if (municipiosUnicos.includes(valorAtual)) sel.value = valorAtual;
}

// Calcula, para cada ano, os valores das linhas e os totais de referência
// (Impostos, Taxas, Transferências Correntes) somando todos os municípios
// informados em `listaMunicipios` (pode ser um único município ou um grupo).
function calcularDependenciaPara(listaMunicipios) {
  const municipiosSet = new Set(listaMunicipios);
  const resultado = {};

  for (const ano of ANOS_DEPENDENCIA) {
    const registros = dataset.filter(r => municipiosSet.has(r.MUNICIPIO) && r.ANOREFERENCIA === ano);
    const somaSe = pred => registros
      .filter(pred)
      .reduce((s, r) => s + (Number(r.VALORLANCAMENTO) || 0), 0);

    const totalImpostos = somaSe(r => r.ESPECIERECEITA === 'Impostos');
    const totalTaxas = somaSe(r => r.ESPECIERECEITA === 'Taxas');
    const totalTransferencias = somaSe(r => r.ORIGEMRECEITA === 'Transferências Correntes');

    const linhas = {};
    for (const linha of LINHAS_DEPENDENCIA) {
      if (linha.tipo === 'descricao') {
        linhas[linha.chave] = somaSe(r => (r.DESCRICAO || '').startsWith(linha.prefixo));
      } else if (linha.tipo === 'especie') {
        linhas[linha.chave] = somaSe(r => r.ESPECIERECEITA === linha.valor);
      } else if (linha.tipo === 'origem') {
        linhas[linha.chave] = somaSe(r => r.ORIGEMRECEITA === linha.valor);
      }
    }

    resultado[ano] = { linhas, totalImpostos, totalTaxas, totalTransferencias, temDados: registros.length > 0 };
  }

  return resultado;
}

// ── Helpers compartilhados: KPIs, tabela e gráfico de dependência ──

// Gera o HTML dos cartões de KPI "Impostos / Transferências Correntes", por exercício
function gerarKpisDependenciaHTML(dados) {
  return ANOS_DEPENDENCIA.map(ano => {
    const d = dados[ano];
    const valor = d.totalTransferencias ? (d.totalImpostos / d.totalTransferencias) * 100 : null;
    return `
      <div class="kpi-card">
        <div class="kpi-valor">${valor !== null ? fmtPct(valor) : '—'}</div>
        <div class="kpi-label">${ano}${d.temDados ? '' : ' (sem dados)'}</div>
      </div>
    `;
  }).join('');
}

// Gera o HTML (thead + tbody) da tabela "Receita Tributária x Transferências Correntes"
function gerarTabelaDependenciaHTML(dados) {
  const theadAnos = ANOS_DEPENDENCIA.map(ano => `<th colspan="3" class="ano">${ano}</th>`).join('');
  const theadCols = ANOS_DEPENDENCIA.map(() => `
    <th>Valor (R$)</th>
    <th>% Particip. Receita Tributária</th>
    <th>% Dependência Receita Própria</th>
  `).join('');

  const linhasHtml = LINHAS_DEPENDENCIA.map(linha => {
    const celulas = ANOS_DEPENDENCIA.map(ano => {
      const d = dados[ano];
      const valor = d.linhas[linha.chave] || 0;
      const ehTransferencias = linha.chave === 'TRANSFERENCIAS';

      const pctParticip = !ehTransferencias && d.totalImpostos
        ? (valor / d.totalImpostos) * 100 : null;
      const pctDepend = !ehTransferencias && d.totalTransferencias
        ? (valor / d.totalTransferencias) * 100 : null;

      return `
        <td>${fmtMoeda(valor)}</td>
        <td>${pctParticip !== null ? fmtPct(pctParticip) : '<span class="na">—</span>'}</td>
        <td>${pctDepend !== null ? fmtPct(pctDepend) : '<span class="na">—</span>'}</td>
      `;
    }).join('');

    return `<tr><td>${linha.rotulo}</td>${celulas}</tr>`;
  }).join('');

  // Linha de verificação: total da espécie "Impostos" (deve coincidir com IPTU+ITBI+ISS+IRPF+Outros Impostos)
  const linhaTotalImpostos = ANOS_DEPENDENCIA.map(ano => {
    const d = dados[ano];
    const pctDepend = d.totalTransferencias ? (d.totalImpostos / d.totalTransferencias) * 100 : null;
    return `
      <td>${fmtMoeda(d.totalImpostos)}</td>
      <td>${fmtPct(100)}</td>
      <td>${pctDepend !== null ? fmtPct(pctDepend) : '<span class="na">—</span>'}</td>
    `;
  }).join('');

  return `
    <thead>
      <tr><th></th>${theadAnos}</tr>
      <tr><th>Receita Tributária</th>${theadCols}</tr>
    </thead>
    <tbody>
      ${linhasHtml}
      <tr><td>Total Impostos (IPTU+ITBI+ISS+IRPF+Outros Impostos)</td>${linhaTotalImpostos}</tr>
    </tbody>
  `;
}

// Cria (ou recria) o gráfico de barras "valor de cada linha, por ano"
function criarGraficoDependencia(canvasId, chartAtual, dados) {
  const ctx = document.getElementById(canvasId);
  if (chartAtual) chartAtual.destroy();
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: LINHAS_DEPENDENCIA.map(l => l.rotulo),
      datasets: ANOS_DEPENDENCIA.map(ano => ({
        label: ano,
        data: LINHAS_DEPENDENCIA.map(l => dados[ano].linhas[l.chave] || 0),
        backgroundColor: COR_ANO[ano],
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { ticks: { callback: v => fmtMoeda(v) } },
      },
    },
  });
}

let depChart;

function renderizarDependencia() {
  const municipio = document.getElementById('depMunicipio').value;
  const kpisEl = document.getElementById('depKpis');
  const tabelaEl = document.getElementById('depTabela');

  if (!municipio) {
    kpisEl.innerHTML = '<div class="hint">Selecione um município para ver os indicadores.</div>';
    tabelaEl.innerHTML = '';
    if (depChart) { depChart.destroy(); depChart = null; }
    return;
  }

  const dados = calcularDependenciaPara([municipio]);

  kpisEl.innerHTML = gerarKpisDependenciaHTML(dados);
  tabelaEl.innerHTML = gerarTabelaDependenciaHTML(dados);
  depChart = criarGraficoDependencia('depGrafico', depChart, dados);
}

// ── Dependência por grupo populacional ───────────────────────────
const GRUPOS_POPULACIONAIS = [
  { id: '1', rotulo: 'Grupo 1 — população > 300 mil habitantes', min: 300000, max: Infinity },
  { id: '2', rotulo: 'Grupo 2 — população entre 100 mil e 300 mil habitantes', min: 100000, max: 300000 },
  { id: '3', rotulo: 'Grupo 3 — população entre 50 mil e 100 mil habitantes', min: 50000, max: 100000 },
  { id: '4', rotulo: 'Grupo 4 — população entre 20 mil e 50 mil habitantes', min: 20000, max: 50000 },
  { id: '5', rotulo: 'Grupo 5 — população entre 10 mil e 20 mil habitantes', min: 10000, max: 20000 },
  { id: '6', rotulo: 'Grupo 6 — população inferior a 10 mil habitantes', min: 0, max: 10000 },
];

// Limites: o "max" de um grupo é exclusivo (pertence ao grupo seguinte, que
// tem esse valor como "min" inclusivo), exceto o Grupo 1 (sem limite superior).
function municipiosDoGrupo(grupoId) {
  const grupo = GRUPOS_POPULACIONAIS.find(g => g.id === grupoId);
  if (!grupo) return [];
  return populacao.filter(p => {
    const pop = Number(p.populacao_2022) || 0;
    if (grupo.max === Infinity) return pop > grupo.min;
    return pop >= grupo.min && pop < grupo.max;
  });
}

let depGrupoChart;

function initDependenciaGrupo() {
  document.getElementById('depGrupoSelecao').addEventListener('change', renderizarDependenciaGrupo);
}

function renderizarDependenciaGrupo() {
  const grupoId = document.getElementById('depGrupoSelecao').value;
  const kpisEl = document.getElementById('depGrupoKpis');
  const tabelaEl = document.getElementById('depGrupoTabela');
  const municipiosEl = document.getElementById('depGrupoMunicipios');

  const municipiosGrupo = municipiosDoGrupo(grupoId);

  if (!municipiosGrupo.length) {
    kpisEl.innerHTML = '<div class="hint">Nenhum município encontrado para este grupo.</div>';
    tabelaEl.innerHTML = '';
    municipiosEl.innerHTML = '';
    if (depGrupoChart) { depGrupoChart.destroy(); depGrupoChart = null; }
    return;
  }

  const nomes = municipiosGrupo
    .map(m => m.municipio)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  municipiosEl.innerHTML = `<strong>${nomes.length} município(s) neste grupo:</strong> ${nomes.join(', ')}`;

  const dados = calcularDependenciaPara(nomes);

  kpisEl.innerHTML = gerarKpisDependenciaHTML(dados);
  tabelaEl.innerHTML = gerarTabelaDependenciaHTML(dados);
  depGrupoChart = criarGraficoDependencia('depGrupoGrafico', depGrupoChart, dados);
}

// ── Aba: Distribuição por critério populacional ──────────────────
const ANOS_DISTRIBUICAO = ['2023', '2024', '2025'];
const PREFIXO_ICMS = 'Cota-Parte do ICMS';

let ordenacaoDistribuicao = { coluna: 'municipio', direcao: 'asc' };

// Conjunto de municípios selecionados no filtro (vazio = todos)
const distMunicipiosSelecionados = new Set();

function initDistribuicao() {
  const selAno = document.getElementById('distAno');
  selAno.innerHTML = ANOS_DISTRIBUICAO.map(a => `<option value="${a}">${a}</option>`).join('');
  selAno.value = ANOS_DISTRIBUICAO[ANOS_DISTRIBUICAO.length - 1];
  selAno.addEventListener('change', renderizarDistribuicao);

  const toggle = document.getElementById('distMunicipiosToggle');
  const panel = document.getElementById('distMunicipiosPanel');
  const busca = document.getElementById('distMunicipiosBusca');
  const wrap = document.getElementById('distMunicipiosWrap');

  toggle.addEventListener('click', () => {
    const abrir = panel.hidden;
    panel.hidden = !abrir;
    if (abrir) {
      busca.value = '';
      filtrarListaDistMunicipios('');
      busca.focus();
    }
  });

  // Fecha o painel ao clicar fora
  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) panel.hidden = true;
  });

  busca.addEventListener('input', () => filtrarListaDistMunicipios(busca.value));

  document.getElementById('btnDistTodos').addEventListener('click', () => {
    document.querySelectorAll('#distMunicipiosList input[type="checkbox"]').forEach(cb => {
      cb.checked = true;
      distMunicipiosSelecionados.add(cb.value);
    });
    atualizarToggleDistMunicipios();
    renderizarDistribuicao();
  });

  document.getElementById('btnDistLimpar').addEventListener('click', () => {
    distMunicipiosSelecionados.clear();
    document.querySelectorAll('#distMunicipiosList input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    atualizarToggleDistMunicipios();
    renderizarDistribuicao();
  });

  document.querySelectorAll('#distTabela th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const coluna = th.dataset.sort;
      if (ordenacaoDistribuicao.coluna === coluna) {
        ordenacaoDistribuicao.direcao = ordenacaoDistribuicao.direcao === 'asc' ? 'desc' : 'asc';
      } else {
        ordenacaoDistribuicao = { coluna, direcao: coluna === 'municipio' ? 'asc' : 'desc' };
        // diffPct: ordenação descendente (maiores ganhos % primeiro)
      }
      renderizarDistribuicao();
    });
  });
}

// Mostra/oculta os itens da lista conforme o texto de busca
function filtrarListaDistMunicipios(termo) {
  const alvo = normalizarTexto(termo);
  const itens = document.querySelectorAll('#distMunicipiosList .multiselect-item');
  let visiveis = 0;
  itens.forEach(item => {
    const corresponde = normalizarTexto(item.dataset.nome).includes(alvo);
    item.style.display = corresponde ? '' : 'none';
    if (corresponde) visiveis++;
  });
  const vazio = document.querySelector('#distMunicipiosList .multiselect-empty');
  if (vazio) vazio.style.display = visiveis ? 'none' : '';
}

function normalizarTexto(texto) {
  return (texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

// Atualiza o texto do botão com a contagem de selecionados
function atualizarToggleDistMunicipios() {
  const toggle = document.getElementById('distMunicipiosToggle');
  const n = distMunicipiosSelecionados.size;
  if (n === 0) toggle.textContent = 'Todos os municípios';
  else if (n === 1) toggle.textContent = [...distMunicipiosSelecionados][0];
  else toggle.textContent = `${n} municípios selecionados`;
}

function preencherFiltrosDistribuicao() {
  const lista = document.getElementById('distMunicipiosList');

  const nomes = [...populacao]
    .map(p => p.municipio)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  // Remove da seleção municípios que não existem mais na lista
  for (const nome of [...distMunicipiosSelecionados]) {
    if (!nomes.includes(nome)) distMunicipiosSelecionados.delete(nome);
  }

  lista.innerHTML = nomes.map(m => `
    <label class="multiselect-item" data-nome="${m}">
      <input type="checkbox" value="${m}" ${distMunicipiosSelecionados.has(m) ? 'checked' : ''}>
      ${m}
    </label>
  `).join('') + '<div class="multiselect-empty">Nenhum município encontrado</div>';

  lista.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) distMunicipiosSelecionados.add(cb.value);
      else distMunicipiosSelecionados.delete(cb.value);
      atualizarToggleDistMunicipios();
      renderizarDistribuicao();
    });
  });

  atualizarToggleDistMunicipios();
}

// Calcula, para o ano informado, os valores recebidos, recalculados e as
// diferenças, para todos os municípios com população cadastrada.
//
// Metodologia do valor recalculado:
//   - 20% do valor recebido por cada município é mantido (parcela fixa)
//   - Os 80% restantes do total estadual são redistribuídos per capita
//   icmsRecalc = icmsRecebido × 0,20 + totalIcms × 0,80 × (pop / populacaoBase)
function calcularDistribuicao(ano) {
  const registrosAno = dataset.filter(r => r.ANOREFERENCIA === ano);

  const recebidoPorMunicipio = new Map();
  let totalIcms = 0;

  for (const r of registrosAno) {
    const desc = r.DESCRICAO || '';
    if (!desc.startsWith(PREFIXO_ICMS)) continue;

    const valor = Number(r.VALORLANCAMENTO) || 0;
    recebidoPorMunicipio.set(r.MUNICIPIO, (recebidoPorMunicipio.get(r.MUNICIPIO) || 0) + valor);
    totalIcms += valor;
  }

  // População total (base para distribuição per capita dos 80%)
  let populacaoBase = 0;
  for (const p of populacao) {
    populacaoBase += Number(p.populacao_2022) || 0;
  }

  const poolPerCapita = populacaoBase ? (totalIcms * 0.80) / populacaoBase : 0;

  return populacao.map(p => {
    const pop = Number(p.populacao_2022) || 0;
    const icmsRecebido = recebidoPorMunicipio.get(p.municipio) || 0;
    const icmsRecalc = (icmsRecebido * 0.20) + (poolPerCapita * pop);
    const diffIcms = icmsRecalc - icmsRecebido;
    const diffPct = icmsRecebido ? (diffIcms / icmsRecebido) * 100 : null;

    return { municipio: p.municipio, populacao: pop, icmsRecebido, icmsRecalc, diffIcms, diffPct };
  });
}

// Formata uma diferença com sinal explícito (+/-)
function fmtDiff(v) {
  const sinal = v > 0 ? '+' : '';
  return `${sinal}${fmtMoeda(v)}`;
}

// Classe CSS para colorir/marcar visualmente o sinal da diferença
function classeDiff(v) {
  if (v > 0.005) return 'diff-pos';
  if (v < -0.005) return 'diff-neg';
  return 'diff-zero';
}

function renderizarDistribuicao() {
  const ano = document.getElementById('distAno').value;
  const selecionados = distMunicipiosSelecionados;

  let linhas = calcularDistribuicao(ano);

  if (selecionados.size) {
    linhas = linhas.filter(l => selecionados.has(l.municipio));
  }

  const { coluna, direcao } = ordenacaoDistribuicao;
  linhas = [...linhas].sort((a, b) => {
    let cmp;
    if (coluna === 'municipio') cmp = a.municipio.localeCompare(b.municipio, 'pt-BR');
    else cmp = (a[coluna] ?? -Infinity) - (b[coluna] ?? -Infinity);
    return direcao === 'asc' ? cmp : -cmp;
  });

  const fmtNumero = v => v.toLocaleString('pt-BR');
  const fmtDiffPct = (v) => {
    if (v === null) return '<span class="na">—</span>';
    const sinal = v > 0 ? '+' : '';
    return `${sinal}${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  };

  const tbody = document.getElementById('distTbody');
  tbody.innerHTML = linhas.map(l => `
    <tr>
      <td>${l.municipio}</td>
      <td style="text-align:right">${fmtNumero(l.populacao)}</td>
      <td>${fmtMoeda(l.icmsRecebido)}</td>
      <td>${fmtMoeda(l.icmsRecalc)}</td>
      <td class="${classeDiff(l.diffIcms)}">${fmtDiff(l.diffIcms)}</td>
      <td class="${classeDiff(l.diffIcms)}">${fmtDiffPct(l.diffPct)}</td>
    </tr>
  `).join('');

  // KPI: diferença (somatório com sinal) em R$ e em % do total recebido
  const somaSinal = chave => linhas.reduce((s, l) => s + l[chave], 0);
  const totalIcmsRecebidoGeral = linhas.reduce((s, l) => s + l.icmsRecebido, 0);
  const diffIcmsSigned = somaSinal('diffIcms');

  const pct = (valor, total) => total ? fmtPct((valor / total) * 100) : null;

  // Monta um cartão de KPI com valor em R$ (em destaque, colorido conforme o
  // sinal) e o percentual correspondente abaixo, em fonte menor.
  const cartaoDiferenca = (rotulo, valor, total) => {
    const classe = classeDiff(valor);
    const percentual = pct(valor, total);
    return `
      <div class="kpi-card">
        <div class="kpi-valor kpi-valor-pequeno ${classe}">${fmtMoeda(Math.abs(valor))}</div>
        <div class="kpi-sub ${classe}">${percentual !== null ? `${valor >= 0 ? '+' : '-'}${percentual}` : '—'}</div>
        <div class="kpi-label">${rotulo}</div>
      </div>
    `;
  };

  document.getElementById('distKpis').innerHTML =
    cartaoDiferenca('Diferença Cota-Parte ICMS', diffIcmsSigned, totalIcmsRecebidoGeral);

  // Indicador visual da coluna/direção de ordenação
  document.querySelectorAll('#distTabela th[data-sort]').forEach(th => {
    const ativo = th.dataset.sort === coluna;
    th.textContent = th.textContent.replace(/ [▲▼]$/, '');
    if (ativo) th.textContent += direcao === 'asc' ? ' ▲' : ' ▼';
  });
}

init();
