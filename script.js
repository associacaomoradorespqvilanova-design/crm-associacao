const URL_API_GS = "https://script.google.com/macros/s/AKfycbzi6DpaF-r_A4RKz_1AsLY9XYfKLJfRFmkg82crAZ2CxzjylhwMgmaT7EbtvhCQ9XUcXw/exec"; 

function fetchFromGS(acao, params = {}, signal) {
    return new Promise((resolve, reject) => {
        const callbackName = 'cb' + Date.now() + Math.random().toString(36).substr(2, 8);
        const urlParams = new URLSearchParams({ acao, callback: callbackName, ...params });
        const script = document.createElement('script');
        script.src = URL_API_GS + '?' + urlParams.toString();
        
        const timeout = setTimeout(() => {
            if (document.body.contains(script)) document.body.removeChild(script);
            reject(new Error('Timeout na requisição JSONP'));
            setTimeout(() => { delete window[callbackName]; }, 1000);
        }, 15000);
        
        window[callbackName] = (res) => {
            clearTimeout(timeout);
            if (document.body.contains(script)) document.body.removeChild(script);
            resolve(res);
            setTimeout(() => { delete window[callbackName]; }, 1000);
        };
        
        script.onerror = () => {
            clearTimeout(timeout);
            if (document.body.contains(script)) document.body.removeChild(script);
            reject(new Error('Erro de rede na requisição JSONP'));
            setTimeout(() => { delete window[callbackName]; }, 1000);
        };
        
        document.body.appendChild(script);

        if (signal) {
            signal.addEventListener('abort', () => {
                if (document.body.contains(script)) {
                    document.body.removeChild(script);
                    clearTimeout(timeout);
                    delete window[callbackName];
                }
            });
        }
    });
}

async function postParaGoogleSheets(acao, dados = {}) {
    const formData = new URLSearchParams();
    formData.append('acao', acao);
    formData.append('dados', JSON.stringify(dados));
    await fetch(URL_API_GS, { method: 'POST', body: formData, mode: 'no-cors' });
}

const state = {
    dadosAgenda: [],
    dadosCartoes: [],
    responsaveis: [],
    telefoneCount: 1,
    cursoCount: 0,
    expCount: 0,
    fotoBase64: null,
    lastSearchedCPF: '',
    tipoComprovanteAtual: 'assinatura'
};

document.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('crm_user');
    if (savedUser === 'admin') {
        loginSuccess();
    }
});

function login() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const errorBox = document.getElementById('login-error');
    errorBox.style.display = 'none';
    if(user === 'admin' && pass === '123') {
        localStorage.setItem('crm_user', 'admin');
        loginSuccess();
    } else { 
        errorBox.style.display = 'block'; 
    }
}

function loginSuccess() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard-screen').style.display = 'block';
    updateClock();
    renderizarTabelas();
    renderizarPendentesCestaHome(); // 🔥 Carrega pendentes
    verificarProximaAgendaPopup();
}

function logout() {
    localStorage.removeItem('crm_user');
    document.getElementById('dashboard-screen').style.display = 'none';
    document.getElementById('login-screen').style.display = 'block';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
}

function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-BR', { hour12: false });
    const clockEl = document.getElementById('current-time');
    if (clockEl.innerText !== timeString) {
        clockEl.innerText = timeString;
        clockEl.style.animation = 'none';
        setTimeout(() => { clockEl.style.animation = 'paperFlip 0.4s ease-in-out'; }, 10);
    }
}
setInterval(updateClock, 1000);
updateClock();

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const activeModal = document.querySelector('.modal-overlay.active');
        if (activeModal) activeModal.classList.remove('active');
        const comprovante = document.getElementById('modal-comprovante-print');
        if (comprovante && comprovante.style.display === 'flex') {
            fecharComprovantePrint();
        }
    }
});

function verificarProximaAgendaPopup() {
    const hoje = new Date();
    const proximos = state.dadosAgenda.filter(item => new Date(item.data + 'T00:00:00') >= hoje).sort((a, b) => new Date(a.data) - new Date(b.data)).slice(0, 2);
    if (proximos.length > 0) {
        const content = document.getElementById('popup-login-content');
        let html = `<p><strong>Você tem os seguintes compromissos agendados:</strong></p><ul>`;
        proximos.forEach(item => {
            const dataFormatada = new Date(item.data + 'T00:00:00').toLocaleDateString('pt-BR');
            html += `<li><strong>${dataFormatada}</strong> - ${item.nome} (${item.periodo})</li>`;
        });
        html += `</ul>`;
        content.innerHTML = html;
        abrirModal('modal-popup-login');
    }
}

async function renderizarTabelas() { 
    await renderizarAgenda(); 
    await renderizarCartoes(); 
}

async function renderizarAgenda() {
    const resp = await fetchFromGS('listarAgenda');
    state.dadosAgenda = resp.itens || [];

    const tbody = document.getElementById('agenda-list');
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    tbody.innerHTML = '';

    const sorted = [...state.dadosAgenda].sort((a, b) => new Date(a.data) - new Date(b.data));
    let hojeEncontrado = false, amanhaEncontrado = false;

    sorted.forEach(item => {
        const tr = document.createElement('tr');
        const dataItem = new Date(item.data + 'T00:00:00');
        dataItem.setHours(0,0,0,0);
        const dataFormatada = dataItem.toLocaleDateString('pt-BR');
        const diffDays = Math.ceil((dataItem - hoje) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) { tr.className = 'highlight-row pulse-row'; hojeEncontrado = true; }
        else if (diffDays === 1) { tr.className = 'highlight-row pulse-row'; amanhaEncontrado = true; }
        else if (diffDays < 0) return;

        tr.innerHTML = `
            <td>${dataFormatada}</td>
            <td>${item.periodo}</td>
            <td style="font-weight:600;">${item.nome}</td>
            <td>${item.endereco}</td>
            <td>${item.telefone}</td>
            <td><button class="btn-edit" onclick="deletarItemAgenda(${item.id})" title="Excluir" style="color:#ff4757;">🗑️</button></td>
        `;
        tbody.appendChild(tr);
    });

    if (tbody.children.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">Nenhum compromisso futuro agendado.</td></tr>';
    }
}

async function salvarAgenda() {
    const nome = document.getElementById('ag-nome').value;
    const data = document.getElementById('ag-data').value;
    const periodo = document.getElementById('ag-periodo').value;
    const endereco = document.getElementById('ag-end').value;
    const telefone = document.getElementById('ag-tel').value;
    if(!nome || !data) { 
        alert("Preencha pelo menos o Nome e a Data."); 
        return; 
    }

    await postParaGoogleSheets('salvarAgenda', { id: Date.now(), nome, data, periodo, endereco, telefone });
    fecharModal('modal-agenda');
    await renderizarAgenda();
    document.getElementById('ag-nome').value = ''; 
    document.getElementById('ag-data').value = ''; 
    document.getElementById('ag-periodo').value = ''; 
    document.getElementById('ag-end').value = ''; 
    document.getElementById('ag-tel').value = '';
}

async function deletarItemAgenda(id) {
    if (!confirm('Tem certeza que deseja excluir este compromisso?')) return;
    await postParaGoogleSheets('deletarAgenda', id);
    await renderizarAgenda();
}

