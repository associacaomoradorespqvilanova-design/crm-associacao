const URL_API_GS = "https://script.google.com/macros/s/AKfycbwDlcThiZxRzUP6ruvYUWCzkrof6WC9N_4HpmmcEVNA3VJqkvOE6kDBs57X5EVW8iSdDw/exec"; 

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
    setInterval(() => {
        if (document.getElementById('dashboard-screen').style.display !== 'none') {
            renderizarPendentesCestaHome();
        }
    }, 20000);
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
    renderizarPendentesCestaHome();
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
    if (select) {
        select.innerHTML = '<option value="">Selecione um responsável</option>';
        state.responsaveis.forEach(nome => {
            const nomeLimpo = String(nome).replace(/^"|"$/g, '').replace(/^'|'$/g, '');
            select.innerHTML += `<option value="${nomeLimpo}">${nomeLimpo}</option>`;
        });
    }

    const nomesOrdenados = state.responsaveis.map(n => n.replace(/^"|"$/g, '').replace(/^'|'$/g, ''));
    const thead = document.getElementById('cards-header');
    let headerHtml = '<tr>';
    headerHtml += `<th>DATA</th>`;
    if (nomesOrdenados.length > 0) {
        nomesOrdenados.forEach(nome => {
            headerHtml += `<th style="text-align:center;">${nome}</th>`;
        });
    } else {
        headerHtml += `<th style="text-align:center;">RESPONSÁVEIS</th>`;
    }
    headerHtml += `<th style="text-align:center;">TOTAL DIA</th>`;
    headerHtml += `<th>AÇÕES</th>`;
    headerHtml += '</tr>';
    thead.innerHTML = headerHtml;

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

async function enviarTodasEntregas() {
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
    
    await postParaGoogleSheets('salvarLoteCartoesEntrega', entregas);
    
    statusDiv.style.display = 'block';
    statusDiv.style.background = '#e8f5e9';
    statusDiv.style.color = '#2e7d32';
    statusDiv.style.border = '2px solid #a5d6a7';
    statusDiv.innerText = `✅ ${entregas.length} registro(s) salvos com sucesso!`;
    
    limparCamposNomeEndereco();
    const nomes = document.querySelectorAll('#mult-lista-entregas .nome-input');
    if (nomes.length > 0) nomes[0].focus();
    
    btnEnviar.innerText = 'Enviar Tudo';
    btnEnviar.disabled = false;
}


