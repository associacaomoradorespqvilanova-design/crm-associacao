// ============================================================
// CONFIGURAÇÃO DA API
// ============================================================
const URL_API_GS = "https://script.google.com/macros/s/AKfycbwb7u0uQIAg_8vev9OjTN6y6zkIj7og1CVBRAY7kccG9HNZOyyXBsQQ-kndbd5qgan5tQ/exec";

// ============================================================
// GET VIA JSONP
// ============================================================
function fetchFromGS(acao, params = {}, signal) {
    return new Promise((resolve, reject) => {
        const callbackName = 'cb' + Date.now() + Math.random().toString(36).substr(2, 8);
        const urlParams = new URLSearchParams({ acao, callback: callbackName, ...params });
        const script = document.createElement('script');
        script.src = URL_API_GS + '?' + urlParams.toString();
        const timeout = setTimeout(() => { if(document.body.contains(script)) document.body.removeChild(script); reject(new Error('Timeout')); delete window[callbackName]; }, 30000);
        window[callbackName] = (res) => { clearTimeout(timeout); if(document.body.contains(script)) document.body.removeChild(script); resolve(res); delete window[callbackName]; };
        script.onerror = () => { clearTimeout(timeout); if(document.body.contains(script)) document.body.removeChild(script); reject(new Error('Erro de rede')); delete window[callbackName]; };
        document.body.appendChild(script);
        if(signal) signal.addEventListener('abort', () => { if(document.body.contains(script)) document.body.removeChild(script); clearTimeout(timeout); delete window[callbackName]; reject(new DOMException('Abortado')); }, { once: true });
    });
}

// ============================================================
// POST PARA GOOGLE SHEETS
// ============================================================
async function postParaGoogleSheets(acao, dados = {}) {
    const formData = new URLSearchParams();
    formData.append('acao', acao);
    formData.append('dados', JSON.stringify(dados));
    await fetch(URL_API_GS, { method: 'POST', body: formData, mode: 'no-cors' });
    // Qualquer gravação pode alterar os resultados; evita mostrar dados antigos.
    if (typeof buscaCacheMemoria !== 'undefined' && buscaCacheMemoria) buscaCacheMemoria.clear();
    if (typeof buscaUltimaConsulta !== 'undefined') buscaUltimaConsulta = null;
}

// ============================================================
// UTILITÁRIO DE DATA - PADRÃO BRASILEIRO (dd/mm/yyyy)
// ============================================================
function formatarDataBR(valor) {
    if (!valor) return "";
    let data = new Date(valor);
    if (isNaN(data.getTime())) {
        const partes = String(valor).split('/');
        if (partes.length === 3) data = new Date(partes[2], partes[1] - 1, partes[0]);
    }
    if (!isNaN(data.getTime())) {
        const dia = String(data.getDate()).padStart(2, '0');
        const mes = String(data.getMonth() + 1).padStart(2, '0');
        const ano = data.getFullYear();
        return `${dia}/${mes}/${ano}`;
    }
    return valor;
}

// ============================================================
// ESTADO GERAL
// ============================================================
const state = {
    dadosAgenda: [], dadosCartoes: [], responsaveis: [],
    telefoneCount: 1, cursoCount: 0, expCount: 0, fotoBase64: null,
    lastSearchedCPF: '', tipoComprovanteAtual: 'assinatura'
};

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('crm_user');
    if (savedUser === 'admin') loginSuccess();
    setInterval(() => {
        const dashboard = document.getElementById('dashboard-screen');
        if (dashboard && dashboard.style.display !== 'none') renderizarPendentesCestaHome();
    }, 45000);
    inicializarEventosBusca();
});

function login() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const errorBox = document.getElementById('login-error');
    errorBox.style.display = 'none';
    if (user === 'admin' && pass === '123') {
        localStorage.setItem('crm_user', 'admin');
        loginSuccess();
    } else errorBox.style.display = 'block';
}

function loginSuccess() {
    try {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('dashboard-screen').style.display = 'block';
        updateClock(); 
        carregarDashboard();
        
        // Atrasa o popup
        setTimeout(() => {
            try {
                verificarProximaAgendaPopup();
                setTimeout(() => {
                    try { fecharModal('modal-popup-login'); } catch(e) {}
                }, 8000);
            } catch (e) {
                console.error("Erro ao abrir o popup de agenda:", e);
            }
        }, 600);
    } catch (e) {
        console.error("Erro crítico no login:", e);
    }
}

function logout() {
    localStorage.removeItem('crm_user');
    document.getElementById('dashboard-screen').style.display = 'none';
    document.getElementById('login-screen').style.display = 'block';
    document.getElementById('username').value = ''; document.getElementById('password').value = '';
}

function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-BR', { hour12: false });
    const clockEl = document.getElementById('current-time');
    if (clockEl && clockEl.innerText !== timeString) {
        clockEl.innerText = timeString;
        clockEl.style.animation = 'none';
        setTimeout(() => { clockEl.style.animation = 'paperFlip 0.4s ease-in-out'; }, 10);
    }
}
setInterval(updateClock, 1000); updateClock();

document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const activeModal = document.querySelector('.modal-overlay.active');
    if (activeModal) activeModal.classList.remove('active');
    const comprovante = document.getElementById('modal-comprovante-print');
    if (comprovante && comprovante.style.display === 'flex') fecharComprovantePrint();
});

// ============================================================
// 🚀 CARREGAR DASHBOARD
// ============================================================
async function carregarDashboard() {
    try {
        const dados = await fetchFromGS('carregarDashboard');
        state.dadosAgenda = dados.agenda || [];
        state.dadosCartoes = dados.cartoes || [];
        state.responsaveis = dados.responsaveis || [];

        renderizarAgendaComDados(state.dadosAgenda);
        renderizarCartoesComDados(state.dadosCartoes, state.responsaveis);
        renderizarPendentesCestaHome();
        
        if (dados.totalPendentes) {
            const contador = document.getElementById('busca-contador');
            if(contador) contador.textContent = `📦 ${dados.totalPendentes.total} pendentes`;
        }
    } catch(e) {
        console.error("Erro ao carregar dashboard unificado:", e);
    }
}