// ==========================================================
// CARTÕES (COLUNA DIREITA)
// ==========================================================
async function renderizarCartoes() {
    const resp = await fetchFromGS('listarCartoes');
    state.dadosCartoes = resp.itens || [];

    const respNomes = await fetchFromGS('listarResponsaveis');
    state.responsaveis = respNomes.nomes || [];

    const select = document.getElementById('card-responsavel');
    select.innerHTML = '<option value="">Selecione um responsável</option>';
    
    state.responsaveis.forEach(nome => {
        const nomeLimpo = String(nome).replace(/^"|"$/g, '').replace(/^'|'$/g, '');
        select.innerHTML += `<option value="${nomeLimpo}">${nomeLimpo}</option>`;
    });

    const thResponsaveis = document.getElementById('th-responsaveis');
    const nomesOrdenados = state.responsaveis.map(n => n.replace(/^"|"$/g, '').replace(/^'|'$/g, ''));
    
    if (nomesOrdenados.length > 0) {
        thResponsaveis.colSpan = nomesOrdenados.length;
        thResponsaveis.innerText = nomesOrdenados.join(' / ');
    } else {
        thResponsaveis.colSpan = 1;
        thResponsaveis.innerText = 'RESPONSÁVEIS';
    }

    const tbody = document.getElementById('cards-list');
    tbody.innerHTML = '';
    const totais = {};

    state.dadosCartoes.forEach(item => {
        if(!totais[item.responsavel]) totais[item.responsavel] = 0;
        totais[item.responsavel] += item.qtd;
    });

    const agrupado = {};
    state.dadosCartoes.forEach(item => {
        let dataObj = new Date(item.data + 'T00:00:00');
        if (isNaN(dataObj.getTime())) {
            const partes = item.data.split('/');
            if (partes.length === 3) {
                dataObj = new Date(partes[2], partes[1] - 1, partes[0]);
            }
        }
        const dataStr = dataObj.toISOString().split('T')[0];

        if(!agrupado[dataStr]) agrupado[dataStr] = {};
        if(!agrupado[dataStr][item.responsavel]) agrupado[dataStr][item.responsavel] = 0;
        agrupado[dataStr][item.responsavel] += item.qtd;
    });

    for (const [data, valores] of Object.entries(agrupado).sort((a,b) => new Date(a[0]) - new Date(b[0]))) {
        const tr = document.createElement('tr');
        const dataFormatada = new Date(data + 'T00:00:00').toLocaleDateString('pt-BR');
        let totalDia = 0;
        let colunasHtml = '';

        nomesOrdenados.forEach(nome => {
            const qtd = valores[nome] || 0;
            if (qtd > 0) {
                colunasHtml += `<td style="text-align:center;"><strong>${qtd}</strong></td>`;
            } else {
                colunasHtml += `<td style="text-align:center; color:#ccc;">-</td>`;
            }
            totalDia += qtd;
        });

        tr.innerHTML = `
            <td>${dataFormatada}</td>
            ${colunasHtml}
            <td style="color:#4a7c2e; font-weight:700; text-align:center;">${totalDia}</td>
            <td>
                <button class="btn-edit" onclick="excluirMesCartao('${data}')" title="Excluir Mês" style="color:#ff4757;">📆🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    }

    if (tbody.children.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">Nenhum registro de cartão.</td></tr>';
    }

    const totaisDiv = document.getElementById('totais-gerais');
    let htmlTotais = '';
    let totalGeral = 0;
    nomesOrdenados.forEach(nome => {
        if (totais[nome]) {
            htmlTotais += `<span>Total ${nome}: <span style="font-weight:700;">${totais[nome]}</span></span>`;
            totalGeral += totais[nome];
        }
    });
    if (htmlTotais) {
        htmlTotais += `<span>Total Geral: <span style="font-weight:700; color:#4a7c2e;">${totalGeral}</span></span>`;
        totaisDiv.innerHTML = htmlTotais;
        totaisDiv.style.display = 'flex';
    } else {
        totaisDiv.style.display = 'none';
    }
}

async function excluirMesCartao(data) {
    let dataStr = data;
    if (data.includes('/')) {
        const partes = data.split('/');
        if (partes.length === 3) {
            dataStr = `${partes[2]}-${partes[1]}-${partes[0]}`;
        }
    }
    const dataObj = new Date(dataStr + 'T00:00:00');
    if (isNaN(dataObj.getTime())) {
        alert("Data inválida para exclusão.");
        return;
    }
    const mes = dataObj.getMonth() + 1;
    const ano = dataObj.getFullYear();
    const confirmGeral = confirm(`Excluir TODOS os cartões do mês ${mes}/${ano}?`);
    if (!confirmGeral) return;
    await postParaGoogleSheets('deletarMesGeral', { mes, ano });
    await renderizarCartoes();
}

async function salvarCartoes() {
    const responsavel = document.getElementById('card-responsavel').value;
    const qtd = parseInt(document.getElementById('card-qtd').value);
    const data = document.getElementById('card-data').value;
    if(!responsavel || !qtd || !data) { 
        alert("Preencha o Responsável, Quantidade e Data."); 
        return; 
    }
    await postParaGoogleSheets('salvarCartao', { id: Date.now(), responsavel, qtd, data });
    fecharModal('modal-cartoes');
    await renderizarCartoes();
    document.getElementById('card-qtd').value = ''; 
    document.getElementById('card-data').value = '';
}

async function adicionarResponsavel() {
    const input = document.getElementById('novo-responsavel-input');
    let nome = input.value.trim();
    nome = nome.replace(/^"|"$/g, ''); 
    nome = nome.replace(/^'|'$/g, '');
    if (!nome) { 
        alert("Digite um nome."); 
        return; 
    }
    await postParaGoogleSheets('salvarResponsavel', nome);
    input.value = '';
    await renderizarCartoes();
    await carregarListaResponsaveisNoModal();
}

async function carregarListaResponsaveisNoModal() {
    const resp = await fetchFromGS('listarResponsaveis');
    state.responsaveis = resp.nomes || [];
    const container = document.getElementById('lista-responsaveis-cadastrados');
    container.innerHTML = '';
    state.responsaveis.forEach(nome => {
        const nomeLimpo = String(nome).replace(/^"|"$/g, '').replace(/^'|'$/g, '');
        const span = document.createElement('span');
        span.style.cssText = 'background:#eafde8; padding:3px 10px; border-radius:12px; font-size:12px; display:flex; align-items:center; gap:5px;';
        span.innerHTML = `${nomeLimpo} <button onclick="deletarResponsavel('${nomeLimpo}')" style="border:none; background:transparent; color:#ff4757; font-weight:bold; cursor:pointer;">×</button>`;
        container.appendChild(span);
    });
}

async function deletarResponsavel(nome) {
    if (!confirm(`Remover o responsável "${nome}" da lista?`)) return;
    await postParaGoogleSheets('deletarResponsavel', nome);
    await renderizarCartoes();
    await carregarListaResponsaveisNoModal();
}


// ==========================================================
// ADC CARTÕES
// ==========================================================
let contadorEntregas = 0;

function abrirModal(id) {
    document.getElementById(id).classList.add('active');
    if (id === 'modal-multiplas-entregas') {
        const lista = document.getElementById('mult-lista-entregas');
        lista.innerHTML = '';
        contadorEntregas = 0;
        adicionarEntrega();
        
        const hoje = new Date();
        const formatada = hoje.toLocaleDateString('pt-BR');
        document.getElementById('mult-data').value = formatada;
        
        setTimeout(() => {
            const primeiroNome = document.querySelector('#mult-lista-entregas .nome-input');
            if (primeiroNome) primeiroNome.focus();
        }, 200);
    }
}

function adicionarEntrega() {
    contadorEntregas++;
    const lista = document.getElementById('mult-lista-entregas');
    
    const novaEntrega = document.createElement('div');
    novaEntrega.className = 'entrega-item';
    novaEntrega.dataset.index = contadorEntregas - 1;
    novaEntrega.style.cssText = 'background: white; padding: 12px; border-radius: 8px; border: 1px solid #e0e0e0; margin-bottom: 10px;';
    
    novaEntrega.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; background: #fafafa; padding: 5px 8px; border-radius: 6px;">
            <div style="background: #4a7c2e; color: white; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: bold;">${contadorEntregas}</div>
            <button type="button" style="background: #ffebee; color: #d32f2f; border: none; border-radius: 50%; width: 30px; height: 30px; cursor: pointer; font-size: 15px; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onclick="removerEntrega(this)" title="Remover esta linha">
                <i class="fas fa-trash-alt"></i>
            </button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
                <label style="display:block; font-weight:600; font-size:11px; color:#444;">Nome</label>
                <input type="text" class="nome-input" placeholder="Nome completo" style="width:100%; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:13px; text-transform:uppercase;">
            </div>
            <div>
                <label style="display:block; font-weight:600; font-size:11px; color:#444;">Endereço</label>
                <input type="text" class="endereco-input" placeholder="Endereço completo" style="width:100%; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:13px; text-transform:uppercase;">
            </div>
        </div>
    `;
    
    lista.appendChild(novaEntrega);
    atualizarContador();
    
    const novoNome = novaEntrega.querySelector('.nome-input');
    const novoEndereco = novaEntrega.querySelector('.endereco-input');

    novoNome.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            this.closest('.entrega-item').querySelector('.endereco-input').focus();
        }
    });

    novoEndereco.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            const enderecos = document.querySelectorAll('#mult-lista-entregas .endereco-input');
            if (this === enderecos[enderecos.length - 1]) {
                adicionarEntrega();
            } else {
                const index = Array.from(enderecos).indexOf(this);
                const proximoNome = document.querySelectorAll('#mult-lista-entregas .nome-input')[index + 1];
                if (proximoNome) proximoNome.focus();
            }
        }
    });

    if (contadorEntregas === 1) novoNome.focus();
}