// ==========================================================
// 🔥 CESTA
// ==========================================================
function normalizeString(s) { if (!s && s !== 0) return ""; return s.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase().trim(); }
function headerToId(lbl) { if (!lbl && lbl !== 0) lbl = ""; return lbl.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_').toUpperCase(); }

const cestaState = {
    names: [],
    types: [],
    currentLine: null,
    currentDados: [],
    qrCodeInstance: null
};

async function abrirModalCesta() {
    document.getElementById('modal-cesta').classList.add('active');
    await carregarNomesCesta();
    await carregarTiposCesta();
    await renderizarPendentesCestaHome();

    const scannerInput = document.getElementById('cesta-scanner-input');
    setTimeout(() => { scannerInput.focus(); }, 300);
}

const abrirModalOriginal = abrirModal;
abrirModal = function(id) {
    if (id === 'modal-cesta') {
        abrirModalCesta();
        return;
    }
    abrirModalOriginal(id);
};

async function carregarNomesCesta() {
    const res = await fetchFromGS('buscarTodosNomesCesta');
    cestaState.names = res || [];
}

async function carregarTiposCesta() {
    const res = await fetchFromGS('listarTiposCesta');
    cestaState.types = res || [];
    document.getElementById('cesta-tipos-input').value = cestaState.types.join(', ');
}

function editarTiposCestaUI() {
    const editor = document.getElementById('cesta-tipos-editor');
    if (editor.style.display === 'none') {
        editor.style.display = 'block';
    } else {
        editor.style.display = 'none';
    }
}
function fecharEditorTipos() {
    document.getElementById('cesta-tipos-editor').style.display = 'none';
}

async function salvarTiposCesta() {
    const tiposStr = document.getElementById('cesta-tipos-input').value.trim();
    const tipos = tiposStr.split(',').map(t => t.trim().toUpperCase()).filter(t => t);
    await postParaGoogleSheets('salvarTiposCesta', { tipos: tipos });
    alert("✅ Tipos de cesta atualizados!");
    await carregarTiposCesta();
    fecharEditorTipos();
    renderizarPendentesCestaHome();
}

async function renderizarPendentesCestaHome() {
    try {
        const list = await fetchFromGS('listarPendentesMesAtual');
        const container = document.getElementById('cesta-pendentes-home');
        container.innerHTML = '';
        container.style.display = 'grid';
        container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
        container.style.gap = '8px';
        container.style.width = '100%';

        if (!list || list.length === 0) {
            container.innerHTML = '<div style="grid-column: 1 / -1; color:#4a7c2e; font-weight:600; padding:10px; text-align:center;">✅ Todos os cadastros do mês atual estão em dia!</div>';
            return;
        }

        list.forEach(item => {
            let nomeLimpo = item.nome || '';
            const card = document.createElement('div');
            card.className = 'pending-item-card';

            const content = document.createElement('div');
            content.className = 'card-content';
            content.onclick = () => { abrirModalCestaComNome(nomeLimpo); };
            content.innerHTML = `
                <span title="Clique para abrir">${nomeLimpo}</span>
                <span class="card-tag">${item.tipo || 'Sem tipo'}</span>
            `;

            const actions = document.createElement('div');
            actions.className = 'card-actions';
            actions.innerHTML = `
                <button class="btn-icon btn-edit" onclick="event.stopPropagation(); editarNomePendente('${nomeLimpo}', ${item.linha})" title="Editar nome">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn-icon btn-delete" onclick="event.stopPropagation(); deletarPendente(${item.linha}, '${nomeLimpo}')" title="Excluir cadastro">
                    <i class="fas fa-trash-alt"></i>
                </button>
            `;

            card.appendChild(content);
            card.appendChild(actions);
            container.appendChild(card);
        });
    } catch (e) {
        console.error(e);
        document.getElementById('cesta-pendentes-home').innerHTML = '<span style="color:#888;">Erro ao carregar pendentes.</span>';
    }
}

async function abrirModalCestaComNome(nome) {
    abrirModal('modal-cesta');
    setTimeout(() => {
        buscarEPreencherCesta(nome, false);
    }, 300);
}

async function editarNomePendente(nomeAntigo, linha) {
    const novoNome = prompt(`Digite o novo nome para "${nomeAntigo}":`, nomeAntigo);
    if (novoNome === null) return;
    if (novoNome.trim() === '') {
        alert("O nome não pode estar vazio.");
        return;
    }
    await postParaGoogleSheets('editarNomeMoradorCesta', { linha: linha, novoNome: novoNome.trim().toUpperCase() });
    alert("✅ Nome atualizado com sucesso!");
    await renderizarPendentesCestaHome();
    await carregarNomesCesta();
}

async function deletarPendente(linha, nome) {
    if (!confirm(`Tem certeza que deseja EXCLUIR permanentemente o cadastro de "${nome}"? Essa ação não pode ser desfeita.`)) return;
    await postParaGoogleSheets('deletarMoradorCesta', { linha: linha });
    alert("✅ Cadastro excluído com sucesso!");
    await renderizarPendentesCestaHome();
    await carregarNomesCesta();
}

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

async function buscarEPreencherCesta(nome, isQRCode = false) {
    try {
        const resp = await fetchFromGS('buscarMoradorCesta', { nome: nome });
        if(!resp || !resp.dados) { 
            if(isQRCode) alert("❌ Morador não encontrado na planilha.");
            else alert("❌ Morador não encontrado."); 
            return; 
        }
        cestaState.currentLine = resp.linha;
        cestaState.currentDados = resp.dados;
        renderFormCesta(resp.dados);

        if (isQRCode) {
            const confirmar = confirm(`Deseja marcar a cesta como ENTREGUE para ${nome} (com a data de hoje)?`);
            if (confirmar) {
                const monthLabels = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
                const todayIndex = new Date().getMonth();
                const today = new Date();
                const dia = String(today.getDate()).padStart(2,'0');
                const mes = String(today.getMonth() + 1).padStart(2,'0');
                const monthId = headerToId(monthLabels[todayIndex]);
                const monthField = document.getElementById(monthId);
                if (monthField) {
                    monthField.value = `${dia}/${mes}`;
                    atualizarMesesUICesta();
                    await salvarCestaAutomatico();
                    alert("✅ Cesta entregue com sucesso!");
                } else {
                    alert("Erro ao encontrar o mês atual para marcar.");
                }
            }
        }
    } catch (e) {
        console.error(e);
        if(isQRCode) alert("Erro ao buscar os dados via QR Code.");
        else alert("Erro ao buscar os dados.");
    }
}

function renderFormCesta(dadosArray) {
    document.getElementById('cesta-formArea').style.display='block';
    document.getElementById('cesta-panelPendentes').style.display='none';
    const fields = document.getElementById('cesta-fields'); fields.innerHTML='';
    const monthsContainer = document.getElementById('cesta-monthsContainer'); monthsContainer.innerHTML='';

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
                const confirmar = confirm(`Marcar mês ${label} como entregue hoje (${diaStr}/${mesStr})?`);
                if (confirmar) {
                    inputMonth.value = `${diaStr}/${mesStr}`;
                    atualizarMesesUICesta();
                    salvarCestaAutomatico(); 
                }
            });

            const lab = document.createElement('label'); lab.textContent = `${label}`;
            div.appendChild(lab); div.appendChild(inputMonth);
            monthsContainer.appendChild(div);
        } else {
            const wrapper = document.createElement('div');
            if (label.trim().toUpperCase() === 'TIPO') {
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

    await postParaGoogleSheets('salvarMoradorCesta', { linha: cestaState.currentLine, payload: payload });
    renderizarPendentesCestaHome();
}

document.getElementById('cesta-btnSave').addEventListener('click', async ()=>{
    if(!cestaState.currentLine) return alert("Nenhum morador selecionado.");
    const inputs = document.querySelectorAll('#cesta-fields .field, #cesta-monthsContainer input');
    const payload = {};
    inputs.forEach(inp => { payload[inp.id] = inp.value; });

    await postParaGoogleSheets('salvarMoradorCesta', { linha: cestaState.currentLine, payload: payload });
    alert("✅ Dados salvos com sucesso!");
    atualizarMesesUICesta();
    renderizarPendentesCestaHome();
});


// ==========================================================
// 🔥 SCANNER DA CESTA (CÂMERA)
// ==========================================================
let cameraHtml5QrCesta = null;

async function abrirCameraCesta() {
    const container = document.getElementById('cesta-camera-container');
    const btn = event.target;
    
    if (container.style.display === 'block') {
        if (cameraHtml5QrCesta) {
            try {
                await cameraHtml5QrCesta.stop();
                await cameraHtml5QrCesta.clear();
            } catch (e) {}
            cameraHtml5QrCesta = null;
        }
        container.style.display = 'none';
        container.innerHTML = '';
        btn.innerText = '📷 Escanear Carteirinha';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = '';
    btn.innerText = '⏹ Fechar';

    cameraHtml5QrCesta = new Html5Qrcode("cesta-camera-container");

    try {
        await cameraHtml5QrCesta.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 200, height: 200 } },
            onScanSuccessCesta
        );
    } catch (err) {
        alert("Erro ao abrir câmera. Verifique as permissões.");
        container.style.display = 'none';
        container.innerHTML = '';
        btn.innerText = '📷 Escanear Carteirinha';
        cameraHtml5QrCesta = null;
    }
}