// ============================================================
// 📅 AGENDA
// ============================================================
function renderizarAgendaComDados(dadosAgenda) {
    const tbody = document.getElementById('agenda-list');
    if (!tbody) return;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    tbody.innerHTML = '';
    const sorted = [...dadosAgenda].sort((a, b) => new Date(a.data) - new Date(b.data));
    sorted.forEach(item => {
        const tr = document.createElement('tr');
        let dataFormatada = formatarDataBR(item.data);
        let dataItem = new Date(item.data);
        let diffDays = 999;
        let badgeHtml = '';
        if (!isNaN(dataItem.getTime())) { 
            dataItem.setHours(0,0,0,0); 
            diffDays = Math.ceil((dataItem - hoje)/(1000*60*60*24)); 
            if (diffDays === 0 || diffDays === 1) {
                badgeHtml = `<span class="badge-urgente" title="Dia do evento!">!</span>`;
                tr.className = 'highlight-row pulse-row';
            } 
            else if (diffDays < 0) return;
        }
        tr.innerHTML = `
            <td>${dataFormatada}</td>
            <td>${item.periodo||''}</td>
            <td style="font-weight:600;">${item.nome||''}</td>
            <td>${item.endereco||''}</td>
            <td style="white-space:nowrap;">${item.telefone||''}</td>
            <td>
                ${badgeHtml}
                <button class="btn-edit" onclick="deletarItemAgenda(${item.id})" title="Excluir" style="color:#ff4757;">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    if (tbody.children.length === 0) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">Nenhum compromisso futuro agendado.</td></tr>';
}

function verificarProximaAgendaPopup() {
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    const proximos = state.dadosAgenda
        .filter(item => {
            const d = new Date(item.data);
            if (isNaN(d.getTime())) return false;
            d.setHours(0,0,0,0);
            return d >= hoje;
        })
        .sort((a, b) => new Date(a.data) - new Date(b.data))
        .slice(0, 2);

    if (proximos.length > 0) {
        const content = document.getElementById('popup-login-content');
        if (!content) return;
        let html = `<p><strong>Você tem os seguintes compromissos agendados:</strong></p><ul style="list-style:none; padding:0; text-align:left; max-width:300px; margin:10px auto;">`;
        proximos.forEach(item => {
            const dataFormatada = formatarDataBR(item.data);
            let isUrgent = '';
            const dItem = new Date(item.data);
            dItem.setHours(0,0,0,0);
            const diffDays = Math.ceil((dItem - hoje)/(1000*60*60*24));
            if(diffDays === 0) isUrgent = ' 🔴 HOJE!';
            else if(diffDays === 1) isUrgent = ' ⚠️ AMANHÃ!';
            
            html += `<li style="background:#f8f9fa; padding:10px; margin-bottom:8px; border-radius:8px; border-left:4px solid #4a7c2e;">
                <strong>${dataFormatada}${isUrgent}</strong><br>${item.nome} (${item.periodo})
            </li>`;
        });
        html += '</ul>';
        content.innerHTML = html;
        abrirModal('modal-popup-login');
    }
}

async function salvarAgenda() {
    const nome = document.getElementById('ag-nome').value, data = document.getElementById('ag-data').value, periodo = document.getElementById('ag-periodo').value, endereco = document.getElementById('ag-end').value, telefone = document.getElementById('ag-tel').value;
    if (!nome || !data) { alert("Preencha pelo menos o Nome e a Data."); return; }
    await postParaGoogleSheets('salvarAgenda', { id: Date.now(), nome, data, periodo, endereco, telefone });
    fecharModal('modal-agenda'); carregarDashboard();
    document.getElementById('ag-nome').value = ''; document.getElementById('ag-data').value = ''; document.getElementById('ag-periodo').value = ''; document.getElementById('ag-end').value = ''; document.getElementById('ag-tel').value = '';
}

async function deletarItemAgenda(id) { if (!confirm('Tem certeza que deseja excluir este compromisso?')) return; await postParaGoogleSheets('deletarAgenda', id); carregarDashboard(); }

// ============================================================
// CARTÕES
// ============================================================
function renderizarCartoesComDados(dadosCartoes, dadosResponsaveis) {
    const select = document.getElementById('card-responsavel');
    if (select) { select.innerHTML = '<option value="">Selecione um responsável</option>'; dadosResponsaveis.forEach(nome => { const nomeLimpo = String(nome).replace(/^"|"$/g,'').replace(/^'|'$/g,''); select.innerHTML += `<option value="${nomeLimpo}">${nomeLimpo}</option>`; }); }
    const nomesOrdenados = dadosResponsaveis.map(n => n.replace(/^"|"$/g,'').replace(/^'|'$/g,''));
    const thead = document.getElementById('cards-header');
    if (thead) { let headerHtml = '<tr><th>DATA</th>'; if(nomesOrdenados.length > 0) nomesOrdenados.forEach(nome => { headerHtml += `<th style="text-align:center;">${nome}</th>`; }); else headerHtml += '<th style="text-align:center;">RESPONSÁVEIS</th>'; headerHtml += '<th style="text-align:center;">TOTAL DIA</th><th>AÇÕES</th></tr>'; thead.innerHTML = headerHtml; }
    const tbody = document.getElementById('cards-list'); if (!tbody) return; tbody.innerHTML = '';
    const totais = {}; dadosCartoes.forEach(item => { if (!totais[item.responsavel]) totais[item.responsavel] = 0; totais[item.responsavel] += Number(item.qtd)||0; });
    const agrupado = {};
    dadosCartoes.forEach(item => {
        let dataObj = new Date(item.data);
        if (isNaN(dataObj.getTime())) { const partes = String(item.data || '').split('/'); if (partes.length === 3) dataObj = new Date(partes[2], partes[1]-1, partes[0]); }
        if (isNaN(dataObj.getTime())) return;
        const dataStr = dataObj.toISOString().split('T')[0];
        if (!agrupado[dataStr]) agrupado[dataStr] = {};
        if (!agrupado[dataStr][item.responsavel]) agrupado[dataStr][item.responsavel] = 0;
        agrupado[dataStr][item.responsavel] += Number(item.qtd)||0;
    });
    for (const [data, valores] of Object.entries(agrupado).sort((a,b) => new Date(a[0]) - new Date(b[0]))) {
        const tr = document.createElement('tr');
        const dataFormatada = formatarDataBR(data);
        let totalDia = 0; let colunasHtml = '';
        nomesOrdenados.forEach(nome => { const qtd = valores[nome] || 0; if(qtd>0) colunasHtml += `<td style="text-align:center;"><strong>${qtd}</strong></td>`; else colunasHtml += '<td style="text-align:center; color:#ccc;">-</td>'; totalDia += Number(qtd)||0; });
        tr.innerHTML = `<td>${dataFormatada}</td>${colunasHtml}<td style="color:#4a7c2e; font-weight:700; text-align:center;">${totalDia}</td><td><button class="btn-edit" onclick="excluirMesCartao('${data}')" title="Excluir Mês" style="color:#ff4757;">📆🗑️</button></td>`;
        tbody.appendChild(tr);
    }
    if(tbody.children.length===0) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">Nenhum registro de cartão.</td></tr>';
    const totaisDiv = document.getElementById('totais-gerais'); if(!totaisDiv) return;
    let htmlTotais = ''; let totalGeral = 0;
    nomesOrdenados.forEach(nome => { if(totais[nome]) { htmlTotais += `<span>Total ${nome}: <span style="font-weight:700;">${totais[nome]}</span></span>`; totalGeral += Number(totais[nome])||0; } });
    if(htmlTotais) { htmlTotais += `<span>Total Geral: <span style="font-weight:700; color:#4a7c2e;">${totalGeral}</span></span>`; totaisDiv.innerHTML = htmlTotais; totaisDiv.style.display = 'flex'; } else { totaisDiv.style.display = 'none'; }
}

async function excluirMesCartao(data) { let dataStr = data; if(data.includes('/')) { const partes = data.split('/'); if(partes.length===3) dataStr = `${partes[2]}-${partes[1]}-${partes[0]}`; } const dataObj = new Date(dataStr + 'T00:00:00'); if(isNaN(dataObj.getTime())) { alert("Data inválida"); return; } const mes = dataObj.getMonth()+1; const ano = dataObj.getFullYear(); if(!confirm(`Excluir TODOS os cartões do mês ${mes}/${ano}?`)) return; await postParaGoogleSheets('deletarMesGeral', { mes, ano }); carregarDashboard(); }

async function salvarCartoes() { const responsavel = document.getElementById('card-responsavel').value; const qtd = parseInt(document.getElementById('card-qtd').value); const data = document.getElementById('card-data').value; if(!responsavel || !qtd || !data) { alert("Preencha o Responsável, Quantidade e Data."); return; } await postParaGoogleSheets('salvarCartao', { id: Date.now(), responsavel, qtd, data }); fecharModal('modal-cartoes'); carregarDashboard(); document.getElementById('card-qtd').value = ''; document.getElementById('card-data').value = ''; }

async function adicionarResponsavel() { const input = document.getElementById('novo-responsavel-input'); let nome = input.value.trim(); nome = nome.replace(/^"|"$/g,'').replace(/^'|'$/g,''); if(!nome) { alert("Digite um nome."); return; } await postParaGoogleSheets('salvarResponsavel', nome); input.value = ''; carregarDashboard(); }
async function deletarResponsavel(nome) { if(!confirm(`Remover o responsável "${nome}" da lista?`)) return; await postParaGoogleSheets('deletarResponsavel', nome); carregarDashboard(); }

// ============================================================
// ADC CARTÕES (Múltiplas Entregas)
// ============================================================
let contadorEntregas = 0;
function abrirModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('active');
    if(id === 'modal-multiplas-entregas') { const lista = document.getElementById('mult-lista-entregas'); if(lista){ lista.innerHTML = ''; contadorEntregas = 0; adicionarEntrega(); document.getElementById('mult-data').value = new Date().toLocaleDateString('pt-BR'); setTimeout(() => { const p = document.querySelector('#mult-lista-entregas .nome-input'); if(p) p.focus(); },200); } } if(id === 'modal-busca') prepararModalBusca(); 
}

function adicionarEntrega() { contadorEntregas++; const lista = document.getElementById('mult-lista-entregas'); if(!lista) return; const novaEntrega = document.createElement('div'); novaEntrega.className = 'entrega-item'; novaEntrega.dataset.index = contadorEntregas-1; novaEntrega.style.cssText = 'background:white; padding:12px; border-radius:8px; border:1px solid #e0e0e0; margin-bottom:10px;'; novaEntrega.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; background:#fafafa; padding:5px 8px; border-radius:6px;"><div style="background:#4a7c2e; color:white; width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:bold;">${contadorEntregas}</div><button type="button" style="background:#ffebee; color:#d32f2f; border:none; border-radius:50%; width:30px; height:30px; cursor:pointer; font-size:15px; display:flex; align-items:center; justify-content:center;" onclick="removerEntrega(this)" title="Remover esta linha"><i class="fas fa-trash-alt"></i></button></div><div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;"><div><label style="display:block; font-weight:600; font-size:11px; color:#444;">Nome</label><input type="text" class="nome-input" placeholder="Nome completo" style="width:100%; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:13px; text-transform:uppercase;"></div><div><label style="display:block; font-weight:600; font-size:11px; color:#444;">Endereço</label><input type="text" class="endereco-input" placeholder="Endereço completo" style="width:100%; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:13px; text-transform:uppercase;"></div></div>`; lista.appendChild(novaEntrega); atualizarContador(); const nomeInp = novaEntrega.querySelector('.nome-input'); const endInp = novaEntrega.querySelector('.endereco-input'); if(nomeInp){ nomeInp.addEventListener('keydown', function(e) { if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();this.closest('.entrega-item').querySelector('.endereco-input').focus();} }); } if(endInp){ endInp.addEventListener('keydown', function(e) { if(e.key==='Enter'||e.key==='Tab'){e.preventDefault(); const enderecos = document.querySelectorAll('#mult-lista-entregas .endereco-input'); if(this === enderecos[enderecos.length-1]) adicionarEntrega(); else { const index = Array.from(enderecos).indexOf(this); const proxNome = document.querySelectorAll('#mult-lista-entregas .nome-input')[index+1]; if(proxNome) proxNome.focus(); } }}); } if(contadorEntregas===1 && nomeInp) nomeInp.focus(); }

function removerEntrega(botao) { const entregaItem = botao.closest('.entrega-item'); if(contadorEntregas<=1) { alert('É necessário pelo menos uma entrega!'); return; } entregaItem.remove(); contadorEntregas--; const itens = document.querySelectorAll('#mult-lista-entregas .entrega-item'); itens.forEach((item, idx) => { item.dataset.index = idx; const numero = item.querySelector('div:first-child div:first-child'); if(numero) numero.textContent = idx+1; }); atualizarContador(); }

function atualizarContador() { const contador = document.getElementById('mult-contador'); if(!contador) return; contador.textContent = `${contadorEntregas} ${contadorEntregas===1?'entrega':'entregas'}`; }

function validarCampos() { let valido = true; const qtd = document.getElementById('mult-qtd').value; const tipo = document.getElementById('mult-tipo').value; const numero = document.getElementById('mult-numero').value; if(!qtd||!tipo||!numero){alert("Preencha todos os campos: Quantidade, Tipo e N°.");valido=false;} const nomes = document.querySelectorAll('#mult-lista-entregas .nome-input'); const enderecos = document.querySelectorAll('#mult-lista-entregas .endereco-input'); nomes.forEach((nome, index) => { if(!nome.value.trim()||!enderecos[index].value.trim()){nome.style.borderColor='#e53935';enderecos[index].style.borderColor='#e53935';valido=false;} else {nome.style.borderColor='#ddd';enderecos[index].style.borderColor='#ddd';} }); return valido; }

function coletarDadosParaEnvio() { const dadosComuns = { quantidade: document.getElementById('mult-qtd').value, data: document.getElementById('mult-data').value, tipo: document.getElementById('mult-tipo').value, obs: document.getElementById('mult-obs').value.toUpperCase(), numero: document.getElementById('mult-numero').value }; const entregas = []; const nomes = document.querySelectorAll('#mult-lista-entregas .nome-input'); const enderecos = document.querySelectorAll('#mult-lista-entregas .endereco-input'); nomes.forEach((nome, index) => { const nomeValor = nome.value.trim().toUpperCase(); const enderecoValor = enderecos[index].value.trim().toUpperCase(); if(nomeValor&&enderecoValor) entregas.push({ nome: nomeValor, endereco: enderecoValor, quantidade: dadosComuns.quantidade, data: dadosComuns.data, tipo: dadosComuns.tipo, obs: dadosComuns.obs, numero: dadosComuns.numero }); }); return entregas; }

function limparCamposNomeEndereco() { document.querySelectorAll('#mult-lista-entregas .nome-input').forEach(n => { n.value=''; n.style.borderColor='#ddd'; }); document.querySelectorAll('#mult-lista-entregas .endereco-input').forEach(e => { e.value=''; e.style.borderColor='#ddd'; }); }

async function enviarTodasEntregas() { if(!validarCampos())return; const entregas = coletarDadosParaEnvio(); if(entregas.length===0){alert('Adicione pelo menos uma entrega válida!');return;} const btnEnviar = document.getElementById('btnEnviarMulti'); if(!btnEnviar)return; btnEnviar.innerText='Enviando...'; btnEnviar.disabled=true; const statusDiv = document.getElementById('mult-status-message'); if(statusDiv) statusDiv.style.display='none'; await postParaGoogleSheets('salvarLoteCartoesEntrega', entregas); if(statusDiv){ statusDiv.style.display='block'; statusDiv.style.background='#e8f5e9'; statusDiv.style.color='#2e7d32'; statusDiv.style.border='2px solid #a5d6a7'; statusDiv.innerText=`✅ ${entregas.length} registro(s) salvos com sucesso!`; } limparCamposNomeEndereco(); const nomes = document.querySelectorAll('#mult-lista-entregas .nome-input'); if(nomes.length>0) nomes[0].focus(); btnEnviar.innerText='Enviar Tudo'; btnEnviar.disabled=false; }

// ============================================================
// CESTA BÁSICA
// ============================================================
function normalizeString(s) { if(!s&&s!==0)return""; return s.toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').toLowerCase().trim(); }
function headerToId(lbl) { if(!lbl&&lbl!==0)lbl=""; return lbl.toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').replace(/_+/g,'_').toUpperCase(); }
const cestaState = { names:[], types:[], currentLine:null, currentDados:[], qrCodeInstance:null };
async function abrirModalCesta() {
    const modal = document.getElementById('modal-cesta');
    if (!modal) return;
    modal.classList.add('active');
    await carregarNomesCesta(); await carregarTiposCesta(); await renderizarPendentesCestaHome(); const scannerInput = document.getElementById('cesta-scanner-input'); if(scannerInput) setTimeout(()=>{scannerInput.focus();},300); 
}
const abrirModalOriginal=abrirModal; abrirModal=function(id){ if(id==='modal-cesta'){abrirModalCesta();return;} abrirModalOriginal(id); };
async function carregarNomesCesta() { const res=await fetchFromGS('buscarTodosNomesCesta'); cestaState.names=res||[]; }
async function carregarTiposCesta() { const res=await fetchFromGS('listarTiposCesta'); cestaState.types=res||[]; const input=document.getElementById('cesta-tipos-input'); if(input) input.value=cestaState.types.join(', '); }
function editarTiposCestaUI() { const e=document.getElementById('cesta-tipos-editor'); if(e) e.style.display=e.style.display==='none'?'block':'none'; }
function fecharEditorTipos() { const e=document.getElementById('cesta-tipos-editor'); if(e) e.style.display='none'; }
async function salvarTiposCesta() { const input=document.getElementById('cesta-tipos-input'); if(!input)return; const tipos=input.value.trim().split(',').map(t=>t.trim().toUpperCase()).filter(t=>t); await postParaGoogleSheets('salvarTiposCesta',{tipos}); alert("✅ Tipos de cesta atualizados!"); await carregarTiposCesta(); fecharEditorTipos(); renderizarPendentesCestaHome(); }

async function renderizarPendentesCestaHome() {
    try {
        const list = await fetchFromGS('listarPendentesMesAtual');
        const container = document.getElementById('cesta-pendentes-home');
        if (!container) return;
        container.innerHTML = '';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '6px';
        if (!list || list.length === 0) {
            container.innerHTML = '<div style="color:#4a7c2e; font-weight:600; padding:10px;">✅ Todos os cadastros do mês atual estão em dia!</div>';
            return;
        }
        list.forEach(item => {
            const nomeLimpo = item.nome || '';
            const card = document.createElement('div');
            card.className = 'pending-item-card';
            const content = document.createElement('div');
            content.className = 'card-content';
            content.onclick = () => abrirModalCestaComNome(nomeLimpo);
            const nomeSpan = document.createElement('span');
            nomeSpan.title = 'Clique para abrir';
            nomeSpan.textContent = nomeLimpo;
            const tagSpan = document.createElement('span');
            tagSpan.className = 'card-tag';
            tagSpan.textContent = item.tipo || 'Sem tipo';
            content.appendChild(nomeSpan);
            content.appendChild(tagSpan);
            const actions = document.createElement('div');
            actions.className = 'card-actions';
            const btnEdit = document.createElement('button');
            btnEdit.className = 'btn-icon btn-edit';
            btnEdit.title = 'Editar nome';
            btnEdit.innerHTML = '<i class="fas fa-edit"></i>';
            btnEdit.onclick = e => { e.stopPropagation(); editarNomePendente(nomeLimpo, item.linha); };
            const btnDelete = document.createElement('button');
            btnDelete.className = 'btn-icon btn-delete';
            btnDelete.title = 'Excluir cadastro';
            btnDelete.innerHTML = '<i class="fas fa-trash-alt"></i>';
            btnDelete.onclick = e => { e.stopPropagation(); deletarPendente(item.linha, nomeLimpo); };
            actions.appendChild(btnEdit);
            actions.appendChild(btnDelete);
            card.appendChild(content);
            card.appendChild(actions);
            container.appendChild(card);
        });
    } catch (e) { console.error(e); const c=document.getElementById('cesta-pendentes-home'); if(c)c.innerHTML='<span style="color:#888;">Erro ao carregar pendentes.</span>'; }
}
async function abrirModalCestaComNome(nome){abrirModal('modal-cesta');setTimeout(()=>{buscarEPreencherCesta(nome,false);},300);}
async function editarNomePendente(nomeAntigo,linha){const novoNome=prompt(`Digite o novo nome para "${nomeAntigo}":`,nomeAntigo);if(novoNome===null)return;if(novoNome.trim()===''){alert("O nome não pode estar vazio.");return;}await postParaGoogleSheets('editarNomeMoradorCesta',{linha,novoNome:novoNome.trim().toUpperCase()});alert("✅ Nome atualizado com sucesso!");await renderizarPendentesCestaHome();await carregarNomesCesta();}
async function deletarPendente(linha,nome){if(!confirm(`Tem certeza que deseja EXCLUIR permanentemente o cadastro de "${nome}"?`))return;await postParaGoogleSheets('deletarMoradorCesta',{linha});alert("✅ Cadastro excluído com sucesso!");await renderizarPendentesCestaHome();await carregarNomesCesta();}
async function buscarEPreencherCesta(nome,isQRCode=false){try{const resp=await fetchFromGS('buscarMoradorCesta',{nome});if(!resp||!resp.dados){alert(isQRCode?"❌ Morador não encontrado na planilha.":"❌ Morador não encontrado.");return;}cestaState.currentLine=resp.linha;cestaState.currentDados=resp.dados;renderFormCesta(resp.dados);if(isQRCode){const confirmar=confirm(`Deseja marcar a cesta como ENTREGUE para ${nome} (com a data de hoje)?`);if(confirmar){const monthLabels=["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];const todayIndex=new Date().getMonth();const today=new Date();const dia=String(today.getDate()).padStart(2,'0');const mes=String(today.getMonth()+1).padStart(2,'0');const monthId=headerToId(monthLabels[todayIndex]);const monthField=document.getElementById(monthId);if(monthField){monthField.value=`${dia}/${mes}`;atualizarMesesUICesta();await salvarCestaAutomatico();alert("✅ Cesta entregue com sucesso!");}else alert("Erro ao encontrar o mês atual para marcar.");}}}catch(e){console.error(e);alert(isQRCode?"Erro ao buscar os dados via QR Code.":"Erro ao buscar os dados.");}}
function renderFormCesta(dadosArray){
    const formArea = document.getElementById('cesta-formArea'); if(!formArea) return; formArea.style.display='block';
    const panelPendentes = document.getElementById('cesta-panelPendentes'); if(panelPendentes) panelPendentes.style.display='none';
    const fields = document.getElementById('cesta-fields'); if(!fields) return; fields.innerHTML='';
    const monthsContainer = document.getElementById('cesta-monthsContainer'); if(!monthsContainer) return; monthsContainer.innerHTML='';
    const tiposOptions=cestaState.types.map(t=>`<option value="${t}">${t}</option>`).join('');
    const monthLabels=["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
    dadosArray.forEach(item=>{const id=item.id;const label=item.label||id;const value=item.value||'';const isMonth=monthLabels.map(m=>normalizeString(m)).indexOf(normalizeString(label))!==-1;if(isMonth){const div=document.createElement('div');div.className='month';const inputMonth=document.createElement('input');inputMonth.className='monthField';inputMonth.id=id;inputMonth.value=value||'';inputMonth.readOnly=true;inputMonth.addEventListener('click',function(){const hoje=new Date();const diaStr=String(hoje.getDate()).padStart(2,'0');const mesStr=String(hoje.getMonth()+1).padStart(2,'0');if(confirm(`Marcar mês ${label} como entregue hoje (${diaStr}/${mesStr})?`)){inputMonth.value=`${diaStr}/${mesStr}`;atualizarMesesUICesta();salvarCestaAutomatico();}});const lab=document.createElement('label');lab.textContent=label;div.appendChild(lab);div.appendChild(inputMonth);monthsContainer.appendChild(div);}else{const wrapper=document.createElement('div');if(label.trim().toUpperCase()==='TIPO'){wrapper.innerHTML=`<label>${label}</label><select class="field" id="${id}"><option value="">Selecione</option>${tiposOptions}</select>`;const select=wrapper.querySelector('select');select.value=value;}else{wrapper.innerHTML=`<label>${label}</label><input class="field" id="${id}">`;const input=wrapper.querySelector('input');input.value=value;}fields.appendChild(wrapper);}});atualizarMesesUICesta();
}
function atualizarMesesUICesta(){const months=document.querySelectorAll('#cesta-monthsContainer .month');let pagos=0;months.forEach(div=>{const inputEl=div.querySelector('input');if(!inputEl)return;inputEl.classList.remove('pago','pendente');let v=(inputEl.value||"").toString().trim();if(v&&!v.includes('/')&&!v.toUpperCase().includes('X')){const d=new Date(v);if(!isNaN(d.getTime())){const dia=String(d.getDate()).padStart(2,'0');const mes=String(d.getMonth()+1).padStart(2,'0');v=`${dia}/${mes}`;inputEl.value=v;}}if(!v)inputEl.value='X';if(/\d/.test(v)){inputEl.classList.add('pago');inputEl.style.background='#e6ffed';inputEl.style.color='#166534';pagos++;}else{inputEl.classList.add('pendente');inputEl.style.background='#fee2e2';inputEl.style.color='#9b2c2c';}});const stamp=document.getElementById('cesta-stamp');if(stamp)stamp.classList.toggle('show',pagos===12);const statusId=headerToId('STATUS');const statusInput=document.getElementById(statusId);if(statusInput){const todayIndex=new Date().getMonth();const monthLabels=["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];const monthId=headerToId(monthLabels[todayIndex]);const monthField=document.getElementById(monthId);const isPago=monthField&&monthField.classList.contains('pago');statusInput.value=isPago?'ENTREGUE':'PENDENTE';statusInput.style.backgroundColor=isPago?'#16a34a':'#dc2626';statusInput.style.color='#ffffff';statusInput.style.fontWeight='bold';}}
async function salvarCestaAutomatico(){if(!cestaState.currentLine)return;const inputs=document.querySelectorAll('#cesta-fields .field, #cesta-monthsContainer input');const payload={};inputs.forEach(inp=>{payload[inp.id]=inp.value;});await postParaGoogleSheets('salvarMoradorCesta',{linha:cestaState.currentLine,payload});renderizarPendentesCestaHome();}
const btnSaveCesta = document.getElementById('cesta-btnSave');
if(btnSaveCesta){
    btnSaveCesta.addEventListener('click',async()=>{if(!cestaState.currentLine){alert("Nenhum morador selecionado.");return;}const inputs=document.querySelectorAll('#cesta-fields .field, #cesta-monthsContainer input');const payload={};inputs.forEach(inp=>{payload[inp.id]=inp.value;});await postParaGoogleSheets('salvarMoradorCesta',{linha:cestaState.currentLine,payload});alert("✅ Dados salvos com sucesso!");atualizarMesesUICesta();renderizarPendentesCestaHome();});
}
async function gerarCarteirinha(){const nome=document.getElementById('cesta-search').value.trim();if(!nome){alert("Busque um morador antes de gerar a carteirinha.");return;}const qrContainer=document.getElementById('card-qrcode');if(!qrContainer)return;qrContainer.innerHTML='';document.getElementById('card-nome').innerText=nome;try{cestaState.qrCodeInstance=new QRCode(qrContainer,{text:nome,width:75,height:75,colorDark:"#4a7c2e",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.H});}catch(e){alert("Erro ao gerar QR Code");return;}setTimeout(async()=>{try{const cardDiv=document.getElementById('carteirinha-print-area');const canvas=await html2canvas(cardDiv,{scale:2});const{jsPDF}=window.jspdf;const pdf=new jsPDF('l','mm','a6');const imgData=canvas.toDataURL('image/jpeg',0.95);pdf.addImage(imgData,'JPEG',0,0,148,105);const pdfBlob=pdf.output('blob');window.open(URL.createObjectURL(pdfBlob),'_blank');}catch(error){console.error(error);alert("Erro ao gerar a imagem da carteirinha.");}},300);}

// ============================================================
// CURRÍCULO (CORRIGIDO E COMPLETO)
// ============================================================
function handlePhotoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            const targetWidth = 300;
            const targetHeight = 400;
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            const aspectRatio = targetWidth / targetHeight;
            let srcWidth = img.width;
            let srcHeight = img.height;
            let srcX = 0;
            let srcY = 0;
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

async function buscarCEP() {
    let cep = document.getElementById('cv-cep').value.replace(/\D/g, '');
    if (cep.length !== 8) return;
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

function adicionarTelefone() {
    if (state.telefoneCount < 3) {
        state.telefoneCount++;
        document.getElementById(`cv-tel-container-${state.telefoneCount}`).style.display = 'block';
        if (state.telefoneCount === 3) document.getElementById('btn-add-tel').style.display = 'none';
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
            <div class="grid-cv full"><label style="font-size:12px;">Período</label><input type="text" class="input-periodo" placeholder="Ex: 2018 - 2022"></div>
        </div>`;
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
            <div class="grid-cv full"><label style="font-size:12px;">Período</label><input type="text" class="input-periodo-exp" placeholder="Ex: Jan/2020 - Dez/2022"></div>
        </div>`;
    container.insertAdjacentHTML('beforeend', html);
    state.expCount++;
}

function removerItem(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (id.startsWith('curso-')) state.cursoCount--;
    if (id.startsWith('exp-')) state.expCount--;
    el.remove();
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

    const tels = [tel1, tel2, tel3].filter(t => t.trim() !== '');
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
            div.innerHTML = `<div class="pdf-entry-title">${c.curso}</div><div class="pdf-entry-sub">${c.inst}</div><div class="pdf-entry-period">${c.periodo}</div>`;
            pdfCursos.appendChild(div);
        });
    }

    const pdfExp = document.getElementById('pdf-experiencias');
    pdfExp.innerHTML = '';
    if (experiencias.length === 0) {
        pdfExp.innerHTML = '<p style="font-size:12px; color:#888;">Nenhuma experiência informada.</p>';
    } else {
        experiencias.forEach(exp => {
            const div = document.createElement('div');
            div.className = 'pdf-entry';
            div.innerHTML = `<div class="pdf-entry-title">${exp.empresa}</div><div class="pdf-entry-sub">${exp.funcao}</div><div class="pdf-entry-period">${exp.periodo}</div>`;
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
        const finalScale = Math.min(scaleX, scaleY);
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

// ============================================================
// COMPROVANTE E SUGESTÕES
// ============================================================
function toggleComprovanteMenu() { const menu=document.getElementById('menu-comprovante'); if(!menu)return; menu.style.display=menu.style.display==='none'?'block':'none'; }
document.addEventListener('click', function(e){ const menu=document.getElementById('menu-comprovante'); const btn=document.getElementById('btn-comprovante'); if(menu&&btn&&!menu.contains(e.target)&&e.target!==btn) menu.style.display='none'; });
function removerAcentos(str){ return String(str||'').normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function formatarCEPPrint(i){ i.value=i.value.replace(/\D/g,'').replace(/(\d{5})(\d)/,'$1-$2'); }
function formatarCPFPrint(i){ i.value=i.value.replace(/\D/g,'').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2'); }
function formatarRGPrint(i){ i.value=i.value.replace(/\D/g,'').replace(/(\d{1,2})(\d{3})(\d{3})(\d{1})$/,'$1.$2.$3-$4'); }
function autoBuscarCEP(el){ const cep=el.value.replace(/\D/g,''); if(cep.length===8) buscarCEPPrint(); }
function autoBuscarCPF(el){ const cpf=el.value.replace(/\D/g,''); if(cpf.length===11){ if(state.lastSearchedCPF!==cpf){state.lastSearchedCPF=cpf;buscarCPFPrint();} }else{state.lastSearchedCPF='';} }
async function abrirComprovantePrint(tipo){ state.tipoComprovanteAtual=tipo; const menu=document.getElementById('menu-comprovante'); if(menu) menu.style.display='none'; const bgImage=tipo==='assinatura'?"https://i.imgur.com/lFhk0Hq.png":"https://i.imgur.com/l47wlMJ.png"; const comprovanteBg=document.getElementById('comprovante-bg'); if(comprovanteBg) comprovanteBg.style.backgroundImage=`url('${bgImage}')`; const modal=document.getElementById('modal-comprovante-print'); if(modal) modal.style.display='flex'; const idsLimpar=['print-nome','print-endereco','print-numero_endereco','print-complemento','print-cep','print-bairro','print-uf','print-nacionalidade','print-estado_civil','print-cpf','print-rg']; idsLimpar.forEach(id=>{const el=document.getElementById(id); if(el) el.value='';}); const emissor=document.getElementById('print-emissor'); if(emissor) emissor.value='DETRAN/RJ'; const proprias=['print-propria','print-alugada','print-emprestada']; proprias.forEach(id=>{const chk=document.getElementById(id); if(chk) chk.checked=false;}); const m=["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"]; const h=new Date(); const printData=document.getElementById("print-data"); if(printData) printData.value=`${String(h.getDate()).padStart(2,'0')} DE ${m[h.getMonth()]}`; const printAno=document.getElementById("print-ano"); if(printAno) printAno.value=h.getFullYear(); try{ const dados=await fetchFromGS('getNumero'); const numeroEl=document.getElementById('print-numero'); if(numeroEl) numeroEl.value=dados.numero||'0000001'; }catch(e){console.error(e);alert("Erro ao buscar o número da declaração."); const numeroEl=document.getElementById('print-numero'); if(numeroEl) numeroEl.value='0000001'; } }
async function buscarCEPPrint(){ const cep=document.getElementById('print-cep').value.replace(/\D/g,''); if(cep.length!==8){alert("CEP inválido");return;} try{ const resp=await fetch(`https://viacep.com.br/ws/${cep}/json/`); const dados=await resp.json(); if(dados.erro){alert("CEP não encontrado na API dos Correios");return;} const enderecoEl=document.getElementById('print-endereco'); if(enderecoEl) enderecoEl.value=(dados.logradouro||'').toUpperCase(); const bairro=(dados.bairro||'').toUpperCase(); const cidade=(dados.localidade||'').toUpperCase(); const bairroEl=document.getElementById('print-bairro'); if(bairroEl) bairroEl.value=bairro+'/'+cidade; const ufEl=document.getElementById('print-uf'); if(ufEl) ufEl.value=(dados.uf||'').toUpperCase(); }catch(e){console.error(e);alert("Erro de conexão ao buscar o CEP.");} }
async function buscarCPFPrint(){ const cpf=document.getElementById('print-cpf').value.replace(/\D/g,''); if(cpf.length!==11){alert("CPF inválido");return;} try{ const r=await fetchFromGS('buscarCPF',{cpf}); if(r.erro){alert("ERRO DO APPS SCRIPT: "+r.erro);return;} if(!r.encontrado){alert("CPF NÃO LOCALIZADO na planilha.");return;} const d=r.dados; const nomeEl=document.getElementById('print-nome'); if(nomeEl) nomeEl.value=d.nome||''; const enderecoEl=document.getElementById('print-endereco'); if(enderecoEl) enderecoEl.value=d.endereco||''; const numEndEl=document.getElementById('print-numero_endereco'); if(numEndEl) numEndEl.value=d.numero_endereco||''; const complEl=document.getElementById('print-complemento'); if(complEl) complEl.value=d.complemento||''; const cepEl=document.getElementById('print-cep'); if(cepEl) cepEl.value=d.cep||''; const bairroEl=document.getElementById('print-bairro'); if(bairroEl) bairroEl.value=d.bairro||''; const ufEl=document.getElementById('print-uf'); if(ufEl) ufEl.value=d.uf||''; const nacEl=document.getElementById('print-nacionalidade'); if(nacEl) nacEl.value=d.nacionalidade||''; const civilEl=document.getElementById('print-estado_civil'); if(civilEl) civilEl.value=d.estado_civil||''; const cpfEl=document.getElementById('print-cpf'); if(cpfEl) cpfEl.value=d.cpf||''; const rgEl=document.getElementById('print-rg'); if(rgEl) rgEl.value=d.rg||''; const emissorEl=document.getElementById('print-emissor'); if(emissorEl) emissorEl.value=d.emissor||''; const propEl=document.getElementById('print-propria'); if(propEl) propEl.checked=d.propria||false; const alugEl=document.getElementById('print-alugada'); if(alugEl) alugEl.checked=d.alugada||false; const empEl=document.getElementById('print-emprestada'); if(empEl) empEl.checked=d.emprestada||false; }catch(e){console.error(e);alert("Erro de comunicação: "+e.message);} }
function detectarGeneroENacionalidadeComprovante(){ const nomeInput=document.getElementById('print-nome'); const nome=nomeInput.value.trim().toUpperCase(); if(nome.length<2)return; const primeiroNome=nome.split(' ')[0].toLowerCase(); let genero='MASCULINO'; const excecoesMasculinas=['joaquim','luca','noa','nicola']; if(excecoesMasculinas.includes(primeiroNome))genero='MASCULINO'; else if(['mar','luz','flor','marjorie','alice','constance'].includes(primeiroNome))genero='FEMININO'; else if(primeiroNome.endsWith('a')||primeiroNome.endsWith('e')||primeiroNome.endsWith('i')||primeiroNome.endsWith('ad')||primeiroNome.endsWith('ra')||primeiroNome.endsWith('na')||primeiroNome.endsWith('la')||primeiroNome.endsWith('da')||primeiroNome.endsWith('ia'))genero='FEMININO'; else genero='MASCULINO'; if(genero==='FEMININO'){ const nacEl=document.getElementById('print-nacionalidade'); if(nacEl) nacEl.value='BRASILEIRA'; const civilEl=document.getElementById('print-estado_civil'); if(civilEl) civilEl.value='SOLTEIRA'; }else{ const nacEl=document.getElementById('print-nacionalidade'); if(nacEl) nacEl.value='BRASILEIRO'; const civilEl=document.getElementById('print-estado_civil'); if(civilEl) civilEl.value='SOLTEIRO'; } }
let debounceTimerEndereco; let enderecoCache={}; let searchController=null;
function buscarSugestoesEndereco(){ const input=document.getElementById('print-endereco'); const container=document.getElementById('address-suggestions'); if(!container) return; const queryOriginal=input.value.trim().toUpperCase(); if(searchController){searchController.abort();searchController=null;} clearTimeout(debounceTimerEndereco); if(queryOriginal.length<2){container.style.display='none';return;} if(enderecoCache[queryOriginal]){exibirSugestoes(container,enderecoCache[queryOriginal]);return;} debounceTimerEndereco=setTimeout(async()=>{ try{ container.innerHTML='<div class="suggestion-item" style="text-align:center;color:#888;cursor:default;">🔍 Buscando...</div>'; container.style.display='block'; searchController=new AbortController(); const resultados=await fetchFromGS('buscarEnderecos',{q:removerAcentos(queryOriginal)},searchController.signal); const querySemAcento=removerAcentos(queryOriginal); const resultadosFiltrados=(resultados||[]).filter(item=>{ const enderecoSemAcento=removerAcentos(String(item.endereco||'').toUpperCase()); return enderecoSemAcento.startsWith(querySemAcento)||enderecoSemAcento.includes(querySemAcento); }); enderecoCache[queryOriginal]=resultadosFiltrados; exibirSugestoes(container,resultadosFiltrados); }catch(e){if(e.name!=='AbortError'){console.warn("Erro ao buscar endereços:",e);container.style.display='none';}}finally{searchController=null;} },100); }
function exibirSugestoes(container,resultados){ if(!container) return; container.innerHTML=''; if(!resultados||resultados.length===0){container.style.display='none';return;} resultados.forEach(item=>{ const div=document.createElement('div'); div.className='suggestion-item'; const strong=document.createElement('strong'); strong.textContent=item.endereco||''; const small=document.createElement('small'); small.textContent=`${item.bairro||''} - ${item.uf||''} (CEP: ${item.cep||'N/I'})`; div.appendChild(strong); div.appendChild(small); div.onclick=()=>{ document.getElementById('print-endereco').value=item.endereco||''; const bairro=(item.bairro||'').toUpperCase(); const cidade=(item.cidade||'').toUpperCase(); document.getElementById('print-bairro').value=bairro+'/'+cidade; document.getElementById('print-uf').value=item.uf||''; document.getElementById('print-cep').value=item.cep||''; container.style.display='none'; }; container.appendChild(div); }); container.style.display='block'; }
document.addEventListener('click',function(e){ const container=document.getElementById('address-suggestions'); const input=document.getElementById('print-endereco'); if(container&&input&&!container.contains(e.target)&&e.target!==input)container.style.display='none'; });
function obterValoresComprovante(){ return { numero:document.getElementById('print-numero').value, data:document.getElementById('print-data').value, ano:document.getElementById('print-ano').value, nome:document.getElementById('print-nome').value.toUpperCase(), endereco:document.getElementById('print-endereco').value.toUpperCase(), numero_endereco:document.getElementById('print-numero_endereco').value.toUpperCase(), complemento:document.getElementById('print-complemento').value.toUpperCase(), cep:document.getElementById('print-cep').value, bairro:document.getElementById('print-bairro').value.toUpperCase(), uf:document.getElementById('print-uf').value.toUpperCase(), nacionalidade:document.getElementById('print-nacionalidade').value.toUpperCase(), estado_civil:document.getElementById('print-estado_civil').value.toUpperCase(), cpf:document.getElementById('print-cpf').value, rg:document.getElementById('print-rg').value, emissor:document.getElementById('print-emissor').value.toUpperCase(), propria:document.getElementById('print-propria').checked, alugada:document.getElementById('print-alugada').checked, emprestada:document.getElementById('print-emprestada').checked }; }
function gerarHTMLImpressaoCRM(v){ return `<!DOCTYPE html><html><head><style>body{margin:0;padding:0;font-family:Arial,sans-serif;}.popup{position:relative;width:794px;height:1123px;background-color:white;overflow:hidden;margin:0 auto;}.popup-content{position:relative;width:100%;height:100%;}.popup-content img{width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;z-index:0;}.input-field{position:absolute;font-size:13px;padding:2px 4px;z-index:1;font-weight:bold;background:transparent;border:none;outline:none;color:black;text-transform:uppercase;}.input-field[type="checkbox"]{width:16px;height:16px;accent-color:black;}@media print{body{margin:0!important;padding:0!important;}}</style></head><body><div class="popup"><div class="popup-content"><img src="https://i.imgur.com/lFhk0Hq.png"><input class="input-field" style="top:386px;left:230px;width:80px" value="${v.numero}" readonly><input class="input-field" style="top:386px;left:390px;width:130px" value="${v.data}" readonly><input class="input-field" style="top:386px;left:580px;width:80px" value="${v.ano}" readonly><input class="input-field" style="top:437px;left:167px;width:500px;font-size:18px" value="${v.nome}" readonly><input class="input-field" style="top:508px;left:216px;width:350px" value="${v.endereco}" readonly><input class="input-field" style="top:508px;left:629px;width:90px" value="${v.numero_endereco}" readonly><input class="input-field" style="top:568px;left:240px;width:210px" value="${v.complemento}" readonly><input class="input-field" style="top:568px;left:530px;width:150px" value="${v.cep}" readonly><input class="input-field" style="top:633px;left:165px;width:350px" value="${v.bairro}" readonly><input class="input-field" style="top:633px;left:630px;width:80px" value="${v.uf}" readonly><input class="input-field" style="top:695px;left:247px;width:150px" value="${v.nacionalidade}" readonly><input class="input-field" style="top:695px;left:555px;width:150px" value="${v.estado_civil}" readonly><input class="input-field" style="top:758px;left:135px;width:188px" value="${v.cpf}" readonly><input class="input-field" style="top:758px;left:395px;width:100px" value="${v.rg}" readonly><input class="input-field" style="top:758px;left:625px;width:120px" value="${v.emissor}" readonly><input type="checkbox" class="input-field" style="top:844px;left:249px" ${v.propria?'checked':''} readonly><input type="checkbox" class="input-field" style="top:844px;left:425px" ${v.alugada?'checked':''} readonly><input type="checkbox" class="input-field" style="top:844px;left:652px" ${v.emprestada?'checked':''} readonly></div></div></body></html>`; }
async function salvarDadosComprovante(){ const dados=[document.getElementById('print-numero').value,document.getElementById('print-data').value,document.getElementById('print-ano').value,document.getElementById('print-nome').value.toUpperCase(),document.getElementById('print-endereco').value.toUpperCase(),document.getElementById('print-numero_endereco').value.toUpperCase(),document.getElementById('print-complemento').value.toUpperCase(),document.getElementById('print-cep').value,document.getElementById('print-bairro').value.toUpperCase(),document.getElementById('print-uf').value.toUpperCase(),document.getElementById('print-nacionalidade').value.toUpperCase(),document.getElementById('print-estado_civil').value.toUpperCase(),document.getElementById('print-cpf').value,document.getElementById('print-rg').value,document.getElementById('print-emissor').value.toUpperCase(),document.getElementById('print-propria').checked?"Casa Própria":"",document.getElementById('print-alugada').checked?"Alugada":"",document.getElementById('print-emprestada').checked?"Emprestada":""]; await postParaGoogleSheets('salvarDeclaracao',dados); }
async function salvarApenas(){ const btn=document.querySelector('#modal-comprovante-print .btn-save'); if(!btn)return; btn.innerText='Salvando...'; btn.disabled=true; try{ await salvarDadosComprovante(); alert("Dados salvos com sucesso!"); fecharComprovantePrint(); }catch(e){alert("Erro ao salvar: "+e.message);}finally{btn.innerText='💾 Salvar';btn.disabled=false;} }
async function salvarEImprimir(){ const btn=document.querySelector('#modal-comprovante-print .btn-print'); if(!btn)return; btn.innerText='Salvando...'; btn.disabled=true; try{ await salvarDadosComprovante(); const v=obterValoresComprovante(); let htmlPrint=gerarHTMLImpressaoCRM(v); htmlPrint=htmlPrint.replace('</body>',`<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},800);});<\/script></body>`); const win=window.open('','_blank'); if(win){win.document.write(htmlPrint);win.document.close();win.focus();}else{alert("Pop-up bloqueado! Permita pop-ups.");} fecharComprovantePrint(); }catch(e){alert("Erro ao salvar e imprimir: "+e.message);}finally{btn.innerText='🖨️ Imprimir';btn.disabled=false;} }
function fecharModal(id){ const modal=document.getElementById(id); if(modal) modal.classList.remove('active'); }
function fecharComprovantePrint(){ const modal=document.getElementById('modal-comprovante-print'); if(modal) modal.style.display='none'; }

// ============================================================
// 🔥 BUSCA INTELIGENTE (Sem Filtros, com Data BR e Ordenação)
// ============================================================
var todosResultadosBusca = []; 
var debounceTimerBusca = null; 
var buscaRequestController = null;
var inputBusca = null; 
var btnBuscaSearch = null; 
var buscaResultados = null; 
var contadorBusca = null;
var buscaTipoSelect = null;
var buscaSequencia = 0;
var buscaUltimaConsulta = null;
var buscaCacheMemoria = new Map();
var buscaContagemEnderecos = new Map();
const BUSCA_DEBOUNCE_MS = 650;
const BUSCA_CACHE_MS = 60000;

function normalizarTextoBusca(valor) {
    return String(valor || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function somenteDigitosBusca(valor) { return String(valor || '').replace(/\D/g, ''); }

function minimoCaracteresBusca(tipo) {
    if (tipo === 'numero') return 1;
    if (tipo === 'cpf' || tipo === 'telefone') return 3;
    return 2;
}

function placeholderBusca(tipo) {
    const textos = {
        todos: 'Digite nome, rua, número, CPF ou telefone...',
        nome: 'Digite o nome da pessoa...',
        endereco: 'Digite o nome da rua ou endereço...',
        numero: 'Digite o número do cartão...',
        cpf: 'Digite pelo menos 3 números do CPF...',
        telefone: 'Digite pelo menos 3 números do telefone...'
    };
    return textos[tipo] || textos.todos;
}

function chaveBuscaMemoria(tipo, termo) {
    return `${tipo}|${normalizarTextoBusca(termo)}|${somenteDigitosBusca(termo)}`;
}

function obterBuscaMemoria(chave) {
    const item = buscaCacheMemoria.get(chave);
    if (!item) return null;
    if (Date.now() - item.criadoEm > BUSCA_CACHE_MS) {
        buscaCacheMemoria.delete(chave);
        return null;
    }
    return item.resposta;
}

function salvarBuscaMemoria(chave, resposta) {
    buscaCacheMemoria.set(chave, { criadoEm: Date.now(), resposta });
    if (buscaCacheMemoria.size > 40) buscaCacheMemoria.delete(buscaCacheMemoria.keys().next().value);
}

function pontuarResultadoLocal(item, termo, tipo) {
    const consulta = normalizarTextoBusca(termo);
    const digitos = somenteDigitosBusca(termo);
    const tokens = consulta.split(/\s+/).filter(Boolean);
    const nome = normalizarTextoBusca(item.nome);
    const endereco = normalizarTextoBusca(item.endereco);
    const palavrasNome = nome.split(/\s+/).filter(Boolean);
    const numero = normalizarTextoBusca(item.numero);
    const cpf = somenteDigitosBusca(item.cpf);
    const telefone = somenteDigitosBusca(item.telefone);

    const nomeScore = () => {
        if (!tokens.length || !tokens.every(t => palavrasNome.some(p => p.startsWith(t)))) return 0;
        if (nome === consulta) return 1200;
        if (nome.startsWith(consulta)) return 900;
        return 500 + tokens.length * 100;
    };
    const enderecoScore = () => {
        if (!tokens.length || !tokens.every(t => endereco.includes(t))) return 0;
        if (endereco === consulta) return 1000;
        if (endereco.startsWith(consulta)) return 800;
        return 450 + tokens.length * 50;
    };

    if (tipo === 'nome') return nomeScore();
    if (tipo === 'endereco') return enderecoScore();
    if (tipo === 'numero') return numero === consulta ? 1000 : (numero.startsWith(consulta) ? 700 : 0);
    if (tipo === 'cpf') return digitos && cpf.includes(digitos) ? (cpf === digitos ? 1000 : 700) : 0;
    if (tipo === 'telefone') return digitos && telefone.includes(digitos) ? (telefone === digitos ? 1000 : 700) : 0;

    let score = Math.max(nomeScore(), enderecoScore());
    if (digitos) {
        if (numero === consulta) score = Math.max(score, 1100);
        else if (numero.startsWith(consulta)) score = Math.max(score, 750);
        if (cpf.includes(digitos)) score = Math.max(score, cpf === digitos ? 1050 : 720);
        if (telefone.includes(digitos)) score = Math.max(score, telefone === digitos ? 1000 : 700);
    }
    return score;
}

function refinarBuscaAnterior(tipo, termo) {
    const anterior = buscaUltimaConsulta;
    if (!anterior || !anterior.resposta?.completo || anterior.tipo !== tipo) return null;
    const antes = normalizarTextoBusca(anterior.termo);
    const agora = normalizarTextoBusca(termo);
    if (!antes || agora.length <= antes.length || !agora.startsWith(antes)) return null;

    const resultados = (anterior.resposta.resultados || [])
        .map(item => ({ ...item, score: pontuarResultadoLocal(item, termo, tipo) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || Number(b.linha) - Number(a.linha));
    return { ...anterior.resposta, resultados, total: resultados.length, completo: true, cacheLocal: true };
}

function inicializarEventosBusca() {
    inputBusca = document.getElementById('busca-input');
    btnBuscaSearch = document.getElementById('busca-btnSearch');
    buscaResultados = document.getElementById('busca-resultados');
    contadorBusca = document.getElementById('busca-contador');
    buscaTipoSelect = document.getElementById('busca-tipo');
    if (!inputBusca || !btnBuscaSearch) return; 
    if (buscaTipoSelect) {
        buscaTipoSelect.addEventListener('change', function() {
            inputBusca.placeholder = placeholderBusca(this.value);
            if (inputBusca.value.trim()) executarBusca();
        });
    }
    if (btnBuscaSearch && !btnBuscaSearch.dataset.bound) {
        btnBuscaSearch.dataset.bound = 'true';
        btnBuscaSearch.addEventListener('click', () => executarBusca());
    }
    if (inputBusca && !inputBusca.dataset.bound) {
        inputBusca.dataset.bound = 'true';
        inputBusca.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); executarBusca(); } });
        inputBusca.addEventListener('input', () => {
            clearTimeout(debounceTimerBusca);
            const tipo = buscaTipoSelect ? buscaTipoSelect.value : 'todos';
            const termo = inputBusca.value.trim();
            if (!termo) { limparBusca(false); return; }
            if (termo.length < minimoCaracteresBusca(tipo)) {
                if (buscaResultados) buscaResultados.innerHTML = `<div style="text-align:center; padding:30px; color:#888;">Digite pelo menos ${minimoCaracteresBusca(tipo)} caractere(s).</div>`;
                return;
            }
            debounceTimerBusca = setTimeout(executarBusca, BUSCA_DEBOUNCE_MS);
        });
    }
}

function prepararModalBusca() {
    setTimeout(async() => {
        inputBusca = document.getElementById('busca-input');
        btnBuscaSearch = document.getElementById('busca-btnSearch');
        buscaResultados = document.getElementById('busca-resultados');
        contadorBusca = document.getElementById('busca-contador');
        buscaTipoSelect = document.getElementById('busca-tipo');
        if (!inputBusca) inicializarEventosBusca();
        if (inputBusca) {
            inputBusca.value = '';
            inputBusca.focus();
            inputBusca.placeholder = placeholderBusca(buscaTipoSelect ? buscaTipoSelect.value : 'todos');
        }
        todosResultadosBusca = [];
        if (contadorBusca) contadorBusca.textContent = '⏳ ...';
        const editorArea = document.getElementById('busca-editor-area');
        if (editorArea) { editorArea.style.display = 'none'; editorArea.innerHTML = ''; }
        if (buscaResultados) {
            buscaResultados.style.display = 'flex';
            buscaResultados.innerHTML = '<div style="text-align:center; padding:40px; color:#999;">🔎 Digite algo para iniciar a busca</div>';
        }
        carregarTotalCartoesBusca();
    }, 100);
}

async function carregarTotalCartoesBusca() { if (!contadorBusca) return; contadorBusca.textContent = '⏳ ...'; try { const resp=await fetchFromGS('contarCartoesPendentes'); if(resp && resp.success) contadorBusca.textContent=`📦 ${resp.total} pendentes`; else { contadorBusca.textContent='⚠️ Erro'; console.error(resp); } } catch(erro){ console.error(erro); contadorBusca.textContent='⚠️ Erro'; } }

async function executarBusca() {
    if (!inputBusca) { inputBusca = document.getElementById('busca-input'); if (!inputBusca) return; }
    const termo = inputBusca.value.trim();
    const tipo = buscaTipoSelect ? buscaTipoSelect.value : 'todos';
    if (!termo) { limparBusca(false); return; }
    if (termo.length < minimoCaracteresBusca(tipo)) {
        if (buscaResultados) buscaResultados.innerHTML = `<div style="text-align:center; padding:30px; color:#888;">Digite pelo menos ${minimoCaracteresBusca(tipo)} caractere(s).</div>`;
        return;
    }

    const chaveMemoria = chaveBuscaMemoria(tipo, termo);
    const respostaMemoria = obterBuscaMemoria(chaveMemoria);
    if (respostaMemoria) {
        buscaUltimaConsulta = { tipo, termo, resposta: respostaMemoria };
        processarResultados(respostaMemoria);
        return;
    }

    const respostaRefinada = refinarBuscaAnterior(tipo, termo);
    if (respostaRefinada) {
        salvarBuscaMemoria(chaveMemoria, respostaRefinada);
        buscaUltimaConsulta = { tipo, termo, resposta: respostaRefinada };
        processarResultados(respostaRefinada);
        return;
    }

    if (buscaRequestController) buscaRequestController.abort();
    const controllerAtual = new AbortController();
    buscaRequestController = controllerAtual;
    const sequenciaAtual = ++buscaSequencia;
    if (buscaResultados) { buscaResultados.style.display = 'flex'; buscaResultados.innerHTML = '<div style="text-align:center; padding:30px; color:#888;">⏳ Buscando...</div>'; }
    const params = { termo, campo: tipo };
    try {
        const resultado = await fetchFromGS('pesquisarCartoes', params, controllerAtual.signal);
        if (sequenciaAtual !== buscaSequencia) return;
        if (!resultado || resultado.error) throw new Error(resultado?.error || 'Resposta inválida do servidor');
        salvarBuscaMemoria(chaveMemoria, resultado);
        buscaUltimaConsulta = { tipo, termo, resposta: resultado };
        processarResultados(resultado);
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error(e);
        if (buscaResultados) buscaResultados.innerHTML = '<div style="text-align:center; padding:30px; color:#d32f2f;">❌ Erro na busca. Tente novamente.</div>';
    } finally {
        if (buscaRequestController === controllerAtual) buscaRequestController = null;
    }
}

function processarResultados(resposta) {
    todosResultadosBusca = Array.isArray(resposta?.resultados) ? resposta.resultados : [];
    buscaContagemEnderecos = new Map();
    todosResultadosBusca.forEach(item => {
        const chave = normalizarEndereco(item.endereco);
        if (chave) buscaContagemEnderecos.set(chave, (buscaContagemEnderecos.get(chave) || 0) + 1);
    });
    todosResultadosBusca.forEach(item => {
        const chave = normalizarEndereco(item.endereco);
        const totalServidor = Number(item.qtdEndereco || 0);
        if (chave && totalServidor > (buscaContagemEnderecos.get(chave) || 0)) {
            buscaContagemEnderecos.set(chave, totalServidor);
        }
    });
    if (contadorBusca) {
        const limitado = resposta?.completo === false ? ` · mostrando ${todosResultadosBusca.length}` : '';
        contadorBusca.textContent = `📦 ${Number(resposta?.total || 0)} encontrado(s)${limitado}`;
    }
    renderizarResultados();
}

function renderizarResultados() {
    if (!buscaResultados) buscaResultados = document.getElementById('busca-resultados');
    if (!buscaResultados) return;
    const exibir = [...todosResultadosBusca];
    exibir.sort((a, b) => {
        const parseDate = (str) => { if (!str) return 0; let d = new Date(str); if (!isNaN(d.getTime())) return d.getTime(); const p = String(str).split('/'); if (p.length === 3) { d = new Date(p[2], p[1] - 1, p[0]); if (!isNaN(d.getTime())) return d.getTime(); } return 0; };
        return Number(b.score || 0) - Number(a.score || 0) || parseDate(b.data) - parseDate(a.data) || Number(b.linha) - Number(a.linha);
    });
    if (!exibir.length) { buscaResultados.innerHTML = '<div style="text-align:center; padding:25px; color:#999;">Nenhum pendente encontrado.</div>'; return; }
    let html = '';
    exibir.forEach(item => {
        const qtdEndereco = contarIguaisPorEndereco(item);
        const multiIcon = qtdEndereco > 1 ? `<span style="background:#e3f2fd; padding:2px 8px; border-radius:12px; margin-left:5px;">👥 ${qtdEndereco}</span>` : '';
        const statusClass = String(item.status || '').toUpperCase().trim() === 'BLOQUEADO' ? 'bloqueado' : '';
        const seloRecente = ehDataRecenteBusca(item.data) ? '<div class="selo-container"><div class="selo">RECENTE</div></div>' : '';
        html += `
            <div class="card" onclick="abrirEditorBuscaRapido(${Number(item.linha)})">
                <span class="numero">${escapeHtml(item.numero || '-')}</span>
                <span class="nome" title="${escapeHtml(item.nome || '')}">${escapeHtml(item.nome || '')}</span>
                <div class="detalhes">
                    <span class="data-destaque">📅 ${escapeHtml(formatarDataBR(item.data))}</span>
                    ${seloRecente}
                    <span>📍 ${escapeHtml(item.endereco || 'SEM ENDEREÇO')} ${multiIcon}</span>
                    <span>📦 ${escapeHtml(item.tipo || '')}</span>
                    <span class="status-badge ${statusClass}">${escapeHtml(item.status || 'PENDENTE')}</span>
                </div>
            </div>`;
    });
    buscaResultados.innerHTML = html;
}

function limparBusca(recarregarTotal = true) {
    clearTimeout(debounceTimerBusca);
    if (buscaRequestController) { buscaRequestController.abort(); buscaRequestController = null; }
    buscaSequencia++;
    todosResultadosBusca = [];
    buscaContagemEnderecos = new Map();
    buscaUltimaConsulta = null;
    if (buscaResultados) buscaResultados.innerHTML = '<div style="text-align:center; padding:40px; color:#999;">Digite algo para buscar.</div>';
    if (contadorBusca && recarregarTotal) contadorBusca.textContent = '⏳ ...';
    const editorArea = document.getElementById('busca-editor-area');
    if (editorArea) { editorArea.style.display = 'none'; editorArea.innerHTML = ''; }
    if (recarregarTotal) carregarTotalCartoesBusca();
}

function normalizarEndereco(endereco) { return String(endereco || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
function contarIguaisPorEndereco(item) { return buscaContagemEnderecos.get(normalizarEndereco(item.endereco)) || 0; }
function ehDataRecenteBusca(valor) {
    if (!valor) return false;
    let data = new Date(valor);
    if (isNaN(data.getTime())) {
        const partes = String(valor).split('/');
        if (partes.length === 3) data = new Date(partes[2], partes[1] - 1, partes[0]);
    }
    if (isNaN(data.getTime())) return false;
    const dias = (Date.now() - data.getTime()) / 86400000;
    return dias >= 0 && dias <= 45;
}
function escapeHtml(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

// ============================================================
// ✨ EDITOR RÁPIDO PREMIUM COM BOTÃO VOLTAR, POSIÇÃO PISCANTE E NÚMERO GIGANTE
// ============================================================
function abrirEditorBuscaRapido(linha) {
    const item = todosResultadosBusca.find(it => Number(it.linha) === Number(linha));
    if (!item) return;
    const qtdMesmoEndereco = contarIguaisPorEndereco(item);
    const temOutros = qtdMesmoEndereco > 1;
    const numeroBloco = item.numero;
    const editorArea = document.getElementById('busca-editor-area');
    const resultadosDiv = document.getElementById('busca-resultados');
    if (!editorArea || !resultadosDiv) return;
    editorArea.style.display = 'block';
    resultadosDiv.style.display = 'none';

    editorArea.innerHTML = `
        <div id="editor-busca-${Number(linha)}">
            <div class="header-editor">
                <button class="btn-voltar" onclick="cancelarEdicaoBusca(${Number(linha)})">← Voltar</button>
                <h4 style="margin:0; flex:1; text-align:center;">✏️ Cartão Nº ${escapeHtml(item.numero || '-')} — ${escapeHtml(item.nome || '')}</h4>
                <span id="posicao-span-busca-${Number(linha)}" class="posicao-badge posicao-badge-piscante">📌 carregando...</span>
            </div>

            <div class="editor-grid">
                <div><label>Nome</label><input id="edit-nome-busca-${Number(linha)}" value="${escapeHtml(item.nome || '')}"></div>
                <div><label>📅 Data</label><input id="edit-data-busca-${Number(linha)}" value="${escapeHtml(formatarDataBR(item.data))}" placeholder="dd/mm/yyyy"></div>
            </div>

            <div class="editor-grid">
                <div class="editor-full"><label>🔢 NÚMERO DO CARTÃO (Identificação)</label><input id="edit-num-busca-${Number(linha)}" class="campo-numero" value="${escapeHtml(item.numero || '')}" readonly></div>
            </div>

            <div class="editor-grid">
                <div class="editor-full">
                    <label>📍 ENDEREÇO COMPLETO</label>
                    <input id="edit-end-busca-${Number(linha)}" value="${escapeHtml(item.endereco || '')}" style="${temOutros ? 'background:#fffbeb;border:2px solid #f59e0b;' : ''}">
                    ${temOutros ? `
                        <div class="alerta-duplicidade">
                            <span style="color:#b45309; font-weight:bold; display:flex; align-items:center; gap:8px;"><span style="font-size:1.2rem;">⚠️</span> Há ${qtdMesmoEndereco} cartões neste mesmo endereço!</span>
                            <div>
                                <button class="btn-sm" onclick="abrirListaMoradoresBusca(${Number(linha)})" style="background:#2563eb; color:white; border:none; padding:5px 14px; border-radius:30px; cursor:pointer;">👥 VER MORADORES</button>
                                <button class="btn-sm" onclick="abrirEdicaoMassivaBusca(${Number(linha)})" style="background:#ea580c; color:white; border:none; padding:5px 14px; border-radius:30px; cursor:pointer;">✏️ EDITAR TODOS</button>
                            </div>
                        </div>` : ''}
                </div>
            </div>

            <div class="editor-grid">
                <div><label>CPF</label><input id="edit-cpf-busca-${Number(linha)}" value="${escapeHtml(item.cpf || '')}"></div>
                <div><label>Entregue À</label><input id="edit-entrega-busca-${Number(linha)}" value="${escapeHtml(item.entregueA || '')}"></div>
            </div>

            <div class="editor-grid">
                <div><label>Telefone</label><input id="edit-tel-busca-${Number(linha)}" value="${escapeHtml(item.telefone || '')}"></div>
            </div>

            <div class="btn-actions">
                <button class="btn-salvar" onclick="salvarEdicaoBusca(${Number(linha)})">💾 Salvar</button>
                <button class="btn-entregue" onclick="confirmarEntregaBusca(${Number(linha)})">✅ ENTREGUE</button>
                <button class="btn-cancelar" onclick="cancelarEdicaoBusca(${Number(linha)})">Cancelar</button>
            </div>
        </div>`;

    if (numeroBloco) {
        fetchFromGS('obterPosicaoNoBlocoBackend', { numeroBloco, linhaAtual: Number(linha) })
            .then(result => {
                const span = document.getElementById(`posicao-span-busca-${Number(linha)}`);
                if (!span) return;
                if (result.success && result.posicao !== null) {
                    span.textContent = `📌 Posição: ${result.posicao} de ${result.total} (bloco ${numeroBloco})`;
                } else if (result.total === 0) {
                    span.textContent = `📌 Sem outros cartões no bloco ${numeroBloco}`;
                } else {
                    span.textContent = '📌 Posição: não disponível';
                }
            })
            .catch(() => {
                const span = document.getElementById(`posicao-span-busca-${Number(linha)}`);
                if (span) span.textContent = '📌 Erro ao carregar posição';
            });
    } else {
        const span = document.getElementById(`posicao-span-busca-${Number(linha)}`);
        if (span) span.textContent = '📌 Bloco não informado';
    }
}

function cancelarEdicaoBusca(linha) {
    const editorArea = document.getElementById('busca-editor-area');
    const resultadosDiv = document.getElementById('busca-resultados');
    if (editorArea) { editorArea.style.display = 'none'; editorArea.innerHTML = ''; }
    if (resultadosDiv) resultadosDiv.style.display = 'flex';
}

window.salvarEdicaoBusca = async function (linha) {
    const itemOriginal = todosResultadosBusca.find(it => Number(it.linha) === Number(linha)) || {};
    const get = id => document.getElementById(id)?.value;
    const dados = {
        nome: get(`edit-nome-busca-${Number(linha)}`) || itemOriginal.nome || '',
        data: get(`edit-data-busca-${Number(linha)}`) || itemOriginal.data || '',
        quantidade: itemOriginal.quantidade || 1,
        obs: itemOriginal.obs || '',
        tipo: itemOriginal.tipo || 'CARTÃO',
        status: itemOriginal.status || '',
        numero: get(`edit-num-busca-${Number(linha)}`) || itemOriginal.numero || '',
        endereco: get(`edit-end-busca-${Number(linha)}`) || itemOriginal.endereco || '',
        cpf: get(`edit-cpf-busca-${Number(linha)}`) || itemOriginal.cpf || '',
        entregueA: get(`edit-entrega-busca-${Number(linha)}`) || itemOriginal.entregueA || '',
        dataEntrega: itemOriginal.dataEntrega || '',
        telefone: get(`edit-tel-busca-${Number(linha)}`) || itemOriginal.telefone || ''
    };
    try {
        await postParaGoogleSheets('atualizarCartao', { linha, dados });
        alert('✅ Dados salvos com sucesso!');
        cancelarEdicaoBusca(linha);
        executarBusca();
    } catch (erro) {
        alert('❌ Erro ao salvar: ' + erro.message);
    }
};

window.confirmarEntregaBusca = function (linha) {
    const itemOriginal = todosResultadosBusca.find(item => Number(item.linha) === Number(linha));
    if (!itemOriginal) return;
    const nomeQuemRecebeu = prompt(`📦 PARA QUEM FOI ENTREGUE O CARTÃO DE ${itemOriginal.nome}?`);
    if (!nomeQuemRecebeu || nomeQuemRecebeu.trim() === '') { alert('Entrega cancelada.'); return; }
    const hoje = new Date();
    const dataFormatada = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
    const telRecebedor = prompt('📞 Qual o telefone de quem recebeu? (Opcional)', '');
    finalizarEntregaBusca(linha, nomeQuemRecebeu.trim(), dataFormatada, telRecebedor);
};

async function finalizarEntregaBusca(linha, nomeEntregueA, dataEntrega, telefoneAdicional) {
    const get = id => document.getElementById(id)?.value;
    const dados = {
        nome: get(`edit-nome-busca-${Number(linha)}`) || '',
        data: get(`edit-data-busca-${Number(linha)}`) || '',
        quantidade: 1,
        obs: '',
        tipo: 'CARTÃO',
        status: 'ENTREGUE',
        numero: get(`edit-num-busca-${Number(linha)}`) || '',
        endereco: get(`edit-end-busca-${Number(linha)}`) || '',
        cpf: get(`edit-cpf-busca-${Number(linha)}`) || '',
        entregueA: nomeEntregueA,
        dataEntrega: dataEntrega,
        telefone: (telefoneAdicional && telefoneAdicional.trim() !== '') ? telefoneAdicional.trim() : ''
    };
    try {
        await postParaGoogleSheets('atualizarCartao', { linha, dados });
        alert('✅ Cartão marcado como ENTREGUE com sucesso!');
        cancelarEdicaoBusca(linha);
        executarBusca();
    } catch (erro) {
        alert('❌ Erro: ' + erro.message);
    }
}

async function obterCartoesMesmoEnderecoBusca(enderecoOriginal) {
    const enderecoNorm = normalizarEndereco(enderecoOriginal);
    let cartoes = todosResultadosBusca.filter(item => normalizarEndereco(item.endereco) === enderecoNorm);
    const totalEsperado = cartoes.reduce((maior, item) => Math.max(maior, Number(item.qtdEndereco || 0)), cartoes.length);
    if (cartoes.length >= totalEsperado) return cartoes;
    try {
        const resposta = await fetchFromGS('pesquisarCartoes', { termo: enderecoOriginal, campo: 'endereco' });
        const completos = Array.isArray(resposta?.resultados) ? resposta.resultados : [];
        const exatos = completos.filter(item => normalizarEndereco(item.endereco) === enderecoNorm);
        if (exatos.length) cartoes = exatos;
    } catch (erro) {
        console.warn('Não foi possível carregar todos os moradores do endereço:', erro);
    }
    return cartoes;
}

async function abrirListaMoradoresBusca(linhaAtual) {
    const atual = todosResultadosBusca.find(item => Number(item.linha) === Number(linhaAtual));
    if (!atual) return;
    const enderecoOriginal = atual.endereco || '';
    const editorArea = document.getElementById('busca-editor-area');
    if (!editorArea) return;
    editorArea.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b;">⏳ Carregando moradores...</div>';
    const cartoes = await obterCartoesMesmoEnderecoBusca(enderecoOriginal);
    if (!cartoes.length) return;
    let listaHtml = '<ul style="list-style:none; padding:0; margin:10px 0; max-height:200px; overflow:auto;">';
    cartoes.forEach(cartao => {
        const isAtual = Number(cartao.linha) === Number(linhaAtual);
        listaHtml += `
            <li style="margin:4px 0; padding:6px; background:${isAtual ? '#e3f2fd' : '#f9f9f9'}; border-radius:6px; display:flex; justify-content:space-between;">
                <div><strong>${escapeHtml(cartao.nome)}</strong><br><small>📍 Nº ${escapeHtml(cartao.numero || '-')}</small></div>
                ${isAtual ? '<span style="font-size:12px; background:#2196f3; color:white; padding:2px 8px; border-radius:12px;">ATUAL</span>' : ''}
            </li>`;
    });
    listaHtml += '</ul>';
    editorArea.innerHTML = `
        <h4>👥 Moradores do endereço</h4>
        <p style="background:#e8f5e9; padding:6px; border-radius:6px;">📍 ${escapeHtml(enderecoOriginal)}</p>
        ${listaHtml}
        <button class="btn-cancelar" onclick="cancelarEdicaoBusca(${Number(linhaAtual)})">Fechar</button>`;
}

async function abrirEdicaoMassivaBusca(linhaAtual) {
    const atual = todosResultadosBusca.find(item => Number(item.linha) === Number(linhaAtual));
    if (!atual) return;
    const editorArea = document.getElementById('busca-editor-area');
    if (!editorArea) return;
    editorArea.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b;">⏳ Carregando cartões do endereço...</div>';
    const cartoes = await obterCartoesMesmoEnderecoBusca(atual.endereco || '');
    if (cartoes.length <= 1) {
        editorArea.innerHTML = `<div style="text-align:center;padding:30px;color:#64748b;">Nenhum outro cartão foi encontrado neste endereço.<br><button class="btn-voltar" style="margin:15px auto 0;" onclick="cancelarEdicaoBusca(${Number(linhaAtual)})">← Voltar</button></div>`;
        return;
    }
    const linhas = cartoes.map(it => Number(it.linha));
    const nomes = [...new Set(cartoes.map(it => it.nome))];
    editorArea.style.display = 'block';
    editorArea.innerHTML = `
        <div id="editorMassaBusca" class="editor-massa active">
            <h4>✏️ Edição Massiva (${linhas.length} cartões)</h4>
            <p>📍 ${escapeHtml(cartoes[0].endereco || '')} — ${escapeHtml(nomes.join(', '))}</p>
            <label>Status</label>
            <select id="massa-status-busca"><option value="">Manter atual</option><option value="ENTREGUE">ENTREGUE</option><option value="BLOQUEADO">BLOQUEADO</option></select>
            <label>Data Entrega</label><input id="massa-dataentrega-busca" placeholder="dd/mm/yyyy">
            <label>CPF</label><input id="massa-cpf-busca" placeholder="CPF para todos">
            <label>Entregue Á</label><input id="massa-entrega-busca" placeholder="Entregue Á para todos">
            <label>Telefone</label><input id="massa-telefone-busca" placeholder="Telefone para todos">
            <div style="display:flex; gap:8px; margin-top:12px;">
                <button class="btn-salvar" onclick='salvarEdicaoMassivaBusca(${JSON.stringify(linhas)})'>Salvar em todos</button>
                <button class="btn-cancelar" onclick="cancelarEdicaoBusca(${Number(linhaAtual)})">Cancelar</button>
            </div>
        </div>`;
}

async function salvarEdicaoMassivaBusca(linhas) {
    const dados = {};
    const status = document.getElementById('massa-status-busca')?.value;
    const dataEntrega = document.getElementById('massa-dataentrega-busca')?.value.trim();
    const cpf = document.getElementById('massa-cpf-busca')?.value.trim();
    const entregueA = document.getElementById('massa-entrega-busca')?.value.trim();
    const telefone = document.getElementById('massa-telefone-busca')?.value.trim();
    if (status) dados.status = status;
    if (dataEntrega) dados.dataEntrega = dataEntrega;
    if (cpf) dados.cpf = cpf;
    if (entregueA) dados.entregueA = entregueA;
    if (telefone) dados.telefone = telefone;
    try {
        await postParaGoogleSheets('atualizarMultiplosCartoes', { linhas, dados });
        alert('✅ Edição massiva salva com sucesso!');
        cancelarEdicaoBusca(linhas[0]);
        executarBusca();
    } catch (erro) {
        alert('Erro: ' + erro.message);
    }
}