function removerEntrega(botao) {
    const entregaItem = botao.closest('.entrega-item');
    if (contadorEntregas <= 1) {
        alert('É necessário pelo menos uma entrega!');
        return;
    }
    entregaItem.remove();
    contadorEntregas--;
    
    const itens = document.querySelectorAll('#mult-lista-entregas .entrega-item');
    itens.forEach((item, idx) => {
        item.dataset.index = idx;
        item.querySelector('div:first-child div:first-child').textContent = idx + 1;
    });
    atualizarContador();
}

function atualizarContador() {
    document.getElementById('mult-contador').textContent = 
        `${contadorEntregas} ${contadorEntregas === 1 ? 'entrega' : 'entregas'}`;
}

function validarCampos() {
    let valido = true;
    
    const qtd = document.getElementById('mult-qtd').value;
    const tipo = document.getElementById('mult-tipo').value;
    const numero = document.getElementById('mult-numero').value;
    
    if (!qtd || !tipo || !numero) {
        alert("Preencha todos os campos: Quantidade, Tipo e N°.");
        valido = false;
    }
    
    const nomes = document.querySelectorAll('#mult-lista-entregas .nome-input');
    const enderecos = document.querySelectorAll('#mult-lista-entregas .endereco-input');
    
    nomes.forEach((nome, index) => {
        if (!nome.value.trim() || !enderecos[index].value.trim()) {
            nome.style.borderColor = '#e53935';
            enderecos[index].style.borderColor = '#e53935';
            valido = false;
        } else {
            nome.style.borderColor = '#ddd';
            enderecos[index].style.borderColor = '#ddd';
        }
    });
    
    return valido;
}

function coletarDadosParaEnvio() {
    const dadosComuns = {
        quantidade: document.getElementById('mult-qtd').value,
        data: document.getElementById('mult-data').value,
        tipo: document.getElementById('mult-tipo').value,
        obs: document.getElementById('mult-obs').value.toUpperCase(),
        numero: document.getElementById('mult-numero').value
    };
    
    const entregas = [];
    const nomes = document.querySelectorAll('#mult-lista-entregas .nome-input');
    const enderecos = document.querySelectorAll('#mult-lista-entregas .endereco-input');
    
    nomes.forEach((nome, index) => {
        const nomeValor = nome.value.trim().toUpperCase();
        const enderecoValor = enderecos[index].value.trim().toUpperCase();
        
        if (nomeValor && enderecoValor) {
            entregas.push({
                nome: nomeValor,
                endereco: enderecoValor,
                quantidade: dadosComuns.quantidade,
                data: dadosComuns.data,
                tipo: dadosComuns.tipo,
                obs: dadosComuns.obs,
                numero: dadosComuns.numero
            });
        }
    });
    
    return entregas;
}

function limparCamposNomeEndereco() {
    const nomes = document.querySelectorAll('#mult-lista-entregas .nome-input');
    const enderecos = document.querySelectorAll('#mult-lista-entregas .endereco-input');
    
    nomes.forEach(nome => {
        nome.value = '';
        nome.style.borderColor = '#ddd';
    });
    
    enderecos.forEach(endereco => {
        endereco.value = '';
        endereco.style.borderColor = '#ddd';
    });
}

function enviarTodasEntregas() {
    if (!validarCampos()) return;
    
    const entregas = coletarDadosParaEnvio();
    
    if (entregas.length === 0) {
        alert('Adicione pelo menos uma entrega válida!');
        return;
    }
    
    const btnEnviar = document.getElementById('btnEnviarMulti');
    btnEnviar.innerText = 'Enviando...';
    btnEnviar.disabled = true;
    
    const statusDiv = document.getElementById('mult-status-message');
    statusDiv.style.display = 'none';
    
    postParaGoogleSheets('salvarLoteCartoesEntrega', entregas)
        .then(() => {
            statusDiv.style.display = 'block';
            statusDiv.style.background = '#e8f5e9';
            statusDiv.style.color = '#2e7d32';
            statusDiv.style.border = '2px solid #a5d6a7';
            statusDiv.innerText = `✅ ${entregas.length} registro(s) salvos com sucesso!`;
            
            limparCamposNomeEndereco();
            const nomes = document.querySelectorAll('#mult-lista-entregas .nome-input');
            if (nomes.length > 0) nomes[0].focus();
        })
        .catch((err) => {
            statusDiv.style.display = 'block';
            statusDiv.style.background = '#ffebee';
            statusDiv.style.color = '#c62828';
            statusDiv.style.border = '2px solid #ef9a9a';
            statusDiv.innerText = `❌ Erro ao salvar: ${err.message}`;
        })
        .finally(() => {
            btnEnviar.innerText = 'Enviar Tudo';
            btnEnviar.disabled = false;
        });
}


// ==========================================================
// 🔥 CESTA (NOVO MÓDULO COMPLETO)
// ==========================================================