function onScanSuccessCesta(decodedText) {
    const container = document.getElementById('cesta-camera-container');
    const btn = document.getElementById('btn-abrir-camera');

    if (cameraHtml5QrCesta) {
        try {
            cameraHtml5QrCesta.stop().catch(()=>{});
            cameraHtml5QrCesta.clear().catch(()=>{});
        } catch (e) {}
        cameraHtml5QrCesta = null;
    }
    
    if (container) {
        container.style.display = 'none';
        container.innerHTML = '';
    }
    if (btn) {
        btn.innerText = '📷 Escanear Carteirinha';
    }

    const nome = decodedText.trim();
    if (!nome) return;
    
    const inputCesta = document.getElementById('cesta-search');
    if (inputCesta) inputCesta.value = nome;

    buscarEPreencherCesta(nome, true);
}


// ==========================================================
// 🔥 GERAR CARTEIRINHA
// ==========================================================
async function gerarCarteirinha() {
    const nome = document.getElementById('cesta-search').value.trim();
    if (!nome) { alert("Busque um morador antes de gerar a carteirinha."); return; }

    const qrContainer = document.getElementById('card-qrcode');
    qrContainer.innerHTML = '';
    document.getElementById('card-nome').innerText = nome;

    try {
        cestaState.qrCodeInstance = new QRCode(qrContainer, {
            text: nome,
            width: 75,
            height: 75,
            colorDark: "#4a7c2e",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
    } catch (e) {
        alert("Erro ao gerar QR Code");
        return;
    }

    setTimeout(async () => {
        try {
            const cardDiv = document.getElementById('carteirinha-print-area');
            const canvas = await html2canvas(cardDiv, { scale: 2 });

            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('l', 'mm', 'a6'); 
            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            const pdfWidth = 148; 
            const pdfHeight = 105; 
            pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
            const pdfBlob = pdf.output('blob');
            window.open(URL.createObjectURL(pdfBlob), '_blank');

        } catch (error) {
            console.error(error);
            alert("Erro ao gerar a imagem da carteirinha.");
        }
    }, 300);
}


// ==========================================================
// 🔥 NOVO MÓDULO DE BUSCA INTELIGENTE
// ==========================================================

async function abrirModalBusca() {
    document.getElementById('modal-busca').classList.add('active');
    document.getElementById('busca-resultados').innerHTML = '<div style="text-align:center; padding:20px; color:#888;">Digite algo para iniciar a busca inteligente.</div>';
    document.getElementById('busca-editor-area').style.display = 'none';
    document.getElementById('busca-resumo-count').innerHTML = '';
    
    // Carrega as ruas para o dropdown
    try {
        const ruas = await fetchFromGS('obterRuasDistintas');
        const select = document.getElementById('busca-select-rua');
        select.innerHTML = '<option value="">🏘️ Todas as ruas</option>';
        ruas.forEach(rua => {
            const opt = document.createElement('option');
            opt.value = rua;
            opt.textContent = rua;
            select.appendChild(opt);
        });
        atualizarContadorBusca(); // Inicializa o contador
    } catch (e) {
        console.error("Erro ao carregar ruas:", e);
    }
}

async function atualizarContadorBusca() {
    try {
        const total = await fetchFromGS('contarCartoesPendentes');
        document.getElementById('busca-contador').textContent = `📦 ${total} pendentes`;
    } catch (e) {
        document.getElementById('busca-contador').textContent = '⏳ ...';
    }
}

// Sobrescreve a função abrirModal
const abrirModalOriginalGlobal = abrirModal;
abrirModal = function(id) {
    if (id === 'modal-busca') {
        abrirModalBusca();
        return;
    }
    abrirModalOriginalGlobal(id);
};

async function executarBuscaInteligente() {
    const termo = document.getElementById('busca-input').value.trim();
    if (!termo) {
        document.getElementById('busca-resultados').innerHTML = '<div style="text-align:center; padding:20px; color:#888;">Digite um nome, rua ou número para buscar.</div>';
        document.getElementById('busca-resumo-count').innerHTML = '';
        return;
    }

    document.getElementById('busca-resultados').innerHTML = '<div style="text-align:center; padding:20px;">⏳ Buscando...</div>';
    document.getElementById('busca-editor-area').style.display = 'none';

    try {
        const resultados = await fetchFromGS('pesquisarCartoesInteligente', { termo: termo });
        processarResultadosBusca(resultados);
    } catch (e) {
        console.error("Erro na busca:", e);
        document.getElementById('busca-resultados').innerHTML = '<div style="text-align:center; padding:20px; color:#d9534f;">❌ Erro ao buscar. Verifique sua internet.</div>';
    }
}

function processarResultadosBusca(resultados) {
    const container = document.getElementById('busca-resultados');
    const resumo = document.getElementById('busca-resumo-count');
    const editorArea = document.getElementById('busca-editor-area');
    editorArea.style.display = 'none';

    if (!resultados || resultados.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">Nenhum cartão encontrado.</div>';
        resumo.innerHTML = '';
        return;
    }

    resumo.innerHTML = `<strong>${resultados.length}</strong> cartão(ões) encontrado(s). Clique em um para gerenciar.`;
    
    let html = '';
    resultados.forEach((item, index) => {
        let statusClass = item.status === 'ENTREGUE' ? 'entregue' : (item.status === 'BLOQUEADO' ? 'bloqueado' : '');
        html += `
            <div class="result-card" onclick="abrirEditorBusca(${index})">
                <div class="info">
                    <span class="numero">${item.numero || '-'}</span>
                    <span class="nome">${item.nome}</span>
                    <div class="detalhes">
                        <span>📅 ${item.data || '—'}</span>
                        <span>📍 ${item.endereco || '—'}</span>
                    </div>
                </div>
                <span class="badge-status ${statusClass}">${item.status || 'PENDENTE'}</span>
            </div>`;
    });
    container.innerHTML = html;
    
    // Guarda os resultados para uso nos botões
    container.dataset.resultados = JSON.stringify(resultados);
}

async function abrirEditorBusca(index) {
    const container = document.getElementById('busca-resultados');
    const resultados = JSON.parse(container.dataset.resultados || '[]');
    const item = resultados[index];
    if (!item) return;

    const editorArea = document.getElementById('busca-editor-area');
    editorArea.style.display = 'block';
    
    const qtdMesmoEndereco = resultados.filter(it => it.endereco === item.endereco).length;

    editorArea.innerHTML = `
        <h4 style="margin:0 0 10px 0; color:#1b5e20;">✏️ Gerenciar Cartão Nº ${item.numero || '-'}</h4>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
            <div><label style="font-size:12px; font-weight:600;">Nome</label><input id="edit-busca-nome" value="${item.nome || ''}" style="width:100%; padding:6px; border:1px solid #ddd; border-radius:4px;"></div>
            <div><label style="font-size:12px; font-weight:600;">📅 Data</label><input id="edit-busca-data" value="${item.data || ''}" style="width:100%; padding:6px; border:1px solid #ddd; border-radius:4px;"></div>
            <div style="grid-column: span 2;"><label style="font-size:12px; font-weight:600;">🔢 Número</label><input id="edit-busca-num" value="${item.numero || ''}" style="width:100%; padding:6px; border:1px solid #ffd700; border-radius:4px; font-size:20px; font-weight:900; text-align:center;"></div>
            <div style="grid-column: span 2;">
                <label style="font-size:12px; font-weight:600;">📍 Endereço</label>
                <input id="edit-busca-end" value="${item.endereco || ''}" style="width:100%; padding:6px; border:1px solid #ddd; border-radius:4px;">
                ${qtdMesmoEndereco > 1 ? `<div style="margin-top:5px; font-size:12px; color:#e65100; background:#fff3e0; padding:4px 8px; border-radius:4px;">⚠️ ${qtdMesmoEndereco} cartões com este mesmo endereço.</div>` : ''}
            </div>
            <div><label style="font-size:12px; font-weight:600;">CPF</label><input id="edit-busca-cpf" value="${item.cpf || ''}" style="width:100%; padding:6px; border:1px solid #ddd; border-radius:4px;"></div>
            <div><label style="font-size:12px; font-weight:600;">📞 Telefone</label><input id="edit-busca-tel" value="${item.telefone || ''}" style="width:100%; padding:6px; border:1px solid #ddd; border-radius:4px;"></div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-primary" onclick="salvarEdicaoBusca(${item.linha})" style="border:none; border-radius:6px; padding:8px 16px; font-weight:600; cursor:pointer;">💾 Salvar</button>
            <button class="btn-primary" onclick="confirmarEntregaBusca(${item.linha})" style="background:#2196F3; border:none; border-radius:6px; padding:8px 16px; font-weight:600; cursor:pointer;">✅ ENTREGAR</button>
            <button class="btn-cancel" onclick="document.getElementById('busca-editor-area').style.display='none';" style="border:none; border-radius:6px; padding:8px 16px; font-weight:600; cursor:pointer;">Cancelar</button>
        </div>
    `;
}

async function salvarEdicaoBusca(linha) {
    const container = document.getElementById('busca-resultados');
    const resultados = JSON.parse(container.dataset.resultados || '[]');
    const item = resultados.find(it => it.linha === linha);
    
    const dados = {
        nome: document.getElementById('edit-busca-nome').