// Utilitários de normalização
function normalizeString(s) { if (!s && s !== 0) return ""; return s.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase().trim(); }
function headerToId(lbl) { if (!lbl && lbl !== 0) lbl = ""; return lbl.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_').toUpperCase(); }

// Estado da Cesta
const cestaState = {
    names: [],
    types: [],
    currentLine: null,
    currentDados: [],
    qrCodeInstance: null
};

// 🔥 FUNÇÃO ABRIR MODAL CESTA
function abrirModalCesta() {
    document.getElementById('modal-cesta').classList.add('active');
    carregarNomesCesta();
    carregarTiposCesta();
    renderizarPendentesCestaHome();

    // Prepara o foco para o scanner
    const scannerInput = document.getElementById('cesta-scanner-input');
    setTimeout(() => { scannerInput.focus(); }, 300);
}

// Sobrescreve a função abrirModal
const abrirModalOriginal = abrirModal;
abrirModal = function(id) {
    if (id === 'modal-cesta') {
        abrirModalCesta();
        return;
    }
    abrirModalOriginal(id);
};

// 🔥 CARREGAR NOMES E TIPOS
async function carregarNomesCesta() {
    try {
        const res = await fetchFromGS('buscarTodosNomesCesta');
        cestaState.names = res || [];
    } catch (e) { console.error(e); cestaState.names = []; }
}

async function carregarTiposCesta() {
    try {
        const res = await fetchFromGS('listarTiposCesta');
        cestaState.types = res || [];
        document.getElementById('cesta-tipos-input').value = cestaState.types.join(', ');
    } catch (e) { console.error(e); cestaState.types = []; }
}

// 🔥 SALVAR TIPOS DE CESTA
async function salvarTiposCesta() {
    const tiposStr = document.getElementById('cesta-tipos-input').value.trim();
    const tipos = tiposStr.split(',').map(t => t.trim().toUpperCase()).filter(t => t);
    try {
        await postParaGoogleSheets('salvarTiposCesta', { tipos: tipos });
        alert("✅ Tipos de cesta atualizados!");
        await carregarTiposCesta();
        renderizarPendentesCestaHome();
    } catch (e) {
        alert("❌ Erro ao salvar tipos: " + e.message);
    }
}

// 🔥 HOME PENDENTES
async function renderizarPendentesCestaHome() {
    try {
        const list = await fetchFromGS('listarPendentesMesAtual');
        const container = document.getElementById('cesta-pendentes-home');
        if (!list || list.length === 0) {
            container.innerHTML = '<span style="color:#4a7c2e; font-weight:600;">✅ Todos os cadastros do mês atual estão em dia!</span>';
            return;
        }
        let html = '';
        list.forEach(item => {
            html += `<span style="background:#ffe6e6; color:#9b2c2c; padding:5px 12px; border-radius:20px; font-weight:600; font-size:13px;">${item.nome} (${item.tipo || 'Sem tipo'})</span>`;
        });
        container.innerHTML = html;
    } catch (e) {
        console.error(e);
        document.getElementById('cesta-pendentes-home').innerHTML = '<span style="color:#888;">Erro ao carregar pendentes.</span>';
    }
}

// 🔥 SEARCH / AUTOCOMPLETE
const inputCesta = document.getElementById('cesta-search');
const suggCesta = document.getElementById('cesta-suggestions');

inputCesta.addEventListener('input', function(){
    const v = this.value; suggCesta.innerHTML='';
    if (!v || v.length < 2) { suggCesta.style.display='none'; return; }
    const q = v.toLowerCase();
    const filtered = cestaState.names.filter(n => n.toLowerCase().includes(q)).slice(0, 30);
    if (filtered.length === 0) { suggCesta.style.display='none'; return; }
    filtered.forEach(name=>{
        const d=document.createElement('div'); d.textContent=name;
        d.onclick=()=>{ inputCesta.value=name; suggCesta.style.display='none'; };
        d.className = 'suggestion-item';
        suggCesta.appendChild(d);
    });
    suggCesta.style.display='block';
});

document.addEventListener('click', e=> {
    if (!document.getElementById('cesta-suggestions').contains(e.target) && e.target !== inputCesta) {
        suggCesta.style.display='none';
    }
});

document.getElementById('cesta-btnSearch').addEventListener('click', async ()=>{
    const nome = inputCesta.value.trim();
    if(!nome) return alert("Digite um nome para buscar.");
    await buscarEPreencherCesta(nome);
});

async function buscarEPreencherCesta(nome) {
    try {
        const resp = await fetchFromGS('buscarMoradorCesta', { nome: nome });
        if(!resp || !resp.dados) { alert("❌ Morador não encontrado."); return; }
        cestaState.currentLine = resp.linha;
        cestaState.currentDados = resp.dados;
        renderFormCesta(resp.dados);
    } catch (e) {
        console.error(e);
        alert("Erro ao buscar os dados.");
    }
}

// 🔥 RENDERIZAR FORMULÁRIO
function renderFormCesta(dadosArray) {
    document.getElementById('cesta-formArea').style.display='block';
    document.getElementById('cesta-panelPendentes').style.display='none';
    const fields = document.getElementById('cesta-fields'); fields.innerHTML='';
    const monthsContainer = document.getElementById('cesta-monthsContainer'); monthsContainer.innerHTML='';

    // Prepara tipos para dropdown
    const tiposOptions = cestaState.types.map(t => `<option value="${t}">${t}</option>`).join('');

    const monthLabels = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];

    dadosArray.forEach(item=>{
        const id = item.id; 
        const label = item.label || id; 
        const value = item.value || "";
        const isMonth = monthLabels.map(m=>normalizeString(m)).indexOf(normalizeString(label)) !== -1;

        if(isMonth){
            const div = document.createElement('div'); div.className='month';
            const inputMonth = document.createElement('input');
            inputMonth.className = 'monthField';
            inputMonth.id = id;
            inputMonth.value = value || '';
            inputMonth.readOnly = true;

            inputMonth.addEventListener('click', function(){
                const hoje = new Date();
                const diaStr = String(hoje.getDate()).padStart(2,'0');
                const mesStr = String(hoje.getMonth()+1).padStart(2,'0');
                // Ao clicar, pergunta se quer marcar com a data de hoje
                const confirmar = confirm(`Marcar mês ${label} como entregue hoje (${diaStr}/${mesStr})?`);
                if (confirmar) {
                    inputMonth.value = `${diaStr}/${mesStr}`;
                    atualizarMesesUICesta();
                    // Salva automaticamente após marcar
                    salvarCestaAutomatico();
                }
            });

            const lab = document.createElement('label'); lab.textContent = `${label}`;
            div.appendChild(lab); div.appendChild(inputMonth);
            monthsContainer.appendChild(div);
        } else {
            const wrapper = document.createElement('div');
            if (label.trim().toUpperCase() === 'TIPO') {
                // Se for TIPO, mostra um dropdown
                wrapper.innerHTML = `<label>${label}</label><select class="field" id="${id}"><option value="">Selecione</option>${tiposOptions}</select>`;
                const select = wrapper.querySelector('select');
                select.value = value;
            } else {
                wrapper.innerHTML = `<label>${label}</label><input class="field" id="${id}" value="${value}">`;
            }
            fields.appendChild(wrapper);
        }
    });

    atualizarMesesUICesta();
}

function atualizarMesesUICesta() {
    const monthLabels = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
    const months = document.querySelectorAll('#cesta-monthsContainer .month');
    let pagos = 0;

    months.forEach((div) => {
        const inputEl = div.querySelector('input');
        if (!inputEl) return;
        inputEl.classList.remove('pago','pendente');
        let v = (inputEl.value || "").toString().trim();

        if (v && !v.includes('/') && !v.toUpperCase().includes('X')) {
            const d = new Date(v);
            if (!isNaN(d.getTime())) {
                const dia = String(d.getDate()).padStart(2,'0');
                const mes = String(d.getMonth()+1).padStart(2,'0');
                v = `${dia}/${mes}`;
                inputEl.value = v;
            }
        }

        if (!v) inputEl.value = 'X';

        if (/\d/.test(v)) {
            inputEl.classList.add('pago');
            inputEl.style.background = '#e6ffed';
            inputEl.style.color = '#166534';
            pagos++;
        } else {
            inputEl.classList.add('pendente');
            inputEl.style.background = '#fee2e2';
            inputEl.style.color = '#9b2c2c';
        }
    });

    document.getElementById('cesta-stamp').classList.toggle('show', pagos === 12);

    const statusId = headerToId('STATUS');
    const statusInput = document.getElementById(statusId);
    if (statusInput) {
        const todayIndex = new Date().getMonth();
        const monthId = headerToId(monthLabels[todayIndex]);
        const monthField = document.getElementById(monthId);
        const isPago = monthField && monthField.classList.contains('pago');
        if (isPago) {
            statusInput.value = 'ENTREGUE';
            statusInput.style.backgroundColor = '#16a34a';
            statusInput.style.color = '#ffffff';
            statusInput.style.fontWeight = 'bold';
        } else {
            statusInput.value = 'PENDENTE';
            statusInput.style.backgroundColor = '#dc2626';
            statusInput.style.color = '#ffffff';
            statusInput.style.fontWeight = 'bold';
        }
    }
}

async function salvarCestaAutomatico() {
    if(!cestaState.currentLine) return;
    
    const inputs = document.querySelectorAll('#cesta-fields .field, #cesta-monthsContainer input');
    const payload = {};
    inputs.forEach(inp => { payload[inp.id] = inp.value; });

    try {
        await postParaGoogleSheets('salvarMoradorCesta', { linha: cestaState.currentLine, payload: payload });
        renderizarPendentesCestaHome(); // Atualiza Home
    } catch (err) {
        console.error("Erro auto salvar:", err);
    }
}

// 🔥 SALVAR MANUAL
document.getElementById('cesta-btnSave').addEventListener('click', async ()=>{
    if(!cestaState.currentLine) return alert("Nenhum morador selecionado.");
    const inputs = document.querySelectorAll('#cesta-fields .field, #cesta-monthsContainer input');
    const payload = {};
    inputs.forEach(inp => { payload[inp.id] = inp.value; });

    try {
        await postParaGoogleSheets('salvarMoradorCesta', { linha: cestaState.currentLine, payload: payload });
        alert("✅ Dados salvos com sucesso!");
        atualizarMesesUICesta();
        renderizarPendentesCestaHome();
    } catch (err) { alert("❌ Erro ao salvar: " + err.message); }
});


// ==========================================================
// 🔥 SCANNER DA CESTA (CÂMERA)
// ==========================================================

let cameraHtml5QrCesta = null;

async function abrirCameraCesta() {
    const container = document.getElementById('cesta-camera-container');
    const btn = event.target;
    
    if (container.style.display === 'block') {
        if (cameraHtml5QrCesta) { await cameraHtml5QrCesta.stop(); cameraHtml5QrCesta.clear(); cameraHtml5QrCesta = null; }
        container.style.display = 'none';
        btn.innerText = '📷 Escanear Carteirinha';
        return;
    }

    container.style.display = 'block';
    btn.innerText = '⏹ Fechar';

    cameraHtml5QrCesta = new Html5Qrcode("cesta-camera-container");

    try {
        await cameraHtml5QrCesta.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 200, height: 200 } },
            onScanSuccessCesta
        );
    } catch (err) {
        alert("Erro ao abrir câmera.");
        container.style.display = 'none';
        btn.innerText = '📷 Escanear Carteirinha';
        cameraHtml5QrCesta = null;
    }
}

function onScanSuccessCesta(decodedText) {
    // Para a câmera
    if (cameraHtml5QrCesta) {
        cameraHtml5QrCesta.stop().catch(()=>{});
        cameraHtml5QrCesta.clear().catch(()=>{});
        cameraHtml5QrCesta = null;
    }
    document.getElementById('cesta-camera-container').style.display = 'none';
    document.querySelector('#modal-cesta button[onclick*="abrirCameraCesta"]').innerText = '📷 Escanear Carteirinha';

    // O QR Code contém o Nome
    const nome = decodedText.trim();
    inputCesta.value = nome;
    buscarEPreencherCesta(nome);
}


// ==========================================================
// 🔥 GERAR CARTEIRINHA (QR CODE + PDF)
// ==========================================================

async function gerarCarteirinha() {
    const nome = document.getElementById('cesta-search').value.trim();
    if (!nome) { alert("Busque um morador antes de gerar a carteirinha."); return; }

    // Limpa QRCode anterior se existir
    const qrContainer = document.getElementById('card-qrcode');
    qrContainer.innerHTML = '';

    // Preenche o nome
    document.getElementById('card-nome').innerText = nome;

    // Gera QR Code com o nome da pessoa
    // O QR Code terá o nome, que será lido pelo scanner
    try {
        cestaState.qrCodeInstance = new QRCode(qrContainer, {
            text: nome,
            width: 80,
            height: 80,
            colorDark: "#4a7c2e",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
    } catch (e) {
        alert("Erro ao gerar QR Code");
        return;
    }

    // Aguarda geração do QR
    setTimeout(async () => {
        try {
            // Captura a carteirinha com html2canvas
            const cardDiv = document.getElementById('carteirinha-print-area');
            const canvas = await html2canvas(cardDiv, { scale: 3 });

            // Gera um PDF com jsPDF
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a6'); // A6 é o tamanho ideal para carteirinha
            const imgData = canvas.toDataURL('image/jpeg');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();
            
            pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
            const pdfBlob = pdf.output('blob');
            
            // Abre para impressão ou download
            window.open(URL.createObjectURL(pdfBlob), '_blank');

        } catch (error) {
            console.error(error);
            alert("Erro ao gerar a imagem da carteirinha.");
        }
    }, 300);
}


// ==========================================================
// CURRÍCULO E OUTRAS FUNÇÕES
// ==========================================================
function handlePhotoUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const targetWidth = 300;
                const targetHeight = 400;
                canvas.width = targetWidth;
                canvas.height = targetHeight;
                const ctx = canvas.getContext('2d');
                const aspectRatio = targetWidth / targetHeight;
                let srcWidth = img.width;
                let srcHeight = img.height;
                let srcX = 0, srcY = 0;
                const imgRatio = srcWidth / srcHeight;
                if (imgRatio > aspectRatio) {
                    srcWidth = srcHeight * aspectRatio;
                    srcX = (img.width - srcWidth) / 2;
                } else {
                    srcHeight = srcWidth / aspectRatio;
                    srcY = (img.height - srcHeight) / 2;
                }
                ctx.drawImage(img, srcX, srcY, srcWidth, srcHeight, 0, 0, targetWidth, targetHeight);
                state.fotoBase64 = canvas.toDataURL('image/jpeg');
                const preview = document.getElementById('cv-photo-preview');
                preview.src = state.fotoBase64;
                preview.style.display = 'block';
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

async function buscarCEP() {
    let cep = document.getElementById('cv-cep').value.replace(/\D/g, '');
    if (cep.length === 8) {
        try {
            const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
            const data = await response.json();
            if (!data.erro) {
                document.getElementById('cv-logradouro').value = data.logradouro;
                document.getElementById('cv-bairro').value = data.bairro;
                document.getElementById('cv-cidade').value = `${data.localidade} - ${data.uf}`;
            } else {
                alert("CEP não encontrado.");
            }
        } catch (error) {
            console.error("Erro ao buscar CEP", error);
        }
    }
}

function adicionarTelefone() {
    if (state.telefoneCount < 3) {
        state.telefoneCount++;
        document.getElementById(`cv-tel-container-${state.telefoneCount}`).style.display = 'block';
        if (state.telefoneCount === 3) {
            document.getElementById('btn-add-tel').style.display = 'none';
        }
    }
}

function adicionarCurso() {
    if (state.cursoCount >= 3) {
        alert("Você já atingiu o limite máximo de 3 cursos para caber em 1 única folha A4.");
        return;
    }
    const container = document.getElementById('cursos-container');
    const id = `curso-${Date.now()}`;
    const html = `
        <div class="dynamic-item" id="${id}">
            <button class="remove-btn" onclick="removerItem('${id}')">×</button>
            <div class="grid-cv">
                <div><label style="font-size:12px;">Curso</label><input type="text" class="input-curso" placeholder="Ex: Administração"></div>
                <div><label style="font-size:12px;">Instituição</label><input type="text" class="input-inst" placeholder="Ex: UNESP"></div>
            </div>
            <div class="grid-cv full">
                <label style="font-size:12px;">Período</label>
                <input type="text" class="input-periodo" placeholder="Ex: 2018 - 2022">
            </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
    state.cursoCount++;
}

function adicionarExperiencia() {
    if (state.expCount >= 6) {
        alert("Você já atingiu o limite máximo de 6 experiências para caber em 1 única folha A4.");
        return;
    }
    const container = document.getElementById('exp-container');
    const id = `exp-${Date.now()}`;
    const html = `
        <div class="dynamic-item" id="${id}">
            <button class="remove-btn" onclick="removerItem('${id}')">×</button>
            <div class="grid-cv">
                <div><label style="font-size:12px;">Empresa</label><input type="text" class="input-empresa" placeholder="Ex: Tech Solutions"></div>
                <div><label style="font-size:12px;">Função</label><input type="text" class="input-funcao" placeholder="Ex: Assistente Administrativo"></div>
            </div>
            <div class="grid-cv full">
                <label style="font-size:12px;">Período</label>
                <input type="text" class="input-periodo-exp" placeholder="Ex: Jan/2020 - Dez/2022">
            </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
    state.expCount++;
}

function removerItem(id) {
    const el = document.getElementById(id);
    if (el) {
        if (id.startsWith('curso-')) state.cursoCount--;
        if (id.startsWith('exp-')) state.expCount--;
        el.remove();
    }
}

async function gerarCurriculo() {
    const nome = document.getElementById('cv-nome').value;
    if (!nome) { 
        alert("Por favor, preencha pelo menos o Nome Completo."); 
        return; 
    }

    const templateSelecionado = document.getElementById('cv-template').value;
    const tel1 = document.getElementById('cv-tel-1').value;
    const tel2 = document.getElementById('cv-tel-2').value;
    const tel3 = document.getElementById('cv-tel-3').value;
    const email = document.getElementById('cv-email').value;
    const logradouro = document.getElementById('cv-logradouro').value;
    const numero = document.getElementById('cv-numero').value;
    const bairro = document.getElementById('cv-bairro').value;
    const cidade = document.getElementById('cv-cidade').value;
    const objetivo = document.getElementById('cv-objetivo').value;
    const habilidades = document.getElementById('cv-habilidades').value;

    let endereco = `${logradouro}, ${numero}`;
    if (bairro) endereco += ` - ${bairro}`;
    if (cidade) endereco += ` - ${cidade}`;

    let tels = [tel1, tel2, tel3].filter(t => t.trim() !== '');

    const cursosNodes = document.querySelectorAll('#cursos-container .dynamic-item');
    const cursos = [];
    cursosNodes.forEach(node => {
        const curso = node.querySelector('.input-curso').value || 'Curso não informado';
        const inst = node.querySelector('.input-inst').value || 'Instituição não informada';
        const periodo = node.querySelector('.input-periodo').value || 'Período não informado';
        cursos.push({ curso, inst, periodo });
    });

    const expNodes = document.querySelectorAll('#exp-container .dynamic-item');
    const experiencias = [];
    expNodes.forEach(node => {
        const empresa = node.querySelector('.input-empresa').value || 'Empresa não informada';
        const funcao = node.querySelector('.input-funcao').value || 'Função não informada';
        const periodo = node.querySelector('.input-periodo-exp').value || 'Período não informado';
        experiencias.push({ empresa, funcao, periodo });
    });

    document.getElementById('pdf-nome').innerText = nome;
    document.getElementById('pdf-tel').innerText = tels.length > 0 ? tels.join(' / ') : '(Não informado)';
    document.getElementById('pdf-email').innerText = email || '(Não informado)';
    document.getElementById('pdf-endereco').innerText = endereco || '(Não informado)';
    document.getElementById('pdf-objetivo').innerText = objetivo || 'Não informado.';

    const pdfPhoto = document.getElementById('pdf-photo');
    if (state.fotoBase64) {
        pdfPhoto.src = state.fotoBase64;
        pdfPhoto.style.display = 'block';
    } else {
        pdfPhoto.style.display = 'none';
    }

    const pdfSkills = document.getElementById('pdf-habilidades');
    pdfSkills.innerHTML = '';
    if (habilidades.trim() !== '') {
        const skillList = habilidades.split(',').map(s => s.trim()).filter(s => s !== '');
        skillList.forEach(skill => {
            const li = document.createElement('li');
            li.innerText = skill;
            pdfSkills.appendChild(li);
        });
    } else {
        pdfSkills.innerHTML = '<li>Não informado.</li>';
    }

    const pdfCursos = document.getElementById('pdf-cursos');
    pdfCursos.innerHTML = '';
    if (cursos.length === 0) {
        pdfCursos.innerHTML = '<p style="font-size:12px; color:#888;">Nenhum curso informado.</p>';
    } else {
        cursos.forEach(c => {
            const div = document.createElement('div');
            div.className = 'pdf-entry';
            div.innerHTML = `
                <div class="pdf-entry-title">${c.curso}</div>
                <div class="pdf-entry-sub">${c.inst}</div>
                <div class="pdf-entry-period">${c.periodo}</div>
            `;
            pdfCursos.appendChild(div);
        });
    }

    const pdfExp = document.getElementById('pdf-experiencias');
    pdfExp.innerHTML = '';
    if (experiencias.length === 0) {
        pdfExp.innerHTML = '<p style="font-size:12px; color:#888;">Nenhuma experiência informada.</p>';
    } else {
        experiencias.forEach(e => {
            const div = document.createElement('div');
            div.className = 'pdf-entry';
            div.innerHTML = `
                <div class="pdf-entry-title">${e.empresa}</div>
                <div class="pdf-entry-sub">${e.funcao}</div>
                <div class="pdf-entry-period">${e.periodo}</div>
            `;
            pdfExp.appendChild(div);
        });
    }

    const pdfLayout = document.getElementById('cv-pdf-layout');
    pdfLayout.className = `template-${templateSelecionado}`;
    pdfLayout.style.display = 'block';

    try {
        const canvas = await html2canvas(pdfLayout, { scale: 2, useCORS: true, logging: false });
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imgProps = pdf.getImageProperties(imgData);
        const imgW = imgProps.width;
        const imgH = imgProps.height;
        const scaleX = pdfWidth / imgW;
        const scaleY = pdfHeight / imgH;
        let finalScale = Math.min(scaleX, scaleY);
        pdf.addImage(imgData, 'JPEG', 0, 0, imgW * finalScale, imgH * finalScale);

        const pdfBlob = pdf.output('blob');
        window.open(URL.createObjectURL(pdfBlob), '_blank');

        pdfLayout.style.display = 'none';
        fecharModal('modal-curriculo');

    } catch (error) {
        console.error("Erro ao gerar PDF:", error);
        alert("Ocorreu um erro ao gerar o currículo.");
        pdfLayout.style.display = 'none';
    }
}

function toggleComprovanteMenu() {
    const menu = document.getElementById('menu-comprovante');
    if (menu.style.display === 'none') {
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
}

document.addEventListener('click', function(e) {
    const menu = document.getElementById('menu-comprovante');
    const btn = document.getElementById('btn-comprovante');
    if (menu && btn && !menu.contains(e.target) && e.target !== btn) {
        menu.style.display = 'none';
    }
});

function removerAcentos(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function formatarCEPPrint(i){ i.value = i.value.replace(/\D/g,'').replace(/(\d{5})(\d)/,'$1-$2'); }
function formatarCPFPrint(i){ i.value = i.value.replace(/\D/g,'').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2'); }
function formatarRGPrint(i){ i.value = i.value.replace(/\D/g,'').replace(/(\d{1,2})(\d{3})(\d{3})(\d{1})$/,'$1.$2.$3-$4'); }

function autoBuscarCEP(el) {
    const cep = el.value.replace(/\D/g, '');
    if (cep.length === 8) { buscarCEPPrint(); }
}

function autoBuscarCPF(el) {
    const cpf = el.value.replace(/\D/g, '');
    if (cpf.length === 11) {
        if (state.lastSearchedCPF !== cpf) {
            state.lastSearchedCPF = cpf;
            buscarCPFPrint();
        }
    } else {
        state.lastSearchedCPF = '';
    }
}

async function abrirComprovantePrint(tipo) {
    state.tipoComprovanteAtual = tipo;
    document.getElementById('menu-comprovante').style.display = 'none';

    const bgImage = tipo === 'assinatura' ? "https://i.imgur.com/lFhk0Hq.png" : "https://i.imgur.com/l47wlMJ.png";
    document.getElementById('comprovante-bg').style.backgroundImage = `url('${bgImage}')`;

    document.getElementById('modal-comprovante-print').style.display = 'flex';
    
    document.getElementById('print-nome').value = '';
    document.getElementById('print-endereco').value = '';
    document.getElementById('print-numero_endereco').value = '';
    document.getElementById('print-complemento').value = '';
    document.getElementById('print-cep').value = '';
    document.getElementById('print-bairro').value = '';
    document.getElementById('print-uf').value = '';
    document.getElementById('print-nacionalidade').value = '';
    document.getElementById('print-estado_civil').value = '';
    document.getElementById('print-cpf').value = '';
    document.getElementById('print-rg').value = '';
    document.getElementById('print-emissor').value = 'DETRAN/RJ';
    document.getElementById('print-propria').checked = false;
    document.getElementById('print-alugada').checked = false;
    document.getElementById('print-emprestada').checked = false;
    
    const m = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
    const h = new Date();
    document.getElementById("print-data").value = `${String(h.getDate()).padStart(2,'0')} DE ${m[h.getMonth()]}`;
    document.getElementById("print-ano").value = h.getFullYear();
    
    try {
        if (URL_API_GS.includes('COLE_AQUI')) throw new Error("A URL do Apps Script não foi configurada!");
        const dados = await fetchFromGS('getNumero');
        document.getElementById('print-numero').value = dados.numero || '0000001';
    } catch (e) {
        console.error(e);
        alert("Erro ao buscar o número da declaração.");
        document.getElementById('print-numero').value = '0000001';
    }
}

async function buscarCEPPrint() {
    const cep = document.getElementById('print-cep').value.replace(/\D/g,'');
    if (cep.length !== 8) { alert("CEP inválido"); return; }
    try {
        const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const dados = await resp.json();
        if (dados.erro) { alert("CEP não encontrado na API dos Correios"); return; }
        document.getElementById('print-endereco').value = (dados.logradouro || '').toUpperCase();
        document.getElementById('print-bairro').value = (dados.bairro || '').toUpperCase();
        document.getElementById('print-uf').value = (dados.uf || '').toUpperCase();
    } catch (e) { console.error(e); alert("Erro de conexão ao buscar o CEP."); }
}

async function buscarCPFPrint() {
    const cpf = document.getElementById('print-cpf').value.replace(/\D/g,'');
    if (cpf.length !== 11) { alert("CPF inválido"); return; }
    try {
        if (URL_API_GS.includes('COLE_AQUI')) throw new Error("A URL do Apps Script não foi configurada!");
        const r = await fetchFromGS('buscarCPF', { cpf: cpf });
        if (r.erro) { alert("ERRO DO APPS SCRIPT: " + r.erro); return; }
        if (!r.encontrado) { alert("CPF NÃO LOCALIZADO na planilha."); return; }
        const d = r.dados;
        document.getElementById('print-nome').value = d.nome || '';
        document.getElementById('print-endereco').value = d.endereco || '';
        document.getElementById('print-numero_endereco').value = d.numero_endereco || '';
        document.getElementById('print-complemento').value = d.complemento || '';
        document.getElementById('print-cep').value = d.cep || '';
        document.getElementById('print-bairro').value = d.bairro || '';
        document.getElementById('print-uf').value = d.uf || '';
        document.getElementById('print-nacionalidade').value = d.nacionalidade || '';
        document.getElementById('print-estado_civil').value = d.estado_civil || '';
        document.getElementById('print-cpf').value = d.cpf || '';
        document.getElementById('print-rg').value = d.rg || '';
        document.getElementById('print-emissor').value = d.emissor || '';
        document.getElementById('print-propria').checked = d.propria || false;
        document.getElementById('print-alugada').checked = d.alugada || false;
        document.getElementById('print-emprestada').checked = d.emprestada || false;
    } catch (e) { console.error(e); alert("Erro de comunicação: " + e.message); }
}

function detectarGeneroENacionalidadeComprovante() {
    const nomeInput = document.getElementById('print-nome');
    const nome = nomeInput.value.trim().toUpperCase();
    if (nome.length < 2) return;
    const primeiroNome = nome.split(' ')[0].toLowerCase();
    let genero = 'MASCULINO';
    const excecoesMasculinas = ['joaquim', 'luca', 'noa', 'nicola'];
    if (excecoesMasculinas.includes(primeiroNome)) genero = 'MASCULINO'; 
    else if (['mar', 'luz', 'flor', 'marjorie', 'alice', 'constance'].includes(primeiroNome)) genero = 'FEMININO';
    else if (primeiroNome.endsWith('a') || primeiroNome.endsWith('e') || primeiroNome.endsWith('i') || primeiroNome.endsWith('ad') || primeiroNome.endsWith('ra') || primeiroNome.endsWith('na') || primeiroNome.endsWith('la') || primeiroNome.endsWith('da') || primeiroNome.endsWith('ia')) {
        genero = 'FEMININO';
    } else { genero = 'MASCULINO'; }
    if (genero === 'FEMININO') {
        document.getElementById('print-nacionalidade').value = 'BRASILEIRA';
        document.getElementById('print-estado_civil').value = 'SOLTEIRA';
    } else {
        document.getElementById('print-nacionalidade').value = 'BRASILEIRO';
        document.getElementById('print-estado_civil').value = 'SOLTEIRO';
    }
}

let debounceTimerEndereco;
let enderecoCache = {};
let searchController = null;

function buscarSugestoesEndereco() {
    const input = document.getElementById('print-endereco');
    const container = document.getElementById('address-suggestions');
    const queryOriginal = input.value.trim().toUpperCase();
    const mapaAcentos = {
        'A': '[AÁÀÂÃÄ]', 'E': '[EÉÈÊË]', 'I': '[IÍÌÎÏ]', 'O': '[OÓÒÔÕÖ]', 'U': '[UÚÙÛÜ]', 
        'C': '[CÇ]', 'N': '[NÑ]'
    };
    let queryComAcentos = queryOriginal;
    for (let [letraSem, letraCom] of Object.entries(mapaAcentos)) {
        queryComAcentos = queryComAcentos.replace(new RegExp(letraSem, 'g'), letraCom);
    }
    if (searchController) { searchController.abort(); searchController = null; }
    clearTimeout(debounceTimerEndereco);
    if (queryOriginal.length < 2) { container.style.display = 'none'; return; }
    if (enderecoCache[queryOriginal]) { exibirSugestoes(container, enderecoCache[queryOriginal]); return; }
    debounceTimerEndereco = setTimeout(async () => {
        try {
            container.innerHTML = '<div class="suggestion-item" style="text-align:center;color:#888;cursor:default;">🔍 Buscando...</div>';
            container.style.display = 'block';
            searchController = new AbortController();
            const resultados = await fetchFromGS('buscarEnderecos', { q: queryComAcentos }, searchController.signal);
            const querySemAcento = removerAcentos(queryOriginal);
            const resultadosFiltrados = resultados.filter(item => {
                const enderecoSemAcento = removerAcentos(item.endereco.toUpperCase());
                return enderecoSemAcento.startsWith(querySemAcento) || enderecoSemAcento.includes(querySemAcento);
            });
            enderecoCache[queryOriginal] = resultadosFiltrados;
            exibirSugestoes(container, resultadosFiltrados);
        } catch (e) {
            if (e.name !== 'AbortError' && e.message !== 'Erro de rede na requisição JSONP') {
                console.warn("Erro ao buscar endereços:", e);
                container.style.display = 'none';
            }
        } finally { searchController = null; }
    }, 40);
}

function exibirSugestoes(container, resultados) {
    container.innerHTML = '';
    if (!resultados || resultados.length === 0) { container.style.display = 'none'; return; }
    resultados.forEach(item => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = `<strong>${item.endereco}</strong><small>${item.bairro || ''} - ${item.uf || ''} (CEP: ${item.cep || 'N/I'})</small>`;
        div.onclick = () => {
            document.getElementById('print-endereco').value = item.endereco || '';
            document.getElementById('print-bairro').value = item.bairro || '';
            document.getElementById('print-uf').value = item.uf || '';
            document.getElementById('print-cep').value = item.cep || '';
            container.style.display = 'none';
        };
        container.appendChild(div);
    });
    container.style.display = 'block';
}
document.addEventListener('click', function(e) {
    const container = document.getElementById('address-suggestions');
    const input = document.getElementById('print-endereco');
    if (container && input && !container.contains(e.target) && e.target !== input) {
        container.style.display = 'none';
    }
});

function obterValoresComprovante() {
    return {
        numero: document.getElementById('print-numero').value,
        data: document.getElementById('print-data').value,
        ano: document.getElementById('print-ano').value,
        nome: document.getElementById('print-nome').value.toUpperCase(),
        endereco: document.getElementById('print-endereco').value.toUpperCase(),
        numero_endereco: document.getElementById('print-numero_endereco').value.toUpperCase(),
        complemento: document.getElementById('print-complemento').value.toUpperCase(),
        cep: document.getElementById('print-cep').value,
        bairro: document.getElementById('print-bairro').value.toUpperCase(),
        uf: document.getElementById('print-uf').value.toUpperCase(),
        nacionalidade: document.getElementById('print-nacionalidade').value.toUpperCase(),
        estado_civil: document.getElementById('print-estado_civil').value.toUpperCase(),
        cpf: document.getElementById('print-cpf').value,
        rg: document.getElementById('print-rg').value,
        emissor: document.getElementById('print-emissor').value.toUpperCase(),
        propria: document.getElementById('print-propria').checked,
        alugada: document.getElementById('print-alugada').checked,
        emprestada: document.getElementById('print-emprestada').checked
    };
}

function gerarHTMLImpressaoCRM(v) {
    return `
    <!DOCTYPE html><html><head>
    <style>
      body{margin:0;padding:0;font-family:Arial,sans-serif;}
      .popup{position:relative;width:794px;height:1123px;background-color:white;overflow:hidden;margin:0 auto;}
      .popup-content{position:relative;width:100%;height:100%;}
      .popup-content img{width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;z-index:0;}
      .input-field{position:absolute;font-size:13px;padding:2px 4px;z-index:1;font-weight:bold;background:transparent;border:none;outline:none;color:black;text-transform:uppercase;}
      .input-field[type="checkbox"]{width:16px;height:16px;accent-color:black;}
      @media print{body{margin:0!important;padding:0!important;}}
    </style>
    </head><body>
    <div class="popup"><div class="popup-content">
      <img src="https://i.imgur.com/lFhk0Hq.png">
      <input class="input-field" style="top:386px;left:230px;width:80px" value="${v.numero}" readonly>
      <input class="input-field" style="top:386px;left:390px;width:130px" value="${v.data}" readonly>
      <input class="input-field" style="top:386px;left:580px;width:80px" value="${v.ano}" readonly>
      <input class="input-field" style="top:437px;left:167px;width:500px;font-size:18px" value="${v.nome}" readonly>
      <input class="input-field" style="top:508px;left:216px;width:350px" value="${v.endereco}" readonly>
      <input class="input-field" style="top:508px;left:629px;width:90px" value="${v.numero_endereco}" readonly>
      <input class="input-field" style="top:568px;left:240px;width:210px" value="${v.complemento}" readonly>
      <input class="input-field" style="top:568px;left:530px;width:150px" value="${v.cep}" readonly>
      <input class="input-field" style="top:633px;left:165px;width:350px" value="${v.bairro}" readonly>
      <input class="input-field" style="top:633px;left:630px;width:80px" value="${v.uf}" readonly>
      <input class="input-field" style="top:695px;left:247px;width:150px" value="${v.nacionalidade}" readonly>
      <input class="input-field" style="top:695px;left:555px;width:150px" value="${v.estado_civil}" readonly>
      <input class="input-field" style="top:758px;left:135px;width:188px" value="${v.cpf}" readonly>
      <input class="input-field" style="top:758px;left:395px;width:100px" value="${v.rg}" readonly>
      <input class="input-field" style="top:758px;left:625px;width:120px" value="${v.emissor}" readonly>
      <input type="checkbox" class="input-field" style="top:844px;left:249px" ${v.propria?'checked':''} readonly>
      <input type="checkbox" class="input-field" style="top:844px;left:425px" ${v.alugada?'checked':''} readonly>
      <input type="checkbox" class="input-field" style="top:844px;left:652px" ${v.emprestada?'checked':''} readonly>
    </div></div>
    </body></html>`;
}

async function salvarDadosComprovante() {
    const dados = [
        document.getElementById('print-numero').value,
        document.getElementById('print-data').value,
        document.getElementById('print-ano').value,
        document.getElementById('print-nome').value.toUpperCase(),
        document.getElementById('print-endereco').value.toUpperCase(),
        document.getElementById('print-numero_endereco').value.toUpperCase(),
        document.getElementById('print-complemento').value.toUpperCase(),
        document.getElementById('print-cep').value,
        document.getElementById('print-bairro').value.toUpperCase(),
        document.getElementById('print-uf').value.toUpperCase(),
        document.getElementById('print-nacionalidade').value.toUpperCase(),
        document.getElementById('print-estado_civil').value.toUpperCase(),
        document.getElementById('print-cpf').value,
        document.getElementById('print-rg').value,
        document.getElementById('print-emissor').value.toUpperCase(),
        document.getElementById('print-propria').checked ? "Casa Própria" : "",
        document.getElementById('print-alugada').checked ? "Alugada" : "",
        document.getElementById('print-emprestada').checked ? "Emprestada" : ""
    ];
    await postParaGoogleSheets('salvarDeclaracao', dados);
}

async function salvarApenas() {
    const btn = document.querySelector('#modal-comprovante-print .btn-save');
    btn.innerText = 'Salvando...'; btn.disabled = true;
    try {
        await salvarDadosComprovante();
        alert("Dados salvos com sucesso!");
        fecharComprovantePrint();
    } catch (e) { 
        alert("Erro ao salvar: " + e.message); 
    } 
    finally { btn.innerText = '💾 Salvar'; btn.disabled = false; }
}

async function salvarEImprimir() {
    const btn = document.querySelector('#modal-comprovante-print .btn-print');
    btn.innerText = 'Salvando...'; btn.disabled = true;
    try {
        await salvarDadosComprovante();
        const v = obterValoresComprovante();
        let htmlPrint = gerarHTMLImpressaoCRM(v);
        htmlPrint = htmlPrint.replace('</body>', `
            <script>
                window.addEventListener('load', function() {
                    setTimeout(function() { window.print(); }, 800);
                });
            <\/script>
        </body>`);

        const win = window.open('', '_blank');
        if (win) {
            win.document.write(htmlPrint);
            win.document.close();
            win.focus();
        } else {
            alert("Pop-up bloqueado! Por favor, permita pop-ups no seu navegador para imprimir o documento.");
        }
        fecharComprovantePrint();

    } catch (e) { 
        alert("Erro ao salvar e imprimir: " + e.message); 
    } 
    finally { btn.innerText = '🖨️ Imprimir'; btn.disabled = false; }
}

function fecharModal(id) { document.getElementById(id).classList.remove('active'); }
function fecharComprovantePrint() { document.getElementById('modal-comprovante-print').style.display = 'none'; }
