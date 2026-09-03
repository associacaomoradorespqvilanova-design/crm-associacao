// ============================================================
// CONFIGURA\u00C7\u00C3O DA API
// ============================================================
const URL_API_GS = "https://script.google.com/macros/s/AKfycbxUDLitWt06Ss9wROIZ8FNc5TQrH1VIX8vRMQkRAfPXZfMC-jL82qcQmhwrQz3NJhC4/exec";
const CRM_BACKEND_VERSAO = '20260902-1';

// ============================================================
// GET VIA JSONP
// ============================================================
function fetchFromGS(acao, params = {}, signal, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
        const callbackName = 'cb' + Date.now() + Math.random().toString(36).substr(2, 8);
        const urlParams = new URLSearchParams({ acao, callback: callbackName, ...params });
        const script = document.createElement('script');
        script.src = URL_API_GS + '?' + urlParams.toString();
        let finalizado = false;
        const descartarCallbackMaisTarde = () => {
            // O Apps Script pode responder depois do timeout. Mantem uma funcao
            // vazia temporariamente para a resposta tardia nao quebrar a pagina.
            window[callbackName] = () => {};
            setTimeout(() => { try { delete window[callbackName]; } catch (ignorar) {} }, 120000);
        };
        const encerrar = (erro, resposta) => {
            if (finalizado) return;
            finalizado = true;
            clearTimeout(timeout);
            if (document.body.contains(script)) document.body.removeChild(script);
            if (erro) { descartarCallbackMaisTarde(); reject(erro); }
            else { try { delete window[callbackName]; } catch (ignorar) {} resolve(resposta); }
        };
        const timeout = setTimeout(() => encerrar(new Error('O Google Apps Script demorou para responder.')), timeoutMs);
        window[callbackName] = res => encerrar(null, res);
        script.onerror = () => encerrar(new Error('Erro de rede'));
        document.body.appendChild(script);
        if(signal) signal.addEventListener('abort', () => encerrar(new DOMException('Abortado', 'AbortError')), { once: true });
    });
}

// ============================================================
// POST PARA GOOGLE SHEETS
// ============================================================
async function postParaGoogleSheets(acao, dados = {}) {
    const identificador = 'gs_post_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    const iframe = document.createElement('iframe');
    iframe.name = identificador;
    iframe.hidden = true;
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);
    // Aguarda o about:blank inicial antes de observar a resposta do Web App.
    await new Promise(resolve => setTimeout(resolve, 0));
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = URL_API_GS;
    form.target = identificador;
    form.hidden = true;
    const criarCampo = (nome, valor) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = nome;
        input.value = valor;
        form.appendChild(input);
    };
    criarCampo('acao', acao);
    criarCampo('dados', JSON.stringify(dados));
    document.body.appendChild(form);
    try {
        await new Promise((resolve, reject) => {
            let terminou = false;
            const finalizar = erro => {
                if (terminou) return;
                terminou = true;
                clearTimeout(timeout);
                erro ? reject(erro) : resolve();
            };
            const timeout = setTimeout(() => finalizar(new Error('O envio ao Google Apps Script excedeu 60 segundos.')), 60000);
            iframe.addEventListener('load', () => finalizar(), { once: true });
            form.submit();
        });
    } finally {
        form.remove();
        setTimeout(() => iframe.remove(), 1000);
    }
    // Qualquer grava\u00E7\u00E3o pode alterar os resultados; evita mostrar dados antigos.
    if (typeof buscaCacheMemoria !== 'undefined' && buscaCacheMemoria) buscaCacheMemoria.clear();
    if (typeof buscaUltimaConsulta !== 'undefined') buscaUltimaConsulta = null;
}

// ============================================================
// UTILIT\u00C1RIO DE DATA - PADR\u00C3O BRASILEIRO (dd/mm/yyyy)
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
// INICIALIZAÇÃO + SESSÃO COM EXPIRAÇÃO POR INATIVIDADE
// ============================================================
const CRM_INATIVIDADE_MAX_MS = 5 * 60 * 60 * 1000;
const CRM_CHAVE_USUARIO = 'crm_user';
const CRM_CHAVE_ULTIMA_ATIVIDADE = 'crm_last_activity';
let crmUltimoRegistroAtividade = 0;
let crmControleInatividadeLigado = false;

function obterUltimaAtividadeCRM_() {
    return Number(localStorage.getItem(CRM_CHAVE_ULTIMA_ATIVIDADE) || 0);
}

function sessaoCRMValida_() {
    const usuario = localStorage.getItem(CRM_CHAVE_USUARIO);
    const ultima = obterUltimaAtividadeCRM_();

    if (usuario !== 'admin' || !ultima) return false;
    return (Date.now() - ultima) < CRM_INATIVIDADE_MAX_MS;
}

function limparSessaoCRM_() {
    localStorage.removeItem(CRM_CHAVE_USUARIO);
    localStorage.removeItem(CRM_CHAVE_ULTIMA_ATIVIDADE);
}

function registrarAtividadeCRM_(forcar = false) {
    if (localStorage.getItem(CRM_CHAVE_USUARIO) !== 'admin') return;

    const agora = Date.now();
    if (!forcar && agora - crmUltimoRegistroAtividade < 30000) return;

    crmUltimoRegistroAtividade = agora;
    localStorage.setItem(CRM_CHAVE_ULTIMA_ATIVIDADE, String(agora));
}

function verificarInatividadeCRM_() {
    if (localStorage.getItem(CRM_CHAVE_USUARIO) !== 'admin') return false;

    const ultima = obterUltimaAtividadeCRM_();
    if (!ultima || Date.now() - ultima >= CRM_INATIVIDADE_MAX_MS) {
        logout('Sessão encerrada após 5 horas sem atividade.');
        return true;
    }

    return false;
}

function tratarAtividadeCRM_() {
    if (verificarInatividadeCRM_()) return;
    registrarAtividadeCRM_();
}

function inicializarControleInatividadeCRM() {
    if (crmControleInatividadeLigado) return;
    crmControleInatividadeLigado = true;

    ['pointerdown', 'keydown', 'touchstart', 'scroll', 'mousemove'].forEach(evento => {
        window.addEventListener(evento, tratarAtividadeCRM_, { passive: true });
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) tratarAtividadeCRM_();
    });

    setInterval(verificarInatividadeCRM_, 60000);
}

document.addEventListener('DOMContentLoaded', () => {
    inicializarControleInatividadeCRM();

    const savedUser = localStorage.getItem(CRM_CHAVE_USUARIO);
    if (savedUser === 'admin') {
        if (sessaoCRMValida_()) loginSuccess();
        else limparSessaoCRM_();
    }

    setInterval(() => {
        const dashboard = document.getElementById('dashboard-screen');
        if (dashboard && dashboard.style.display !== 'none') renderizarPendentesCestaHome();
    }, 45000);

    inicializarEventosBusca();
    inicializarBotaoWhatsapp();
    inicializarBotoesDocumentosAntigos();
    setTimeout(() => inicializarBotaoLembretesCRM(), 350);
});

function login() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const errorBox = document.getElementById('login-error');
    errorBox.style.display = 'none';

    if (user === 'admin' && pass === '123') {
        localStorage.setItem(CRM_CHAVE_USUARIO, 'admin');
        registrarAtividadeCRM_(true);
        loginSuccess();
    } else {
        errorBox.textContent = 'Usuário ou senha incorretos';
        errorBox.style.display = 'block';
    }
}

function loginSuccess() {
    try {
        registrarAtividadeCRM_(true);
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('dashboard-screen').style.display = 'block';
        updateClock();
        carregarDashboard();

        // Lembretes têm prioridade no início do CRM. Se não houver nenhum,
        // mantém o popup antigo da agenda.
        setTimeout(async () => {
            try {
                const abriuLembretes = await carregarLembretesCRM(true);
                if (!abriuLembretes) {
                    verificarProximaAgendaPopup();
                    setTimeout(() => {
                        try { fecharModal('modal-popup-login'); } catch(e) {}
                    }, 8000);
                }
            } catch (e) {
                console.error('Erro ao abrir lembretes:', e);
                try { verificarProximaAgendaPopup(); } catch (_) {}
            }
        }, 650);
    } catch (e) {
        console.error('Erro crítico no login:', e);
    }
}

function logout(motivo = '') {
    limparSessaoCRM_();

    const dashboard = document.getElementById('dashboard-screen');
    const loginScreen = document.getElementById('login-screen');
    if (dashboard) dashboard.style.display = 'none';
    if (loginScreen) loginScreen.style.display = 'block';

    const user = document.getElementById('username');
    const pass = document.getElementById('password');
    if (user) user.value = '';
    if (pass) pass.value = '';

    document.querySelectorAll('.modal-overlay.active').forEach(modal => modal.classList.remove('active'));
    const cvModal = document.getElementById('modal-compra-venda-crm');
    if (cvModal) cvModal.classList.remove('active');

    if (motivo) {
        const errorBox = document.getElementById('login-error');
        if (errorBox) {
            errorBox.textContent = motivo;
            errorBox.style.display = 'block';
        }
    }
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
    if (activeModal) fecharModal(activeModal.id);
    const comprovante = document.getElementById('modal-comprovante-print');
    if (comprovante && comprovante.style.display === 'flex') fecharComprovantePrint();
});

// ============================================================
// \uD83D\uDE80 CARREGAR DASHBOARD
// ============================================================
async function carregarDashboard() {
    try {
        // Timestamp evita qualquer reaproveitamento de resposta antiga no navegador/proxy.
        const dados = await fetchFromGS('carregarDashboard', { _: String(Date.now()) });
        state.dadosAgenda = dados.agenda || [];
        state.dadosCartoes = dados.cartoes || [];
        state.responsaveis = dados.responsaveis || [];

        renderizarAgendaComDados(state.dadosAgenda);
        renderizarCartoesComDados(state.dadosCartoes, state.responsaveis);
        renderizarPendentesCestaHome();
        
        if (dados.totalPendentes) {
            const contador = document.getElementById('busca-contador');
            if(contador) contador.textContent = `\uD83D\uDCE6 ${dados.totalPendentes.total} pendentes`;
        }
    } catch(e) {
        console.error("Erro ao carregar dashboard unificado:", e);
    }
}

// ============================================================
// \uD83D\uDCC5 AGENDA
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
                <button class="btn-edit" onclick="deletarItemAgenda(${item.id})" title="Excluir" style="color:#ff4757;">\uD83D\uDDD1\uFE0F</button>
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
        let html = `<p><strong>Voc\u00EA tem os seguintes compromissos agendados:</strong></p><ul style="list-style:none; padding:0; text-align:left; max-width:300px; margin:10px auto;">`;
        proximos.forEach(item => {
            const dataFormatada = formatarDataBR(item.data);
            let isUrgent = '';
            const dItem = new Date(item.data);
            dItem.setHours(0,0,0,0);
            const diffDays = Math.ceil((dItem - hoje)/(1000*60*60*24));
            if(diffDays === 0) isUrgent = ' \uD83D\uDD34 HOJE!';
            else if(diffDays === 1) isUrgent = ' \u26A0\uFE0F AMANH\u00C3!';
            
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

let cartoesFiltroResponsavel = 'TODOS';
let cartoesDadosAtuais = [];
let cartoesResponsaveisAtuais = [];
let cartoesDiaGerenciado = null;

// Interpreta datas do módulo CARTÕES SEM usar o padrão americano do JavaScript.
function interpretarDataCartao(valor) {
    if (!valor && valor !== 0) return null;

    const texto = String(valor).trim();
    if (!texto) return null;

    let match = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

    if (match) {
        const dia = Number(match[1]);
        const mes = Number(match[2]);
        const ano = Number(match[3]);
        const data = new Date(ano, mes - 1, dia, 12, 0, 0);

        if (
            data.getFullYear() === ano &&
            data.getMonth() === mes - 1 &&
            data.getDate() === dia
        ) {
            return {
                dia,
                mes,
                ano,
                chave: `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
                data
            };
        }

        return null;
    }

    match = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);

    if (match) {
        const ano = Number(match[1]);
        const mes = Number(match[2]);
        const dia = Number(match[3]);
        const data = new Date(ano, mes - 1, dia, 12, 0, 0);

        if (
            data.getFullYear() === ano &&
            data.getMonth() === mes - 1 &&
            data.getDate() === dia
        ) {
            return {
                dia,
                mes,
                ano,
                chave: `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
                data
            };
        }

        return null;
    }

    const fallback = new Date(texto);

    if (!isNaN(fallback.getTime())) {
        const dia = fallback.getDate();
        const mes = fallback.getMonth() + 1;
        const ano = fallback.getFullYear();

        return {
            dia,
            mes,
            ano,
            chave: `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
            data: new Date(ano, mes - 1, dia, 12, 0, 0)
        };
    }

    return null;
}

function formatarDataCartaoDiaMes(valor) {
    const info = interpretarDataCartao(valor);
    if (!info) return String(valor || '');

    return `${String(info.dia).padStart(2, '0')}/${String(info.mes).padStart(2, '0')}`;
}

function formatarDataCartaoCompleta(valor) {
    const info = interpretarDataCartao(valor);
    if (!info) return String(valor || '');

    return `${String(info.dia).padStart(2, '0')}/${String(info.mes).padStart(2, '0')}/${info.ano}`;
}

function escapeAtributoCartoes(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function garantirControlesFiltroCartoes(nomes) {
    const thead = document.getElementById('cards-header');
    const tabela = thead?.closest('table');

    if (!tabela || !tabela.parentElement) return;

    let toolbar = document.getElementById('cartoes-filtro-colunas');

    if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.id = 'cartoes-filtro-colunas';
        toolbar.style.cssText = `
            display:flex;
            align-items:center;
            gap:6px;
            flex-wrap:wrap;
            margin:0 0 10px 0;
            padding:7px 8px;
            background:rgba(255,255,255,.55);
            border:1px solid rgba(74,124,46,.18);
            border-radius:10px;
            font-size:11px;
        `;

        tabela.parentElement.insertBefore(toolbar, tabela);
    }

    const nomesValidos = nomes || [];

    if (
        cartoesFiltroResponsavel !== 'TODOS' &&
        !nomesValidos.includes(cartoesFiltroResponsavel)
    ) {
        cartoesFiltroResponsavel = 'TODOS';
    }

    toolbar.innerHTML = '';

    const label = document.createElement('span');
    label.textContent = 'Mostrar:';
    label.style.cssText = 'font-weight:800;color:#52645a;margin-right:2px;';
    toolbar.appendChild(label);

    const criarBotao = (texto, valor) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = texto;

        const ativo = cartoesFiltroResponsavel === valor;

        btn.style.cssText = `
            border:1px solid ${ativo ? '#4a7c2e' : '#b8cdbd'};
            background:${ativo ? '#4a7c2e' : '#fff'};
            color:${ativo ? '#fff' : '#38633f'};
            border-radius:999px;
            padding:5px 9px;
            font-size:10px;
            font-weight:800;
            cursor:pointer;
        `;

        btn.addEventListener('click', () => {
            cartoesFiltroResponsavel = valor;

            renderizarCartoesComDados(
                cartoesDadosAtuais,
                cartoesResponsaveisAtuais
            );
        });

        toolbar.appendChild(btn);
    };

    criarBotao('TODOS', 'TODOS');

    nomesValidos.forEach(nome => {
        criarBotao(String(nome).toUpperCase(), nome);
    });
}

function garantirModalGerenciarLinhasCartoes() {
    let modal = document.getElementById('modal-gerenciar-linhas-cartoes');

    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'modal-gerenciar-linhas-cartoes';

    modal.style.cssText = `
        position:fixed;
        inset:0;
        z-index:1000000;
        background:rgba(15,25,20,.58);
        display:none;
        align-items:center;
        justify-content:center;
        padding:14px;
    `;

    modal.innerHTML = `
        <div style="
            width:min(680px, 96vw);
            max-height:88vh;
            overflow:auto;
            background:#fff;
            border-radius:18px;
            box-shadow:0 20px 60px rgba(0,0,0,.28);
        ">
            <div style="
                position:sticky;
                top:0;
                z-index:2;
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:10px;
                padding:14px 16px;
                background:#edf6ef;
                border-bottom:1px solid #d8e8dc;
            ">
                <div>
                    <div style="font-weight:900;color:#2f6d37;">✏️ GERENCIAR CARTÕES</div>
                    <div id="ger-cartoes-subtitulo" style="font-size:11px;color:#708177;margin-top:2px;"></div>
                </div>

                <button
                    type="button"
                    onclick="fecharGerenciadorLinhasCartoes()"
                    style="
                        border:0;
                        background:transparent;
                        font-size:24px;
                        cursor:pointer;
                        color:#52645a;
                    "
                >×</button>
            </div>

            <div id="ger-cartoes-lista" style="padding:12px;"></div>
        </div>
    `;

    modal.addEventListener('click', e => {
        if (e.target === modal) fecharGerenciadorLinhasCartoes();
    });

    document.body.appendChild(modal);
    return modal;
}

function fecharGerenciadorLinhasCartoes() {
    const modal = document.getElementById('modal-gerenciar-linhas-cartoes');

    if (modal) {
        modal.style.display = 'none';
    }

    cartoesDiaGerenciado = null;
}

function gerenciarLinhasCartao(dataChave) {
    cartoesDiaGerenciado = dataChave;

    const modal = garantirModalGerenciarLinhasCartoes();
    const lista = document.getElementById('ger-cartoes-lista');
    const subtitulo = document.getElementById('ger-cartoes-subtitulo');

    if (!modal || !lista) return;

    const info = interpretarDataCartao(dataChave);

    if (subtitulo) {
        subtitulo.textContent = info
            ? `Registros de ${String(info.dia).padStart(2, '0')}/${String(info.mes).padStart(2, '0')}/${info.ano}`
            : dataChave;
    }

    let itens = (cartoesDadosAtuais || []).filter(item => {
        const d = interpretarDataCartao(item.data);
        return d && d.chave === dataChave;
    });

    // Se o usuário escolheu "somente Cezar" ou "somente Walter",
    // o gerenciador acompanha o mesmo filtro.
    if (cartoesFiltroResponsavel !== 'TODOS') {
        itens = itens.filter(
            item => String(item.responsavel || '') === cartoesFiltroResponsavel
        );
    }

    if (!itens.length) {
        lista.innerHTML = `
            <div style="padding:24px;text-align:center;color:#718078;">
                Nenhuma linha encontrada para este filtro.
            </div>
        `;

        modal.style.display = 'flex';
        return;
    }

    lista.innerHTML = itens.map(item => {
        const data = formatarDataCartaoCompleta(item.data);

        return `
            <div style="
                display:grid;
                grid-template-columns:minmax(140px,1fr) 90px 110px auto;
                gap:8px;
                align-items:center;
                border:1px solid #e1ebe4;
                border-radius:12px;
                padding:10px;
                margin-bottom:8px;
                background:#fbfdfb;
            ">
                <div>
                    <div style="font-weight:900;color:#2f5136;">
                        ${escapeHtml(String(item.responsavel || ''))}
                    </div>
                    <div style="font-size:10px;color:#839087;margin-top:2px;">
                        ID ${escapeHtml(String(item.id || ''))}
                    </div>
                </div>

                <div>
                    <div style="font-size:10px;color:#819087;">QUANTIDADE</div>
                    <div style="font-weight:900;">${Number(item.qtd) || 0}</div>
                </div>

                <div>
                    <div style="font-size:10px;color:#819087;">DATA</div>
                    <div style="font-weight:800;">${escapeHtml(data)}</div>
                </div>

                <div style="display:flex;gap:5px;justify-content:flex-end;">
                    <button
                        type="button"
                        onclick="editarLinhaCartaoCRM('${escapeAtributoCartoes(String(item.id || ''))}')"
                        title="Editar esta linha"
                        style="
                            border:1px solid #c8dccd;
                            background:#edf7ef;
                            color:#2f6d37;
                            border-radius:8px;
                            padding:7px 9px;
                            cursor:pointer;
                            font-weight:900;
                        "
                    >✏️</button>

                    <button
                        type="button"
                        onclick="deletarLinhaCartaoCRM('${escapeAtributoCartoes(String(item.id || ''))}')"
                        title="Excluir somente esta linha"
                        style="
                            border:1px solid #efc7c7;
                            background:#fff0f0;
                            color:#b22d2d;
                            border-radius:8px;
                            padding:7px 9px;
                            cursor:pointer;
                            font-weight:900;
                        "
                    >🗑️</button>
                </div>
            </div>
        `;
    }).join('');

    modal.style.display = 'flex';
}

async function deletarLinhaCartaoCRM(id) {
    const item = (cartoesDadosAtuais || []).find(
        registro => String(registro.id) === String(id)
    );

    if (!item) {
        alert('Registro não encontrado.');
        return;
    }

    const data = formatarDataCartaoCompleta(item.data);

    if (
        !confirm(
            `Excluir SOMENTE esta linha?\n\n` +
            `${item.responsavel}\n` +
            `Quantidade: ${item.qtd}\n` +
            `Data: ${data}`
        )
    ) {
        return;
    }

    try {
        await postParaGoogleSheets('deletarLinhaCartao', {
            id: String(id)
        });

        await carregarDashboard();

        // Atualiza o modal caso ainda existam outras linhas no dia.
        if (cartoesDiaGerenciado) {
            const dia = cartoesDiaGerenciado;
            gerenciarLinhasCartao(dia);
        }

    } catch (erro) {
        console.error('Erro ao excluir linha de cartão:', erro);
        alert(
            'Não foi possível excluir esta linha: ' +
            (erro.message || erro)
        );
    }
}

async function editarLinhaCartaoCRM(id) {
    const item = (cartoesDadosAtuais || []).find(
        registro => String(registro.id) === String(id)
    );

    if (!item) {
        alert('Registro não encontrado.');
        return;
    }

    const responsavelAtual = String(item.responsavel || '');
    const qtdAtual = Number(item.qtd) || 0;
    const dataAtual = formatarDataCartaoCompleta(item.data);

    const novoResponsavel = prompt(
        'Responsável:',
        responsavelAtual
    );

    if (novoResponsavel === null) return;

    const responsavel = novoResponsavel.trim();

    if (!responsavel) {
        alert('Responsável não pode ficar vazio.');
        return;
    }

    const novaQtdTexto = prompt(
        'Quantidade:',
        String(qtdAtual)
    );

    if (novaQtdTexto === null) return;

    const qtd = Number(novaQtdTexto);

    if (!Number.isFinite(qtd) || qtd <= 0) {
        alert('Quantidade inválida.');
        return;
    }

    const novaDataTexto = prompt(
        'Data (dd/mm/aaaa):',
        dataAtual
    );

    if (novaDataTexto === null) return;

    const infoNovaData = interpretarDataCartao(
        novaDataTexto.trim()
    );

    if (!infoNovaData) {
        alert('Data inválida. Use dd/mm/aaaa.');
        return;
    }

    try {
        await postParaGoogleSheets('editarLinhaCartao', {
            id: String(id),
            responsavel,
            qtd,
            data: infoNovaData.chave
        });

        const diaAnterior = cartoesDiaGerenciado;

        await carregarDashboard();

        // Se a data mudou, abre o novo dia; senão continua no mesmo.
        if (diaAnterior) {
            gerenciarLinhasCartao(infoNovaData.chave);
        }

    } catch (erro) {
        console.error('Erro ao editar linha de cartão:', erro);
        alert(
            'Não foi possível editar esta linha: ' +
            (erro.message || erro)
        );
    }
}

function renderizarCartoesComDados(dadosCartoes, dadosResponsaveis) {
    cartoesDadosAtuais = Array.isArray(dadosCartoes)
        ? dadosCartoes.map(item => ({ ...item }))
        : [];

    cartoesResponsaveisAtuais = Array.isArray(dadosResponsaveis)
        ? [...dadosResponsaveis]
        : [];

    const select = document.getElementById('card-responsavel');

    if (select) {
        select.innerHTML = '<option value="">Selecione um responsável</option>';

        cartoesResponsaveisAtuais.forEach(nome => {
            const nomeLimpo = String(nome)
                .replace(/^"|"$/g, '')
                .replace(/^'|'$/g, '');

            select.innerHTML += `<option value="${nomeLimpo}">${nomeLimpo}</option>`;
        });
    }

    const nomesOrdenados = cartoesResponsaveisAtuais.map(n =>
        String(n)
            .replace(/^"|"$/g, '')
            .replace(/^'|'$/g, '')
    );

    garantirControlesFiltroCartoes(nomesOrdenados);

    const nomesVisiveis =
        cartoesFiltroResponsavel === 'TODOS'
            ? nomesOrdenados
            : nomesOrdenados.filter(
                nome => nome === cartoesFiltroResponsavel
            );

    const thead = document.getElementById('cards-header');

    if (thead) {
        let headerHtml = '<tr><th>DATA</th>';

        if (nomesVisiveis.length > 0) {
            nomesVisiveis.forEach(nome => {
                headerHtml += `<th style="text-align:center;">${nome}</th>`;
            });
        } else {
            headerHtml += '<th style="text-align:center;">RESPONSÁVEIS</th>';
        }

        headerHtml += '<th style="text-align:center;">TOTAL DIA</th><th>AÇÕES</th></tr>';
        thead.innerHTML = headerHtml;
    }

    const tbody = document.getElementById('cards-list');

    if (!tbody) return;

    tbody.innerHTML = '';

    const totais = {};
    const agrupado = {};

    cartoesDadosAtuais.forEach(item => {
        const responsavel = String(item.responsavel || '');
        const qtd = Number(item.qtd) || 0;
        const infoData = interpretarDataCartao(item.data);

        if (!infoData) {
            console.warn('Data de cartão inválida ignorada:', item);
            return;
        }

        totais[responsavel] = (totais[responsavel] || 0) + qtd;

        if (!agrupado[infoData.chave]) {
            agrupado[infoData.chave] = {
                valores: {},
                linhas: []
            };
        }

        agrupado[infoData.chave].valores[responsavel] =
            (agrupado[infoData.chave].valores[responsavel] || 0) + qtd;

        agrupado[infoData.chave].linhas.push(item);
    });

    const diasOrdenados = Object.entries(agrupado).sort(
        (a, b) => a[0].localeCompare(b[0])
    );

    for (const [dataChave, grupo] of diasOrdenados) {
        const valores = grupo.valores;

        // Se está mostrando somente um responsável e neste dia ele não tem nada,
        // esconde a linha inteira.
        if (
            cartoesFiltroResponsavel !== 'TODOS' &&
            !(Number(valores[cartoesFiltroResponsavel]) > 0)
        ) {
            continue;
        }

        const tr = document.createElement('tr');
        const dataFormatada = formatarDataCartaoDiaMes(dataChave);

        let totalDia = 0;
        let colunasHtml = '';

        nomesVisiveis.forEach(nome => {
            const qtd = Number(valores[nome]) || 0;

            if (qtd > 0) {
                colunasHtml += `<td style="text-align:center;"><strong>${qtd}</strong></td>`;
            } else {
                colunasHtml += '<td style="text-align:center;color:#ccc;">-</td>';
            }

            totalDia += qtd;
        });

        tr.innerHTML = `
            <td>${dataFormatada}</td>
            ${colunasHtml}
            <td style="color:#4a7c2e;font-weight:700;text-align:center;">
                ${totalDia}
            </td>
            <td style="text-align:center;white-space:nowrap;">
                <button
                    type="button"
                    onclick="gerenciarLinhasCartao('${dataChave}')"
                    title="Editar ou excluir uma linha"
                    aria-label="Gerenciar linhas deste dia"
                    style="
                        border:0;
                        background:transparent;
                        color:#3f7447;
                        cursor:pointer;
                        font-size:16px;
                        line-height:1;
                        padding:4px 3px;
                    "
                >✏️</button>

                <button
                    type="button"
                    onclick="excluirDiaCartao('${dataChave}')"
                    title="Excluir TODOS os registros deste dia"
                    aria-label="Excluir todos os cartões deste dia"
                    style="
                        border:0;
                        background:transparent;
                        color:#d32f2f;
                        cursor:pointer;
                        font-size:16px;
                        line-height:1;
                        padding:4px 3px;
                    "
                >🗑️</button>
            </td>
        `;

        tbody.appendChild(tr);
    }

    if (tbody.children.length === 0) {
        const colspan = Math.max(4, nomesVisiveis.length + 3);

        tbody.innerHTML = `
            <tr>
                <td colspan="${colspan}" style="text-align:center;padding:20px;color:#76827a;">
                    Nenhum registro para este filtro.
                </td>
            </tr>
        `;
    }

    const totaisDiv = document.getElementById('totais-gerais');

    if (!totaisDiv) return;

    let htmlTotais = '';
    let totalGeral = 0;

    nomesVisiveis.forEach(nome => {
        const total = Number(totais[nome]) || 0;

        htmlTotais += `
            <span>
                Total ${nome}:
                <span style="font-weight:700;">${total}</span>
            </span>
        `;

        totalGeral += total;
    });

    if (nomesVisiveis.length > 0) {
        htmlTotais += `
            <span>
                Total Geral:
                <span style="font-weight:700;color:#4a7c2e;">${totalGeral}</span>
            </span>
        `;

        totaisDiv.innerHTML = htmlTotais;
        totaisDiv.style.display = 'flex';
    } else {
        totaisDiv.innerHTML = '';
        totaisDiv.style.display = 'none';
    }
}

// Exclui TODOS os registros do dia.
// Para excluir apenas uma linha, use o botão ✏️ e depois a lixeira da linha.
async function excluirDiaCartao(dataChave) {
    const infoData = interpretarDataCartao(dataChave);

    if (!infoData) {
        alert('Data inválida.');
        return;
    }

    const diaMes =
        `${String(infoData.dia).padStart(2, '0')}/${String(infoData.mes).padStart(2, '0')}`;

    if (
        !confirm(
            `ATENÇÃO: excluir TODOS os cartões registrados no dia ${diaMes}/${infoData.ano}?`
        )
    ) {
        return;
    }

    try {
        await postParaGoogleSheets('deletarDiaCartao', {
            data: infoData.chave
        });

        await carregarDashboard();

    } catch (erro) {
        console.error('Erro ao excluir cartões do dia:', erro);

        alert(
            'Não foi possível excluir os cartões deste dia: ' +
            (erro.message || erro)
        );
    }
}

async function excluirMesCartao(data) {
    return excluirDiaCartao(data);
}

async function salvarCartoes() {
    const responsavel = document.getElementById('card-responsavel').value;
    const qtd = parseInt(document.getElementById('card-qtd').value, 10);
    const data = document.getElementById('card-data').value;

    if (!responsavel || !qtd || !data) {
        alert('Preencha o Responsável, Quantidade e Data.');
        return;
    }

    try {
        await postParaGoogleSheets('salvarCartao', {
            id: Date.now(),
            responsavel,
            qtd,
            data
        });

        fecharModal('modal-cartoes');

        document.getElementById('card-qtd').value = '';
        document.getElementById('card-data').value = '';

        await carregarDashboard();

    } catch (erro) {
        console.error('Erro ao salvar cartões:', erro);

        alert(
            'Não foi possível salvar os cartões: ' +
            (erro.message || erro)
        );
    }
}

async function adicionarResponsavel() {
    const input = document.getElementById('novo-responsavel-input');
    let nome = input.value.trim();

    nome = nome
        .replace(/^"|"$/g, '')
        .replace(/^'|'$/g, '');

    if (!nome) {
        alert('Digite um nome.');
        return;
    }

    await postParaGoogleSheets('salvarResponsavel', nome);

    input.value = '';

    await carregarDashboard();
}

async function deletarResponsavel(nome) {
    if (!confirm(`Remover o responsável "${nome}" da lista?`)) {
        return;
    }

    await postParaGoogleSheets('deletarResponsavel', nome);

    await carregarDashboard();
}

// ============================================================
// ADC CART\u00D5ES (M\u00FAltiplas Entregas)
// ============================================================
let contadorEntregas = 0;
let cartoesLotePendente = null;
function abrirModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('active');
    if (id === 'modal-multiplas-entregas') {
        document.body.classList.add('cartoes-modal-open');
        const lista = document.getElementById('mult-lista-entregas');
        if (lista) {
            pararCameraCartoes();
            limparResultadoCartaoOCR();
            lista.innerHTML = '';
            contadorEntregas = 0;
            const primeira = adicionarEntrega();
            const data = document.getElementById('mult-data');
            if (data) data.value = new Date().toLocaleDateString('pt-BR');
            selecionarModoCadastroCartoes('manual', false);
            setTimeout(() => primeira?.querySelector('.nome-input')?.focus(), 200);
        }
    }
    if (id === 'modal-busca') prepararModalBusca();

    // O formulário de currículo é grande. Ele precisa ter a própria área
    // de rolagem para funcionar tanto no computador quanto no celular.
    if (id === 'modal-curriculo') {
        prepararModalCurriculoResponsivo();
    }
}

function adicionarEntrega(dadosIniciais = {}) {
    const lista = document.getElementById('mult-lista-entregas');
    if (!lista) return null;
    contadorEntregas++;
    const novaEntrega = document.createElement('div');
    novaEntrega.className = 'entrega-item';
    novaEntrega.dataset.index = String(contadorEntregas - 1);
    novaEntrega.innerHTML = `
        <div class="entrega-header">
            <div class="entrega-numero">${contadorEntregas}</div>
            <div class="entrega-header-actions">
                <button type="button" class="entrega-icon-btn btn-scan-entrega" onclick="abrirScannerCartoesParaLinha(this.closest('.entrega-item'))" title="Digitalizar neste cart\u00E3o" aria-label="Digitalizar este cart\u00E3o">\uD83D\uDCF7</button>
                <button type="button" class="entrega-icon-btn entrega-delete-btn" onclick="removerEntrega(this)" title="Remover esta linha" aria-label="Remover este cart\u00E3o"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>
        <div class="entrega-fields">
            <div class="entrega-field"><label>Nome</label><input type="text" class="nome-input" placeholder="Nome completo" autocomplete="name"></div>
            <div class="entrega-field"><label>Endere\u00E7o</label><input type="text" class="endereco-input" placeholder="Rua e n\u00FAmero" autocomplete="street-address"></div>
        </div>`;
    lista.appendChild(novaEntrega);
    const nomeInp = novaEntrega.querySelector('.nome-input');
    const endInp = novaEntrega.querySelector('.endereco-input');
    if (nomeInp) nomeInp.value = String(dadosIniciais.nome || '').toUpperCase();
    if (endInp) endInp.value = String(dadosIniciais.endereco || '').toUpperCase();
    nomeInp?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            this.closest('.entrega-item')?.querySelector('.endereco-input')?.focus();
        }
    });
    endInp?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            const enderecos = [...document.querySelectorAll('#mult-lista-entregas .endereco-input')];
            const index = enderecos.indexOf(this);
            if (index === enderecos.length - 1) adicionarEntrega()?.querySelector('.nome-input')?.focus();
            else document.querySelectorAll('#mult-lista-entregas .nome-input')[index + 1]?.focus();
        }
    });
    atualizarContador();
    if (contadorEntregas === 1 && nomeInp) nomeInp.focus();
    return novaEntrega;
}

function removerEntrega(botao) {
    const entregaItem = botao.closest('.entrega-item');
    if (contadorEntregas <= 1) { alert('\u00C9 necess\u00E1rio pelo menos uma entrega!'); return; }
    if (entregaItem === cartoesScannerAlvo) cartoesScannerAlvo = null;
    entregaItem?.remove();
    contadorEntregas--;
    document.querySelectorAll('#mult-lista-entregas .entrega-item').forEach((item, idx) => {
        item.dataset.index = String(idx);
        const numero = item.querySelector('.entrega-numero');
        if (numero) numero.textContent = String(idx + 1);
    });
    atualizarContador();
    atualizarAlvoScannerCartoes();
}

function atualizarContador() { const contador = document.getElementById('mult-contador'); if(!contador) return; contador.textContent = `${contadorEntregas} ${contadorEntregas===1?'entrega':'entregas'}`; }

function validarCampos() { let valido = true; const qtd = document.getElementById('mult-qtd').value; const tipo = document.getElementById('mult-tipo').value; const numero = document.getElementById('mult-numero').value; if(!qtd||!tipo||!numero){alert("Preencha todos os campos: Quantidade, Tipo e N\u00B0.");valido=false;} const nomes = document.querySelectorAll('#mult-lista-entregas .nome-input'); const enderecos = document.querySelectorAll('#mult-lista-entregas .endereco-input'); nomes.forEach((nome, index) => { if(!nome.value.trim()||!enderecos[index].value.trim()){nome.style.borderColor='#e53935';enderecos[index].style.borderColor='#e53935';valido=false;} else {nome.style.borderColor='#ddd';enderecos[index].style.borderColor='#ddd';} }); return valido; }

function coletarDadosParaEnvio() { const dadosComuns = { quantidade: document.getElementById('mult-qtd').value, data: document.getElementById('mult-data').value, tipo: document.getElementById('mult-tipo').value, obs: document.getElementById('mult-obs').value.toUpperCase(), numero: document.getElementById('mult-numero').value }; const entregas = []; const nomes = document.querySelectorAll('#mult-lista-entregas .nome-input'); const enderecos = document.querySelectorAll('#mult-lista-entregas .endereco-input'); nomes.forEach((nome, index) => { const nomeValor = nome.value.trim().toUpperCase(); const enderecoValor = enderecos[index].value.trim().toUpperCase(); if(nomeValor&&enderecoValor) entregas.push({ nome: nomeValor, endereco: enderecoValor, quantidade: dadosComuns.quantidade, data: dadosComuns.data, tipo: dadosComuns.tipo, obs: dadosComuns.obs, numero: dadosComuns.numero }); }); return entregas; }

function limparCamposNomeEndereco() { document.querySelectorAll('#mult-lista-entregas .nome-input').forEach(n => { n.value=''; n.style.borderColor='#ddd'; }); document.querySelectorAll('#mult-lista-entregas .endereco-input').forEach(e => { e.value=''; e.style.borderColor='#ddd'; }); }

function criarIdLoteEntregas() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `LOTE-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function aguardarCartoes(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function confirmarGravacaoLoteEntregas(loteId, totalEsperado) {
    let ultimaResposta = null;
    for (let tentativa = 1; tentativa <= 6; tentativa++) {
        await aguardarCartoes(tentativa === 1 ? 900 : 1400);
        try {
            ultimaResposta = await fetchFromGS('confirmarLoteCartoesEntrega', {
                loteId,
                esperado: String(totalEsperado),
                _: String(Date.now())
            });
            if (ultimaResposta?.success && Number(ultimaResposta.total) === Number(totalEsperado)) return ultimaResposta;
            if (ultimaResposta?.success === false && ultimaResposta?.definitivo) break;
        } catch (erro) {
            console.warn(`Tentativa ${tentativa} de confirmar o lote falhou:`, erro);
        }
    }
    const detalhe = ultimaResposta?.message || ultimaResposta?.error || 'O servidor n\u00E3o confirmou a grava\u00E7\u00E3o. Atualize a implanta\u00E7\u00E3o do Google Apps Script.';
    throw new Error(`${detalhe} Os campos foram mantidos para voc\u00EA tentar novamente.`);
}

async function enviarTodasEntregas() {
    if (!validarCampos()) return;
    const entregas = coletarDadosParaEnvio();
    if (entregas.length === 0) {
        alert('Adicione pelo menos uma entrega v\u00E1lida!');
        return;
    }
    const btnEnviar = document.getElementById('btnEnviarMulti');
    if (!btnEnviar) return;
    const conteudoOriginal = btnEnviar.innerHTML;
    const statusDiv = document.getElementById('mult-status-message');
    btnEnviar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    btnEnviar.disabled = true;
    if (statusDiv) statusDiv.style.display = 'none';
    try {
        const backend = await fetchFromGS('statusBackendCRM', { _: String(Date.now()) }, undefined, 25000);
        if (backend?.versao !== CRM_BACKEND_VERSAO) {
            throw new Error('O Google Apps Script publicado ainda esta na versao antiga. Crie uma NOVA VERSAO em Gerenciar implantacoes antes de enviar.');
        }
        const assinatura = JSON.stringify(entregas);
        const loteId = cartoesLotePendente?.assinatura === assinatura
            ? cartoesLotePendente.loteId
            : criarIdLoteEntregas();
        cartoesLotePendente = { loteId, assinatura };
        await postParaGoogleSheets('salvarLoteCartoesEntrega', { loteId, entregas });
        const confirmacao = await confirmarGravacaoLoteEntregas(loteId, entregas.length);
        if (statusDiv) {
            statusDiv.style.display = 'block';
            statusDiv.style.background = '#e8f5e9';
            statusDiv.style.color = '#2e7d32';
            statusDiv.style.border = '2px solid #a5d6a7';
            statusDiv.innerText = `\u2705 ${confirmacao.total} registro(s) confirmados na aba ENTREGAS!`;
        }
        cartoesLotePendente = null;
        limparCamposNomeEndereco();
        document.querySelector('#mult-lista-entregas .nome-input')?.focus();
    } catch (erro) {
        console.error('Erro ao enviar cart\u00F5es:', erro);
        alert(`N\u00E3o foi poss\u00EDvel enviar os cart\u00F5es: ${erro.message || erro}`);
    } finally {
        btnEnviar.innerHTML = conteudoOriginal;
        btnEnviar.disabled = false;
    }
}

// ============================================================
// ADC CART\u00D5ES \u2014 CAMERA E OCR DO DESTINAT\u00C1RIO
// ============================================================
let cartoesScannerStream = null;
let cartoesScannerWorkerPromise = null;
let cartoesScannerAlvo = null;
let cartoesScannerProcessando = false;

function selecionarModoCadastroCartoes(modo, iniciarCamera = true) {
    const digitalizado = modo === 'digitalizado';
    const area = document.getElementById('cartoes-digitalizado-area');
    const ajuda = document.getElementById('cartoes-manual-ajuda');
    const tabManual = document.getElementById('cartoes-tab-manual');
    const tabDigital = document.getElementById('cartoes-tab-digitalizado');
    const dadosGerais = document.getElementById('cartoes-dados-gerais');
    const modalScroll = document.getElementById('cartoes-modal-scroll');
    if (area) area.style.display = digitalizado ? 'block' : 'none';
    if (ajuda) ajuda.style.display = digitalizado ? 'none' : 'block';
    tabManual?.classList.toggle('active', !digitalizado);
    tabDigital?.classList.toggle('active', digitalizado);
    tabManual?.setAttribute('aria-selected', String(!digitalizado));
    tabDigital?.setAttribute('aria-selected', String(digitalizado));
    if (window.matchMedia('(max-width: 600px)').matches && dadosGerais) {
        dadosGerais.open = !digitalizado;
    }
    if (digitalizado) {
        atualizarAlvoScannerCartoes();
        if (iniciarCamera) iniciarCameraCartoes();
    } else {
        pararCameraCartoes();
        document.querySelectorAll('.entrega-item.scanner-target').forEach(item => item.classList.remove('scanner-target'));
    }
    if (window.matchMedia('(max-width: 600px)').matches && modalScroll) {
        requestAnimationFrame(() => modalScroll.scrollTo({ top: 0, behavior: 'smooth' }));
    }
}

function abrirScannerCartoesParaLinha(item) {
    if (item) cartoesScannerAlvo = item;
    selecionarModoCadastroCartoes('digitalizado');
    atualizarAlvoScannerCartoes();
}

function obterAlvoScannerCartoes() {
    if (cartoesScannerAlvo?.isConnected) return cartoesScannerAlvo;
    const itens = [...document.querySelectorAll('#mult-lista-entregas .entrega-item')];
    cartoesScannerAlvo = itens.find(item => {
        const nome = item.querySelector('.nome-input')?.value.trim();
        const endereco = item.querySelector('.endereco-input')?.value.trim();
        return !nome && !endereco;
    }) || itens[itens.length - 1] || null;
    return cartoesScannerAlvo;
}

function atualizarAlvoScannerCartoes() {
    document.querySelectorAll('#mult-lista-entregas .entrega-item').forEach(item => item.classList.remove('scanner-target'));
    const alvo = obterAlvoScannerCartoes();
    alvo?.classList.add('scanner-target');
    const itens = [...document.querySelectorAll('#mult-lista-entregas .entrega-item')];
    const numero = alvo ? itens.indexOf(alvo) + 1 : 1;
    const badge = document.getElementById('cartoes-scanner-alvo');
    if (badge) badge.textContent = `Cart\u00E3o ${Math.max(numero, 1)}`;
}

function atualizarStatusScannerCartoes(mensagem, progresso) {
    const status = document.getElementById('cartoes-scanner-status');
    const barra = document.getElementById('cartoes-scanner-progress-bar');
    if (status && mensagem) status.textContent = mensagem;
    if (barra && Number.isFinite(progresso)) barra.style.width = `${Math.max(0, Math.min(100, progresso))}%`;
}

async function iniciarCameraCartoes() {
    const video = document.getElementById('cartoes-scanner-video');
    const semCamera = document.getElementById('cartoes-scanner-sem-camera');
    const capturar = document.getElementById('cartoes-btn-capturar');
    if (!video) return;
    if (cartoesScannerStream) {
        if (capturar) capturar.disabled = false;
        atualizarStatusScannerCartoes('C\u00E2mera pronta. Centralize apenas o nome e a rua dentro da moldura.', 0);
        return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
        if (semCamera) { semCamera.style.display = 'flex'; }
        atualizarStatusScannerCartoes('Este navegador n\u00E3o liberou a c\u00E2mera. Use \u201CEscolher foto\u201D.', 0);
        return;
    }
    try {
        atualizarStatusScannerCartoes('Solicitando acesso \u00E0 c\u00E2mera...', 0);
        cartoesScannerStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false
        });
        video.srcObject = cartoesScannerStream;
        await video.play();
        try {
            const track = cartoesScannerStream.getVideoTracks()[0];
            const capacidades = track?.getCapabilities?.() || {};
            const avancado = {};
            if (Array.isArray(capacidades.focusMode) && capacidades.focusMode.includes('continuous')) avancado.focusMode = 'continuous';
            if (Array.isArray(capacidades.exposureMode) && capacidades.exposureMode.includes('continuous')) avancado.exposureMode = 'continuous';
            if (Object.keys(avancado).length) await track.applyConstraints({ advanced: [avancado] });
        } catch (ignorar) {}
        if (semCamera) semCamera.style.display = 'none';
        if (capturar) capturar.disabled = false;
        atualizarStatusScannerCartoes('C\u00E2mera pronta. Evite reflexos e aproxime o bloco do destinat\u00E1rio.', 0);
    } catch (erro) {
        console.warn('C\u00E2mera n\u00E3o iniciada:', erro);
        cartoesScannerStream = null;
        if (semCamera) semCamera.style.display = 'flex';
        if (capturar) capturar.disabled = true;
        atualizarStatusScannerCartoes('N\u00E3o foi poss\u00EDvel abrir a c\u00E2mera. Autorize a permiss\u00E3o ou use \u201CEscolher foto\u201D.', 0);
    }
}

function pararCameraCartoes() {
    if (cartoesScannerStream) cartoesScannerStream.getTracks().forEach(track => track.stop());
    cartoesScannerStream = null;
    const video = document.getElementById('cartoes-scanner-video');
    if (video) video.srcObject = null;
    const capturar = document.getElementById('cartoes-btn-capturar');
    if (capturar) capturar.disabled = true;
}

function mensagemProgressoOCR(info) {
    const nomes = {
        'loading tesseract core': 'Carregando leitor de texto...',
        'initializing tesseract': 'Inicializando leitor...',
        'loading language traineddata': 'Carregando idioma portugu\u00EAs...',
        'initializing api': 'Preparando reconhecimento...',
        'recognizing text': 'Lendo nome e endere\u00E7o...'
    };
    atualizarStatusScannerCartoes(nomes[info.status] || 'Processando imagem...', Math.round(Number(info.progress || 0) * 100));
}

async function obterWorkerCartoesOCR() {
    if (typeof Tesseract === 'undefined') throw new Error('O leitor OCR n\u00E3o foi carregado. Verifique a internet e recarregue a p\u00E1gina.');
    if (!cartoesScannerWorkerPromise) {
        const oem = Tesseract.OEM?.LSTM_ONLY ?? 1;
        cartoesScannerWorkerPromise = Tesseract.createWorker('por', oem, { logger: mensagemProgressoOCR })
            .then(async worker => {
                await worker.setParameters({
                    tessedit_pageseg_mode: '6',
                    preserve_interword_spaces: '1'
                });
                return worker;
            })
            .catch(erro => {
                cartoesScannerWorkerPromise = null;
                throw erro;
            });
    }
    return cartoesScannerWorkerPromise;
}

function desenharFonteNoCanvasCartoes(fonte, recortarGuia) {
    const canvas = document.getElementById('cartoes-scanner-canvas');
    if (!canvas) throw new Error('\u00C1rea de captura n\u00E3o encontrada.');
    const larguraFonte = fonte.videoWidth || fonte.naturalWidth || fonte.width;
    const alturaFonte = fonte.videoHeight || fonte.naturalHeight || fonte.height;
    if (!larguraFonte || !alturaFonte) throw new Error('A imagem ainda n\u00E3o est\u00E1 pronta.');

    // Mantem o recorte simples que apresentou melhor resultado nos aparelhos reais.
    const sx = recortarGuia ? Math.round(larguraFonte * 0.08) : 0;
    const sy = recortarGuia ? Math.round(alturaFonte * 0.18) : 0;
    const sw = recortarGuia ? Math.round(larguraFonte * 0.84) : larguraFonte;
    const sh = recortarGuia ? Math.round(alturaFonte * 0.64) : alturaFonte;
    const escala = Math.min(2, 1800 / sw);
    canvas.width = Math.max(900, Math.round(sw * escala));
    canvas.height = Math.round(canvas.width * sh / sw);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(fonte, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    // Tons de cinza + contraste autom\u00E1tico: ajuda papel amarelo, branco e reflexos.
    const imagem = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imagem.data;
    const histograma = new Uint32Array(256);
    for (let i = 0; i < pixels.length; i += 4) {
        const cinza = Math.round(pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
        histograma[cinza]++;
    }
    const total = canvas.width * canvas.height;
    const margem = total * 0.015;
    let baixo = 0, alto = 255, soma = 0;
    for (let i = 0; i < 256; i++) { soma += histograma[i]; if (soma >= margem) { baixo = i; break; } }
    soma = 0;
    for (let i = 255; i >= 0; i--) { soma += histograma[i]; if (soma >= margem) { alto = i; break; } }
    const faixa = Math.max(30, alto - baixo);
    for (let i = 0; i < pixels.length; i += 4) {
        const cinza = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
        const ajustado = Math.max(0, Math.min(255, (cinza - baixo) * 255 / faixa));
        pixels[i] = pixels[i + 1] = pixels[i + 2] = ajustado;
    }
    ctx.putImageData(imagem, 0, 0);
    return canvas;
}

function linhaLimpaCartaoOCR(valor) {
    let linha = String(valor || '')
        .replace(/[|\[\]{}\u201C\u201D"']/g, ' ')
        .replace(/[^A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF0-9\u00BA\u00AA\u00B0.,/\-\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
    const palavras = linha.split(/\s+/).filter(Boolean);
    if (palavras.length >= 4 && palavras.length % 2 === 0) {
        const metade = palavras.length / 2;
        if (palavras.slice(0, metade).join(' ') === palavras.slice(metade).join(' ')) linha = palavras.slice(0, metade).join(' ');
    }
    return linha;
}

function semAcentoCartaoOCR(valor) {
    return linhaLimpaCartaoOCR(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function indiceInicioEnderecoOCR(valor) {
    const linha = semAcentoCartaoOCR(valor);
    const padrao = /(?:^|\s)(?:RUA\b|R(?:\.?\s+|[A-Z]{2,3}\s+)(?=[A-Z])|AVENIDA\b|AV\.?\s+(?=[A-Z])|TRAVESSA\b|TRAV\.?\s+(?=[A-Z])|TV\.?\s+(?=[A-Z])|ALAMEDA\b|ESTRADA\b|EST\.?\s+(?=[A-Z])|RODOVIA\b|ROD\.?\s+(?=[A-Z])|BECO\b|PRACA\b)/;
    const match = padrao.exec(linha);
    return match ? match.index + (match[0].startsWith(' ') ? 1 : 0) : -1;
}

function normalizarEnderecoDetectadoOCR(valor) {
    let linha = linhaLimpaCartaoOCR(valor);
    const inicio = indiceInicioEnderecoOCR(linha);
    if (inicio > 0) linha = linha.slice(inicio).trim();
    const repeticao = linha.slice(4).search(/\s(?:RUA\b|R(?:\.?\s+|[A-Z]{2,3}\s+)(?=[A-Z])|AVENIDA\b|AV\.?\s+(?=[A-Z])|TRAVESSA\b|ESTRADA\b)/i);
    if (repeticao >= 0) linha = linha.slice(0, repeticao + 4).trim();
    linha = linha.replace(/^RUA\s*/i, 'RUA ')
        .replace(/^R(?!UA)(?:\.?\s+|(?=[A-Z\u00C0-\u00D6\u00D8-\u00DE]{1,3}\s))/i, 'RUA ')
        .replace(/^AV\.?\s+/i, 'AVENIDA ')
        .replace(/^TRAV\.?\s+/i, 'TRAVESSA ')
        .replace(/^TV\.?\s+/i, 'TRAVESSA ')
        .replace(/([A-Z\u00C0-\u00D6\u00D8-\u00DE])(?=\d{1,5}\b)/g, '$1 ')
        .replace(/\s+[A-Z]$/i, '')
        .replace(/\s*,\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .trim();
    return linha;
}

function linhaPareceEnderecoOCR(valor) {
    return indiceInicioEnderecoOCR(valor) >= 0;
}

function normalizarNomeDetectadoOCR(valor) {
    let linha = linhaLimpaCartaoOCR(valor).replace(/^\d+\s+/, '');
    const palavrasOriginais = linha.split(/\s+/).filter(Boolean);
    const indicesNumericos = palavrasOriginais.map((p, i) => /\d/.test(p) ? i : -1).filter(i => i >= 0);
    if (indicesNumericos.length) {
        const primeiro = indicesNumericos[0];
        const ultimo = indicesNumericos[indicesNumericos.length - 1];
        const opcoes = [palavrasOriginais.slice(0, primeiro), palavrasOriginais.slice(ultimo + 1)]
            .map(p => p.join(' ').trim())
            .filter(p => p.split(/\s+/).length >= 2);
        const bloqueioCurto = /PROTOCOLO|ENCOMENDA|RASTREADA|STATUS|VISITA|CEP|DATA|HORA|LOCAL PARA|DESTINATARIO|REMETENTE/;
        linha = opcoes.find(p => !bloqueioCurto.test(semAcentoCartaoOCR(p))) || opcoes[0] || linha;
    }
    let palavras = linha.split(/\s+/).filter(Boolean);
    if (palavras.length >= 4 && palavras.length % 2 === 0) {
        const metade = palavras.length / 2;
        if (palavras.slice(0, metade).join(' ') === palavras.slice(metade).join(' ')) palavras = palavras.slice(0, metade);
    }
    const preposicoes = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS']);
    if (palavras.length >= 3 && palavras[0].length <= 2 && !preposicoes.has(palavras[0])) palavras.shift();
    while (palavras.length >= 3 && palavras[palavras.length - 1].length === 1) palavras.pop();
    return palavras.join(' ');
}

function linhaPareceNomeOCR(valor) {
    const linha = semAcentoCartaoOCR(normalizarNomeDetectadoOCR(valor));
    const original = semAcentoCartaoOCR(valor);
    if (linha.length < 6 || linha.length > 75 || /^[-.,]/.test(linha) || /\d/.test(linha) || linhaPareceEnderecoOCR(linha)) return false;
    const bloqueios = /DESTINATARIO|REMETENTE|PEQUENA ENCOMENDA|STATUS VISITA|NOME.*RECEBEDOR|ASSINATURA|PROTOCOLO|LOCAL PARA DEVOLUCAO|FLASH|COURIER|CEP\b|BAIRRO|DUQUE DE CAXIA(?:S)?|RIO DE JANEIRO|SAO PAULO|SAO BERNARDO|ENCOMENDA|RASTREADA|VISITA|AUSENTE|DATA\b|HORA\b|PARQUE\b|PQE\b|PRQ\b|JARDIM\b|JD\b|VILA\b|COOPERATIVA|\bRJ\b|\bSP\b/;
    const prefixoLocalidade = /^(?:JD|JARDIM|PQE|PRQ|PARQUE|VILA|BAIRRO)\b/;
    if (bloqueios.test(linha) || prefixoLocalidade.test(original) || linhaEhOpcaoStatusVisitaOCR(linha)) return false;
    const palavras = linha.split(/\s+/).filter(Boolean);
    if (palavras.length < 2 || palavras.length > 7) return false;
    const letras = (linha.match(/[A-Z]/g) || []).length;
    return letras / Math.max(1, linha.replace(/\s/g, '').length) > 0.72;
}

function linhaEhOpcaoStatusVisitaOCR(valor) {
    const linha = semAcentoCartaoOCR(valor);
    return /INSUFIC|NSUFIC|DESCONHEC|ESCONHEC|ESCONN|\bE?NAO\b|INEXIST|RECUSAD|FALECID|MUDOU|CEP ERRAD|AREA DE RISCO|DANIFIC|ZONA RURAL|STATUS VISITA/.test(linha);
}

function linhaPareceEnderecoComNumeroOCR(valor) {
    const linha = semAcentoCartaoOCR(valor);
    if (!linha || linhaEhOpcaoStatusVisitaOCR(linha) || /CEP\b|PROTOCOLO|N[O0]?\s*WO|DATA\b|VISITA|AUSENTE|TELEFONE|CPF|CNPJ/.test(linha)) return false;
    if (/DUQUE DE CAXIA(?:S)?|RIO DE JANEIRO|SAO PAULO|SAO BERNARDO/.test(linha)) return false;
    const temNumeroResidencial = /(?:^|\s)\d{1,5}[A-Z]?(?:\s|,|$)/.test(linha) || /[A-Z]\d{1,5}(?:\s|,|$)/.test(linha);
    const letras = (linha.match(/[A-Z]/g) || []).length;
    return temNumeroResidencial && letras >= 4;
}

function ehLimiteBlocoDestinatarioOCR(valor) {
    const linha = semAcentoCartaoOCR(valor);
    return /REMETENTE|STATUS VISITA|PEQUENA ENCOMENDA|LOCAL PARA DEVOLUCAO|NOME.*RECEBEDOR|ASSINATURA|PROTOCOLO/.test(linha);
}

function extrairDoBlocoDestinatarioOCR(linhas, simples, inicioRotulo) {
    const limiteMaximo = Math.min(linhas.length, inicioRotulo + 10);
    let fim = limiteMaximo;
    for (let i = inicioRotulo + 1; i < limiteMaximo; i++) {
        if (i > inicioRotulo + 1 && (ehLimiteBlocoDestinatarioOCR(linhas[i]) || simples[i].includes('DESTINATARIO'))) {
            fim = i;
            break;
        }
    }
    let indiceNome = -1;
    for (let i = inicioRotulo + 1; i < fim; i++) {
        if (linhaPareceNomeOCR(linhas[i])) { indiceNome = i; break; }
    }
    if (indiceNome < 0) return null;
    let indiceEndereco = -1;
    for (let i = indiceNome + 1; i < fim; i++) {
        if (linhaPareceEnderecoOCR(linhas[i]) || linhaPareceEnderecoComNumeroOCR(linhas[i])) {
            indiceEndereco = i;
            break;
        }
    }
    if (indiceEndereco < 0) return null;
    return {
        nome: normalizarNomeDetectadoOCR(linhas[indiceNome]),
        endereco: normalizarEnderecoDetectadoOCR(linhas[indiceEndereco]),
        pontuacao: 1000 - (indiceEndereco - indiceNome) * 10
    };
}

function extrairNomeEnderecoCartaoOCR(texto) {
    const linhas = String(texto || '').split(/\r?\n/).map(linhaLimpaCartaoOCR).filter(l => l.length >= 2);
    const simples = linhas.map(semAcentoCartaoOCR);
    let melhor = null;

    // Nos quatro modelos recebidos, o bloco correto comeca em DESTINATARIO.
    // Prioriza esse bloco e nunca atravessa REMETENTE/STATUS/PROTOCOLO.
    for (let i = 0; i < linhas.length; i++) {
        if (!simples[i].includes('DESTINATARIO')) continue;
        const candidato = extrairDoBlocoDestinatarioOCR(linhas, simples, i);
        if (candidato && (!melhor || candidato.pontuacao > melhor.pontuacao)) melhor = candidato;
    }

    if (!melhor) {
        for (let i = 0; i < linhas.length; i++) {
            if (!linhaPareceEnderecoOCR(linhas[i]) && !linhaPareceEnderecoComNumeroOCR(linhas[i])) continue;
            for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
                if (!linhaPareceNomeOCR(linhas[j])) continue;
                if (simples.slice(j + 1, i).some(ehLimiteBlocoDestinatarioOCR)) continue;
                const temRotulo = simples.slice(Math.max(0, j - 4), j + 1).some(l => l.includes('DESTINATARIO'));
                const distancia = i - j;
                const pontuacao = 220 - distancia * 14 + (temRotulo ? 120 : 0) + Math.min(30, linhas[j].split(/\s+/).length * 5);
                if (!melhor || pontuacao > melhor.pontuacao) melhor = { nome: normalizarNomeDetectadoOCR(linhas[j]), endereco: normalizarEnderecoDetectadoOCR(linhas[i]), pontuacao };
            }
        }
    }

    if (!melhor) {
        const indiceNome = linhas.findIndex(linhaPareceNomeOCR);
        const indiceEndereco = linhas.findIndex(l => linhaPareceEnderecoOCR(l) || linhaPareceEnderecoComNumeroOCR(l));
        melhor = {
            nome: indiceNome >= 0 ? normalizarNomeDetectadoOCR(linhas[indiceNome]) : '',
            endereco: indiceEndereco >= 0 ? normalizarEnderecoDetectadoOCR(linhas[indiceEndereco]) : '',
            pontuacao: 0
        };
    }
    return { nome: melhor.nome || '', endereco: melhor.endereco || '', linhas };
}

async function processarFonteCartaoOCR(fonte, recortarGuia) {
    if (cartoesScannerProcessando) return;
    cartoesScannerProcessando = true;
    const capturar = document.getElementById('cartoes-btn-capturar');
    if (capturar) capturar.disabled = true;
    const review = document.getElementById('cartoes-ocr-review');
    if (review) review.style.display = 'none';
    try {
        atualizarStatusScannerCartoes('Preparando a imagem...', 3);
        const canvas = desenharFonteNoCanvasCartoes(fonte, recortarGuia);
        const worker = await obterWorkerCartoesOCR();
        const resultado = await worker.recognize(canvas);
        const texto = resultado?.data?.text || '';
        const dados = extrairNomeEnderecoCartaoOCR(texto);
        const nome = document.getElementById('cartoes-ocr-nome');
        const endereco = document.getElementById('cartoes-ocr-endereco');
        const bruto = document.getElementById('cartoes-ocr-texto-bruto');
        if (nome) nome.value = dados.nome;
        if (endereco) endereco.value = dados.endereco;
        if (bruto) bruto.textContent = texto.trim() || '(nenhum texto reconhecido)';
        if (review) review.style.display = 'block';
        if (dados.nome && dados.endereco) atualizarStatusScannerCartoes('Leitura conclu\u00EDda. Confira principalmente o n\u00FAmero da rua.', 100);
        else atualizarStatusScannerCartoes('Leitura parcial. Corrija os campos ou aproxime mais o cart\u00E3o e tente novamente.', 100);
        nome?.focus();
    } catch (erro) {
        console.error('Erro no OCR:', erro);
        atualizarStatusScannerCartoes(`Erro na leitura: ${erro.message || erro}`, 0);
    } finally {
        cartoesScannerProcessando = false;
        if (capturar) capturar.disabled = !cartoesScannerStream;
    }
}

async function capturarCartaoParaOCR() {
    const video = document.getElementById('cartoes-scanner-video');
    if (!video || !cartoesScannerStream || video.readyState < 2) {
        alert('Inicie a c\u00E2mera e aguarde a imagem aparecer.');
        return;
    }
    await processarFonteCartaoOCR(video, true);
}

async function processarArquivoCartaoOCR(evento) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    try {
        let imagem;
        if ('createImageBitmap' in window) imagem = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
        else {
            imagem = await new Promise((resolve, reject) => {
                const img = new Image();
                const url = URL.createObjectURL(arquivo);
                img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
                img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('N\u00E3o foi poss\u00EDvel abrir a foto.')); };
                img.src = url;
            });
        }
        await processarFonteCartaoOCR(imagem, false);
        if (typeof imagem.close === 'function') imagem.close();
    } catch (erro) {
        console.error(erro);
        atualizarStatusScannerCartoes(`Erro ao abrir a foto: ${erro.message || erro}`, 0);
    } finally {
        evento.target.value = '';
    }
}

function limparResultadoCartaoOCR() {
    const review = document.getElementById('cartoes-ocr-review');
    if (review) review.style.display = 'none';
    const nome = document.getElementById('cartoes-ocr-nome');
    const endereco = document.getElementById('cartoes-ocr-endereco');
    const bruto = document.getElementById('cartoes-ocr-texto-bruto');
    if (nome) nome.value = '';
    if (endereco) endereco.value = '';
    if (bruto) bruto.textContent = '';
    atualizarStatusScannerCartoes(cartoesScannerStream ? 'Pronto para capturar o pr\u00F3ximo cart\u00E3o.' : 'Clique em \u201CIniciar c\u00E2mera\u201D.', 0);
}

function usarDadosCartaoOCR(adicionarProximo) {
    const nome = document.getElementById('cartoes-ocr-nome')?.value.trim().toUpperCase();
    const endereco = document.getElementById('cartoes-ocr-endereco')?.value.trim().toUpperCase();
    if (!nome || !endereco) {
        alert('Confira e preencha o nome e o endere\u00E7o antes de adicionar.');
        return;
    }
    const alvo = obterAlvoScannerCartoes();
    if (!alvo) return;
    const nomeInput = alvo.querySelector('.nome-input');
    const enderecoInput = alvo.querySelector('.endereco-input');
    if (nomeInput) nomeInput.value = nome;
    if (enderecoInput) enderecoInput.value = endereco;
    alvo.classList.remove('scanner-target');
    alvo.classList.add('scanner-filled');
    setTimeout(() => alvo.classList.remove('scanner-filled'), 900);

    if (adicionarProximo) {
        const itens = [...document.querySelectorAll('#mult-lista-entregas .entrega-item')];
        const indice = itens.indexOf(alvo);
        cartoesScannerAlvo = itens.slice(indice + 1).find(item => {
            return !item.querySelector('.nome-input')?.value.trim() && !item.querySelector('.endereco-input')?.value.trim();
        }) || adicionarEntrega();
        limparResultadoCartaoOCR();
        atualizarAlvoScannerCartoes();
        if (window.matchMedia('(max-width: 600px)').matches) {
            const modalScroll = document.getElementById('cartoes-modal-scroll');
            modalScroll?.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            cartoesScannerAlvo?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    } else {
        limparResultadoCartaoOCR();
        cartoesScannerAlvo = alvo;
        atualizarAlvoScannerCartoes();
        atualizarStatusScannerCartoes('Dados preenchidos. Voc\u00EA pode conferir na lista ou capturar novamente.', 0);
    }
}

window.addEventListener('beforeunload', () => {
    pararCameraCartoes();
    if (cartoesScannerWorkerPromise) cartoesScannerWorkerPromise.then(worker => worker.terminate()).catch(() => {});
});

// ============================================================
// CESTA B\u00C1SICA
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
async function salvarTiposCesta() { const input=document.getElementById('cesta-tipos-input'); if(!input)return; const tipos=input.value.trim().split(',').map(t=>t.trim().toUpperCase()).filter(t=>t); await postParaGoogleSheets('salvarTiposCesta',{tipos}); alert("\u2705 Tipos de cesta atualizados!"); await carregarTiposCesta(); fecharEditorTipos(); renderizarPendentesCestaHome(); }

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
            container.innerHTML = '<div style="color:#4a7c2e; font-weight:600; padding:10px;">\u2705 Todos os cadastros do m\u00EAs atual est\u00E3o em dia!</div>';
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
async function editarNomePendente(nomeAntigo,linha){const novoNome=prompt(`Digite o novo nome para "${nomeAntigo}":`,nomeAntigo);if(novoNome===null)return;if(novoNome.trim()===''){alert("O nome n\u00E3o pode estar vazio.");return;}await postParaGoogleSheets('editarNomeMoradorCesta',{linha,novoNome:novoNome.trim().toUpperCase()});alert("\u2705 Nome atualizado com sucesso!");await renderizarPendentesCestaHome();await carregarNomesCesta();}
async function deletarPendente(linha,nome){if(!confirm(`Tem certeza que deseja EXCLUIR permanentemente o cadastro de "${nome}"?`))return;await postParaGoogleSheets('deletarMoradorCesta',{linha});alert("\u2705 Cadastro exclu\u00EDdo com sucesso!");await renderizarPendentesCestaHome();await carregarNomesCesta();}
async function buscarEPreencherCesta(nome,isQRCode=false){try{const resp=await fetchFromGS('buscarMoradorCesta',{nome});if(!resp||!resp.dados){alert(isQRCode?"\u274C Morador n\u00E3o encontrado na planilha.":"\u274C Morador n\u00E3o encontrado.");return;}cestaState.currentLine=resp.linha;cestaState.currentDados=resp.dados;renderFormCesta(resp.dados);if(isQRCode){const confirmar=confirm(`Deseja marcar a cesta como ENTREGUE para ${nome} (com a data de hoje)?`);if(confirmar){const monthLabels=["JANEIRO","FEVEREIRO","MAR\u00C7O","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];const todayIndex=new Date().getMonth();const today=new Date();const dia=String(today.getDate()).padStart(2,'0');const mes=String(today.getMonth()+1).padStart(2,'0');const monthId=headerToId(monthLabels[todayIndex]);const monthField=document.getElementById(monthId);if(monthField){monthField.value=`${dia}/${mes}`;atualizarMesesUICesta();await salvarCestaAutomatico();alert("\u2705 Cesta entregue com sucesso!");}else alert("Erro ao encontrar o m\u00EAs atual para marcar.");}}}catch(e){console.error(e);alert(isQRCode?"Erro ao buscar os dados via QR Code.":"Erro ao buscar os dados.");}}
function renderFormCesta(dadosArray){
    const formArea = document.getElementById('cesta-formArea'); if(!formArea) return; formArea.style.display='block';
    const panelPendentes = document.getElementById('cesta-panelPendentes'); if(panelPendentes) panelPendentes.style.display='none';
    const fields = document.getElementById('cesta-fields'); if(!fields) return; fields.innerHTML='';
    const monthsContainer = document.getElementById('cesta-monthsContainer'); if(!monthsContainer) return; monthsContainer.innerHTML='';
    const tiposOptions=cestaState.types.map(t=>`<option value="${t}">${t}</option>`).join('');
    const monthLabels=["JANEIRO","FEVEREIRO","MAR\u00C7O","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
    dadosArray.forEach(item=>{const id=item.id;const label=item.label||id;const value=item.value||'';const isMonth=monthLabels.map(m=>normalizeString(m)).indexOf(normalizeString(label))!==-1;if(isMonth){const div=document.createElement('div');div.className='month';const inputMonth=document.createElement('input');inputMonth.className='monthField';inputMonth.id=id;inputMonth.value=value||'';inputMonth.readOnly=true;inputMonth.addEventListener('click',function(){const hoje=new Date();const diaStr=String(hoje.getDate()).padStart(2,'0');const mesStr=String(hoje.getMonth()+1).padStart(2,'0');if(confirm(`Marcar m\u00EAs ${label} como entregue hoje (${diaStr}/${mesStr})?`)){inputMonth.value=`${diaStr}/${mesStr}`;atualizarMesesUICesta();salvarCestaAutomatico();}});const lab=document.createElement('label');lab.textContent=label;div.appendChild(lab);div.appendChild(inputMonth);monthsContainer.appendChild(div);}else{const wrapper=document.createElement('div');if(label.trim().toUpperCase()==='TIPO'){wrapper.innerHTML=`<label>${label}</label><select class="field" id="${id}"><option value="">Selecione</option>${tiposOptions}</select>`;const select=wrapper.querySelector('select');select.value=value;}else{wrapper.innerHTML=`<label>${label}</label><input class="field" id="${id}">`;const input=wrapper.querySelector('input');input.value=value;}fields.appendChild(wrapper);}});atualizarMesesUICesta();
}
function atualizarMesesUICesta(){const months=document.querySelectorAll('#cesta-monthsContainer .month');let pagos=0;months.forEach(div=>{const inputEl=div.querySelector('input');if(!inputEl)return;inputEl.classList.remove('pago','pendente');let v=(inputEl.value||"").toString().trim();if(v&&!v.includes('/')&&!v.toUpperCase().includes('X')){const d=new Date(v);if(!isNaN(d.getTime())){const dia=String(d.getDate()).padStart(2,'0');const mes=String(d.getMonth()+1).padStart(2,'0');v=`${dia}/${mes}`;inputEl.value=v;}}if(!v)inputEl.value='X';if(/\d/.test(v)){inputEl.classList.add('pago');inputEl.style.background='#e6ffed';inputEl.style.color='#166534';pagos++;}else{inputEl.classList.add('pendente');inputEl.style.background='#fee2e2';inputEl.style.color='#9b2c2c';}});const stamp=document.getElementById('cesta-stamp');if(stamp)stamp.classList.toggle('show',pagos===12);const statusId=headerToId('STATUS');const statusInput=document.getElementById(statusId);if(statusInput){const todayIndex=new Date().getMonth();const monthLabels=["JANEIRO","FEVEREIRO","MAR\u00C7O","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];const monthId=headerToId(monthLabels[todayIndex]);const monthField=document.getElementById(monthId);const isPago=monthField&&monthField.classList.contains('pago');statusInput.value=isPago?'ENTREGUE':'PENDENTE';statusInput.style.backgroundColor=isPago?'#16a34a':'#dc2626';statusInput.style.color='#ffffff';statusInput.style.fontWeight='bold';}}
async function salvarCestaAutomatico(){if(!cestaState.currentLine)return;const inputs=document.querySelectorAll('#cesta-fields .field, #cesta-monthsContainer input');const payload={};inputs.forEach(inp=>{payload[inp.id]=inp.value;});await postParaGoogleSheets('salvarMoradorCesta',{linha:cestaState.currentLine,payload});renderizarPendentesCestaHome();}
const btnSaveCesta = document.getElementById('cesta-btnSave');
if(btnSaveCesta){
    btnSaveCesta.addEventListener('click',async()=>{if(!cestaState.currentLine){alert("Nenhum morador selecionado.");return;}const inputs=document.querySelectorAll('#cesta-fields .field, #cesta-monthsContainer input');const payload={};inputs.forEach(inp=>{payload[inp.id]=inp.value;});await postParaGoogleSheets('salvarMoradorCesta',{linha:cestaState.currentLine,payload});alert("\u2705 Dados salvos com sucesso!");atualizarMesesUICesta();renderizarPendentesCestaHome();});
}
async function gerarCarteirinha(){const nome=document.getElementById('cesta-search').value.trim();if(!nome){alert("Busque um morador antes de gerar a carteirinha.");return;}const qrContainer=document.getElementById('card-qrcode');if(!qrContainer)return;qrContainer.innerHTML='';document.getElementById('card-nome').innerText=nome;try{cestaState.qrCodeInstance=new QRCode(qrContainer,{text:nome,width:75,height:75,colorDark:"#4a7c2e",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.H});}catch(e){alert("Erro ao gerar QR Code");return;}setTimeout(async()=>{try{const cardDiv=document.getElementById('carteirinha-print-area');const canvas=await html2canvas(cardDiv,{scale:2});const{jsPDF}=window.jspdf;const pdf=new jsPDF('l','mm','a6');const imgData=canvas.toDataURL('image/jpeg',0.95);pdf.addImage(imgData,'JPEG',0,0,148,105);const pdfBlob=pdf.output('blob');window.open(URL.createObjectURL(pdfBlob),'_blank');}catch(error){console.error(error);alert("Erro ao gerar a imagem da carteirinha.");}},300);}


// ============================================================
// CURRÍCULO — RESPONSIVIDADE E ROLAGEM DO MODAL
// ============================================================
function prepararModalCurriculoResponsivo() {
    const modal = document.getElementById('modal-curriculo');
    if (!modal) return;

    // Injeta uma única vez. Usamos !important porque o modal já possui
    // estilos antigos no HTML que estavam bloqueando a rolagem.
    if (!document.getElementById('curriculo-responsive-fix')) {
        const style = document.createElement('style');
        style.id = 'curriculo-responsive-fix';
        style.textContent = `
            /* O overlay inteiro também pode rolar caso o conteúdo ultrapasse a tela */
            #modal-curriculo {
                box-sizing: border-box !important;
                overflow-y: auto !important;
                overflow-x: hidden !important;
                align-items: flex-start !important;
                justify-content: center !important;
                padding: 12px !important;
                height: 100vh !important;
                height: 100dvh !important;
                max-height: 100vh !important;
                max-height: 100dvh !important;
                overscroll-behavior: contain !important;
                -webkit-overflow-scrolling: touch !important;
            }

            /*
             * Compatível com os nomes de container mais comuns usados no CRM.
             * O :first-child garante a correção mesmo que o painel não tenha
             * uma classe específica.
             */
            #modal-curriculo > .modal-content,
            #modal-curriculo > .modal-box,
            #modal-curriculo > .modal-container,
            #modal-curriculo > div:first-child {
                box-sizing: border-box !important;
                width: min(820px, 100%) !important;
                max-width: 820px !important;
                max-height: calc(100dvh - 24px) !important;
                overflow-y: auto !important;
                overflow-x: hidden !important;
                margin: 0 auto !important;
                overscroll-behavior: contain !important;
                -webkit-overflow-scrolling: touch !important;
                scrollbar-gutter: stable;
            }

            /* Impede que algum campo estoure horizontalmente o modal */
            #modal-curriculo input,
            #modal-curriculo select,
            #modal-curriculo textarea {
                box-sizing: border-box !important;
                max-width: 100% !important;
            }

            #modal-curriculo input[type="file"] {
                width: 100% !important;
                min-width: 0 !important;
            }

            /* Conteúdos adicionados dinamicamente não podem bloquear a rolagem */
            #modal-curriculo #cursos-container,
            #modal-curriculo #exp-container {
                max-width: 100% !important;
                overflow: visible !important;
            }

            @media (max-width: 700px) {
                #modal-curriculo {
                    padding: 0 !important;
                    align-items: stretch !important;
                    width: 100vw !important;
                    height: 100dvh !important;
                    max-height: 100dvh !important;
                }

                #modal-curriculo > .modal-content,
                #modal-curriculo > .modal-box,
                #modal-curriculo > .modal-container,
                #modal-curriculo > div:first-child {
                    width: 100% !important;
                    max-width: none !important;
                    height: 100dvh !important;
                    max-height: 100dvh !important;
                    margin: 0 !important;
                    border-radius: 0 !important;
                    overflow-y: auto !important;
                    overflow-x: hidden !important;
                    padding-bottom: max(28px, env(safe-area-inset-bottom)) !important;
                }

                /* Campos que eram duas colunas passam para uma no celular */
                #modal-curriculo .grid-cv {
                    grid-template-columns: minmax(0, 1fr) !important;
                    gap: 10px !important;
                }

                #modal-curriculo .grid-cv.full {
                    display: grid !important;
                    grid-template-columns: minmax(0, 1fr) !important;
                }

                #modal-curriculo button {
                    max-width: 100% !important;
                }

                #modal-curriculo textarea {
                    resize: vertical !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Além do CSS, força as propriedades essenciais no elemento real.
    modal.style.overflowY = 'auto';
    modal.style.overflowX = 'hidden';
    modal.style.webkitOverflowScrolling = 'touch';

    const painel =
        modal.querySelector(':scope > .modal-content') ||
        modal.querySelector(':scope > .modal-box') ||
        modal.querySelector(':scope > .modal-container') ||
        modal.firstElementChild;

    if (painel) {
        painel.style.overflowY = 'auto';
        painel.style.overflowX = 'hidden';
        painel.style.webkitOverflowScrolling = 'touch';
        painel.scrollTop = 0;
    }

    // Ao abrir, começa sempre no topo.
    modal.scrollTop = 0;

    // Em celular, o teclado virtual altera a altura útil da tela.
    // Reaplica o limite usando visualViewport quando disponível.
    const ajustarAltura = () => {
        if (!window.visualViewport) return;

        const altura = Math.round(window.visualViewport.height);

        modal.style.height = `${altura}px`;
        modal.style.maxHeight = `${altura}px`;

        if (painel && window.matchMedia('(max-width: 700px)').matches) {
            painel.style.height = `${altura}px`;
            painel.style.maxHeight = `${altura}px`;
        }
    };

    ajustarAltura();

    if (!modal.dataset.curriculoViewportListener) {
        modal.dataset.curriculoViewportListener = '1';

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', ajustarAltura);
        }
    }

    // Carrega a lista de currículos já salvos e ativa o autopreenchimento
    // sempre que o modal for aberto.
    setTimeout(() => {
        inicializarAutocompleteCurriculoCRM();
    }, 0);
}


// ============================================================
// CURRÍCULO — SALVAR NA PLANILHA + AUTOPREENCHER PELO NOME
// ============================================================

const curriculoCRMState = {
    nomesSalvos: [],
    carregandoNomes: false,
    preenchendo: false,
    timerNome: null,
    ultimoNomeCarregado: ''
};

function normalizarNomeCurriculoCRM(valor) {
    return String(valor || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function garantirUIAutocompleteCurriculoCRM() {
    const nomeInput = document.getElementById('cv-nome');
    if (!nomeInput) return null;

    let datalist = document.getElementById('cv-nomes-salvos-lista');

    if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = 'cv-nomes-salvos-lista';
        document.body.appendChild(datalist);
    }

    nomeInput.setAttribute('list', 'cv-nomes-salvos-lista');
    nomeInput.setAttribute('autocomplete', 'off');

    let barra = document.getElementById('cv-salvos-barra');

    if (!barra) {
        barra = document.createElement('div');
        barra.id = 'cv-salvos-barra';
        barra.style.cssText = `
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:8px;
            flex-wrap:wrap;
            margin-top:6px;
            padding:7px 9px;
            border:1px solid #dce7de;
            background:#f8fbf8;
            border-radius:9px;
            font-size:11px;
        `;

        const status = document.createElement('span');
        status.id = 'cv-salvos-status';
        status.textContent = 'Digite um nome. Currículos salvos aparecem automaticamente.';
        status.style.cssText = 'color:#65736a;font-weight:700;';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'cv-btn-salvar-cadastro';
        btn.textContent = '💾 Salvar cadastro';
        btn.style.cssText = `
            border:1px solid #9fc0a5;
            background:#fff;
            color:#2f6f38;
            border-radius:999px;
            padding:6px 10px;
            cursor:pointer;
            font-size:10px;
            font-weight:900;
        `;
        btn.onclick = () => salvarCadastroCurriculoCRM(true);

        barra.appendChild(status);
        barra.appendChild(btn);

        nomeInput.insertAdjacentElement('afterend', barra);
    }

    return { nomeInput, datalist };
}

function atualizarStatusCurriculoSalvoCRM(texto, tipo = 'normal') {
    const el = document.getElementById('cv-salvos-status');
    if (!el) return;

    el.textContent = texto;

    if (tipo === 'ok') {
        el.style.color = '#28733a';
    } else if (tipo === 'erro') {
        el.style.color = '#b42318';
    } else if (tipo === 'buscando') {
        el.style.color = '#8a6420';
    } else {
        el.style.color = '#65736a';
    }
}

function renderizarNomesSalvosCurriculoCRM() {
    const lista = document.getElementById('cv-nomes-salvos-lista');
    if (!lista) return;

    lista.innerHTML = '';

    curriculoCRMState.nomesSalvos.forEach(nome => {
        const option = document.createElement('option');
        option.value = nome;
        lista.appendChild(option);
    });
}

async function carregarNomesSalvosCurriculoCRM() {
    if (curriculoCRMState.carregandoNomes) return;

    curriculoCRMState.carregandoNomes = true;

    try {
        const resposta = await fetchFromGS(
            'listarNomesCurriculosCRM',
            { _: String(Date.now()) }
        );

        if (resposta?.success === false || resposta?.error) {
            throw new Error(
                resposta.message ||
                resposta.error ||
                'Não foi possível carregar os currículos salvos.'
            );
        }

        curriculoCRMState.nomesSalvos =
            Array.isArray(resposta?.nomes)
                ? resposta.nomes
                : [];

        renderizarNomesSalvosCurriculoCRM();

        atualizarStatusCurriculoSalvoCRM(
            curriculoCRMState.nomesSalvos.length
                ? `${curriculoCRMState.nomesSalvos.length} currículo(s) salvo(s). Digite o nome para preencher.`
                : 'Nenhum currículo salvo ainda. Ao gerar ou salvar, ele ficará disponível aqui.'
        );

    } catch (erro) {
        console.error('Erro ao carregar currículos salvos:', erro);

        atualizarStatusCurriculoSalvoCRM(
            'Não foi possível carregar os currículos salvos.',
            'erro'
        );
    } finally {
        curriculoCRMState.carregandoNomes = false;
    }
}

function inicializarAutocompleteCurriculoCRM() {
    const ui = garantirUIAutocompleteCurriculoCRM();
    if (!ui) return;

    const { nomeInput } = ui;

    // Sempre atualiza a lista ao abrir para refletir o que está na planilha.
    carregarNomesSalvosCurriculoCRM();

    if (nomeInput.dataset.curriculoAutoPreenchimento === '1') {
        return;
    }

    nomeInput.dataset.curriculoAutoPreenchimento = '1';

    const tentarAutoPreencher = () => {
        clearTimeout(curriculoCRMState.timerNome);

        curriculoCRMState.timerNome = setTimeout(() => {
            const digitado = normalizarNomeCurriculoCRM(nomeInput.value);

            if (!digitado) {
                curriculoCRMState.ultimoNomeCarregado = '';
                atualizarStatusCurriculoSalvoCRM(
                    'Digite um nome. Currículos salvos aparecem automaticamente.'
                );
                return;
            }

            const exato = curriculoCRMState.nomesSalvos.find(nome =>
                normalizarNomeCurriculoCRM(nome) === digitado
            );

            if (exato) {
                if (
                    curriculoCRMState.ultimoNomeCarregado !==
                    normalizarNomeCurriculoCRM(exato)
                ) {
                    buscarEPreencherCurriculoSalvoCRM(exato);
                }
            } else {
                curriculoCRMState.ultimoNomeCarregado = '';
                atualizarStatusCurriculoSalvoCRM(
                    'Novo currículo — preencha normalmente. Ele será salvo ao gerar o PDF.'
                );
            }
        }, 350);
    };

    nomeInput.addEventListener('input', tentarAutoPreencher);

    nomeInput.addEventListener('change', () => {
        clearTimeout(curriculoCRMState.timerNome);

        const digitado = normalizarNomeCurriculoCRM(nomeInput.value);

        const exato = curriculoCRMState.nomesSalvos.find(nome =>
            normalizarNomeCurriculoCRM(nome) === digitado
        );

        if (exato) {
            buscarEPreencherCurriculoSalvoCRM(exato);
        }
    });
}

function coletarDadosCurriculoCRM() {
    const modal = document.getElementById('modal-curriculo');

    if (!modal) {
        throw new Error('Modal de currículo não encontrado.');
    }

    const nome = String(
        document.getElementById('cv-nome')?.value || ''
    ).trim();

    const campos = {};

    modal
        .querySelectorAll(
            'input[id^="cv-"], select[id^="cv-"], textarea[id^="cv-"]'
        )
        .forEach(el => {
            if (!el.id) return;

            // Foto é tratada separadamente e não é colocada na planilha
            // para não ultrapassar o limite de tamanho de uma célula.
            if (el.type === 'file') return;

            if (
                el.type === 'checkbox' ||
                el.type === 'radio'
            ) {
                campos[el.id] = {
                    tipo: el.type,
                    checked: !!el.checked,
                    value: el.value
                };
            } else {
                campos[el.id] = {
                    tipo: el.type || el.tagName.toLowerCase(),
                    value: el.value
                };
            }
        });

    const cursos = [
        ...document.querySelectorAll(
            '#cursos-container .dynamic-item'
        )
    ].map(node => ({
        curso:
            node.querySelector('.input-curso')?.value || '',
        inst:
            node.querySelector('.input-inst')?.value || '',
        periodo:
            node.querySelector('.input-periodo')?.value || ''
    }));

    const experiencias = [
        ...document.querySelectorAll(
            '#exp-container .dynamic-item'
        )
    ].map(node => ({
        empresa:
            node.querySelector('.input-empresa')?.value || '',
        funcao:
            node.querySelector('.input-funcao')?.value || '',
        periodo:
            node.querySelector('.input-periodo-exp')?.value || ''
    }));

    return {
        nome,
        dados: {
            campos,
            cursos,
            experiencias
        }
    };
}

function limparFotoCurriculoAoCarregarCRM() {
    state.fotoBase64 = null;

    const preview = document.getElementById('cv-photo-preview');

    if (preview) {
        preview.src = '';
        preview.style.display = 'none';
    }

    const modal = document.getElementById('modal-curriculo');

    const file = modal?.querySelector('input[type="file"]');

    if (file) {
        try {
            file.value = '';
        } catch (_) {}
    }
}

function preencherTelefonesVisiveisCurriculoCRM() {
    const tel2 = document.getElementById('cv-tel-2');
    const tel3 = document.getElementById('cv-tel-3');

    const container2 = document.getElementById('cv-tel-container-2');
    const container3 = document.getElementById('cv-tel-container-3');
    const btnAdd = document.getElementById('btn-add-tel');

    state.telefoneCount = 1;

    if (tel2?.value) {
        if (container2) container2.style.display = 'block';
        state.telefoneCount = 2;
    } else if (container2) {
        container2.style.display = 'none';
    }

    if (tel3?.value) {
        if (container3) container3.style.display = 'block';
        state.telefoneCount = 3;
    } else if (container3) {
        container3.style.display = 'none';
    }

    if (btnAdd) {
        btnAdd.style.display =
            state.telefoneCount >= 3
                ? 'none'
                : '';
    }
}

function preencherCurriculoComDadosCRM(registro) {
    if (!registro?.dados) return;

    curriculoCRMState.preenchendo = true;

    try {
        limparFotoCurriculoAoCarregarCRM();

        const campos = registro.dados.campos || {};

        Object.entries(campos).forEach(([id, info]) => {
            const el = document.getElementById(id);
            if (!el || !info) return;

            if (
                el.type === 'checkbox' ||
                el.type === 'radio'
            ) {
                el.checked = !!info.checked;
            } else if (info.value !== undefined) {
                el.value = info.value;
            }
        });

        const cursosContainer =
            document.getElementById('cursos-container');

        const expContainer =
            document.getElementById('exp-container');

        if (cursosContainer) cursosContainer.innerHTML = '';
        if (expContainer) expContainer.innerHTML = '';

        state.cursoCount = 0;
        state.expCount = 0;

        const cursos =
            Array.isArray(registro.dados.cursos)
                ? registro.dados.cursos
                : [];

        cursos.slice(0, 3).forEach(curso => {
            adicionarCurso();

            const node =
                document.querySelector(
                    '#cursos-container .dynamic-item:last-child'
                );

            if (!node) return;

            const cursoEl =
                node.querySelector('.input-curso');

            const instEl =
                node.querySelector('.input-inst');

            const periodoEl =
                node.querySelector('.input-periodo');

            if (cursoEl) cursoEl.value = curso.curso || '';
            if (instEl) instEl.value = curso.inst || '';
            if (periodoEl) periodoEl.value = curso.periodo || '';
        });

        const experiencias =
            Array.isArray(registro.dados.experiencias)
                ? registro.dados.experiencias
                : [];

        experiencias.slice(0, 6).forEach(exp => {
            adicionarExperiencia();

            const node =
                document.querySelector(
                    '#exp-container .dynamic-item:last-child'
                );

            if (!node) return;

            const empresaEl =
                node.querySelector('.input-empresa');

            const funcaoEl =
                node.querySelector('.input-funcao');

            const periodoEl =
                node.querySelector('.input-periodo-exp');

            if (empresaEl) empresaEl.value = exp.empresa || '';
            if (funcaoEl) funcaoEl.value = exp.funcao || '';
            if (periodoEl) periodoEl.value = exp.periodo || '';
        });

        preencherTelefonesVisiveisCurriculoCRM();

        curriculoCRMState.ultimoNomeCarregado =
            normalizarNomeCurriculoCRM(
                registro.nome ||
                document.getElementById('cv-nome')?.value
            );

        atualizarStatusCurriculoSalvoCRM(
            '✓ Currículo encontrado e preenchido automaticamente.',
            'ok'
        );

    } finally {
        curriculoCRMState.preenchendo = false;
    }
}

async function buscarEPreencherCurriculoSalvoCRM(nome) {
    if (!nome) return;

    atualizarStatusCurriculoSalvoCRM(
        '⏳ Buscando currículo salvo...',
        'buscando'
    );

    try {
        const resposta = await fetchFromGS(
            'buscarCurriculoCRM',
            {
                nome,
                _: String(Date.now())
            }
        );

        if (resposta?.success === false || resposta?.error) {
            throw new Error(
                resposta.message ||
                resposta.error ||
                'Erro ao buscar currículo.'
            );
        }

        if (!resposta?.encontrado || !resposta?.registro) {
            atualizarStatusCurriculoSalvoCRM(
                'Currículo não encontrado na planilha.'
            );
            return;
        }

        preencherCurriculoComDadosCRM(
            resposta.registro
        );

    } catch (erro) {
        console.error(
            'Erro ao autopreencher currículo:',
            erro
        );

        atualizarStatusCurriculoSalvoCRM(
            'Erro ao buscar currículo salvo.',
            'erro'
        );
    }
}

async function salvarCadastroCurriculoCRM(mostrarMensagem = true) {
    const payload = coletarDadosCurriculoCRM();

    if (!payload.nome) {
        if (mostrarMensagem) {
            alert('Digite o nome antes de salvar.');
        }
        return false;
    }

    const btn =
        document.getElementById('cv-btn-salvar-cadastro');

    const textoOriginal =
        btn?.textContent || '💾 Salvar cadastro';

    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Salvando...';
    }

    atualizarStatusCurriculoSalvoCRM(
        '⏳ Salvando currículo na planilha...',
        'buscando'
    );

    try {
        await postParaGoogleSheets(
            'salvarCurriculoCRM',
            payload
        );

        const nomeNormalizado =
            normalizarNomeCurriculoCRM(payload.nome);

        const jaExiste =
            curriculoCRMState.nomesSalvos.some(nome =>
                normalizarNomeCurriculoCRM(nome) ===
                nomeNormalizado
            );

        if (!jaExiste) {
            curriculoCRMState.nomesSalvos.push(
                payload.nome
            );

            curriculoCRMState.nomesSalvos.sort(
                (a, b) =>
                    a.localeCompare(
                        b,
                        'pt-BR',
                        { sensitivity: 'base' }
                    )
            );

            renderizarNomesSalvosCurriculoCRM();
        }

        curriculoCRMState.ultimoNomeCarregado =
            nomeNormalizado;

        atualizarStatusCurriculoSalvoCRM(
            '✓ Currículo salvo na planilha.',
            'ok'
        );

        return true;

    } catch (erro) {
        console.error(
            'Erro ao salvar currículo:',
            erro
        );

        atualizarStatusCurriculoSalvoCRM(
            '❌ Não foi possível salvar o currículo.',
            'erro'
        );

        if (mostrarMensagem) {
            alert(
                'Não foi possível salvar o currículo: ' +
                (erro.message || erro)
            );
        }

        return false;

    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = textoOriginal;
        }
    }
}


// ============================================================
// CURR\u00CDCULO (CORRIGIDO E COMPLETO)
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
            alert("CEP n\u00E3o encontrado.");
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
        alert("Voc\u00EA j\u00E1 atingiu o limite m\u00E1ximo de 3 cursos para caber em 1 \u00FAnica folha A4.");
        return;
    }
    const container = document.getElementById('cursos-container');
    const id = `curso-${Date.now()}`;
    const html = `
        <div class="dynamic-item" id="${id}">
            <button class="remove-btn" onclick="removerItem('${id}')">\u00D7</button>
            <div class="grid-cv">
                <div><label style="font-size:12px;">Curso</label><input type="text" class="input-curso" placeholder="Ex: Administra\u00E7\u00E3o"></div>
                <div><label style="font-size:12px;">Institui\u00E7\u00E3o</label><input type="text" class="input-inst" placeholder="Ex: UNESP"></div>
            </div>
            <div class="grid-cv full"><label style="font-size:12px;">Per\u00EDodo</label><input type="text" class="input-periodo" placeholder="Ex: 2018 - 2022"></div>
        </div>`;
    container.insertAdjacentHTML('beforeend', html);
    state.cursoCount++;
}

function adicionarExperiencia() {
    if (state.expCount >= 6) {
        alert("Voc\u00EA j\u00E1 atingiu o limite m\u00E1ximo de 6 experi\u00EAncias para caber em 1 \u00FAnica folha A4.");
        return;
    }
    const container = document.getElementById('exp-container');
    const id = `exp-${Date.now()}`;
    const html = `
        <div class="dynamic-item" id="${id}">
            <button class="remove-btn" onclick="removerItem('${id}')">\u00D7</button>
            <div class="grid-cv">
                <div><label style="font-size:12px;">Empresa</label><input type="text" class="input-empresa" placeholder="Ex: Tech Solutions"></div>
                <div><label style="font-size:12px;">Fun\u00E7\u00E3o</label><input type="text" class="input-funcao" placeholder="Ex: Assistente Administrativo"></div>
            </div>
            <div class="grid-cv full"><label style="font-size:12px;">Per\u00EDodo</label><input type="text" class="input-periodo-exp" placeholder="Ex: Jan/2020 - Dez/2022"></div>
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


function garantirLayoutPDFCurriculo() {
    const idsObrigatorios = [
        'pdf-nome',
        'pdf-tel',
        'pdf-email',
        'pdf-endereco',
        'pdf-objetivo',
        'pdf-photo',
        'pdf-habilidades',
        'pdf-cursos',
        'pdf-experiencias'
    ];

    let layout = document.getElementById('cv-pdf-layout');

    const estruturaCompleta =
        layout &&
        idsObrigatorios.every(id => document.getElementById(id));

    if (estruturaCompleta) {
        return layout;
    }

    // Se existe um layout antigo/incompleto, reaproveita o mesmo container,
    // mas reconstrói somente a área interna necessária para gerar o PDF.
    if (!layout) {
        layout = document.createElement('div');
        layout.id = 'cv-pdf-layout';
        document.body.appendChild(layout);
    }

    if (!document.getElementById('curriculo-pdf-fallback-style')) {
        const style = document.createElement('style');
        style.id = 'curriculo-pdf-fallback-style';
        style.textContent = `
            #cv-pdf-layout {
                position: fixed;
                left: -10000px;
                top: 0;
                width: 794px;
                min-height: 1123px;
                box-sizing: border-box;
                background: #ffffff;
                color: #1f2937;
                font-family: Arial, Helvetica, sans-serif;
                padding: 44px 48px;
                z-index: -1;
            }

            #cv-pdf-layout .cvpdf-header {
                display: grid;
                grid-template-columns: 110px 1fr;
                gap: 22px;
                align-items: center;
                padding-bottom: 20px;
                border-bottom: 3px solid #4a7c2e;
                margin-bottom: 24px;
            }

            #cv-pdf-layout .cvpdf-photo-wrap {
                width: 100px;
                height: 130px;
                border-radius: 10px;
                overflow: hidden;
                border: 1px solid #d1d5db;
                background: #f3f4f6;
            }

            #cv-pdf-layout #pdf-photo {
                display: none;
                width: 100%;
                height: 100%;
                object-fit: cover;
            }

            #cv-pdf-layout #pdf-nome {
                margin: 0 0 10px;
                font-size: 30px;
                line-height: 1.08;
                color: #234d2a;
                text-transform: uppercase;
            }

            #cv-pdf-layout .cvpdf-contact {
                display: grid;
                gap: 5px;
                color: #4b5563;
                font-size: 13px;
                line-height: 1.35;
            }

            #cv-pdf-layout .cvpdf-section {
                margin-top: 22px;
            }

            #cv-pdf-layout .cvpdf-section-title {
                margin: 0 0 10px;
                padding-bottom: 5px;
                border-bottom: 1px solid #cdd8cf;
                color: #315d38;
                font-size: 16px;
                font-weight: 800;
                text-transform: uppercase;
            }

            #cv-pdf-layout #pdf-objetivo {
                margin: 0;
                font-size: 13px;
                line-height: 1.5;
                white-space: pre-wrap;
            }

            #cv-pdf-layout #pdf-habilidades {
                margin: 0;
                padding-left: 18px;
                columns: 2;
                column-gap: 28px;
                font-size: 13px;
                line-height: 1.45;
            }

            #cv-pdf-layout .pdf-entry {
                margin-bottom: 11px;
                page-break-inside: avoid;
            }

            #cv-pdf-layout .pdf-entry-title {
                font-size: 14px;
                font-weight: 800;
                color: #263b2a;
            }

            #cv-pdf-layout .pdf-entry-sub {
                margin-top: 2px;
                font-size: 12.5px;
                color: #4b5563;
            }

            #cv-pdf-layout .pdf-entry-period {
                margin-top: 2px;
                font-size: 11.5px;
                color: #6b7280;
            }

            #cv-pdf-layout.template-moderno .cvpdf-header {
                border-bottom-width: 5px;
            }

            #cv-pdf-layout.template-simples .cvpdf-header {
                border-bottom: 1px solid #9ca3af;
            }

            #cv-pdf-layout.template-simples #pdf-nome {
                color: #111827;
            }
        `;
        document.head.appendChild(style);
    }

    layout.innerHTML = `
        <div class="cvpdf-header">
            <div class="cvpdf-photo-wrap">
                <img id="pdf-photo" alt="">
            </div>

            <div>
                <h1 id="pdf-nome"></h1>

                <div class="cvpdf-contact">
                    <div><strong>Telefone:</strong> <span id="pdf-tel"></span></div>
                    <div><strong>E-mail:</strong> <span id="pdf-email"></span></div>
                    <div><strong>Endereço:</strong> <span id="pdf-endereco"></span></div>
                </div>
            </div>
        </div>

        <section class="cvpdf-section">
            <h2 class="cvpdf-section-title">Objetivo</h2>
            <p id="pdf-objetivo"></p>
        </section>

        <section class="cvpdf-section">
            <h2 class="cvpdf-section-title">Habilidades</h2>
            <ul id="pdf-habilidades"></ul>
        </section>

        <section class="cvpdf-section">
            <h2 class="cvpdf-section-title">Cursos e Formação Complementar</h2>
            <div id="pdf-cursos"></div>
        </section>

        <section class="cvpdf-section">
            <h2 class="cvpdf-section-title">Experiência Profissional</h2>
            <div id="pdf-experiencias"></div>
        </section>
    `;

    layout.style.display = 'none';

    return layout;
}

async function gerarCurriculo() {
    const nome = document.getElementById('cv-nome').value;
    if (!nome) {
        alert("Por favor, preencha pelo menos o Nome Completo.");
        return;
    }
    // Sempre que o PDF for gerado, o cadastro também é salvo/atualizado
    // na planilha CURRICULOS para ficar disponível no autopreenchimento.
    try {
        await salvarCadastroCurriculoCRM(false);
    } catch (erroSalvar) {
        console.warn(
            'O PDF será gerado, mas o cadastro não pôde ser salvo:',
            erroSalvar
        );
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
        const curso = node.querySelector('.input-curso').value || 'Curso n\u00E3o informado';
        const inst = node.querySelector('.input-inst').value || 'Institui\u00E7\u00E3o n\u00E3o informada';
        const periodo = node.querySelector('.input-periodo').value || 'Per\u00EDodo n\u00E3o informado';
        cursos.push({ curso, inst, periodo });
    });
    const expNodes = document.querySelectorAll('#exp-container .dynamic-item');
    const experiencias = [];
    expNodes.forEach(node => {
        const empresa = node.querySelector('.input-empresa').value || 'Empresa n\u00E3o informada';
        const funcao = node.querySelector('.input-funcao').value || 'Fun\u00E7\u00E3o n\u00E3o informada';
        const periodo = node.querySelector('.input-periodo-exp').value || 'Per\u00EDodo n\u00E3o informado';
        experiencias.push({ empresa, funcao, periodo });
    });

    // O HTML atual não possui todos os elementos usados pela geração do PDF.
    // Recria a área de impressão automaticamente quando necessário.
    garantirLayoutPDFCurriculo();

    document.getElementById('pdf-nome').innerText = nome;
    document.getElementById('pdf-tel').innerText = tels.length > 0 ? tels.join(' / ') : '(N\u00E3o informado)';
    document.getElementById('pdf-email').innerText = email || '(N\u00E3o informado)';
    document.getElementById('pdf-endereco').innerText = endereco || '(N\u00E3o informado)';
    document.getElementById('pdf-objetivo').innerText = objetivo || 'N\u00E3o informado.';

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
        pdfSkills.innerHTML = '<li>N\u00E3o informado.</li>';
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
        pdfExp.innerHTML = '<p style="font-size:12px; color:#888;">Nenhuma experi\u00EAncia informada.</p>';
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
        alert("Ocorreu um erro ao gerar o curr\u00EDculo.");
        pdfLayout.style.display = 'none';
    }
}

// ============================================================
// COMPROVANTE E SUGEST\u00D5ES
// ============================================================
function toggleComprovanteMenu() { const menu=document.getElementById('menu-comprovante'); if(!menu)return; menu.style.display=menu.style.display==='none'?'block':'none'; }
document.addEventListener('click', function(e){ const menu=document.getElementById('menu-comprovante'); const btn=document.getElementById('btn-comprovante'); if(menu&&btn&&!menu.contains(e.target)&&e.target!==btn) menu.style.display='none'; });
function removerAcentos(str){ return String(str||'').normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function formatarCEPPrint(i){ i.value=i.value.replace(/\D/g,'').replace(/(\d{5})(\d)/,'$1-$2'); }
function formatarCPFPrint(i){ i.value=i.value.replace(/\D/g,'').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2'); }
function formatarRGPrint(i){ i.value=i.value.replace(/\D/g,'').replace(/(\d{1,2})(\d{3})(\d{3})(\d{1})$/,'$1.$2.$3-$4'); }
function autoBuscarCEP(el){ const cep=el.value.replace(/\D/g,''); if(cep.length===8) buscarCEPPrint(); }
function autoBuscarCPF(el){ const cpf=el.value.replace(/\D/g,''); if(cpf.length===11){ if(state.lastSearchedCPF!==cpf){state.lastSearchedCPF=cpf;buscarCPFPrint();} }else{state.lastSearchedCPF='';} }
async function abrirComprovantePrint(tipo){ state.tipoComprovanteAtual=tipo; const menu=document.getElementById('menu-comprovante'); if(menu) menu.style.display='none'; const bgImage=tipo==='assinatura'?"https://i.imgur.com/lFhk0Hq.png":"https://i.imgur.com/l47wlMJ.png"; const comprovanteBg=document.getElementById('comprovante-bg'); if(comprovanteBg) comprovanteBg.style.backgroundImage=`url('${bgImage}')`; const modal=document.getElementById('modal-comprovante-print'); if(modal) modal.style.display='flex'; const idsLimpar=['print-nome','print-endereco','print-numero_endereco','print-complemento','print-cep','print-bairro','print-uf','print-nacionalidade','print-estado_civil','print-cpf','print-rg']; idsLimpar.forEach(id=>{const el=document.getElementById(id); if(el) el.value='';}); const emissor=document.getElementById('print-emissor'); if(emissor) emissor.value='DETRAN/RJ'; const proprias=['print-propria','print-alugada','print-emprestada']; proprias.forEach(id=>{const chk=document.getElementById(id); if(chk) chk.checked=false;}); const m=["JANEIRO","FEVEREIRO","MAR\u00C7O","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"]; const h=new Date(); const printData=document.getElementById("print-data"); if(printData) printData.value=`${String(h.getDate()).padStart(2,'0')} DE ${m[h.getMonth()]}`; const printAno=document.getElementById("print-ano"); if(printAno) printAno.value=h.getFullYear(); try{ const dados=await fetchFromGS('getNumero'); const numeroEl=document.getElementById('print-numero'); if(numeroEl) numeroEl.value=dados.numero||'0000001'; }catch(e){console.error(e);alert("Erro ao buscar o n\u00FAmero da declara\u00E7\u00E3o."); const numeroEl=document.getElementById('print-numero'); if(numeroEl) numeroEl.value='0000001'; } }
async function buscarCEPPrint(){ const cep=document.getElementById('print-cep').value.replace(/\D/g,''); if(cep.length!==8){alert("CEP inv\u00E1lido");return;} try{ const resp=await fetch(`https://viacep.com.br/ws/${cep}/json/`); const dados=await resp.json(); if(dados.erro){alert("CEP n\u00E3o encontrado na API dos Correios");return;} const enderecoEl=document.getElementById('print-endereco'); if(enderecoEl) enderecoEl.value=(dados.logradouro||'').toUpperCase(); const bairro=(dados.bairro||'').toUpperCase(); const cidade=(dados.localidade||'').toUpperCase(); const bairroEl=document.getElementById('print-bairro'); if(bairroEl) bairroEl.value=bairro+'/'+cidade; const ufEl=document.getElementById('print-uf'); if(ufEl) ufEl.value=(dados.uf||'').toUpperCase(); }catch(e){console.error(e);alert("Erro de conex\u00E3o ao buscar o CEP.");} }
async function buscarCPFPrint(){ const cpf=document.getElementById('print-cpf').value.replace(/\D/g,''); if(cpf.length!==11){alert("CPF inv\u00E1lido");return;} try{ const r=await fetchFromGS('buscarCPF',{cpf}); if(r.erro){alert("ERRO DO APPS SCRIPT: "+r.erro);return;} if(!r.encontrado){alert("CPF N\u00C3O LOCALIZADO na planilha.");return;} const d=r.dados; const nomeEl=document.getElementById('print-nome'); if(nomeEl) nomeEl.value=d.nome||''; const enderecoEl=document.getElementById('print-endereco'); if(enderecoEl) enderecoEl.value=d.endereco||''; const numEndEl=document.getElementById('print-numero_endereco'); if(numEndEl) numEndEl.value=d.numero_endereco||''; const complEl=document.getElementById('print-complemento'); if(complEl) complEl.value=d.complemento||''; const cepEl=document.getElementById('print-cep'); if(cepEl) cepEl.value=d.cep||''; const bairroEl=document.getElementById('print-bairro'); if(bairroEl) bairroEl.value=d.bairro||''; const ufEl=document.getElementById('print-uf'); if(ufEl) ufEl.value=d.uf||''; const nacEl=document.getElementById('print-nacionalidade'); if(nacEl) nacEl.value=d.nacionalidade||''; const civilEl=document.getElementById('print-estado_civil'); if(civilEl) civilEl.value=d.estado_civil||''; const cpfEl=document.getElementById('print-cpf'); if(cpfEl) cpfEl.value=d.cpf||''; const rgEl=document.getElementById('print-rg'); if(rgEl) rgEl.value=d.rg||''; const emissorEl=document.getElementById('print-emissor'); if(emissorEl) emissorEl.value=d.emissor||''; const propEl=document.getElementById('print-propria'); if(propEl) propEl.checked=d.propria||false; const alugEl=document.getElementById('print-alugada'); if(alugEl) alugEl.checked=d.alugada||false; const empEl=document.getElementById('print-emprestada'); if(empEl) empEl.checked=d.emprestada||false; }catch(e){console.error(e);alert("Erro de comunica\u00E7\u00E3o: "+e.message);} }
function detectarGeneroENacionalidadeComprovante(){ const nomeInput=document.getElementById('print-nome'); const nome=nomeInput.value.trim().toUpperCase(); if(nome.length<2)return; const primeiroNome=nome.split(' ')[0].toLowerCase(); let genero='MASCULINO'; const excecoesMasculinas=['joaquim','luca','noa','nicola']; if(excecoesMasculinas.includes(primeiroNome))genero='MASCULINO'; else if(['mar','luz','flor','marjorie','alice','constance'].includes(primeiroNome))genero='FEMININO'; else if(primeiroNome.endsWith('a')||primeiroNome.endsWith('e')||primeiroNome.endsWith('i')||primeiroNome.endsWith('ad')||primeiroNome.endsWith('ra')||primeiroNome.endsWith('na')||primeiroNome.endsWith('la')||primeiroNome.endsWith('da')||primeiroNome.endsWith('ia'))genero='FEMININO'; else genero='MASCULINO'; if(genero==='FEMININO'){ const nacEl=document.getElementById('print-nacionalidade'); if(nacEl) nacEl.value='BRASILEIRA'; const civilEl=document.getElementById('print-estado_civil'); if(civilEl) civilEl.value='SOLTEIRA'; }else{ const nacEl=document.getElementById('print-nacionalidade'); if(nacEl) nacEl.value='BRASILEIRO'; const civilEl=document.getElementById('print-estado_civil'); if(civilEl) civilEl.value='SOLTEIRO'; } }
let debounceTimerEndereco;
let enderecoCache = {};
let searchController = null;

function posicionarSugestoesEndereco(input, container) {
    if (!input || !container) return;

    const inputRect = input.getBoundingClientRect();
    const pai = container.offsetParent || input.offsetParent || document.body;
    const paiRect = pai === document.body
        ? { left: 0, top: 0 }
        : pai.getBoundingClientRect();

    container.style.position = 'absolute';
    container.style.left = `${inputRect.left - paiRect.left}px`;
    container.style.top = `${inputRect.bottom - paiRect.top + 4}px`;
    container.style.width = `${inputRect.width}px`;
    container.style.zIndex = '999999';
    container.style.background = '#ffffff';
    container.style.border = '1px solid #b7c9bd';
    container.style.borderRadius = '6px';
    container.style.boxShadow = '0 8px 20px rgba(0,0,0,.18)';
    container.style.maxHeight = '220px';
    container.style.overflowY = 'auto';
    container.style.overflowX = 'hidden';
    container.style.padding = '0';
    container.style.margin = '0';
    container.style.fontFamily = 'Arial, sans-serif';
}

function buscarSugestoesEndereco() {
    const input = document.getElementById('print-endereco');
    const container = document.getElementById('address-suggestions');

    if (!input || !container) return;

    const queryOriginal = input.value.trim().toUpperCase();

    if (searchController) {
        searchController.abort();
        searchController = null;
    }

    clearTimeout(debounceTimerEndereco);

    if (queryOriginal.length < 2) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    posicionarSugestoesEndereco(input, container);

    if (enderecoCache[queryOriginal]) {
        exibirSugestoes(container, enderecoCache[queryOriginal]);
        return;
    }

    debounceTimerEndereco = setTimeout(async () => {
        try {
            posicionarSugestoesEndereco(input, container);

            container.innerHTML = `
                <div style="
                    padding:10px;
                    text-align:center;
                    color:#777;
                    background:#fff;
                    font-size:12px;
                    line-height:1.2;
                ">
                    🔍 Buscando...
                </div>
            `;
            container.style.display = 'block';

            searchController = new AbortController();

            const resultados = await fetchFromGS(
                'buscarEnderecos',
                { q: removerAcentos(queryOriginal) },
                searchController.signal
            );

            const querySemAcento = removerAcentos(queryOriginal);

            const resultadosFiltrados = (resultados || [])
                .filter(item => {
                    const enderecoSemAcento = removerAcentos(
                        String(item.endereco || '').toUpperCase()
                    );
                    return enderecoSemAcento.startsWith(querySemAcento) ||
                           enderecoSemAcento.includes(querySemAcento);
                })
                .slice(0, 5);

            enderecoCache[queryOriginal] = resultadosFiltrados;
            exibirSugestoes(container, resultadosFiltrados);

        } catch (e) {
            if (e.name !== 'AbortError') {
                console.warn('Erro ao buscar endereços:', e);
                container.style.display = 'none';
            }
        } finally {
            searchController = null;
        }
    }, 180);
}

function exibirSugestoes(container, resultados) {
    if (!container) return;

    const input = document.getElementById('print-endereco');
    if (input) posicionarSugestoesEndereco(input, container);

    container.innerHTML = '';

    if (!resultados || resultados.length === 0) {
        container.style.display = 'none';
        return;
    }

    resultados.forEach((item, index) => {
        const div = document.createElement('div');

        div.className = 'suggestion-item';
        div.style.display = 'block';
        div.style.position = 'relative';
        div.style.boxSizing = 'border-box';
        div.style.width = '100%';
        div.style.background = '#ffffff';
        div.style.padding = '9px 12px';
        div.style.margin = '0';
        div.style.cursor = 'pointer';
        div.style.borderBottom = index < resultados.length - 1
            ? '1px solid #eeeeee'
            : 'none';
        div.style.lineHeight = '1.25';
        div.style.transition = 'background .15s ease';
        div.style.whiteSpace = 'normal';
        div.style.textAlign = 'left';

        const strong = document.createElement('strong');
        strong.textContent = item.endereco || '';
        strong.style.display = 'block';
        strong.style.position = 'static';
        strong.style.fontSize = '12px';
        strong.style.lineHeight = '1.25';
        strong.style.color = '#173d28';
        strong.style.margin = '0 0 3px 0';
        strong.style.padding = '0';
        strong.style.whiteSpace = 'normal';

        const small = document.createElement('small');

        const detalhes = [];
        if (item.bairro) detalhes.push(item.bairro);
        if (item.uf) detalhes.push(item.uf);
        if (item.cep) detalhes.push('CEP: ' + item.cep);

        small.textContent = detalhes.join(' • ');
        small.style.display = 'block';
        small.style.position = 'static';
        small.style.fontSize = '10px';
        small.style.lineHeight = '1.25';
        small.style.fontWeight = 'normal';
        small.style.color = '#666666';
        small.style.margin = '0';
        small.style.padding = '0';
        small.style.whiteSpace = 'normal';

        div.appendChild(strong);
        div.appendChild(small);

        div.addEventListener('mouseenter', function () {
            this.style.background = '#eef8f1';
        });

        div.addEventListener('mouseleave', function () {
            this.style.background = '#ffffff';
        });

        div.onclick = function () {
            const endereco = document.getElementById('print-endereco');
            const bairro = document.getElementById('print-bairro');
            const uf = document.getElementById('print-uf');
            const cep = document.getElementById('print-cep');
            const numero = document.getElementById('print-numero_endereco');

            if (endereco) {
                endereco.value = String(item.endereco || '').toUpperCase();
            }

            if (bairro) {
                bairro.value = String(item.bairro || '').toUpperCase();
            }

            if (uf) {
                uf.value = String(item.uf || '').toUpperCase();
            }

            if (cep) {
                cep.value = item.cep || '';
            }

            container.style.display = 'none';
            container.innerHTML = '';

            if (numero) numero.focus();
        };

        container.appendChild(div);
    });

    container.style.display = 'block';
}

document.addEventListener('click', function (e) {
    const container = document.getElementById('address-suggestions');
    const input = document.getElementById('print-endereco');

    if (
        container &&
        input &&
        !container.contains(e.target) &&
        e.target !== input
    ) {
        container.style.display = 'none';
    }
});

window.addEventListener('resize', function () {
    const input = document.getElementById('print-endereco');
    const container = document.getElementById('address-suggestions');

    if (
        input &&
        container &&
        container.style.display !== 'none'
    ) {
        posicionarSugestoesEndereco(input, container);
    }
});
function obterValoresComprovante(){ return { numero:document.getElementById('print-numero').value, data:document.getElementById('print-data').value, ano:document.getElementById('print-ano').value, nome:document.getElementById('print-nome').value.toUpperCase(), endereco:document.getElementById('print-endereco').value.toUpperCase(), numero_endereco:document.getElementById('print-numero_endereco').value.toUpperCase(), complemento:document.getElementById('print-complemento').value.toUpperCase(), cep:document.getElementById('print-cep').value, bairro:document.getElementById('print-bairro').value.toUpperCase(), uf:document.getElementById('print-uf').value.toUpperCase(), nacionalidade:document.getElementById('print-nacionalidade').value.toUpperCase(), estado_civil:document.getElementById('print-estado_civil').value.toUpperCase(), cpf:document.getElementById('print-cpf').value, rg:document.getElementById('print-rg').value, emissor:document.getElementById('print-emissor').value.toUpperCase(), propria:document.getElementById('print-propria').checked, alugada:document.getElementById('print-alugada').checked, emprestada:document.getElementById('print-emprestada').checked }; }
function gerarHTMLImpressaoCRM(v){ return `<!DOCTYPE html><html><head><style>body{margin:0;padding:0;font-family:Arial,sans-serif;}.popup{position:relative;width:794px;height:1123px;background-color:white;overflow:hidden;margin:0 auto;}.popup-content{position:relative;width:100%;height:100%;}.popup-content img{width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;z-index:0;}.input-field{position:absolute;font-size:13px;padding:2px 4px;z-index:1;font-weight:bold;background:transparent;border:none;outline:none;color:black;text-transform:uppercase;}.input-field[type="checkbox"]{width:16px;height:16px;accent-color:black;}@media print{body{margin:0!important;padding:0!important;}}</style></head><body><div class="popup"><div class="popup-content"><img src="https://i.imgur.com/lFhk0Hq.png"><input class="input-field" style="top:386px;left:230px;width:80px" value="${v.numero}" readonly><input class="input-field" style="top:386px;left:390px;width:130px" value="${v.data}" readonly><input class="input-field" style="top:386px;left:580px;width:80px" value="${v.ano}" readonly><input class="input-field" style="top:437px;left:167px;width:500px;font-size:18px" value="${v.nome}" readonly><input class="input-field" style="top:508px;left:216px;width:350px" value="${v.endereco}" readonly><input class="input-field" style="top:508px;left:629px;width:90px" value="${v.numero_endereco}" readonly><input class="input-field" style="top:568px;left:240px;width:210px" value="${v.complemento}" readonly><input class="input-field" style="top:568px;left:530px;width:150px" value="${v.cep}" readonly><input class="input-field" style="top:633px;left:165px;width:350px" value="${v.bairro}" readonly><input class="input-field" style="top:633px;left:630px;width:80px" value="${v.uf}" readonly><input class="input-field" style="top:695px;left:247px;width:150px" value="${v.nacionalidade}" readonly><input class="input-field" style="top:695px;left:555px;width:150px" value="${v.estado_civil}" readonly><input class="input-field" style="top:758px;left:135px;width:188px" value="${v.cpf}" readonly><input class="input-field" style="top:758px;left:395px;width:100px" value="${v.rg}" readonly><input class="input-field" style="top:758px;left:625px;width:120px" value="${v.emissor}" readonly><input type="checkbox" class="input-field" style="top:844px;left:249px" ${v.propria?'checked':''} readonly><input type="checkbox" class="input-field" style="top:844px;left:425px" ${v.alugada?'checked':''} readonly><input type="checkbox" class="input-field" style="top:844px;left:652px" ${v.emprestada?'checked':''} readonly></div></div></body></html>`; }
async function salvarDadosComprovante(){ const dados=[document.getElementById('print-numero').value,document.getElementById('print-data').value,document.getElementById('print-ano').value,document.getElementById('print-nome').value.toUpperCase(),document.getElementById('print-endereco').value.toUpperCase(),document.getElementById('print-numero_endereco').value.toUpperCase(),document.getElementById('print-complemento').value.toUpperCase(),document.getElementById('print-cep').value,document.getElementById('print-bairro').value.toUpperCase(),document.getElementById('print-uf').value.toUpperCase(),document.getElementById('print-nacionalidade').value.toUpperCase(),document.getElementById('print-estado_civil').value.toUpperCase(),document.getElementById('print-cpf').value,document.getElementById('print-rg').value,document.getElementById('print-emissor').value.toUpperCase(),document.getElementById('print-propria').checked?"Casa Pr\u00F3pria":"",document.getElementById('print-alugada').checked?"Alugada":"",document.getElementById('print-emprestada').checked?"Emprestada":""]; await postParaGoogleSheets('salvarDeclaracao',dados); }
async function salvarApenas(){ const btn=document.querySelector('#modal-comprovante-print .btn-save'); if(!btn)return; btn.innerText='Salvando...'; btn.disabled=true; try{ await salvarDadosComprovante(); alert("Dados salvos com sucesso!"); fecharComprovantePrint(); }catch(e){alert("Erro ao salvar: "+e.message);}finally{btn.innerText='\uD83D\uDCBE Salvar';btn.disabled=false;} }
async function salvarEImprimir(){ const btn=document.querySelector('#modal-comprovante-print .btn-print'); if(!btn)return; btn.innerText='Salvando...'; btn.disabled=true; try{ await salvarDadosComprovante(); const v=obterValoresComprovante(); let htmlPrint=gerarHTMLImpressaoCRM(v); htmlPrint=htmlPrint.replace('</body>',`<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},800);});<\/script></body>`); const win=window.open('','_blank'); if(win){win.document.write(htmlPrint);win.document.close();win.focus();}else{alert("Pop-up bloqueado! Permita pop-ups.");} fecharComprovantePrint(); }catch(e){alert("Erro ao salvar e imprimir: "+e.message);}finally{btn.innerText='\uD83D\uDDA8\uFE0F Imprimir';btn.disabled=false;} }
function fecharModal(id){
    const modal=document.getElementById(id);
    if(modal) modal.classList.remove('active');
    if(id==='modal-multiplas-entregas'){
        document.body.classList.remove('cartoes-modal-open');
        pararCameraCartoes();
        limparResultadoCartaoOCR();
    }
}
function fecharComprovantePrint(){ const modal=document.getElementById('modal-comprovante-print'); if(modal) modal.style.display='none'; }

// ============================================================
// \uD83D\uDD25 BUSCA INTELIGENTE (Sem Filtros, com Data BR e Ordena\u00E7\u00E3o)
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
var buscaResultadosAuxiliares = new Map();
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
        todos: 'Digite nome, rua, n\u00FAmero, CPF ou telefone...',
        nome: 'Digite o nome da pessoa...',
        endereco: 'Digite o nome da rua ou endere\u00E7o...',
        numero: 'Digite o n\u00FAmero do cart\u00E3o...',
        cpf: 'Digite pelo menos 3 n\u00FAmeros do CPF...',
        telefone: 'Digite pelo menos 3 n\u00FAmeros do telefone...'
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
        if (contadorBusca) contadorBusca.textContent = '\u23F3 ...';
        const editorArea = document.getElementById('busca-editor-area');
        if (editorArea) { editorArea.style.display = 'none'; editorArea.innerHTML = ''; }
        if (buscaResultados) {
            buscaResultados.style.display = 'flex';
            buscaResultados.innerHTML = '<div style="text-align:center; padding:40px; color:#999;">\uD83D\uDD0E Digite algo para iniciar a busca</div>';
        }
        carregarTotalCartoesBusca();
    }, 100);
}

async function carregarTotalCartoesBusca() { if (!contadorBusca) return; contadorBusca.textContent = '\u23F3 ...'; try { const resp=await fetchFromGS('contarCartoesPendentes'); if(resp && resp.success) contadorBusca.textContent=`\uD83D\uDCE6 ${resp.total} pendentes`; else { contadorBusca.textContent='\u26A0\uFE0F Erro'; console.error(resp); } } catch(erro){ console.error(erro); contadorBusca.textContent='\u26A0\uFE0F Erro'; } }

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
    if (buscaResultados) { buscaResultados.style.display = 'flex'; buscaResultados.innerHTML = '<div style="text-align:center; padding:30px; color:#888;">\u23F3 Buscando...</div>'; }
    const params = { termo, campo: tipo };
    try {
        const resultado = await fetchFromGS('pesquisarCartoes', params, controllerAtual.signal);
        if (sequenciaAtual !== buscaSequencia) return;
        if (!resultado || resultado.error) throw new Error(resultado?.error || 'Resposta inv\u00E1lida do servidor');
        salvarBuscaMemoria(chaveMemoria, resultado);
        buscaUltimaConsulta = { tipo, termo, resposta: resultado };
        processarResultados(resultado);
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error(e);
        if (buscaResultados) buscaResultados.innerHTML = '<div style="text-align:center; padding:30px; color:#d32f2f;">\u274C Erro na busca. Tente novamente.</div>';
    } finally {
        if (buscaRequestController === controllerAtual) buscaRequestController = null;
    }
}

function processarResultados(resposta) {
    todosResultadosBusca = Array.isArray(resposta?.resultados) ? resposta.resultados : [];
    buscaResultadosAuxiliares.clear();
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
        const limitado = resposta?.completo === false ? ` \u00B7 mostrando ${todosResultadosBusca.length}` : '';
        contadorBusca.textContent = `\uD83D\uDCE6 ${Number(resposta?.total || 0)} encontrado(s)${limitado}`;
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
        const multiIcon = qtdEndereco > 1 ? `<span style="background:#e3f2fd; padding:2px 8px; border-radius:12px; margin-left:5px;">\uD83D\uDC65 ${qtdEndereco}</span>` : '';
        const statusClass = String(item.status || '').toUpperCase().trim() === 'BLOQUEADO' ? 'bloqueado' : '';
        const seloRecente = ehDataRecenteBusca(item.data) ? '<div class="selo-container"><div class="selo">RECENTE</div></div>' : '';
        html += `
            <div class="card" onclick="abrirEditorBuscaRapido(${Number(item.linha)})">
                <span class="numero">${escapeHtml(item.numero || '-')}</span>
                <span class="nome" title="${escapeHtml(item.nome || '')}">${escapeHtml(item.nome || '')}</span>
                <div class="detalhes">
                    <span class="data-destaque">\uD83D\uDCC5 ${escapeHtml(formatarDataBR(item.data))}</span>
                    ${seloRecente}
                    <span>\uD83D\uDCCD ${escapeHtml(item.endereco || 'SEM ENDERE\u00C7O')} ${multiIcon}</span>
                    <span>\uD83D\uDCE6 ${escapeHtml(item.tipo || '')}</span>
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
    buscaResultadosAuxiliares.clear();
    buscaUltimaConsulta = null;
    if (buscaResultados) buscaResultados.innerHTML = '<div style="text-align:center; padding:40px; color:#999;">Digite algo para buscar.</div>';
    if (contadorBusca && recarregarTotal) contadorBusca.textContent = '\u23F3 ...';
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
// \u2728 EDITOR R\u00C1PIDO PREMIUM COM BOT\u00C3O VOLTAR, POSI\u00C7\u00C3O PISCANTE E N\u00DAMERO GIGANTE
// ============================================================
function abrirEditorBuscaRapido(linha) {
    const item = obterResultadoBuscaPorLinha(linha);
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
                <button class="btn-voltar" onclick="cancelarEdicaoBusca(${Number(linha)})">\u2190 Voltar</button>
                <h4 style="margin:0; flex:1; text-align:center;">\u270F\uFE0F Cart\u00E3o N\u00BA ${escapeHtml(item.numero || '-')} \u2014 ${escapeHtml(item.nome || '')}</h4>
                <span id="posicao-span-busca-${Number(linha)}" class="posicao-badge posicao-badge-piscante">\uD83D\uDCCC carregando...</span>
            </div>

            <div class="editor-grid">
                <div><label>Nome</label><input id="edit-nome-busca-${Number(linha)}" value="${escapeHtml(item.nome || '')}"></div>
                <div><label>\uD83D\uDCC5 Data</label><input id="edit-data-busca-${Number(linha)}" value="${escapeHtml(formatarDataBR(item.data))}" placeholder="dd/mm/yyyy"></div>
            </div>

            <div class="editor-grid">
                <div class="editor-full"><label>\uD83D\uDD22 N\u00DAMERO DO CART\u00C3O (Identifica\u00E7\u00E3o)</label><input id="edit-num-busca-${Number(linha)}" class="campo-numero" value="${escapeHtml(item.numero || '')}" readonly></div>
            </div>

            <div class="editor-grid">
                <div class="editor-full">
                    <label>\uD83D\uDCCD ENDERE\u00C7O COMPLETO</label>
                    <input id="edit-end-busca-${Number(linha)}" value="${escapeHtml(item.endereco || '')}" style="${temOutros ? 'background:#fffbeb;border:2px solid #f59e0b;' : ''}">
                    ${temOutros ? `
                        <div class="alerta-duplicidade">
                            <span style="color:#b45309; font-weight:bold; display:flex; align-items:center; gap:8px;"><span style="font-size:1.2rem;">\u26A0\uFE0F</span> H\u00E1 ${qtdMesmoEndereco} cart\u00F5es neste mesmo endere\u00E7o!</span>
                            <div>
                                <button class="btn-sm" onclick="abrirListaMoradoresBusca(${Number(linha)})" style="background:#2563eb; color:white; border:none; padding:5px 14px; border-radius:30px; cursor:pointer;">\uD83D\uDC65 VER MORADORES</button>
                                <button id="btn-editar-todos-busca-${Number(linha)}" class="btn-sm" onclick="abrirEdicaoMassivaBusca(${Number(linha)})" style="display:none; background:#ea580c; color:white; border:none; padding:5px 14px; border-radius:30px; cursor:pointer;">\u270F\uFE0F EDITAR TODOS</button>
                            </div>
                        </div>` : ''}
                </div>
            </div>

            <div class="editor-grid">
                <div><label>CPF</label><input id="edit-cpf-busca-${Number(linha)}" value="${escapeHtml(item.cpf || '')}"></div>
                <div><label>Entregue \u00C0</label><input id="edit-entrega-busca-${Number(linha)}" value="${escapeHtml(item.entregueA || '')}"></div>
            </div>

            <div class="editor-grid">
                <div><label>Telefone</label><input id="edit-tel-busca-${Number(linha)}" value="${escapeHtml(item.telefone || '')}"></div>
            </div>

            <div class="btn-actions">
                <button class="btn-salvar" onclick="salvarEdicaoBusca(${Number(linha)})">\uD83D\uDCBE Salvar</button>
                <button class="btn-entregue" onclick="confirmarEntregaBusca(${Number(linha)})">\u2705 ENTREGUE</button>
                <button class="btn-cancelar" onclick="cancelarEdicaoBusca(${Number(linha)})">Cancelar</button>
            </div>
        </div>`;

    // EDITAR TODOS só aparece depois de validar:
    // MESMO endereço + MESMA pessoa (nome completo ou abreviado).
    if (temOutros) {
        atualizarVisibilidadeEditarTodosBusca(Number(linha));
    }

    if (numeroBloco) {
        fetchFromGS('obterPosicaoNoBlocoBackend', { numeroBloco, linhaAtual: Number(linha) })
            .then(result => {
                const span = document.getElementById(`posicao-span-busca-${Number(linha)}`);
                if (!span) return;
                if (result.success && result.posicao !== null) {
                    span.textContent = `\uD83D\uDCCC Posi\u00E7\u00E3o: ${result.posicao} de ${result.total} (bloco ${numeroBloco})`;
                } else if (result.total === 0) {
                    span.textContent = `\uD83D\uDCCC Sem outros cart\u00F5es no bloco ${numeroBloco}`;
                } else {
                    span.textContent = '\uD83D\uDCCC Posi\u00E7\u00E3o: n\u00E3o dispon\u00EDvel';
                }
            })
            .catch(() => {
                const span = document.getElementById(`posicao-span-busca-${Number(linha)}`);
                if (span) span.textContent = '\uD83D\uDCCC Erro ao carregar posi\u00E7\u00E3o';
            });
    } else {
        const span = document.getElementById(`posicao-span-busca-${Number(linha)}`);
        if (span) span.textContent = '\uD83D\uDCCC Bloco n\u00E3o informado';
    }
}

function cancelarEdicaoBusca(linha) {
    const editorArea = document.getElementById('busca-editor-area');
    const resultadosDiv = document.getElementById('busca-resultados');
    if (editorArea) { editorArea.style.display = 'none'; editorArea.innerHTML = ''; }
    if (resultadosDiv) resultadosDiv.style.display = 'flex';
}

window.salvarEdicaoBusca = async function (linha) {
    const itemOriginal = obterResultadoBuscaPorLinha(linha) || {};
    const get = id => document.getElementById(id)?.value;
    const dados = {
        nome: get(`edit-nome-busca-${Number(linha)}`) || itemOriginal.nome || '',
        data: get(`edit-data-busca-${Number(linha)}`) || itemOriginal.data || '',
        quantidade: itemOriginal.quantidade || 1,
        obs: itemOriginal.obs || '',
        tipo: itemOriginal.tipo || 'CART\u00C3O',
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
        alert('\u2705 Dados salvos com sucesso!');
        cancelarEdicaoBusca(linha);
        executarBusca();
    } catch (erro) {
        alert('\u274C Erro ao salvar: ' + erro.message);
    }
};

window.confirmarEntregaBusca = function (linha) {
    const itemOriginal = obterResultadoBuscaPorLinha(linha);
    if (!itemOriginal) return;
    const nomeQuemRecebeu = prompt(`\uD83D\uDCE6 PARA QUEM FOI ENTREGUE O CART\u00C3O DE ${itemOriginal.nome}?`);
    if (!nomeQuemRecebeu || nomeQuemRecebeu.trim() === '') { alert('Entrega cancelada.'); return; }
    const hoje = new Date();
    const dataFormatada = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
    const telRecebedor = prompt('\uD83D\uDCDE Qual o telefone de quem recebeu? (Opcional)', '');
    finalizarEntregaBusca(linha, nomeQuemRecebeu.trim(), dataFormatada, telRecebedor);
};

async function finalizarEntregaBusca(linha, nomeEntregueA, dataEntrega, telefoneAdicional) {
    const get = id => document.getElementById(id)?.value;
    const dados = {
        nome: get(`edit-nome-busca-${Number(linha)}`) || '',
        data: get(`edit-data-busca-${Number(linha)}`) || '',
        quantidade: 1,
        obs: '',
        tipo: 'CART\u00C3O',
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
        alert('\u2705 Cart\u00E3o marcado como ENTREGUE com sucesso!');
        cancelarEdicaoBusca(linha);
        executarBusca();
    } catch (erro) {
        alert('\u274C Erro: ' + erro.message);
    }
}


function normalizarNomePessoaBusca(nome) {
    return String(nome || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokensNomePessoaBusca(nome) {
    const ignorar = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E']);

    return normalizarNomePessoaBusca(nome)
        .split(' ')
        .filter(token => token && !ignorar.has(token));
}

// Considera a MESMA pessoa somente quando:
// - nome é exatamente igual; OU
// - é uma abreviação segura: primeiro nome igual, último sobrenome igual
//   e todas as palavras do nome menor existem no nome maior.
function nomesRepresentamMesmaPessoaBusca(nomeA, nomeB) {
    const normA = normalizarNomePessoaBusca(nomeA);
    const normB = normalizarNomePessoaBusca(nomeB);

    if (!normA || !normB) return false;
    if (normA === normB) return true;

    const a = tokensNomePessoaBusca(nomeA);
    const b = tokensNomePessoaBusca(nomeB);

    if (a.length < 2 || b.length < 2) return false;

    if (a[0] !== b[0]) return false;
    if (a[a.length - 1] !== b[b.length - 1]) return false;

    const menor = a.length <= b.length ? a : b;
    const maior = a.length <= b.length ? b : a;
    const setMaior = new Set(maior);

    return menor.every(token => setMaior.has(token));
}

function filtrarCartoesMesmaPessoaMesmoEnderecoBusca(cartoes, referencia) {
    const enderecoRef = normalizarEndereco(referencia?.endereco || '');
    const nomeRef = referencia?.nome || '';

    return (cartoes || []).filter(item => {
        const mesmoEndereco =
            normalizarEndereco(item?.endereco || '') === enderecoRef;

        if (!mesmoEndereco) return false;

        return nomesRepresentamMesmaPessoaBusca(
            nomeRef,
            item?.nome || ''
        );
    });
}

async function atualizarVisibilidadeEditarTodosBusca(linhaAtual) {
    const atual = obterResultadoBuscaPorLinha(linhaAtual);
    const btn = document.getElementById(
        `btn-editar-todos-busca-${Number(linhaAtual)}`
    );

    if (!atual || !btn) return;

    // Por segurança, o botão começa escondido.
    btn.style.display = 'none';

    try {
        const cartoesEndereco =
            await obterCartoesMesmoEnderecoBusca(atual.endereco || '');

        const mesmaPessoa =
            filtrarCartoesMesmaPessoaMesmoEnderecoBusca(
                cartoesEndereco,
                atual
            );

        if (mesmaPessoa.length > 1) {
            btn.style.display = 'inline-block';
            btn.textContent = `✏️ EDITAR TODOS (${mesmaPessoa.length})`;
            btn.title =
                'Editar somente cartões da mesma pessoa no mesmo endereço';
        }
    } catch (erro) {
        console.warn(
            'Não foi possível validar o botão EDITAR TODOS:',
            erro
        );
        btn.style.display = 'none';
    }
}

async function obterCartoesMesmoEnderecoBusca(enderecoOriginal) {
    const enderecoNorm = normalizarEndereco(enderecoOriginal);
    const conhecidos = [...todosResultadosBusca, ...buscaResultadosAuxiliares.values()];
    let cartoes = conhecidos.filter(item => normalizarEndereco(item.endereco) === enderecoNorm);
    const totalEsperado = cartoes.reduce((maior, item) => Math.max(maior, Number(item.qtdEndereco || 0)), cartoes.length);
    if (cartoes.length >= totalEsperado) return cartoes;
    try {
        const resposta = await fetchFromGS('pesquisarCartoes', { termo: enderecoOriginal, campo: 'endereco' });
        const completos = Array.isArray(resposta?.resultados) ? resposta.resultados : [];
        const exatos = completos.filter(item => normalizarEndereco(item.endereco) === enderecoNorm);
        if (exatos.length) cartoes = exatos;
    } catch (erro) {
        console.warn('N\u00E3o foi poss\u00EDvel carregar todos os moradores do endere\u00E7o:', erro);
    }
    return cartoes;
}

function incluirResultadosAuxiliaresBusca(itens) {
    (itens || []).forEach(item => {
        const existe = todosResultadosBusca.some(atual => Number(atual.linha) === Number(item.linha));
        if (!existe) buscaResultadosAuxiliares.set(Number(item.linha), item);
    });
    buscaContagemEnderecos = new Map();
    const conhecidos = [...todosResultadosBusca, ...buscaResultadosAuxiliares.values()];
    conhecidos.forEach(item => {
        const chave = normalizarEndereco(item.endereco);
        if (chave) buscaContagemEnderecos.set(chave, (buscaContagemEnderecos.get(chave) || 0) + 1);
    });
    conhecidos.forEach(item => {
        const chave = normalizarEndereco(item.endereco);
        const totalServidor = Number(item.qtdEndereco || 0);
        if (chave && totalServidor > (buscaContagemEnderecos.get(chave) || 0)) buscaContagemEnderecos.set(chave, totalServidor);
    });
}

function obterResultadoBuscaPorLinha(linha) {
    return todosResultadosBusca.find(item => Number(item.linha) === Number(linha)) || buscaResultadosAuxiliares.get(Number(linha)) || null;
}

function abrirCartaoDaListaBusca(linha) {
    abrirEditorBuscaRapido(Number(linha));
}

async function abrirListaMoradoresBusca(linhaAtual) {
    const atual = obterResultadoBuscaPorLinha(linhaAtual);
    if (!atual) return;
    const enderecoOriginal = atual.endereco || '';
    const editorArea = document.getElementById('busca-editor-area');
    if (!editorArea) return;
    editorArea.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b;">\u23F3 Carregando moradores...</div>';
    const cartoes = await obterCartoesMesmoEnderecoBusca(enderecoOriginal);
    if (!cartoes.length) return;
    incluirResultadosAuxiliaresBusca(cartoes);
    let listaHtml = '<ul style="list-style:none; padding:0; margin:10px 0; max-height:200px; overflow:auto;">';
    cartoes.forEach(cartao => {
        const isAtual = Number(cartao.linha) === Number(linhaAtual);
        listaHtml += `
            <li role="button" tabindex="0" onclick="abrirCartaoDaListaBusca(${Number(cartao.linha)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();abrirCartaoDaListaBusca(${Number(cartao.linha)});}" style="margin:4px 0; padding:9px; background:${isAtual ? '#e3f2fd' : '#f9f9f9'}; border:1px solid ${isAtual ? '#90caf9' : '#e5e7eb'}; border-radius:8px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; transition:.2s;" onmouseover="this.style.transform='translateX(4px)'" onmouseout="this.style.transform='translateX(0)'">
                <div><strong>${escapeHtml(cartao.nome)}</strong><br><small>\uD83D\uDCCD N\u00BA ${escapeHtml(cartao.numero || '-')}</small></div>
                ${isAtual ? '<span style="font-size:12px; background:#2196f3; color:white; padding:4px 10px; border-radius:12px;">ATUAL</span>' : '<span style="font-size:12px; background:#1B4F1F; color:white; padding:4px 10px; border-radius:12px;">ABRIR \u2192</span>'}
            </li>`;
    });
    listaHtml += '</ul>';
    editorArea.innerHTML = `
        <h4>\uD83D\uDC65 Moradores do endere\u00E7o</h4>
        <p style="background:#e8f5e9; padding:6px; border-radius:6px;">\uD83D\uDCCD ${escapeHtml(enderecoOriginal)}</p>
        ${listaHtml}
        <button class="btn-cancelar" onclick="cancelarEdicaoBusca(${Number(linhaAtual)})">Fechar</button>`;
}

async function abrirEdicaoMassivaBusca(linhaAtual) {
    const atual = obterResultadoBuscaPorLinha(linhaAtual);
    if (!atual) return;

    const editorArea = document.getElementById('busca-editor-area');
    if (!editorArea) return;

    editorArea.innerHTML =
        '<div style="text-align:center;padding:30px;color:#64748b;">⏳ Conferindo nome e endereço...</div>';

    const cartoesDoEndereco =
        await obterCartoesMesmoEnderecoBusca(atual.endereco || '');

    // REGRA PRINCIPAL:
    // NÃO usa todos os moradores do endereço.
    // Filtra exclusivamente a MESMA pessoa.
    const cartoes =
        filtrarCartoesMesmaPessoaMesmoEnderecoBusca(
            cartoesDoEndereco,
            atual
        );

    if (cartoes.length <= 1) {
        editorArea.innerHTML = `
            <div style="text-align:center;padding:30px;color:#64748b;">
                <div style="font-size:34px;margin-bottom:8px;">🛡️</div>
                <strong>Nenhum outro cartão da mesma pessoa foi encontrado.</strong>
                <br><br>
                Existem outros moradores nesse endereço, mas eles
                <b>não serão incluídos</b> na edição.
                <br><br>
                O EDITAR TODOS exige:
                <b>mesmo endereço + mesmo nome/nome abreviado</b>.
                <br>
                <button
                    class="btn-voltar"
                    style="margin:15px auto 0;"
                    onclick="cancelarEdicaoBusca(${Number(linhaAtual)})"
                >
                    ← Voltar
                </button>
            </div>`;
        return;
    }

    const linhas = cartoes.map(it => Number(it.linha));
    const nomes = [
        ...new Set(
            cartoes.map(it => String(it.nome || '').trim())
        )
    ];

    editorArea.style.display = 'block';

    editorArea.innerHTML = `
        <div id="editorMassaBusca" class="editor-massa active">

            <h4>
                ✏️ Editar cartões da mesma pessoa
                (${linhas.length})
            </h4>

            <div style="
                background:#ecfdf5;
                border:1px solid #86efac;
                color:#166534;
                padding:10px 12px;
                border-radius:10px;
                margin-bottom:12px;
                line-height:1.45;
            ">
                <b>🛡️ Proteção ativa</b><br>
                Somente cartões com <b>mesmo endereço</b> e
                <b>mesmo nome ou nome abreviado</b>
                serão alterados.
            </div>

            <p style="line-height:1.5;">
                📍 ${escapeHtml(atual.endereco || '')}<br>
                👤 ${escapeHtml(nomes.join(' / '))}
            </p>

            <label>Status</label>
            <select id="massa-status-busca">
                <option value="">Manter atual</option>
                <option value="ENTREGUE">ENTREGUE</option>
                <option value="BLOQUEADO">BLOQUEADO</option>
            </select>

            <label>Data Entrega</label>
            <input
                id="massa-dataentrega-busca"
                placeholder="dd/mm/yyyy"
            >

            <label>CPF</label>
            <input
                id="massa-cpf-busca"
                placeholder="CPF para todos"
            >

            <label>Entregue À</label>
            <input
                id="massa-entrega-busca"
                placeholder="Entregue À para todos"
            >

            <label>Telefone</label>
            <input
                id="massa-telefone-busca"
                placeholder="Telefone para todos"
            >

            <div style="
                display:flex;
                gap:8px;
                margin-top:12px;
                flex-wrap:wrap;
            ">
                <button
                    class="btn-salvar"
                    onclick='salvarEdicaoMassivaBusca(
                        ${JSON.stringify(linhas)},
                        ${Number(linhaAtual)}
                    )'
                >
                    Salvar somente nesta pessoa
                </button>

                <button
                    class="btn-cancelar"
                    onclick="cancelarEdicaoBusca(${Number(linhaAtual)})"
                >
                    Cancelar
                </button>
            </div>
        </div>`;
}

async function salvarEdicaoMassivaBusca(linhas, linhaReferencia) {
    const dados = {};

    const status =
        document.getElementById('massa-status-busca')?.value;

    const dataEntrega =
        document.getElementById(
            'massa-dataentrega-busca'
        )?.value.trim();

    const cpf =
        document.getElementById(
            'massa-cpf-busca'
        )?.value.trim();

    const entregueA =
        document.getElementById(
            'massa-entrega-busca'
        )?.value.trim();

    const telefone =
        document.getElementById(
            'massa-telefone-busca'
        )?.value.trim();

    if (status) dados.status = status;
    if (dataEntrega) dados.dataEntrega = dataEntrega;
    if (cpf) dados.cpf = cpf;
    if (entregueA) dados.entregueA = entregueA;
    if (telefone) dados.telefone = telefone;

    try {
        await postParaGoogleSheets(
            'atualizarMultiplosCartoes',
            {
                linhas,
                dados,
                linhaReferencia:
                    Number(
                        linhaReferencia ||
                        linhas[0]
                    )
            }
        );

        alert(
            '✅ Alterações aplicadas somente aos cartões da mesma pessoa!'
        );

        cancelarEdicaoBusca(
            Number(
                linhaReferencia ||
                linhas[0]
            )
        );

        executarBusca();

    } catch (erro) {
        alert(
            'Erro: ' +
            erro.message
        );
    }
}


// ============================================================
// CARTEIRINHAS + COMPRA E VENDA
// Migração dos antigos pop-ups do Google Sheets para o CRM.
// ============================================================

const COMPRA_VENDA_HTML_CRM = "<!DOCTYPE html>\n<html>\n\n<head>\n\n<!-- jQuery e Summernote (Editor de Texto Rico) -->\n<script src=\"https://code.jquery.com/jquery-3.6.0.min.js\"></script>\n<link href=\"https://cdn.jsdelivr.net/npm/summernote@0.9.0/dist/summernote-lite.min.css\" rel=\"stylesheet\">\n<script src=\"https://cdn.jsdelivr.net/npm/summernote@0.9.0/dist/summernote-lite.min.js\"></script>\n\n<style>\n\n@media print {\n\n  .no-print,\n  .no-print * {\n    display: none !important;\n    visibility: hidden !important;\n  }\n\n  body {\n    -webkit-print-color-adjust: exact !important;\n    print-color-adjust: exact !important;\n    margin: 0;\n    padding: 0;\n    background: white !important;\n  }\n\n  /* =========================\n     PADRÃO = IMPRIME SÓ CONTRATO\n  ========================= */\n\n  #notaFiscal {\n    display: none !important;\n  }\n\n  .container {\n    display: block !important;\n  }\n\n  /* =========================\n     QUANDO FOR IMPRIMIR NOTA\n  ========================= */\n\n  body.imprimindo-nota .container {\n    display: none !important;\n  }\n\n  body.imprimindo-nota #notaFiscal {\n    display: block !important;\n    zoom: 0.40 !important;\n    width: 1000px !important;\n    margin: 0 auto !important;\n    padding: 0 !important;\n  }\n\n  /* =========================\n     IMPRESSÃO: ESCONDE O EDITOR E MOSTRA A CAIXA RESERVA\n  ========================= */\n  #obs-container, #obs-container * {\n    background: transparent !important;\n    border: none !important;\n    outline: none !important;\n    box-shadow: none !important;\n  }\n\n  #wrapper-obs {\n    display: none !important;\n  }\n\n  #print-area-obs {\n    display: block !important;\n    height: 155px !important;\n    max-height: 155px !important;\n    min-height: 155px !important;\n    width: 100% !important;\n    padding: 0 !important;\n    margin: 0 !important;\n    overflow: hidden !important;\n    font-weight: bold !important;\n    font-size: 14px !important;\n    font-family: Arial, sans-serif !important;\n  }\n}\n\nbody {\n  margin: 0;\n  font-family: 'Segoe UI', Arial, sans-serif;\n  background: #f2f2f2;\n}\n\n/* =========================\n   MENU PRINCIPAL (3 Botões)\n========================= */\n#menu-principal {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 800px;\n  height: 1150px;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  align-items: center;\n  background: #eaf4f4;\n  z-index: 100;\n  border-radius: 8px;\n  box-shadow: inset 0 0 30px rgba(0,0,0,0.05);\n}\n\n#menu-principal h2 {\n  font-size: 28px;\n  color: #1a3b3b;\n  margin-bottom: 50px;\n  text-transform: uppercase;\n  letter-spacing: 2px;\n  border-bottom: 3px solid #1a3b3b;\n  padding-bottom: 15px;\n}\n\n.menu-botoes {\n  display: flex;\n  flex-direction: column;\n  gap: 20px;\n  align-items: center;\n}\n\n.btn-menu {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 15px;\n  width: 320px;\n  height: 70px;\n  border: none;\n  border-radius: 40px;\n  font-size: 22px;\n  font-weight: bold;\n  color: white;\n  cursor: pointer;\n  transition: all 0.3s ease;\n  box-shadow: 0 6px 15px rgba(0,0,0,0.15);\n  padding: 15px 25px;\n}\n\n.btn-menu span {\n  font-size: 30px;\n}\n\n.btn-menu:hover {\n  transform: translateY(-5px) scale(1.02);\n  box-shadow: 0 10px 25px rgba(0,0,0,0.25);\n}\n\n.btn-menu:active {\n  transform: scale(0.95);\n}\n\n.btn-compra {\n  background: linear-gradient(145deg, #004d99, #003366);\n}\n\n.btn-transferencia {\n  background: linear-gradient(145deg, #2e7d32, #1b5e20);\n}\n\n.btn-atualizacao {\n  background: linear-gradient(145deg, #b8860b, #8b6508);\n}\n\n/* =========================\n   CONTAINER DO CONTRATO\n========================= */\n.container {\n  position: relative;\n  width: 800px;\n  height: 1150px;\n  background-image: url(\"https://i.imgur.com/u0FKrsJ.png\");\n  background-size: cover;\n  display: none; /* Começa oculto */\n  border-radius: 8px;\n}\n\n.btn-voltar {\n  position: absolute;\n  top: 15px;\n  left: 15px;\n  z-index: 30;\n  background: rgba(255, 255, 255, 0.95);\n  color: #333;\n  border: 1px solid #ccc;\n  padding: 8px 16px;\n  border-radius: 20px;\n  font-weight: bold;\n  font-size: 14px;\n  cursor: pointer;\n  box-shadow: 0 2px 8px rgba(0,0,0,0.1);\n  transition: 0.2s;\n}\n.btn-voltar:hover {\n  background: #fff;\n  box-shadow: 0 4px 12px rgba(0,0,0,0.2);\n}\n\n.campo {\n  position: absolute;\n  background-color: transparent;\n  font-weight: bold;\n  font-size: 14px;\n  border: none;\n  text-transform: uppercase;\n}\n\ninput[type=\"text\"],\nselect {\n  background-color: rgba(255,255,255,0.75);\n  border: 1px solid #999;\n  padding: 2px 4px;\n  font-weight: bold;\n  font-size: 16px;\n  text-transform: uppercase;\n  z-index: 2;\n  box-sizing: border-box;\n}\n\n.btn {\n  position: absolute;\n  bottom: 20px;\n  left: 50%;\n  transform: translateX(-50%);\n  padding: 10px 20px;\n  background-color: green;\n  color: white;\n  border: none;\n  font-size: 18px;\n  border-radius: 5px;\n  cursor: pointer;\n  z-index: 10;\n}\n\n.btn-imprimir {\n  left: calc(50% + 130px);\n  background-color: #2196F3;\n}\n\n.btn-buscar-cpf {\n  position: absolute;\n  background-color: #ff9800;\n  color: white;\n  border: none;\n  border-radius: 4px;\n  padding: 2px 10px;\n  font-size: 12px;\n  cursor: pointer;\n  z-index: 5;\n}\n.btn-buscar-cpf:hover {\n  background-color: #e68900;\n}\n\n</style>\n\n\n<script>\n(function () {\n  function criarRunner(successHandler, failureHandler) {\n    return new Proxy({}, {\n      get: function (_, prop) {\n        if (prop === 'withSuccessHandler') {\n          return function (fn) {\n            return criarRunner(fn, failureHandler);\n          };\n        }\n\n        if (prop === 'withFailureHandler') {\n          return function (fn) {\n            return criarRunner(successHandler, fn);\n          };\n        }\n\n        return function () {\n          const args = Array.prototype.slice.call(arguments);\n\n          Promise.resolve(\n            window.parent.compraVendaBridgeCall(String(prop), args)\n          )\n          .then(function (res) {\n            if (typeof successHandler === 'function') {\n              successHandler(res);\n            }\n          })\n          .catch(function (err) {\n            const erro = {\n              message: err && err.message ? err.message : String(err)\n            };\n\n            if (typeof failureHandler === 'function') {\n              failureHandler(erro);\n            } else {\n              console.error('Erro no módulo Compra e Venda:', erro.message);\n              alert('Erro: ' + erro.message);\n            }\n          });\n        };\n      }\n    });\n  }\n\n  window.google = window.google || {};\n  window.google.script = window.google.script || {};\n\n  Object.defineProperty(window.google.script, 'run', {\n    configurable: true,\n    get: function () {\n      return criarRunner(null, null);\n    }\n  });\n})();\n</script>\n\n</head>\n\n<body>\n\n<!-- =========================\n   MENU PRINCIPAL (3 BOTÕES)\n========================= -->\n<div id=\"menu-principal\" class=\"no-print\">\n    <h2>Selecione o Tipo de Documento</h2>\n    <div class=\"menu-botoes\">\n        <button class=\"btn-menu btn-compra\" onclick=\"selecionarTipo('compra')\">\n            <span>📜</span> COMPRA E VENDA\n        </button>\n        <button class=\"btn-menu btn-transferencia\" onclick=\"selecionarTipo('transferencia')\">\n            <span>🔄</span> TRANSFERÊNCIA (Posse)\n        </button>\n        <button class=\"btn-menu btn-atualizacao\" onclick=\"selecionarTipo('atualizacao')\">\n            <span>📝</span> ATUALIZAÇÃO (Posse)\n        </button>\n    </div>\n</div>\n\n<!-- =========================\nCONTRATO (SEUS CAMPOS ORIGINAIS)\n========================= -->\n\n<div class=\"container\" id=\"container-formulario\">\n\n    <button class=\"btn-voltar no-print\" onclick=\"voltarMenu()\">↩ VOLTAR</button>\n\n    <!-- CABEÇALHO & CAMPOS FIXOS -->\n    <input class=\"campo\" id=\"contrato\" style=\"top: 267px; left: 160px; width: 70px;\">\n    <input class=\"campo\" id=\"data\" style=\"top: 269px; left: 315px; width: 150px;\">\n    <input class=\"campo\" id=\"ano\" style=\"top: 268px; left: 610px; width: 60px;\">\n\n    <input class=\"campo\" id=\"cep\" style=\"top: 336px; left: 610px; width: 100px;\" onblur=\"buscarCEP()\">\n    <button type=\"button\" id=\"btnBuscarCEP\" class=\"button no-print\" style=\"position:absolute; top:565px; left:690px; z-index:2; padding:4px 8px; font-size:12px; background:#ff9800; color:#fff; border:none; border-radius:4px; cursor:pointer;\" onclick=\"buscarCEP()\">Buscar CEP</button>\n\n    <input class=\"campo\" id=\"proprietario\" style=\"top:292px; left:185px; width:540px;\">\n    <input class=\"campo\" id=\"endereco\" style=\"top:336px; left:163px; width:390px;\">\n    \n    <input class=\"campo\" id=\"rg\" style=\"top:360px; left:110px; width:100px;\">\n    <input class=\"campo\" id=\"emissor\" style=\"top:360px; left:330px; width:90px;\">\n    <input class=\"campo\" id=\"cpf\" style=\"top:360px; left:590px; width:130px;\">\n    <button type=\"button\" id=\"btnBuscarCPF\" class=\"btn-buscar-cpf no-print\" style=\"top:358px; left:730px; z-index:5;\" onclick=\"buscarCPF()\">Buscar</button>\n\n    <input class=\"campo\" id=\"nacionalidade\" style=\"top:381px; left:219px; width:180px;\">\n    <input class=\"campo\" id=\"naturalidade\" style=\"top:381px; left:540px; width:180px;\">\n    <input class=\"campo\" id=\"estadocivil\" style=\"top:404px; left:195px; width:180px;\">\n    <input class=\"campo\" id=\"profissao\" style=\"top:404px; left:469px; width:200px;\">\n    \n    <input class=\"campo\" id=\"bairro\" style=\"top:428px; left:145px; width:180px;\">\n    <input class=\"campo\" id=\"municipio\" style=\"top:428px; left:470px; width:180px;\">\n    <input class=\"campo\" id=\"uf\" style=\"top:426px; left:660px; width:60px;\">\n\n    <input class=\"campo\" id=\"frente\" style=\"top:450px; left:250px; width:70px;\">\n    <input class=\"campo\" id=\"lateral\" style=\"top:450px; left:420px; width:70px;\">\n    <input class=\"campo\" id=\"total\" style=\"top:450px; left:650px; width:70px;\">\n\n    <input class=\"campo\" id=\"valor\" style=\"top:473px; left:230px; width:420px;\" onblur=\"formatarValor()\"/>\n\n    <!-- CAMPO FORMA DE PAGAMENTO -->\n    <select class=\"campo\" id=\"pagamento\" style=\"top:495px; left:280px; width:400px;\">\n        <option value=\"\">Selecione</option>\n        <option value=\"À VISTA\">À VISTA</option>\n        <option value=\"TRANSFERÊNCIA\">TRANSFERÊNCIA</option>\n        <option value=\"DOAÇÃO\">DOAÇÃO</option>\n        <option value=\"ATUALIZAÇÃO\">ATUALIZAÇÃO</option>\n        <option value=\"PARCELADO\">PARCELADO</option>\n        <option value=\"DESMEMBRAMENTO\">DESMEMBRAMENTO</option>\n    </select>\n\n    <!-- DROPDOWN DE SITUAÇÃO (SÓ VAI APARECER NA COMPRA E VENDA) -->\n    <select class=\"campo\" id=\"tipo_transferencia\" style=\"top: 522px; left: 80px; width: 100px; display: none;\" onchange=\"atualizarCampoTransferente()\">\n        <option value=\"ATUALIZAÇÃO\">ATUALIZAÇÃO</option>\n        <option value=\"TRANSFERÊNCIA\">TRANSFERÊNCIA</option>\n    </select>\n    \n    <!-- CAMPO VENDEDOR / TESTEMUNHA -->\n    <input class=\"campo\" id=\"vendedor\" style=\"top:522px; left:190px; width:530px;\" oninput=\"copiarVendedorParaDeclarante()\">\n    \n    <input class=\"campo\" id=\"rgvendedor\" style=\"top:575px; left:100px; width:130px;\">\n    <input class=\"campo\" id=\"emissorv\" style=\"top:575px; left:430px; width:90px;\">\n    <input class=\"campo\" id=\"cpfvendedor\" style=\"top:575px; left:590px; width:150px;\">\n\n    <input class=\"campo\" id=\"declarante\" style=\"top:600px; left:190px; width:520px;\">\n\n    <!-- =========================\n       CAIXA DE TEXTO COM EDITOR (TELA) E CAIXA RESERVA (IMPRESSÃO)\n    ========================= -->\n    <div id=\"obs-container\" style=\"position:absolute; top:730px; left:90px; width:650px; height:155px; z-index:2;\">\n        \n        <!-- Editor com botões na tela -->\n        <div id=\"wrapper-obs\" style=\"width:100%; height:100%; background:rgba(255,255,255,0.75); border:1px solid #999; overflow:hidden; border-radius:4px;\">\n            <textarea id=\"obs\" style=\"width:100%; height:100%; border:none; padding:8px; resize:none; background:transparent; font-weight:bold; font-size:14px; font-family:Arial; box-sizing:border-box;\"></textarea>\n        </div>\n        \n        <!-- Caixa de texto invisível para impressão -->\n        <div id=\"print-area-obs\" style=\"width:100%; height:100%; background:transparent; border:none; overflow:hidden; display:none; font-weight:bold; font-size:14px; font-family:Arial; padding:8px; box-sizing:border-box; white-space:pre-wrap;\"></div>\n    </div>\n\n    <button class=\"btn no-print\" type=\"button\" onclick=\"salvar()\">Salvar</button>\n    <button class=\"btn btn-imprimir no-print\" type=\"button\" onclick=\"imprimir()\">Imprimir</button>\n\n</div>\n\n<!-- =========================\nNOTA FISCAL NOVA\n========================= -->\n\n<div id=\"notaFiscal\" style=\"display:none; width:850px; margin:auto; padding:20px; font-family:Arial; background:white;\">\n<div style=\"border:5px solid #0f6b38; border-radius:35px; padding:35px; position:relative; overflow:hidden; background:white;\">\n<div style=\"display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:30px;\">\n<div style=\"display:flex; align-items:center; gap:20px;\">\n<img src='https://i.imgur.com/sX9Nm0k.png' style='width:160px; height:160px; object-fit:contain; border-radius:50%; border:4px solid #0f6b38; padding:10px;'>\n<div>\n<div style=\"font-size:34px; font-weight:bold; color:#0f6b38; line-height:1.1;\">ASSOCIAÇÃO<br>MORADORES<br><span style=\"color:#5ea532;\">PARQUE VILA NOVA</span></div>\n<div style=\"margin-top:10px; font-size:16px; color:#2b5c36;\">TRABALHANDO POR UMA<br>COMUNIDADE MELHOR</div>\n</div>\n</div>\n<div style=\"text-align:right;\">\n<div style=\"font-size:60px; font-weight:bold; color:#0f6b38; line-height:1;\">NOTA FISCAL</div>\n<div style=\"margin-top:20px; border:3px solid #5ea532; border-radius:15px; padding:15px 25px; font-size:40px; font-weight:bold; color:#5ea532;\">Nº <span id=\"numeroNota\"></span></div>\n</div>\n</div>\n\n<div style=\"border:3px solid #5ea532; border-radius:25px; padding:30px; margin-bottom:30px;\">\n<div style=\"font-size:18px; color:#2b5c36; margin-bottom:8px;\">NOME:</div>\n<div id=\"notaNome\" style=\"font-size:42px; font-weight:bold; margin-bottom:25px;\"></div>\n<div style=\"font-size:18px; color:#2b5c36; margin-bottom:8px;\">CPF:</div>\n<div id=\"notaCPF\" style=\"font-size:32px; font-weight:bold; margin-bottom:25px;\"></div>\n<div style=\"font-size:18px; color:#2b5c36; margin-bottom:8px;\">FORMA DE PAGAMENTO:</div>\n<div id=\"notaPagamento\" style=\"font-size:32px; font-weight:bold; margin-bottom:25px;\"></div>\n<div style=\"font-size:18px; color:#2b5c36; margin-bottom:8px;\">VALOR DO DOCUMENTO:</div>\n<div id=\"notaValor\" style=\"font-size:50px; font-weight:bold; color:#0f6b38;\"></div>\n</div>\n\n<table style=\"width:100%; border-collapse:collapse; border:3px solid #0f6b38; overflow:hidden; border-radius:20px;\">\n<tr style=\"background:linear-gradient(90deg,#006b3a,#6ab536); color:white;\">\n<th style=\"padding:20px; font-size:26px;\">DESCRIÇÃO</th>\n<th style=\"font-size:26px; width:250px;\">VALOR</th>\n</tr>\n<tr>\n<td style=\"padding:35px; font-size:30px; border-right:2px solid #0f6b38;\">PRESTAÇÃO DE SERVIÇOS / DOCUMENTAÇÃO</td>\n<td style=\"text-align:center; font-size:36px; font-weight:bold;\"><span id=\"notaValorTabela\"></span></td>\n</tr>\n<tr>\n<td style=\"text-align:right; padding:25px; font-size:34px; font-weight:bold; color:#0f6b38;\">TOTAL</td>\n<td style=\"text-align:center; font-size:45px; font-weight:bold; color:#0f6b38;\"><span id=\"notaTotal\"></span></td>\n</tr>\n</table>\n<div style=\"margin-top:70px; text-align:center;\"><div style=\"width:420px; margin:auto; border-top:3px solid #0f6b38; padding-top:12px; font-size:28px; color:#0f6b38;\">ASSINATURA</div></div>\n</div>\n</div>\n\n<script>\n\n    // ============================================================\n    // 🔴 LINKS DOS 3 BACKGROUNDS\n    // ============================================================\n    const url_fundo_compra = \"https://i.imgur.com/L1Qv1pI.png\";\n    const url_fundo_transferencia = \"https://i.imgur.com/Ea22z5w.png\";\n    const url_fundo_atualizacao = \"https://i.imgur.com/yFpEQSo.png\";\n    // ============================================================\n\n    // =========================\n    // LÓGICA DO MENU (3 Botões e Ajuste de Layout)\n    // =========================\n    function selecionarTipo(tipo) {\n        document.getElementById('menu-principal').style.display = 'none';\n        const container = document.getElementById('container-formulario');\n        \n        if (tipo === 'compra') {\n            container.style.backgroundImage = \"url('\" + url_fundo_compra + \"')\";\n        } else if (tipo === 'transferencia') {\n            container.style.backgroundImage = \"url('\" + url_fundo_transferencia + \"')\";\n        } else if (tipo === 'atualizacao') {\n            container.style.backgroundImage = \"url('\" + url_fundo_atualizacao + \"')\";\n        }\n        \n        ajustarLayout(tipo);\n        container.style.display = 'block';\n    }\n\n    function voltarMenu() {\n        document.getElementById('container-formulario').style.display = 'none';\n        document.getElementById('menu-principal').style.display = 'flex';\n    }\n\n    // =========================\n    // CONTROLE DO DROPDOWN E LAYOUT\n    // =========================\n    function atualizarCampoTransferente() {\n        const tipo = document.getElementById('tipo_transferencia').value;\n        const campo = document.getElementById('vendedor');\n        if (tipo === 'ATUALIZAÇÃO') {\n            campo.value = '';\n            campo.disabled = true;\n            campo.style.opacity = '0.6';\n            document.getElementById('declarante').value = ''; \n        } else {\n            campo.disabled = false;\n            campo.style.opacity = '1';\n        }\n    }\n\n    function ajustarLayout(tipo) {\n        const dropdownSituacao = document.getElementById('tipo_transferencia');\n        const campoPagamento = document.getElementById('pagamento');\n        const campoVendedor = document.getElementById('vendedor');\n        const campoDeclarante = document.getElementById('declarante');\n        const containerObs = document.getElementById('obs-container');\n        \n        const btnBuscarCEP = document.getElementById('btnBuscarCEP');\n        const btnBuscarCPF = document.getElementById('btnBuscarCPF');\n        \n        // Elementos RG, Emissor, CPF do Transferente\n        const rgVendedor = document.getElementById('rgvendedor');\n        const emissorV = document.getElementById('emissorv');\n        const cpfVendedor = document.getElementById('cpfvendedor');\n        \n        if (tipo === 'compra') {\n            // =========================\n            // COMPRA E VENDA\n            // =========================\n            dropdownSituacao.style.display = 'none'; \n            campoPagamento.style.display = 'block';\n            \n            btnBuscarCEP.style.display = 'block';\n            btnBuscarCPF.style.display = 'block';\n            \n            campoVendedor.style.top = '522px';\n            campoVendedor.style.left = '190px';\n            campoVendedor.style.width = '530px';\n            campoVendedor.disabled = false;\n            campoVendedor.style.opacity = '1';\n            \n            rgVendedor.style.display = 'block';\n            emissorV.style.display = 'block';\n            cpfVendedor.style.display = 'block';\n            \n            campoDeclarante.style.top = '600px';\n            campoDeclarante.style.left = '190px';\n            campoDeclarante.style.width = '520px';\n            \n            containerObs.style.top = '730px';\n            containerObs.style.height = '155px';\n            \n        } else if (tipo === 'transferencia') {\n            // =========================\n            // TRANSFERÊNCIA (POSSE)\n            // =========================\n            dropdownSituacao.style.display = 'none';\n            campoPagamento.style.display = 'none';\n            \n            btnBuscarCEP.style.display = 'none';\n            btnBuscarCPF.style.display = 'none';\n            \n            // Campo Transferente deslocado para a direita\n            campoVendedor.style.top = '522px';\n            campoVendedor.style.left = '205px';\n            campoVendedor.style.width = '585px';\n            campoVendedor.disabled = false;\n            campoVendedor.style.opacity = '1';\n            \n            // RG, Emissor e CPF do Transferente APARECEM\n            rgVendedor.style.display = 'block';\n            emissorV.style.display = 'block';\n            cpfVendedor.style.display = 'block';\n            \n            rgVendedor.style.top = '575px';\n            rgVendedor.style.left = '100px';\n            emissorV.style.top = '575px';\n            emissorV.style.left = '430px';\n            cpfVendedor.style.top = '575px';\n            cpfVendedor.style.left = '590px';\n            \n            campoDeclarante.style.top = '600px';\n            campoDeclarante.style.left = '190px';\n            campoDeclarante.style.width = '520px';\n            \n            containerObs.style.top = '730px';\n            containerObs.style.height = '155px';\n\n        } else if (tipo === 'atualizacao') {\n            // =========================\n            // ATUALIZAÇÃO (POSSE) - CORREÇÃO DO TESTEMUNHA\n            // =========================\n            dropdownSituacao.style.display = 'none';\n            campoPagamento.style.display = 'none';\n            \n            btnBuscarCEP.style.display = 'none';\n            btnBuscarCPF.style.display = 'none';\n            \n            // Testemunha alinhada (Aumentei o left levemente para 205px para dar um pequeno espaço)\n            campoVendedor.style.top = '602px';\n            campoVendedor.style.left = '185px';\n            campoVendedor.style.width = '585px';\n            campoVendedor.disabled = false;\n            campoVendedor.style.opacity = '1';\n            \n            // RG, Emissor e CPF do Transferente DESAPARECEM\n            rgVendedor.style.display = 'none';\n            emissorV.style.display = 'none';\n            cpfVendedor.style.display = 'none';\n            \n            campoDeclarante.style.top = '690px';\n            campoDeclarante.style.left = '190px';\n            campoDeclarante.style.width = '520px';\n            \n            containerObs.style.top = '675px';\n            containerObs.style.height = '155px';\n        }\n    }\n\n    /* =========================\n    JAVASCRIPT ORIGINAL\n    ========================= */\n\n    function calcularTotal() {\n      const frente = parseFloat(document.getElementById(\"frente\").value) || 0;\n      const lateral = parseFloat(document.getElementById(\"lateral\").value) || 0;\n      const total = (frente * lateral).toFixed(2);\n      document.getElementById(\"total\").value = total + \" m²\";\n    }\n\n    document.getElementById(\"frente\").addEventListener(\"input\", calcularTotal);\n    document.getElementById(\"lateral\").addEventListener(\"input\", calcularTotal);\n\n    let ultimoValorDigitado = \"\";\n\n    function formatarValor() {\n      const input = document.getElementById(\"valor\");\n      let valorBruto = input.value.replace(/\\D/g, '');\n      if (!valorBruto) {\n        ultimoValorDigitado = \"\";\n        return;\n      }\n      if (valorBruto === ultimoValorDigitado) return;\n      const valor = parseInt(valorBruto);\n      const valorMilhar = valor * 1000;\n      const valorFormatado = valorMilhar.toLocaleString('pt-BR') + \",00\";\n      const extenso = numeroPorExtenso(valor).trim() + \" MIL REAIS\";\n      input.value = `${valorFormatado} (${extenso})`;\n      ultimoValorDigitado = valorBruto;\n    }\n\n    function numeroPorExtenso(n) {\n      const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];\n      const especiais = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];\n      const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];\n      const centenas = ['', 'cem', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];\n\n      if (n === 0) return 'zero';\n      if (n === 100) return 'cem';\n      let partes = [];\n      if (n >= 100) {\n        let c = Math.floor(n / 100);\n        partes.push(n % 100 === 0 ? centenas[c] : (c === 1 ? 'cento' : centenas[c]));\n        n %= 100;\n      }\n      if (n >= 20) {\n        let d = Math.floor(n / 10);\n        partes.push(dezenas[d]);\n        n %= 10;\n      } else if (n >= 10) {\n        partes.push(especiais[n - 10]);\n        n = 0;\n      }\n      if (n > 0) partes.push(unidades[n]);\n      return partes.join(' e ');\n    }\n\n    function copiarVendedorParaDeclarante() {\n      document.getElementById(\"declarante\").value = document.getElementById(\"vendedor\").value;\n    }\n\n    window.onload = () => {\n      const hoje = new Date();\n      const meses = [\"JANEIRO\", \"FEVEREIRO\", \"MARÇO\", \"ABRIL\", \"MAIO\", \"JUNHO\", \"JULHO\", \"AGOSTO\", \"SETEMBRO\", \"OUTUBRO\", \"NOVEMBRO\", \"DEZEMBRO\"];\n      document.getElementById(\"data\").value = `${hoje.getDate()} DE ${meses[hoje.getMonth()]}`;\n      document.getElementById(\"ano\").value = hoje.getFullYear();\n      google.script.run.withSuccessHandler(num => {\n        document.getElementById(\"contrato\").value = String(num).padStart(6, '0');\n      }).obterProximoNumeroContrato();\n\n      // =========================\n      // INICIALIZA O EDITOR DE TEXTO RICO\n      // =========================\n      $('#obs').summernote({\n          height: 155,\n          minHeight: 100,\n          maxHeight: 200,\n          toolbar: [\n              ['style', ['bold', 'italic', 'underline']],\n              ['fontsize', ['fontsize']],\n              ['para', ['ul', 'ol', 'paragraph']],\n              ['clear', ['clear']]\n          ],\n          placeholder: 'Digite aqui as cláusulas, observações e informações extras...'\n      });\n    };\n\n    function coletarDados() {\n      // NOTA: O array tem 21 itens (campoExtra1 e campoExtra2 foram removidos)\n      return [\n        document.getElementById(\"contrato\").value,\n        document.getElementById(\"data\").value,\n        document.getElementById(\"ano\").value,\n        document.getElementById(\"proprietario\").value,\n        document.getElementById(\"cpf\").value,\n        document.getElementById(\"rg\").value,\n        document.getElementById(\"cep\").value,\n        document.getElementById(\"endereco\").value,\n        document.getElementById(\"bairro\").value,\n        document.getElementById(\"municipio\").value,\n        document.getElementById(\"uf\").value,\n        document.getElementById(\"vendedor\").value,\n        document.getElementById(\"cpfvendedor\").value,\n        document.getElementById(\"rgvendedor\").value,\n        document.getElementById(\"frente\").value + \"m\",\n        document.getElementById(\"lateral\").value + \"m\",\n        document.getElementById(\"total\").value,\n        document.getElementById(\"pagamento\").value,\n        document.getElementById(\"valor\").value,\n        document.getElementById(\"declarante\").value,\n        $('#obs').summernote('code') // Salva o texto com toda a formatação HTML\n      ];\n    }\n\n    function salvar() {\n      const dados = coletarDados();\n      google.script.run.withSuccessHandler(() => {\n        alert(\"Dados salvos com sucesso!\");\n      }).salvarCompraVenda(dados);\n    }\n\n    function buscarCPF() {\n      const cpf = document.getElementById(\"cpf\").value.replace(/\\D/g, '');\n      if (cpf.length !== 11) {\n        alert(\"CPF inválido. Digite 11 números.\");\n        return;\n      }\n      google.script.run.withSuccessHandler(function(resultado) {\n        if (!resultado || !resultado.encontrado) {\n          alert(\"CPF não encontrado na base de dados.\");\n          return;\n        }\n        preencherDados(resultado.dados);\n      }).withFailureHandler(function(erro) {\n        alert(\"Erro ao buscar CPF: \" + erro.message);\n      }).buscarDadosPorCPFCompraVenda(cpf);\n    }\n\n    function preencherDados(dados) {\n      const mapa = {\n        'proprietario': dados.nome || '',\n        'rg': dados.rg || '',\n        'emissor': dados.emissor || '',\n        'nacionalidade': dados.nacionalidade || '',\n        'naturalidade': dados.naturalidade || '',\n        'estadocivil': dados.estadocivil || '',\n        'profissao': dados.profissao || '',\n        'endereco': dados.endereco || '',\n        'bairro': dados.bairro || '',\n        'municipio': dados.municipio || '',\n        'uf': dados.uf || '',\n        'cep': dados.cep || ''\n      };\n      Object.keys(mapa).forEach(id => {\n        const el = document.getElementById(id);\n        if (el) el.value = mapa[id];\n      });\n      if (dados.frente) document.getElementById('frente').value = dados.frente;\n      if (dados.lateral) document.getElementById('lateral').value = dados.lateral;\n      calcularTotal();\n    }\n\n    function imprimir() {\n      let valorDocumento = prompt(\"VALOR DO DOCUMENTO:\");\n      if (!valorDocumento) {\n        alert(\"Informe um valor.\");\n        return;\n      }\n      let formaPagamento = confirm(\"FORMA DE PAGAMENTO:\\n\\nOK = PIX\\nCANCELAR = DINHEIRO\");\n      let pagamentoSelecionado = formaPagamento ? \"PIX\" : \"DINHEIRO\";\n      valorDocumento = Number(valorDocumento.replace(\",\", \".\")).toLocaleString('pt-BR', {\n        style: 'currency',\n        currency: 'BRL'\n      });\n      const dados = coletarDados();\n\n      google.script.run.withSuccessHandler(() => {\n\n        // =========================\n        // PASSA O CONTEÚDO DO EDITOR PARA A CAIXA RESERVA\n        // =========================\n        const conteudo = $('#obs').summernote('code');\n        const textoLimpo = $('<div>').html(conteudo).text().trim();\n        const printArea = document.getElementById('print-area-obs');\n\n        if (textoLimpo.length > 0) {\n            printArea.innerHTML = conteudo;\n        } else {\n            printArea.innerHTML = '';\n        }\n\n        // =========================\n        // PRIMEIRA IMPRESSÃO: CONTRATO\n        // =========================\n        document.body.classList.remove(\"imprimindo-nota\");\n\n        setTimeout(() => {\n          try { window.print(); } catch (e) { console.log(\"Erro na impressão do contrato (ignorado):\", e); }\n        }, 500);\n\n        gerarNotaFiscal(valorDocumento, pagamentoSelecionado);\n\n        setTimeout(() => {\n          document.body.classList.add(\"imprimindo-nota\");\n          try { window.print(); } catch (e) { console.log(\"Erro na impressão da nota fiscal (ignorado):\", e); }\n          document.body.classList.remove(\"imprimindo-nota\");\n        }, 1000);\n\n        google.script.run.withSuccessHandler(novoNumero => {\n          document.getElementById(\"contrato\").value = String(novoNumero).padStart(6, '0');\n        }).incrementarNumeroContrato();\n        google.script.run.incrementarNumeroNota();\n\n      }).salvarCompraVenda(dados);\n    }\n\n    function gerarNotaFiscal(valorDocumento, pagamentoSelecionado) {\n      google.script.run.withSuccessHandler(numero => {\n        document.getElementById(\"numeroNota\").innerText = String(numero).padStart(6, '0');\n      }).obterProximoNumeroNota();\n      document.getElementById(\"notaNome\").innerText = document.getElementById(\"proprietario\").value.toUpperCase();\n      document.getElementById(\"notaCPF\").innerText = document.getElementById(\"cpf\").value;\n      document.getElementById(\"notaPagamento\").innerText = pagamentoSelecionado;\n      document.getElementById(\"notaValor\").innerText = valorDocumento;\n      document.getElementById(\"notaValorTabela\").innerText = valorDocumento;\n      document.getElementById(\"notaTotal\").innerText = valorDocumento;\n    }\n\n    function buscarCEP() {\n      const cep = document.getElementById(\"cep\").value.replace(/\\D/g,'');\n      if(cep.length !== 8){\n        alert(\"CEP inválido\");\n        return;\n      }\n      fetch(\"https://viacep.com.br/ws/\" + cep + \"/json/\")\n      .then(response => response.json())\n      .then(d => {\n        if(d.erro){\n          alert(\"CEP não encontrado\");\n          return;\n        }\n        document.getElementById(\"endereco\").value = (d.logradouro || \"\").toUpperCase();\n        document.getElementById(\"bairro\").value = (d.bairro || \"\").toUpperCase();\n        document.getElementById(\"municipio\").value = (d.localidade || \"\").toUpperCase();\n        document.getElementById(\"uf\").value = (d.uf || \"\").toUpperCase();\n      });\n    }\n\n</script>\n\n</body>\n</html>";

function localizarBotaoPorTextoCRM(texto) {
    const alvo = String(texto || '').trim().toUpperCase();

    return [...document.querySelectorAll('button, a, [role="button"]')]
        .find(el => String(el.textContent || '').trim().toUpperCase() === alvo) || null;
}

function localizarContainerBotoesCentraisCRM() {
    const textos = [
        'CURRICULO',
        'CURRÍCULO',
        'WHATSAPP',
        'ADC CARTÕES',
        'ADC CARTOES',
        'CESTAS',
        'BUSCAR'
    ];

    const encontrados = textos
        .map(localizarBotaoPorTextoCRM)
        .filter(Boolean);

    if (!encontrados.length) return null;

    const contagem = new Map();

    encontrados.forEach(el => {
        let pai = el.parentElement;
        let niveis = 0;

        while (pai && niveis < 4) {
            contagem.set(pai, (contagem.get(pai) || 0) + 1);
            pai = pai.parentElement;
            niveis++;
        }
    });

    return [...contagem.entries()]
        .sort((a, b) => b[1] - a[1])[0]?.[0] || encontrados[0].parentElement;
}

function criarBotaoModuloAntigoCRM(id, texto, referencia) {
    let btn = document.getElementById(id);
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.textContent = texto;

    if (referencia) {
        btn.className = referencia.className || '';
        btn.style.cssText = referencia.style.cssText || '';
    }

    // Garante aparência coerente mesmo se o botão de referência não tiver style inline.
    btn.style.cursor = 'pointer';
    btn.style.minWidth = btn.style.minWidth || '130px';

    return btn;
}

function inicializarBotoesDocumentosAntigos(tentativa = 0) {
    const container = localizarContainerBotoesCentraisCRM();

    if (!container) {
        if (tentativa < 20) {
            setTimeout(() => inicializarBotoesDocumentosAntigos(tentativa + 1), 300);
        }
        return;
    }

    const referencia =
        localizarBotaoPorTextoCRM('CESTAS') ||
        localizarBotaoPorTextoCRM('CURRICULO') ||
        localizarBotaoPorTextoCRM('CURRÍCULO') ||
        localizarBotaoPorTextoCRM('WHATSAPP');

    const btnCarteirinhas = criarBotaoModuloAntigoCRM(
        'btn-carteirinhas',
        'CARTEIRINHAS',
        referencia
    );

    const btnCompraVenda = criarBotaoModuloAntigoCRM(
        'btn-compra-venda',
        'COMPRA E VENDA',
        referencia
    );

    btnCarteirinhas.onclick = function (e) {
        e.preventDefault();
        abrirModalCarteirinhasCRM();
    };

    btnCompraVenda.onclick = function (e) {
        e.preventDefault();
        abrirModalCompraVendaCRM();
    };

    // Tenta manter a ordem visual próxima do sistema antigo.
    const btnCestas = localizarBotaoPorTextoCRM('CESTAS');

    if (btnCestas && btnCestas.parentElement === container) {
        if (!btnCarteirinhas.isConnected) {
            container.insertBefore(btnCarteirinhas, btnCestas);
        }

        if (!btnCompraVenda.isConnected) {
            container.insertBefore(btnCompraVenda, btnCestas);
        }
    } else {
        if (!btnCarteirinhas.isConnected) container.appendChild(btnCarteirinhas);
        if (!btnCompraVenda.isConnected) container.appendChild(btnCompraVenda);
    }
}


// ============================================================
// CARTEIRINHAS — PESQUISA E EDIÇÃO DE MORADORES
// ============================================================


const carteirinhasCRMState = {
    nomes: [],
    linhaAtual: null,
    camposAtuais: [],
    salvando: false,
    timerAutoSave: null,
    timerBusca: null,
    ultimoSnapshot: '',
    nomeAtual: ''
};

const CARTEIRINHAS_MESES = [
    { nome: 'JAN', aliases: ['JAN', 'JANEIRO'] },
    { nome: 'FEV', aliases: ['FEV', 'FEVEREIRO'] },
    { nome: 'MARÇO', aliases: ['MARCO', 'MARÇO'] },
    { nome: 'ABRIL', aliases: ['ABRIL'] },
    { nome: 'MAIO', aliases: ['MAIO'] },
    { nome: 'JUNHO', aliases: ['JUNHO'] },
    { nome: 'JULHO', aliases: ['JULHO'] },
    { nome: 'AGOSTO', aliases: ['AGOSTO'] },
    { nome: 'SETEMBRO', aliases: ['SETEMBRO'] },
    { nome: 'OUTUBRO', aliases: ['OUTUBRO'] },
    { nome: 'NOVEMBRO', aliases: ['NOVEMBRO'] },
    { nome: 'DEZEMBRO', aliases: ['DEZEMBRO'] }
];

function normalizarTextoCarteirinhasCRM(valor) {
    return String(valor || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeAtributoCarteirinhasCRM(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function obterMesCarteirinhasCRM(coluna) {
    const chave = normalizarTextoCarteirinhasCRM(coluna);

    return CARTEIRINHAS_MESES.find(mes =>
        mes.aliases.some(alias =>
            normalizarTextoCarteirinhasCRM(alias) === chave
        )
    ) || null;
}

function formatarCPFCarteirinhasCRM(valor) {
    const digitos = String(valor || '').replace(/\D/g, '').slice(0, 11);

    if (!digitos) return '';

    return digitos
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function preencherDatalistCarteirinhasCRM() {
    const lista = document.getElementById('carteirinhas-lista-nomes');
    if (!lista) return;

    lista.innerHTML = '';

    carteirinhasCRMState.nomes.forEach(nome => {
        const option = document.createElement('option');
        option.value = nome;
        lista.appendChild(option);
    });
}

function garantirModalCarteirinhasCRM() {
    let modal = document.getElementById('modal-carteirinhas-crm');

    if (modal) return modal;

    const style = document.createElement('style');
    style.id = 'carteirinhas-crm-styles';
    style.textContent = `
        #modal-carteirinhas-crm {
            position: fixed;
            inset: 0;
            z-index: 1000000;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 16px;
            background: rgba(21, 31, 24, .52);
            backdrop-filter: blur(5px);
        }

        #modal-carteirinhas-crm.active {
            display: flex;
        }

        #modal-carteirinhas-crm .cart-box {
            width: min(920px, 100%);
            max-height: 94dvh;
            background: #f8fbf8;
            border-radius: 22px;
            overflow: hidden;
            box-shadow: 0 24px 70px rgba(0,0,0,.28);
            display: flex;
            flex-direction: column;
            border: 1px solid rgba(68, 117, 76, .16);
        }

        #modal-carteirinhas-crm .cart-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 15px 18px;
            border-bottom: 1px solid #e0eae2;
            background: rgba(255,255,255,.88);
        }

        #modal-carteirinhas-crm .cart-head-left {
            min-width: 0;
        }

        #modal-carteirinhas-crm .cart-head h3 {
            margin: 0;
            color: #214d2b;
            font-size: 20px;
            line-height: 1.2;
        }

        #modal-carteirinhas-crm .cart-head small {
            display: block;
            margin-top: 3px;
            color: #77837b;
            font-size: 11px;
        }

        #modal-carteirinhas-crm .cart-close {
            flex: 0 0 auto;
            width: 40px;
            height: 40px;
            border: 0;
            border-radius: 50%;
            background: #edf2ee;
            color: #40544a;
            font-size: 22px;
            cursor: pointer;
        }

        #modal-carteirinhas-crm .cart-body {
            padding: 14px 16px 18px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
        }

        #modal-carteirinhas-crm .cart-search-box {
            position: sticky;
            top: 0;
            z-index: 5;
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 8px;
            align-items: end;
            padding: 10px;
            margin: -2px 0 12px;
            background: rgba(248,251,248,.96);
            backdrop-filter: blur(6px);
            border: 1px solid #dbe8de;
            border-radius: 14px;
        }

        #modal-carteirinhas-crm label {
            display: block;
            margin: 0 0 5px;
            font-weight: 800;
            color: #405448;
            font-size: 12px;
        }

        #modal-carteirinhas-crm input {
            width: 100%;
            box-sizing: border-box;
            border: 1px solid #c9d8cc;
            border-radius: 10px;
            padding: 10px 11px;
            font-size: 14px;
            background: #fff;
            color: #243229;
            outline: none;
        }

        #modal-carteirinhas-crm input:focus {
            border-color: #5d9a64;
            box-shadow: 0 0 0 3px rgba(74,124,46,.10);
        }

        #modal-carteirinhas-crm .cart-search-actions {
            display: flex;
            gap: 7px;
        }

        #modal-carteirinhas-crm .cart-primary,
        #modal-carteirinhas-crm .cart-secondary,
        #modal-carteirinhas-crm .cart-danger {
            border-radius: 10px;
            font-weight: 900;
            cursor: pointer;
            padding: 10px 14px;
            min-height: 40px;
        }

        #modal-carteirinhas-crm .cart-primary {
            border: 0;
            background: #397c42;
            color: white;
        }

        #modal-carteirinhas-crm .cart-secondary {
            border: 1px solid #bdd1c1;
            background: #fff;
            color: #35633c;
        }

        #modal-carteirinhas-crm .cart-danger {
            border: 1px solid #efc5c5;
            background: #fff5f5;
            color: #a53a3a;
        }

        #modal-carteirinhas-crm .cart-primary:disabled,
        #modal-carteirinhas-crm .cart-secondary:disabled {
            opacity: .55;
            cursor: wait;
        }

        #modal-carteirinhas-crm .cart-form {
            min-height: 90px;
        }

        #modal-carteirinhas-crm .cart-vazio {
            padding: 32px 12px;
            text-align: center;
            color: #78847c;
            border: 1px dashed #d7e2d9;
            border-radius: 14px;
            background: rgba(255,255,255,.55);
        }

        #modal-carteirinhas-crm .cart-resumo {
            display: grid;
            grid-template-columns: minmax(0, 1.6fr) minmax(220px, .8fr);
            gap: 12px;
            margin-bottom: 12px;
        }

        #modal-carteirinhas-crm .cart-card {
            background: #fff;
            border: 1px solid #dfe9e1;
            border-radius: 15px;
            padding: 13px;
            box-shadow: 0 5px 18px rgba(45,80,52,.05);
        }

        #modal-carteirinhas-crm .cart-card-title {
            font-size: 11px;
            font-weight: 900;
            color: #718078;
            text-transform: uppercase;
            letter-spacing: .05em;
            margin-bottom: 8px;
        }

        #modal-carteirinhas-crm .cart-dados-grid {
            display: grid;
            grid-template-columns: 1.4fr .8fr;
            gap: 9px;
        }

        #modal-carteirinhas-crm .cart-dados-grid .full {
            grid-column: 1 / -1;
        }

        #modal-carteirinhas-crm .cart-progresso-top {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 8px;
        }

        #modal-carteirinhas-crm .cart-progresso-numero {
            font-size: 28px;
            font-weight: 950;
            color: #34733e;
            line-height: 1;
        }

        #modal-carteirinhas-crm .cart-progresso-texto {
            color: #758079;
            font-size: 11px;
            font-weight: 700;
        }

        #modal-carteirinhas-crm .cart-progress {
            height: 10px;
            background: #e8efea;
            border-radius: 999px;
            overflow: hidden;
            margin-top: 12px;
        }

        #modal-carteirinhas-crm .cart-progress > span {
            display: block;
            width: 0%;
            height: 100%;
            background: linear-gradient(90deg, #4a8a51, #77b148);
            border-radius: inherit;
            transition: width .25s ease;
        }

        #modal-carteirinhas-crm .cart-status-save {
            margin-top: 9px;
            min-height: 19px;
            font-size: 11px;
            font-weight: 800;
            color: #647269;
        }

        #modal-carteirinhas-crm .cart-meses-area {
            background: #fff;
            border: 1px solid #dfe9e1;
            border-radius: 15px;
            padding: 13px;
            margin-bottom: 12px;
        }

        #modal-carteirinhas-crm .cart-section-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            flex-wrap: wrap;
            margin-bottom: 10px;
        }

        #modal-carteirinhas-crm .cart-section-head h4 {
            margin: 0;
            color: #2e5937;
            font-size: 15px;
        }

        #modal-carteirinhas-crm .cart-mini-actions {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }

        #modal-carteirinhas-crm .cart-mini-actions button {
            padding: 7px 10px;
            min-height: 32px;
            font-size: 10px;
        }

        #modal-carteirinhas-crm .cart-month-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 8px;
        }

        #modal-carteirinhas-crm .cart-month {
            appearance: none;
            border: 1px solid #e0e7e2;
            background: #fafcfb;
            min-height: 64px;
            border-radius: 12px;
            padding: 9px;
            cursor: pointer;
            text-align: left;
            transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
        }

        #modal-carteirinhas-crm .cart-month:hover {
            transform: translateY(-1px);
            box-shadow: 0 5px 13px rgba(38,76,45,.08);
        }

        #modal-carteirinhas-crm .cart-month .mes {
            display: block;
            font-size: 11px;
            font-weight: 950;
            color: #4f6155;
            margin-bottom: 7px;
        }

        #modal-carteirinhas-crm .cart-month .status {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            border-radius: 999px;
            padding: 4px 8px;
            font-size: 10px;
            font-weight: 950;
        }

        #modal-carteirinhas-crm .cart-month.pago {
            border-color: #98c49e;
            background: #f0f9f2;
        }

        #modal-carteirinhas-crm .cart-month.pago .status {
            background: #d9f0dd;
            color: #256a31;
        }

        #modal-carteirinhas-crm .cart-month.pendente {
            border-color: #f0c6c6;
            background: #fff8f8;
        }

        #modal-carteirinhas-crm .cart-month.pendente .status {
            background: #fde3e3;
            color: #9c3434;
        }

        #modal-carteirinhas-crm .cart-outros {
            background: #fff;
            border: 1px solid #dfe9e1;
            border-radius: 15px;
            padding: 12px 13px;
            margin-bottom: 12px;
        }

        #modal-carteirinhas-crm details summary {
            cursor: pointer;
            font-weight: 900;
            color: #45614c;
        }

        #modal-carteirinhas-crm .cart-outros-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 9px 12px;
            padding-top: 12px;
        }

        #modal-carteirinhas-crm .cart-footer-actions {
            position: sticky;
            bottom: -18px;
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            padding: 10px 0 2px;
            background: linear-gradient(
                to top,
                rgba(248,251,248,1) 70%,
                rgba(248,251,248,0)
            );
        }

        @media (max-width: 760px) {
            #modal-carteirinhas-crm {
                padding: 0;
                align-items: stretch;
            }

            #modal-carteirinhas-crm .cart-box {
                width: 100%;
                height: 100dvh;
                max-height: 100dvh;
                border-radius: 0;
            }

            #modal-carteirinhas-crm .cart-body {
                padding: 10px;
            }

            #modal-carteirinhas-crm .cart-search-box {
                grid-template-columns: 1fr;
            }

            #modal-carteirinhas-crm .cart-search-actions {
                display: grid;
                grid-template-columns: 1fr auto;
            }

            #modal-carteirinhas-crm .cart-resumo {
                grid-template-columns: 1fr;
            }

            #modal-carteirinhas-crm .cart-dados-grid,
            #modal-carteirinhas-crm .cart-outros-grid {
                grid-template-columns: 1fr;
            }

            #modal-carteirinhas-crm .cart-dados-grid .full {
                grid-column: auto;
            }

            #modal-carteirinhas-crm .cart-month-grid {
                grid-template-columns: repeat(3, minmax(0, 1fr));
            }
        }

        @media (max-width: 460px) {
            #modal-carteirinhas-crm .cart-month-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            #modal-carteirinhas-crm .cart-head h3 {
                font-size: 17px;
            }
        }
    `;

    document.head.appendChild(style);

    modal = document.createElement('div');
    modal.id = 'modal-carteirinhas-crm';

    modal.innerHTML = `
        <div class="cart-box">
            <div class="cart-head">
                <div class="cart-head-left">
                    <h3>▣ Carteirinhas</h3>
                    <small>Pesquisa, mensalidades e edição do morador</small>
                </div>

                <button
                    type="button"
                    class="cart-close"
                    onclick="fecharModalCarteirinhasCRM()"
                    aria-label="Fechar"
                >×</button>
            </div>

            <div class="cart-body">
                <div class="cart-search-box">
                    <div>
                        <label for="carteirinhas-buscar-nome">Buscar morador</label>
                        <input
                            type="text"
                            id="carteirinhas-buscar-nome"
                            list="carteirinhas-lista-nomes"
                            placeholder="Comece a digitar o nome..."
                            autocomplete="off"
                        >
                        <datalist id="carteirinhas-lista-nomes"></datalist>
                    </div>

                    <div class="cart-search-actions">
                        <button
                            type="button"
                            class="cart-primary"
                            onclick="buscarMoradorCarteirinhasCRM()"
                        >
                            🔍 Buscar
                        </button>

                        <button
                            type="button"
                            class="cart-secondary"
                            onclick="limparBuscaCarteirinhasCRM()"
                            title="Limpar"
                        >
                            ×
                        </button>
                    </div>
                </div>

                <div id="carteirinhas-formulario" class="cart-form">
                    <div class="cart-vazio">
                        Digite o nome acima. A busca também abre automaticamente
                        quando encontra uma correspondência exata.
                    </div>
                </div>
            </div>
        </div>
    `;

    modal.addEventListener('click', function (e) {
        if (e.target === modal) fecharModalCarteirinhasCRM();
    });

    document.body.appendChild(modal);

    const input = modal.querySelector('#carteirinhas-buscar-nome');

    if (input) {
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                buscarMoradorCarteirinhasCRM();
            }
        });

        input.addEventListener('input', function () {
            clearTimeout(carteirinhasCRMState.timerBusca);

            const termo = normalizarTextoCarteirinhasCRM(input.value);

            if (termo.length < 3) return;

            carteirinhasCRMState.timerBusca = setTimeout(() => {
                const correspondencias = carteirinhasCRMState.nomes.filter(nome => {
                    const n = normalizarTextoCarteirinhasCRM(nome);
                    return n === termo || n.startsWith(termo);
                });

                const exata = correspondencias.find(nome =>
                    normalizarTextoCarteirinhasCRM(nome) === termo
                );

                if (exata) {
                    input.value = exata;
                    buscarMoradorCarteirinhasCRM(true);
                    return;
                }

                // Automatiza apenas quando há UMA única opção e o usuário já digitou
                // uma parte suficientemente específica do nome.
                if (termo.length >= 5 && correspondencias.length === 1) {
                    input.value = correspondencias[0];
                    buscarMoradorCarteirinhasCRM(true);
                }
            }, 450);
        });

        input.addEventListener('change', function () {
            const termo = normalizarTextoCarteirinhasCRM(input.value);

            const exata = carteirinhasCRMState.nomes.find(nome =>
                normalizarTextoCarteirinhasCRM(nome) === termo
            );

            if (exata) {
                input.value = exata;
                buscarMoradorCarteirinhasCRM(true);
            }
        });
    }

    return modal;
}

async function abrirModalCarteirinhasCRM() {
    const modal = garantirModalCarteirinhasCRM();

    modal.classList.add('active');

    carteirinhasCRMState.linhaAtual = null;
    carteirinhasCRMState.camposAtuais = [];
    carteirinhasCRMState.ultimoSnapshot = '';
    carteirinhasCRMState.nomeAtual = '';

    const formulario = document.getElementById('carteirinhas-formulario');

    if (formulario) {
        formulario.innerHTML = `
            <div class="cart-vazio">
                ⏳ Carregando lista de moradores...
            </div>
        `;
    }

    try {
        const resposta = await fetchFromGS(
            'buscarTodosNomesCarteirinhas',
            { _: String(Date.now()) }
        );

        if (resposta?.success === false) {
            throw new Error(resposta.error || 'Não foi possível carregar a lista.');
        }

        carteirinhasCRMState.nomes = Array.isArray(resposta?.nomes)
            ? resposta.nomes
            : [];

        preencherDatalistCarteirinhasCRM();

        if (formulario) {
            formulario.innerHTML = `
                <div class="cart-vazio">
                    Digite o nome acima. A busca também abre automaticamente
                    quando encontra uma correspondência exata.
                </div>
            `;
        }

        setTimeout(() => {
            document.getElementById('carteirinhas-buscar-nome')?.focus();
        }, 100);

    } catch (erro) {
        console.error('Erro ao carregar nomes de CARTEIRINHAS:', erro);

        if (formulario) {
            formulario.innerHTML = `
                <div class="cart-vazio" style="color:#b42318;">
                    Erro ao carregar moradores:<br>
                    ${escapeHtml(String(erro.message || erro))}
                </div>
            `;
        }
    }
}

function fecharModalCarteirinhasCRM() {
    clearTimeout(carteirinhasCRMState.timerAutoSave);
    clearTimeout(carteirinhasCRMState.timerBusca);

    const modal = document.getElementById('modal-carteirinhas-crm');

    if (modal) modal.classList.remove('active');
}

function limparBuscaCarteirinhasCRM() {
    const input = document.getElementById('carteirinhas-buscar-nome');
    const formulario = document.getElementById('carteirinhas-formulario');

    if (input) {
        input.value = '';
        input.focus();
    }

    carteirinhasCRMState.linhaAtual = null;
    carteirinhasCRMState.camposAtuais = [];
    carteirinhasCRMState.ultimoSnapshot = '';
    carteirinhasCRMState.nomeAtual = '';

    if (formulario) {
        formulario.innerHTML = `
            <div class="cart-vazio">
                Digite o nome acima para abrir o cadastro.
            </div>
        `;
    }
}

function separarCamposCarteirinhasCRM(campos) {
    const base = {
        nome: null,
        cpf: null,
        endereco: null
    };

    const meses = [];
    const outros = [];

    (campos || []).forEach(campo => {
        const colunaNorm = normalizarTextoCarteirinhasCRM(campo.coluna);

        if (colunaNorm === 'NOME') {
            base.nome = campo;
            return;
        }

        if (colunaNorm === 'CPF') {
            base.cpf = campo;
            return;
        }

        if (
            colunaNorm === 'ENDERECO' ||
            colunaNorm === 'ENDEREÇO'
        ) {
            base.endereco = campo;
            return;
        }

        const mes = obterMesCarteirinhasCRM(campo.coluna);

        if (mes) {
            meses.push({
                ...campo,
                mesLabel: mes.nome
            });
            return;
        }

        outros.push(campo);
    });

    // Garante a ordem JAN -> DEZ, independentemente da ordem da planilha.
    meses.sort((a, b) => {
        const ia = CARTEIRINHAS_MESES.findIndex(m => m.nome === a.mesLabel);
        const ib = CARTEIRINHAS_MESES.findIndex(m => m.nome === b.mesLabel);
        return ia - ib;
    });

    return { base, meses, outros };
}

function renderizarMoradorCarteirinhasCRM(campos) {
    const formulario = document.getElementById('carteirinhas-formulario');
    if (!formulario) return;

    const { base, meses, outros } = separarCamposCarteirinhasCRM(campos);

    const campoInput = (campo, classeExtra = '') => {
        if (!campo) return '';

        const colunaNorm = normalizarTextoCarteirinhasCRM(campo.coluna);
        let valor = String(campo.valor ?? '');

        if (colunaNorm === 'CPF') {
            valor = formatarCPFCarteirinhasCRM(valor);
        }

        return `
            <div class="${classeExtra}">
                <label>${escapeHtml(String(campo.coluna || ''))}</label>
                <input
                    type="text"
                    class="carteirinhas-campo-edicao"
                    data-coluna="${escapeAtributoCarteirinhasCRM(campo.coluna)}"
                    data-tipo="${colunaNorm === 'CPF' ? 'cpf' : 'texto'}"
                    value="${escapeAtributoCarteirinhasCRM(valor)}"
                    autocomplete="off"
                >
            </div>
        `;
    };

    const mesesHtml = meses.map(campo => {
        const pago =
            normalizarTextoCarteirinhasCRM(campo.valor) === 'PAGO';

        return `
            <button
                type="button"
                class="cart-month ${pago ? 'pago' : 'pendente'}"
                data-coluna="${escapeAtributoCarteirinhasCRM(campo.coluna)}"
                onclick="alternarMesCarteirinhasCRM(this)"
                title="Clique para alternar entre PAGO e PENDENTE"
            >
                <span class="mes">${escapeHtml(campo.mesLabel)}</span>
                <span class="status">
                    ${pago ? '✓ PAGO' : '● PENDENTE'}
                </span>

                <input
                    type="hidden"
                    class="carteirinhas-campo-edicao carteirinhas-mes-hidden"
                    data-coluna="${escapeAtributoCarteirinhasCRM(campo.coluna)}"
                    value="${pago ? 'PAGO' : ''}"
                >
            </button>
        `;
    }).join('');

    const outrosHtml = outros.length
        ? `
            <details class="cart-outros">
                <summary>Outros dados da planilha (${outros.length})</summary>
                <div class="cart-outros-grid">
                    ${outros.map(campo => campoInput(campo)).join('')}
                </div>
            </details>
        `
        : '';

    formulario.innerHTML = `
        <div class="cart-resumo">
            <div class="cart-card">
                <div class="cart-card-title">Dados do morador</div>

                <div class="cart-dados-grid">
                    ${campoInput(base.nome, 'full')}
                    ${campoInput(base.cpf)}
                    ${campoInput(base.endereco)}
                </div>
            </div>

            <div class="cart-card">
                <div class="cart-card-title">Situação anual</div>

                <div class="cart-progresso-top">
                    <span id="carteirinhas-pagos-numero" class="cart-progresso-numero">0/12</span>
                    <span id="carteirinhas-pagos-percentual" class="cart-progresso-texto">0%</span>
                </div>

                <div class="cart-progress">
                    <span id="carteirinhas-progress-bar"></span>
                </div>

                <div id="carteirinhas-save-status" class="cart-status-save">
                    Alterações são salvas automaticamente.
                </div>
            </div>
        </div>

        <div class="cart-meses-area">
            <div class="cart-section-head">
                <h4>Mensalidades</h4>

                <div class="cart-mini-actions">
                    <button
                        type="button"
                        class="cart-secondary"
                        onclick="marcarTodosMesesCarteirinhasCRM()"
                    >
                        ✓ Marcar todos PAGO
                    </button>

                    <button
                        type="button"
                        class="cart-danger"
                        onclick="limparMesesCarteirinhasCRM()"
                    >
                        Limpar meses
                    </button>
                </div>
            </div>

            <div class="cart-month-grid">
                ${mesesHtml}
            </div>
        </div>

        ${outrosHtml}

        <div class="cart-footer-actions">
            <button
                type="button"
                class="cart-secondary"
                onclick="buscarProximoMoradorCarteirinhasCRM(-1)"
            >
                ← Anterior
            </button>

            <button
                type="button"
                class="cart-secondary"
                onclick="buscarProximoMoradorCarteirinhasCRM(1)"
            >
                Próximo →
            </button>

            <button
                type="button"
                id="carteirinhas-btn-salvar"
                class="cart-primary"
                onclick="salvarMoradorCarteirinhasCRM({ forcar: true })"
            >
                💾 Salvar agora
            </button>
        </div>
    `;

    configurarAutomacaoCamposCarteirinhasCRM();

    atualizarResumoMesesCarteirinhasCRM();

    // Snapshot inicial para não fazer POST sem mudança.
    carteirinhasCRMState.ultimoSnapshot =
        JSON.stringify(coletarDadosCarteirinhasCRM());
}

async function buscarMoradorCarteirinhasCRM(silencioso = false) {
    const input = document.getElementById('carteirinhas-buscar-nome');
    const formulario = document.getElementById('carteirinhas-formulario');

    const nome = String(input?.value || '').trim();

    if (!nome) {
        if (!silencioso) alert('Digite um nome para buscar.');
        return;
    }

    if (formulario) {
        formulario.innerHTML =
            '<div class="cart-vazio">⏳ Buscando morador...</div>';
    }

    try {
        const resposta = await fetchFromGS(
            'buscarMoradorCarteirinhas',
            {
                nome,
                _: String(Date.now())
            }
        );

        if (resposta?.success === false) {
            throw new Error(resposta.error || 'Erro na busca.');
        }

        if (!resposta || !resposta.encontrado) {
            carteirinhasCRMState.linhaAtual = null;
            carteirinhasCRMState.camposAtuais = [];

            if (formulario) {
                formulario.innerHTML =
                    '<div class="cart-vazio" style="color:#b42318;">Morador não encontrado.</div>';
            }

            return;
        }

        carteirinhasCRMState.linhaAtual = Number(resposta.linha);
        carteirinhasCRMState.camposAtuais = Array.isArray(resposta.dados)
            ? resposta.dados
            : [];

        const campoNome = carteirinhasCRMState.camposAtuais.find(campo =>
            normalizarTextoCarteirinhasCRM(campo.coluna) === 'NOME'
        );

        carteirinhasCRMState.nomeAtual =
            String(campoNome?.valor || nome).trim();

        if (input && carteirinhasCRMState.nomeAtual) {
            input.value = carteirinhasCRMState.nomeAtual;
        }

        renderizarMoradorCarteirinhasCRM(
            carteirinhasCRMState.camposAtuais
        );

    } catch (erro) {
        console.error('Erro ao buscar morador em CARTEIRINHAS:', erro);

        if (formulario) {
            formulario.innerHTML =
                `<div class="cart-vazio" style="color:#b42318;">
                    Erro: ${escapeHtml(String(erro.message || erro))}
                </div>`;
        }
    }
}

function configurarAutomacaoCamposCarteirinhasCRM() {
    const inputs = document.querySelectorAll(
        '#modal-carteirinhas-crm .carteirinhas-campo-edicao:not([type="hidden"])'
    );

    inputs.forEach(input => {
        input.addEventListener('input', function () {
            if (input.dataset.tipo === 'cpf') {
                input.value = formatarCPFCarteirinhasCRM(input.value);
            }

            if (
                normalizarTextoCarteirinhasCRM(input.dataset.coluna) === 'NOME' ||
                normalizarTextoCarteirinhasCRM(input.dataset.coluna) === 'ENDERECO' ||
                normalizarTextoCarteirinhasCRM(input.dataset.coluna) === 'ENDEREÇO'
            ) {
                const inicio = input.selectionStart;
                input.value = input.value.toUpperCase();

                try {
                    input.setSelectionRange(inicio, inicio);
                } catch (_) {}
            }

            atualizarIndicadorSalvamentoCarteirinhasCRM(
                'pendente',
                'Alteração detectada…'
            );

            agendarAutoSalvarCarteirinhasCRM();
        });

        input.addEventListener('change', function () {
            agendarAutoSalvarCarteirinhasCRM(250);
        });
    });
}

function coletarDadosCarteirinhasCRM() {
    const dados = {};

    document
        .querySelectorAll(
            '#modal-carteirinhas-crm .carteirinhas-campo-edicao'
        )
        .forEach(input => {
            if (!input.dataset.coluna) return;
            dados[input.dataset.coluna] = input.value;
        });

    return dados;
}

function atualizarIndicadorSalvamentoCarteirinhasCRM(tipo, texto) {
    const el = document.getElementById('carteirinhas-save-status');
    if (!el) return;

    el.textContent = texto || '';

    if (tipo === 'salvando') {
        el.style.color = '#93651d';
    } else if (tipo === 'erro') {
        el.style.color = '#b42318';
    } else if (tipo === 'salvo') {
        el.style.color = '#24713a';
    } else {
        el.style.color = '#647269';
    }
}

function agendarAutoSalvarCarteirinhasCRM(delay = 800) {
    clearTimeout(carteirinhasCRMState.timerAutoSave);

    carteirinhasCRMState.timerAutoSave = setTimeout(() => {
        salvarMoradorCarteirinhasCRM({
            silencioso: true
        });
    }, delay);
}

async function salvarMoradorCarteirinhasCRM(opcoes = {}) {
    const linha = Number(carteirinhasCRMState.linhaAtual);

    if (!linha) {
        if (!opcoes.silencioso) {
            alert('Nenhum morador selecionado.');
        }
        return false;
    }

    if (carteirinhasCRMState.salvando) {
        // Se já está salvando, agenda uma nova tentativa para pegar a alteração mais recente.
        agendarAutoSalvarCarteirinhasCRM(350);
        return false;
    }

    const dados = coletarDadosCarteirinhasCRM();
    const snapshot = JSON.stringify(dados);

    if (
        !opcoes.forcar &&
        snapshot === carteirinhasCRMState.ultimoSnapshot
    ) {
        atualizarIndicadorSalvamentoCarteirinhasCRM(
            'salvo',
            '✓ Tudo salvo'
        );
        return true;
    }

    carteirinhasCRMState.salvando = true;

    const btn = document.getElementById('carteirinhas-btn-salvar');
    const textoBtn = btn?.innerHTML || '';

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Salvando...';
    }

    atualizarIndicadorSalvamentoCarteirinhasCRM(
        'salvando',
        '⏳ Salvando automaticamente...'
    );

    try {
        const resposta = await postParaGoogleSheets(
            'salvarMoradorCarteirinhas',
            { linha, dados }
        );

        if (resposta?.success === false || resposta?.status === 'error') {
            throw new Error(
                resposta.message || 'Não foi possível salvar.'
            );
        }

        carteirinhasCRMState.ultimoSnapshot = snapshot;

        atualizarIndicadorSalvamentoCarteirinhasCRM(
            'salvo',
            '✓ Salvo na planilha'
        );

        // Se o nome foi alterado, atualiza o campo de pesquisa e a lista.
        const campoNome = Object.keys(dados).find(chave =>
            normalizarTextoCarteirinhasCRM(chave) === 'NOME'
        );

        if (campoNome && dados[campoNome]) {
            const nomeNovo = String(dados[campoNome]).trim();

            if (nomeNovo && nomeNovo !== carteirinhasCRMState.nomeAtual) {
                carteirinhasCRMState.nomeAtual = nomeNovo;

                const busca = document.getElementById(
                    'carteirinhas-buscar-nome'
                );

                if (busca) busca.value = nomeNovo;

                const listaResp = await fetchFromGS(
                    'buscarTodosNomesCarteirinhas',
                    { _: String(Date.now()) }
                );

                if (Array.isArray(listaResp?.nomes)) {
                    carteirinhasCRMState.nomes = listaResp.nomes;
                    preencherDatalistCarteirinhasCRM();
                }
            }
        }

        return true;

    } catch (erro) {
        console.error('Erro ao salvar CARTEIRINHAS:', erro);

        atualizarIndicadorSalvamentoCarteirinhasCRM(
            'erro',
            '❌ Erro ao salvar: ' + String(erro.message || erro)
        );

        if (!opcoes.silencioso) {
            alert(
                'Não foi possível salvar: ' +
                (erro.message || erro)
            );
        }

        return false;

    } finally {
        carteirinhasCRMState.salvando = false;

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = textoBtn || '💾 Salvar agora';
        }
    }
}

function alternarMesCarteirinhasCRM(botao) {
    if (!botao) return;

    const input = botao.querySelector(
        '.carteirinhas-mes-hidden'
    );

    const status = botao.querySelector('.status');

    if (!input || !status) return;

    const pago =
        normalizarTextoCarteirinhasCRM(input.value) === 'PAGO';

    if (pago) {
        input.value = '';
        botao.classList.remove('pago');
        botao.classList.add('pendente');
        status.textContent = '● PENDENTE';
    } else {
        input.value = 'PAGO';
        botao.classList.remove('pendente');
        botao.classList.add('pago');
        status.textContent = '✓ PAGO';
    }

    atualizarResumoMesesCarteirinhasCRM();

    // Mês é uma ação objetiva: salva praticamente na hora.
    agendarAutoSalvarCarteirinhasCRM(120);
}

function atualizarResumoMesesCarteirinhasCRM() {
    const meses = [
        ...document.querySelectorAll(
            '#modal-carteirinhas-crm .carteirinhas-mes-hidden'
        )
    ];

    const pagos = meses.filter(input =>
        normalizarTextoCarteirinhasCRM(input.value) === 'PAGO'
    ).length;

    const total = meses.length || 12;
    const percentual = total > 0
        ? Math.round((pagos / total) * 100)
        : 0;

    const numero = document.getElementById(
        'carteirinhas-pagos-numero'
    );

    const percentualEl = document.getElementById(
        'carteirinhas-pagos-percentual'
    );

    const barra = document.getElementById(
        'carteirinhas-progress-bar'
    );

    if (numero) numero.textContent = `${pagos}/${total}`;
    if (percentualEl) percentualEl.textContent = `${percentual}%`;
    if (barra) barra.style.width = `${percentual}%`;
}

function marcarTodosMesesCarteirinhasCRM() {
    const botoes = document.querySelectorAll(
        '#modal-carteirinhas-crm .cart-month'
    );

    botoes.forEach(botao => {
        const input = botao.querySelector('.carteirinhas-mes-hidden');
        const status = botao.querySelector('.status');

        if (!input || !status) return;

        input.value = 'PAGO';
        botao.classList.remove('pendente');
        botao.classList.add('pago');
        status.textContent = '✓ PAGO';
    });

    atualizarResumoMesesCarteirinhasCRM();
    agendarAutoSalvarCarteirinhasCRM(120);
}

function limparMesesCarteirinhasCRM() {
    if (
        !confirm(
            'Limpar o status de TODOS os meses deste morador?\n\n' +
            'Eles voltarão a aparecer como PENDENTE.'
        )
    ) {
        return;
    }

    const botoes = document.querySelectorAll(
        '#modal-carteirinhas-crm .cart-month'
    );

    botoes.forEach(botao => {
        const input = botao.querySelector('.carteirinhas-mes-hidden');
        const status = botao.querySelector('.status');

        if (!input || !status) return;

        input.value = '';
        botao.classList.remove('pago');
        botao.classList.add('pendente');
        status.textContent = '● PENDENTE';
    });

    atualizarResumoMesesCarteirinhasCRM();
    agendarAutoSalvarCarteirinhasCRM(120);
}

async function buscarProximoMoradorCarteirinhasCRM(direcao) {
    if (!carteirinhasCRMState.nomes.length) return;

    const atualNorm =
        normalizarTextoCarteirinhasCRM(
            carteirinhasCRMState.nomeAtual ||
            document.getElementById('carteirinhas-buscar-nome')?.value
        );

    let indice = carteirinhasCRMState.nomes.findIndex(nome =>
        normalizarTextoCarteirinhasCRM(nome) === atualNorm
    );

    if (indice < 0) indice = 0;

    indice += Number(direcao) || 0;

    if (indice < 0) {
        indice = carteirinhasCRMState.nomes.length - 1;
    }

    if (indice >= carteirinhasCRMState.nomes.length) {
        indice = 0;
    }

    const input = document.getElementById(
        'carteirinhas-buscar-nome'
    );

    if (input) {
        input.value = carteirinhasCRMState.nomes[indice];
    }

    await buscarMoradorCarteirinhasCRM(true);
}


// ============================================================
// COMPRA E VENDA — HTML ANTIGO RODANDO DENTRO DO CRM
// ============================================================

function garantirModalCompraVendaCRM() {
    let modal = document.getElementById('modal-compra-venda-crm');

    if (modal) return modal;

    const style = document.createElement('style');
    style.id = 'compra-venda-crm-styles';
    style.textContent = `
        #modal-compra-venda-crm {
            position: fixed;
            inset: 0;
            z-index: 1000000;
            display: none;
            align-items: center;
            justify-content: center;
            background: rgba(20, 29, 23, .58);
            backdrop-filter: blur(4px);
            padding: 12px;
        }

        #modal-compra-venda-crm.active {
            display: flex;
        }

        #modal-compra-venda-crm .cvenda-box {
            width: min(1060px, 100%);
            height: min(900px, 96dvh);
            background: #fff;
            border-radius: 18px;
            overflow: hidden;
            box-shadow: 0 24px 70px rgba(0,0,0,.32);
            display: flex;
            flex-direction: column;
        }

        #modal-compra-venda-crm .cvenda-head {
            min-height: 54px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 8px 14px;
            background: #f4f8f4;
            border-bottom: 1px solid #dce7de;
        }

        #modal-compra-venda-crm .cvenda-title {
            color: #255a31;
            font-weight: 900;
            font-size: 17px;
        }

        #modal-compra-venda-crm .cvenda-close {
            width: 38px;
            height: 38px;
            border: 0;
            border-radius: 50%;
            background: #e8eee9;
            color: #405048;
            font-size: 22px;
            cursor: pointer;
        }

        #modal-compra-venda-crm iframe {
            width: 100%;
            flex: 1;
            border: 0;
            background: #f2f2f2;
        }

        @media (max-width: 700px) {
            #modal-compra-venda-crm {
                padding: 0;
            }

            #modal-compra-venda-crm .cvenda-box {
                width: 100%;
                height: 100dvh;
                max-height: 100dvh;
                border-radius: 0;
            }
        }
    `;

    document.head.appendChild(style);

    modal = document.createElement('div');
    modal.id = 'modal-compra-venda-crm';

    modal.innerHTML = `
        <div class="cvenda-box">
            <div class="cvenda-head">
                <div class="cvenda-title">📜 Compra e Venda / Transferência / Atualização</div>
                <button
                    type="button"
                    class="cvenda-close"
                    onclick="fecharModalCompraVendaCRM()"
                    aria-label="Fechar"
                >×</button>
            </div>

            <iframe
                id="compra-venda-iframe-crm"
                title="Compra e Venda"
            ></iframe>
        </div>
    `;

    modal.addEventListener('click', function (e) {
        if (e.target === modal) fecharModalCompraVendaCRM();
    });

    document.body.appendChild(modal);

    return modal;
}

function abrirModalCompraVendaCRM() {
    const modal = garantirModalCompraVendaCRM();
    const iframe = document.getElementById('compra-venda-iframe-crm');
    if (!iframe) return;

    const etapa = garantirEtapaVerificacaoCompraVendaCRM_(modal, iframe);
    compraVendaVerificacaoState = { cpf: '', resposta: null, verificado: false };

    iframe.style.display = 'none';
    iframe.srcdoc = '';
    etapa.style.display = 'flex';

    const input = etapa.querySelector('#cv-cpf-consulta');
    const resultado = etapa.querySelector('#cv-historico-resultado');
    const continuar = etapa.querySelector('#cv-continuar-modelos');
    if (input) input.value = '';
    if (resultado) resultado.innerHTML = '<div class="cv-empty">Digite o CPF para verificar se já existem contratos salvos.</div>';
    if (continuar) continuar.disabled = true;

    modal.classList.add('active');
    setTimeout(() => input && input.focus(), 80);
}

function fecharModalCompraVendaCRM() {
    const modal = document.getElementById('modal-compra-venda-crm');

    if (modal) modal.classList.remove('active');
}

// Chamado pelo shim google.script.run que foi injetado no HTML antigo.
async function compraVendaBridgeCall(metodo, args = []) {
    switch (metodo) {
        case 'obterProximoNumeroContrato': {
            const res = await fetchFromGS(
                'obterProximoNumeroContratoCompraVenda',
                { _: String(Date.now()) }
            );

            if (res?.error) throw new Error(res.error);

            return Number(res?.numero || 10);
        }

        case 'incrementarNumeroContrato': {
            await postParaGoogleSheets(
                'incrementarNumeroContratoCompraVenda',
                {}
            );

            const res = await fetchFromGS(
                'obterProximoNumeroContratoCompraVenda',
                { _: String(Date.now()) }
            );

            if (res?.error) throw new Error(res.error);

            return Number(res?.numero || 10);
        }

        case 'obterProximoNumeroNota': {
            const res = await fetchFromGS(
                'obterProximoNumeroNotaCompraVenda',
                { _: String(Date.now()) }
            );

            if (res?.error) throw new Error(res.error);

            return Number(res?.numero || 1);
        }

        case 'incrementarNumeroNota': {
            await postParaGoogleSheets(
                'incrementarNumeroNotaCompraVenda',
                {}
            );

            const res = await fetchFromGS(
                'obterProximoNumeroNotaCompraVenda',
                { _: String(Date.now()) }
            );

            if (res?.error) throw new Error(res.error);

            return Number(res?.numero || 1);
        }

        case 'buscarDadosPorCPFCompraVenda': {
            const cpf = String(args?.[0] || '');

            const res = await fetchFromGS(
                'buscarDadosPorCPFCompraVenda',
                {
                    cpf,
                    _: String(Date.now())
                }
            );

            if (res?.error) throw new Error(res.error);

            return res;
        }

        case 'buscarEnderecoPorCEP': {
            const cep = String(args?.[0] || '');

            const res = await fetchFromGS(
                'buscarEnderecoPorCEPCompraVenda',
                {
                    cep,
                    _: String(Date.now())
                }
            );

            if (res?.error) throw new Error(res.error);

            return res;
        }

        case 'salvarCompraVenda': {
            const dados = Array.isArray(args?.[0])
                ? args[0]
                : [];

            await postParaGoogleSheets(
                'salvarCompraVenda',
                { dados }
            );

            return true;
        }

        default:
            throw new Error(
                'Função antiga não mapeada no CRM: ' + metodo
            );
    }
}


// ============================================================
// WHATSAPP - CARTÕES PENDENTES
// ============================================================
const whatsappCRMState = {
    itens: [],
    aba: 'enviar',
    carregando: false,
    atualizandoTelefones: false,
    relatorio: [],
    relatorioAberto: false
};

function localizarBotaoWhatsapp() {
    const porId = document.getElementById('btn-whatsapp') || document.getElementById('btnWhatsapp');
    if (porId) return porId;

    const candidatos = [...document.querySelectorAll('button, a, [role="button"]')];
    return candidatos.find(el => String(el.textContent || '').trim().toUpperCase() === 'WHATSAPP') || null;
}

function inicializarBotaoWhatsapp(tentativa = 0) {
    const botao = localizarBotaoWhatsapp();

    if (!botao) {
        if (tentativa < 15) setTimeout(() => inicializarBotaoWhatsapp(tentativa + 1), 300);
        return;
    }

    if (botao.dataset.whatsappCrmAtivo === '1') return;

    botao.dataset.whatsappCrmAtivo = '1';
    botao.removeAttribute('onclick');
    botao.onclick = function(e) {
        e.preventDefault();
        abrirModalWhatsapp();
    };
}

function garantirModalWhatsapp() {
    let modal = document.getElementById('modal-whatsapp-crm');
    if (modal) return modal;

    const style = document.createElement('style');
    style.id = 'whatsapp-crm-styles';
    style.textContent = `
        #modal-whatsapp-crm {
            position: fixed;
            inset: 0;
            z-index: 1000000;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 18px;
            background: rgba(20, 31, 25, .46);
            backdrop-filter: blur(4px);
        }
        #modal-whatsapp-crm.active { display: flex; }
        #modal-whatsapp-crm .wa-box {
            width: min(860px, 100%);
            max-height: min(760px, 92vh);
            background: #fff;
            border-radius: 22px;
            overflow: hidden;
            box-shadow: 0 24px 70px rgba(0,0,0,.28);
            display: flex;
            flex-direction: column;
        }
        #modal-whatsapp-crm .wa-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 14px;
            padding: 18px 22px;
            border-bottom: 1px solid #e7eee9;
        }
        #modal-whatsapp-crm .wa-title {
            display: flex;
            align-items: center;
            gap: 10px;
            color: #1f5d2c;
            font-size: 20px;
            font-weight: 800;
        }
        #modal-whatsapp-crm .wa-close {
            border: 0;
            width: 42px;
            height: 42px;
            border-radius: 50%;
            cursor: pointer;
            background: #f1f5f2;
            color: #435249;
            font-size: 22px;
        }
        #modal-whatsapp-crm .wa-content {
            overflow: auto;
            padding: 18px 22px 24px;
            background: #f7faf8;
        }
        #modal-whatsapp-crm .wa-info {
            background: #eef8f0;
            border: 1px solid #cfe8d4;
            border-radius: 14px;
            padding: 12px 14px;
            margin-bottom: 14px;
            color: #35573d;
            font-size: 13px;
            line-height: 1.45;
        }
        #modal-whatsapp-crm .wa-stats {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
            margin-bottom: 14px;
        }
        #modal-whatsapp-crm .wa-stat {
            background: #fff;
            border: 1px solid #e2ebe5;
            border-radius: 13px;
            padding: 11px 12px;
        }
        #modal-whatsapp-crm .wa-stat strong {
            display: block;
            font-size: 20px;
            color: #2f6f35;
        }
        #modal-whatsapp-crm .wa-stat span {
            font-size: 11px;
            color: #6d786f;
            font-weight: 700;
            text-transform: uppercase;
        }
        #modal-whatsapp-crm .wa-tabs {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            padding: 5px;
            background: #eaf1ec;
            border-radius: 14px;
            margin-bottom: 14px;
        }
        #modal-whatsapp-crm .wa-tab {
            border: 0;
            border-radius: 10px;
            padding: 11px 12px;
            cursor: pointer;
            font-weight: 800;
            background: transparent;
            color: #597060;
        }
        #modal-whatsapp-crm .wa-tab.active {
            background: #2f7a38;
            color: #fff;
            box-shadow: 0 4px 12px rgba(47,122,56,.20);
        }
        #modal-whatsapp-crm .wa-toolbar {
            display: flex;
            justify-content: flex-end;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 10px;
        }
        #modal-whatsapp-crm .wa-refresh,
        #modal-whatsapp-crm .wa-report-btn {
            border: 1px solid #b9d3bf;
            background: #fff;
            color: #2f6f35;
            border-radius: 999px;
            padding: 9px 13px;
            cursor: pointer;
            font-weight: 800;
        }
        #modal-whatsapp-crm .wa-refresh {
            background: #2f7a38;
            border-color: #2f7a38;
            color: #fff;
        }
        #modal-whatsapp-crm .wa-refresh:disabled,
        #modal-whatsapp-crm .wa-report-btn:disabled {
            opacity: .55;
            cursor: wait;
        }
        #modal-whatsapp-crm .wa-update-result {
            display: none;
            margin-bottom: 10px;
            border-radius: 12px;
            padding: 10px 12px;
            font-size: 12px;
            font-weight: 700;
        }
        #modal-whatsapp-crm .wa-update-result.ok {
            display: block;
            background: #e8f5eb;
            border: 1px solid #b9dfc0;
            color: #277034;
        }
        #modal-whatsapp-crm .wa-update-result.error {
            display: block;
            background: #fff0f0;
            border: 1px solid #efb8b8;
            color: #a53a3a;
        }
        #modal-whatsapp-crm .wa-report-panel {
            display: none;
            margin-bottom: 12px;
            background: #fff;
            border: 1px solid #dce8df;
            border-radius: 15px;
            overflow: hidden;
        }
        #modal-whatsapp-crm .wa-report-panel.active {
            display: block;
        }
        #modal-whatsapp-crm .wa-report-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 11px 13px;
            background: #edf6ef;
            border-bottom: 1px solid #dce8df;
            color: #285c32;
            font-weight: 900;
        }
        #modal-whatsapp-crm .wa-report-close {
            border: 0;
            background: transparent;
            color: #46644d;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
        }
        #modal-whatsapp-crm .wa-report-list {
            max-height: 280px;
            overflow: auto;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 7px;
        }
        #modal-whatsapp-crm .wa-report-item {
            border: 1px solid #e2ebe5;
            border-radius: 11px;
            padding: 10px;
            background: #fbfdfb;
            font-size: 12px;
            color: #536158;
            line-height: 1.4;
        }
        #modal-whatsapp-crm .wa-report-route {
            color: #24362a;
            font-weight: 800;
            margin-bottom: 5px;
        }
        #modal-whatsapp-crm .wa-report-arrow {
            color: #2f7a38;
            font-weight: 900;
            padding: 0 4px;
        }
        #modal-whatsapp-crm .wa-report-meta {
            color: #758078;
            font-size: 11px;
        }
        #modal-whatsapp-crm .wa-lista {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        #modal-whatsapp-crm .wa-item {
            background: #fff;
            border: 1px solid #e0e9e3;
            border-radius: 15px;
            padding: 14px;
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 14px;
            align-items: center;
        }
        #modal-whatsapp-crm .wa-nome {
            font-size: 15px;
            font-weight: 900;
            color: #24362a;
            margin-bottom: 4px;
        }
        #modal-whatsapp-crm .wa-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 6px 10px;
            font-size: 12px;
            color: #667169;
        }
        #modal-whatsapp-crm .wa-meta b { color: #405347; }
        #modal-whatsapp-crm .wa-send {
            border: 0;
            border-radius: 12px;
            padding: 11px 14px;
            min-width: 150px;
            cursor: pointer;
            background: #25D366;
            color: #fff;
            font-weight: 900;
            box-shadow: 0 5px 14px rgba(37,211,102,.23);
        }
        #modal-whatsapp-crm .wa-send:disabled {
            cursor: not-allowed;
            box-shadow: none;
            background: #d8ddd9;
            color: #79827b;
        }
        #modal-whatsapp-crm .wa-enviado {
            min-width: 150px;
            text-align: center;
            background: #e8f5eb;
            border: 1px solid #b9dfc0;
            color: #277034;
            border-radius: 12px;
            padding: 9px 12px;
            font-size: 12px;
            font-weight: 900;
        }
        #modal-whatsapp-crm .wa-enviado small {
            display: block;
            margin-top: 3px;
            color: #65806a;
            font-weight: 600;
        }
        #modal-whatsapp-crm .wa-vazio {
            background: #fff;
            border: 1px dashed #cbd8cf;
            border-radius: 16px;
            padding: 28px 16px;
            text-align: center;
            color: #738078;
        }
        #modal-whatsapp-crm .wa-loading {
            padding: 34px 12px;
            text-align: center;
            color: #55715d;
            font-weight: 700;
        }
        @media (max-width: 640px) {
            #modal-whatsapp-crm { padding: 8px; align-items: stretch; }
            #modal-whatsapp-crm .wa-box { max-height: 100%; border-radius: 16px; }
            #modal-whatsapp-crm .wa-header { padding: 14px 15px; }
            #modal-whatsapp-crm .wa-title { font-size: 17px; }
            #modal-whatsapp-crm .wa-content { padding: 12px; }
            #modal-whatsapp-crm .wa-stats { grid-template-columns: 1fr 1fr; gap: 6px; }
            #modal-whatsapp-crm .wa-stat { padding: 9px 7px; text-align: center; }
            #modal-whatsapp-crm .wa-stat strong { font-size: 17px; }
            #modal-whatsapp-crm .wa-stat span { font-size: 9px; }
            #modal-whatsapp-crm .wa-item { grid-template-columns: 1fr; }
            #modal-whatsapp-crm .wa-send,
            #modal-whatsapp-crm .wa-enviado { width: 100%; min-width: 0; }
            #modal-whatsapp-crm .wa-toolbar { display: grid; grid-template-columns: 1fr 1fr; }
            #modal-whatsapp-crm .wa-refresh,
            #modal-whatsapp-crm .wa-report-btn { width: 100%; }
        }
    `;
    document.head.appendChild(style);

    modal = document.createElement('div');
    modal.id = 'modal-whatsapp-crm';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="wa-box" role="dialog" aria-modal="true" aria-labelledby="wa-crm-title">
            <div class="wa-header">
                <div class="wa-title" id="wa-crm-title">💬 WhatsApp — Cartões Pendentes</div>
                <button type="button" class="wa-close" onclick="fecharModalWhatsapp()" aria-label="Fechar">×</button>
            </div>
            <div class="wa-content">
                <div class="wa-info">
                    Pessoas com cartão ainda pendente aparecem aqui. Para maior segurança, números antigos só são reaproveitados quando você clicar em <b>ATUALIZAR</b>. O CRM cruza um registro já <b>ENTREGUE</b> com o pendente pelo endereço e pela semelhança do nome. O botão <b>RELATÓRIO</b> mostra exatamente de qual cadastro cada telefone foi copiado.
                </div>

                <div class="wa-stats">
                    <div class="wa-stat"><strong id="wa-total-enviar">0</strong><span>Enviar</span></div>
                    <div class="wa-stat"><strong id="wa-total-enviado">0</strong><span>Enviado</span></div>
                </div>

                <div class="wa-tabs">
                    <button type="button" id="wa-tab-enviar" class="wa-tab active" onclick="trocarAbaWhatsapp('enviar')">📨 Enviar mensagem</button>
                    <button type="button" id="wa-tab-enviado" class="wa-tab" onclick="trocarAbaWhatsapp('enviado')">✅ Enviado</button>
                </div>

                <div class="wa-toolbar">
                    <button type="button" id="wa-btn-atualizar-telefones" class="wa-refresh" onclick="atualizarTelefonesWhatsappCRM()">↻ ATUALIZAR</button>
                    <button type="button" id="wa-btn-relatorio" class="wa-report-btn" onclick="abrirRelatorioWhatsappCRM()">📋 RELATÓRIO</button>
                </div>

                <div id="wa-update-result" class="wa-update-result"></div>

                <div id="wa-report-panel" class="wa-report-panel">
                    <div class="wa-report-head">
                        <span>📋 Relatório de telefones reaproveitados</span>
                        <button type="button" class="wa-report-close" onclick="fecharRelatorioWhatsappCRM()" aria-label="Fechar relatório">×</button>
                    </div>
                    <div id="wa-report-list" class="wa-report-list"></div>
                </div>

                <div id="wa-lista-crm" class="wa-lista"></div>
            </div>
        </div>
    `;

    modal.addEventListener('click', function(e) {
        if (e.target === modal) fecharModalWhatsapp();
    });

    document.body.appendChild(modal);
    return modal;
}

async function abrirModalWhatsapp() {
    const modal = garantirModalWhatsapp();
    modal.classList.add('active');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    whatsappCRMState.aba = 'enviar';
    whatsappCRMState.relatorioAberto = false;
    const painelRelatorio = document.getElementById('wa-report-panel');
    if (painelRelatorio) painelRelatorio.classList.remove('active');
    atualizarAbasWhatsapp();
    await carregarWhatsappPendentes();
}

function fecharModalWhatsapp() {
    const modal = document.getElementById('modal-whatsapp-crm');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
    document.body.style.overflow = '';
}

function trocarAbaWhatsapp(aba) {
    whatsappCRMState.aba = aba === 'enviado' ? 'enviado' : 'enviar';
    atualizarAbasWhatsapp();
    renderizarWhatsappPendentes();
}

function atualizarAbasWhatsapp() {
    document.getElementById('wa-tab-enviar')?.classList.toggle('active', whatsappCRMState.aba === 'enviar');
    document.getElementById('wa-tab-enviado')?.classList.toggle('active', whatsappCRMState.aba === 'enviado');
}

async function carregarWhatsappPendentes() {
    if (whatsappCRMState.carregando) return;

    whatsappCRMState.carregando = true;
    const lista = document.getElementById('wa-lista-crm');
    if (lista) lista.innerHTML = '<div class="wa-loading">⏳ Carregando cartões pendentes...</div>';

    try {
        const resposta = await fetchFromGS('listarWhatsappPendentes', { _: String(Date.now()) }, undefined, 30000);

        if (!resposta || resposta.success === false) {
            throw new Error(resposta?.message || resposta?.error || 'Não foi possível carregar os contatos.');
        }

        // Segurança extra no frontend: contatos sem telefone nunca entram no modal.
        whatsappCRMState.itens = (Array.isArray(resposta.itens) ? resposta.itens : [])
            .filter(item => item.temTelefone && normalizarTelefoneWhatsappLink(item.telefone));

        const totalEnviar = whatsappCRMState.itens.filter(item => !item.enviado).length;
        const totalEnviado = whatsappCRMState.itens.filter(item => item.enviado).length;

        const elEnviar = document.getElementById('wa-total-enviar');
        const elEnviado = document.getElementById('wa-total-enviado');
        if (elEnviar) elEnviar.textContent = String(totalEnviar);
        if (elEnviado) elEnviado.textContent = String(totalEnviado);

        renderizarWhatsappPendentes();
    } catch (erro) {
        console.error('Erro ao carregar WhatsApp:', erro);
        if (lista) lista.innerHTML = `<div class="wa-vazio">❌ ${escapeHtml(String(erro.message || erro))}</div>`;
    } finally {
        whatsappCRMState.carregando = false;
    }
}


function mostrarResultadoAtualizacaoWhatsapp(texto, tipo = 'ok') {
    const el = document.getElementById('wa-update-result');
    if (!el) return;

    el.className = 'wa-update-result ' + (tipo === 'error' ? 'error' : 'ok');
    el.textContent = texto;

    clearTimeout(mostrarResultadoAtualizacaoWhatsapp._timer);
    mostrarResultadoAtualizacaoWhatsapp._timer = setTimeout(() => {
        if (el) {
            el.className = 'wa-update-result';
            el.textContent = '';
        }
    }, 7000);
}

async function atualizarTelefonesWhatsappCRM() {
    if (whatsappCRMState.atualizandoTelefones) return;

    const btn = document.getElementById('wa-btn-atualizar-telefones');
    whatsappCRMState.atualizandoTelefones = true;

    const textoOriginal = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ ATUALIZANDO...';
    }

    try {
        const resposta = await fetchFromGS(
            'atualizarTelefonesWhatsapp',
            { _: String(Date.now()) },
            undefined,
            45000
        );

        if (!resposta || resposta.success === false) {
            throw new Error(resposta?.message || resposta?.error || 'Não foi possível atualizar os telefones.');
        }

        const total = Number(resposta.atualizados || 0);

        mostrarResultadoAtualizacaoWhatsapp(
            total > 0
                ? `✅ ${total} telefone(s) encontrado(s) e copiado(s) para novos pendentes.`
                : 'ℹ️ Nenhum novo telefone compatível foi encontrado.',
            'ok'
        );

        // Recarrega a lista: quem recebeu telefone agora passa a aparecer no modal.
        await carregarWhatsappPendentes();

        // Se o relatório estiver aberto, atualiza também.
        if (whatsappCRMState.relatorioAberto) {
            await carregarRelatorioWhatsappCRM();
        }

    } catch (erro) {
        console.error('Erro ao atualizar telefones WhatsApp:', erro);
        mostrarResultadoAtualizacaoWhatsapp(
            '❌ ' + String(erro.message || erro),
            'error'
        );
    } finally {
        whatsappCRMState.atualizandoTelefones = false;

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = textoOriginal || '↻ ATUALIZAR';
        }
    }
}

function fecharRelatorioWhatsappCRM() {
    whatsappCRMState.relatorioAberto = false;
    const painel = document.getElementById('wa-report-panel');
    if (painel) painel.classList.remove('active');
}

async function abrirRelatorioWhatsappCRM() {
    const painel = document.getElementById('wa-report-panel');
    if (!painel) return;

    whatsappCRMState.relatorioAberto = true;
    painel.classList.add('active');

    await carregarRelatorioWhatsappCRM();
}

async function carregarRelatorioWhatsappCRM() {
    const lista = document.getElementById('wa-report-list');
    const btn = document.getElementById('wa-btn-relatorio');

    if (!lista) return;

    const original = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ CARREGANDO...';
    }

    lista.innerHTML = '<div class="wa-loading">⏳ Carregando relatório...</div>';

    try {
        const resposta = await fetchFromGS(
            'listarRelatorioWhatsapp',
            { _: String(Date.now()) },
            undefined,
            30000
        );

        if (!resposta || resposta.success === false) {
            throw new Error(resposta?.message || resposta?.error || 'Não foi possível carregar o relatório.');
        }

        whatsappCRMState.relatorio = Array.isArray(resposta.itens) ? resposta.itens : [];
        renderizarRelatorioWhatsappCRM();

    } catch (erro) {
        console.error('Erro ao carregar relatório WhatsApp:', erro);
        lista.innerHTML = `<div class="wa-vazio">❌ ${escapeHtml(String(erro.message || erro))}</div>`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = original || '📋 RELATÓRIO';
        }
    }
}

function renderizarRelatorioWhatsappCRM() {
    const lista = document.getElementById('wa-report-list');
    if (!lista) return;

    const itens = whatsappCRMState.relatorio || [];

    if (!itens.length) {
        lista.innerHTML = `
            <div class="wa-vazio">
                Nenhum telefone foi reaproveitado ainda.<br>
                Clique em <b>ATUALIZAR</b> para procurar correspondências.
            </div>`;
        return;
    }

    lista.innerHTML = itens.map(item => {
        const telefone = formatarTelefoneWhatsappTela(item.telefone);
        const data = formatarDataHoraWhatsapp(item.data);
        const score = Number(item.score || 0);

        return `
            <div class="wa-report-item">
                <div class="wa-report-route">
                    ${escapeHtml(String(item.nomeOrigem || ''))}
                    (${escapeHtml(String(item.enderecoOrigem || ''))})
                    <span class="wa-report-arrow">→</span>
                    ${escapeHtml(String(item.nomeDestino || ''))}
                    (${escapeHtml(String(item.enderecoDestino || ''))})
                </div>
                <div>📱 <b>${escapeHtml(telefone)}</b></div>
                <div class="wa-report-meta">
                    ${data ? `🕒 ${escapeHtml(data)} · ` : ''}
                    Origem: linha ${Number(item.linhaOrigem || 0)} ·
                    Destino: linha ${Number(item.linhaDestino || 0)} ·
                    Correspondência: ${score}%
                </div>
            </div>`;
    }).join('');
}

function formatarTelefoneWhatsappTela(valor) {
    const d = String(valor || '').replace(/\D/g, '');
    const nacional = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;

    if (nacional.length === 11) {
        return `(${nacional.slice(0,2)}) ${nacional.slice(2,7)}-${nacional.slice(7)}`;
    }
    if (nacional.length === 10) {
        return `(${nacional.slice(0,2)}) ${nacional.slice(2,6)}-${nacional.slice(6)}`;
    }
    return valor || 'Sem telefone';
}

function normalizarTelefoneWhatsappLink(valor) {
    let d = String(valor || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
    if (d.length === 10 || d.length === 11) return '55' + d;
    return '';
}

function mensagemPadraoWhatsapp(item) {
    const nome = String(item.nome || '').trim();
    const plural = Number(item.quantidadeCartoes || 0) > 1;
    return `Olá, ${nome}! Informamos que ${plural ? 'seus cartões já estão aqui e estão disponíveis' : 'seu cartão já está aqui e está disponível'} para retirada na Associação.`;
}

function formatarDataHoraWhatsapp(valor) {
    const d = new Date(valor);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function textoRetornoWhatsapp(valor) {
    const fim = new Date(valor);
    if (isNaN(fim.getTime())) return '';

    const ms = fim.getTime() - Date.now();
    if (ms <= 0) return 'Disponível para novo envio';

    const horas = Math.ceil(ms / (60 * 60 * 1000));
    if (horas <= 24) return `Volta em ${horas}h`;

    const dias = Math.ceil(horas / 24);
    return `Volta em ${dias} dia${dias > 1 ? 's' : ''}`;
}

function renderizarWhatsappPendentes() {
    const lista = document.getElementById('wa-lista-crm');
    if (!lista) return;

    let itens;
    if (whatsappCRMState.aba === 'enviado') {
        itens = whatsappCRMState.itens.filter(item => item.enviado);
    } else {
        itens = whatsappCRMState.itens.filter(item => !item.enviado);
    }

    if (!itens.length) {
        lista.innerHTML = whatsappCRMState.aba === 'enviado'
            ? '<div class="wa-vazio">✅ Nenhuma mensagem está no período de 3 dias.</div>'
            : '<div class="wa-vazio">🎉 Nenhum cartão pendente para avisar agora.</div>';
        return;
    }

    lista.innerHTML = itens.map(item => {
        const chave = encodeURIComponent(String(item.chave || ''));
        const telefone = formatarTelefoneWhatsappTela(item.telefone);
        const numeros = Array.isArray(item.numeros) && item.numeros.length
            ? item.numeros.join(', ')
            : '—';
        const qtd = Number(item.quantidadeCartoes || 1);

        let acao;
        if (item.enviado) {
            acao = `
                <div class="wa-enviado">
                    ✅ ENVIADO
                    <small>${escapeHtml(formatarDataHoraWhatsapp(item.enviadoEm))}</small>
                    <small>${escapeHtml(textoRetornoWhatsapp(item.retornaEm))}</small>
                </div>`;
        } else {
            acao = `<button type="button" class="wa-send" onclick="enviarMensagemWhatsappCRM('${chave}')">💬 Enviar mensagem</button>`;
        }

        return `
            <div class="wa-item">
                <div>
                    <div class="wa-nome">${escapeHtml(String(item.nome || ''))}</div>
                    <div class="wa-meta">
                        <span>📱 <b>${escapeHtml(telefone)}</b></span>
                        <span>💳 Cartão Nº <b>${escapeHtml(numeros)}</b></span>
                        ${qtd > 1 ? `<span>📦 <b>${qtd}</b> cartões pendentes</span>` : ''}
                    </div>
                </div>
                ${acao}
            </div>`;
    }).join('');
}

async function enviarMensagemWhatsappCRM(chaveCodificada) {
    const chave = decodeURIComponent(String(chaveCodificada || ''));
    const item = whatsappCRMState.itens.find(i => String(i.chave) === chave);
    if (!item) return;

    const telefone = normalizarTelefoneWhatsappLink(item.telefone);
    if (!telefone) {
        alert('O telefone desta pessoa está incompleto. Cadastre o DDD + número antes de enviar.');
        return;
    }

    const mensagem = mensagemPadraoWhatsapp(item);
    const url = `https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`;

    // Abre imediatamente para não ser bloqueado pelo navegador.
    const janela = window.open(url, '_blank');
    if (!janela) {
        alert('O navegador bloqueou a abertura do WhatsApp. Permita pop-ups para este site.');
        return;
    }

    // O CRM registra o clique/abertura como envio. O WhatsApp não fornece
    // confirmação de que a pessoa realmente apertou o botão Enviar.
    try {
        await postParaGoogleSheets('marcarWhatsappEnviado', { linhas: item.linhas });

        // Atualização otimista: move imediatamente para a aba ENVIADO.
        const agora = new Date();
        item.enviado = true;
        item.enviadoEm = agora.toISOString();
        item.retornaEm = new Date(agora.getTime() + (3 * 24 * 60 * 60 * 1000)).toISOString();

        renderizarWhatsappPendentes();

        // Confirma com o servidor em seguida.
        setTimeout(() => carregarWhatsappPendentes(), 900);
    } catch (erro) {
        console.error('Erro ao registrar envio do WhatsApp:', erro);
        alert('O WhatsApp foi aberto, mas o CRM não conseguiu registrar o envio. Tente atualizar o modal.');
    }
}

document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('modal-whatsapp-crm');
    if (modal && modal.style.display === 'flex') fecharModalWhatsapp();
});

// ============================================================
// 🔔 LEMBRETES CRM - SALVOS NO GOOGLE SHEETS
// ============================================================
let crmLembretesCache = [];

function inicializarBotaoLembretesCRM(tentativa = 0) {
    if (document.getElementById('btn-lembretes-crm')) return;

    const container = typeof localizarContainerBotoesCentraisCRM === 'function'
        ? localizarContainerBotoesCentraisCRM()
        : document.querySelector('.menu-buttons');

    if (!container) {
        if (tentativa < 25) setTimeout(() => inicializarBotaoLembretesCRM(tentativa + 1), 300);
        return;
    }

    const referencia = container.querySelector('.btn-action');
    const btn = document.createElement('button');
    btn.id = 'btn-lembretes-crm';
    btn.type = 'button';
    btn.className = referencia?.className || 'btn-action';
    btn.innerHTML = '<span class="crm-reminder-icon">🔔</span> LEMBRETES <span id="crm-lembretes-badge" class="crm-reminder-badge" style="display:none">0</span>';
    btn.onclick = () => abrirModalLembretesCRM();

    const btnCestas = Array.from(container.querySelectorAll('button')).find(b =>
        String(b.textContent || '').trim().toUpperCase().includes('CESTAS')
    );

    if (btnCestas) container.insertBefore(btn, btnCestas);
    else container.appendChild(btn);
}

function garantirModalLembretesCRM_() {
    let modal = document.getElementById('modal-lembretes-crm');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'modal-lembretes-crm';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-box crm-reminder-modal">
            <button class="crm-modal-x" type="button" onclick="fecharModalLembretesCRM()" aria-label="Fechar">×</button>
            <div class="crm-reminder-heading">
                <div class="crm-reminder-heading-icon">🔔</div>
                <div>
                    <h3>Lembretes</h3>
                    <p>Salvos automaticamente na planilha <strong>LEMBRETES_CRM</strong>.</p>
                </div>
            </div>

            <div class="crm-reminder-form">
                <label for="crm-lembrete-assunto">Assunto</label>
                <input id="crm-lembrete-assunto" type="text" maxlength="180" placeholder="Ex.: Retornar ligação do morador">
                <label for="crm-lembrete-data">Data</label>
                <input id="crm-lembrete-data" type="date">
                <button type="button" class="btn-primary" onclick="salvarLembreteCRMFrontend()">+ Adicionar lembrete</button>
            </div>

            <div class="crm-reminder-divider"></div>
            <div id="crm-lembretes-resumo" class="crm-reminder-summary"></div>
            <div id="crm-lembretes-lista" class="crm-reminder-list">
                <div class="crm-empty-state">Carregando lembretes...</div>
            </div>
        </div>`;

    modal.addEventListener('click', e => {
        if (e.target === modal) fecharModalLembretesCRM();
    });

    document.body.appendChild(modal);
    return modal;
}

function dataLocalISOCRM_() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dia}`;
}

async function abrirModalLembretesCRM() {
    const modal = garantirModalLembretesCRM_();
    const inputData = modal.querySelector('#crm-lembrete-data');
    if (inputData && !inputData.value) inputData.value = dataLocalISOCRM_();
    modal.classList.add('active');
    await carregarLembretesCRM(false);
}

function fecharModalLembretesCRM() {
    document.getElementById('modal-lembretes-crm')?.classList.remove('active');
}

function atualizarBadgeLembretesCRM_(total) {
    const badge = document.getElementById('crm-lembretes-badge');
    const btn = document.getElementById('btn-lembretes-crm');
    if (!badge || !btn) return;

    badge.textContent = String(total || 0);
    badge.style.display = total > 0 ? 'inline-flex' : 'none';
    btn.classList.toggle('crm-has-reminders', total > 0);
}

function escaparHtmlCRM_(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderizarLembretesCRM_(resposta) {
    const lista = document.getElementById('crm-lembretes-lista');
    const resumo = document.getElementById('crm-lembretes-resumo');
    if (!lista) return;

    const itens = Array.isArray(resposta?.itens) ? resposta.itens : [];
    crmLembretesCache = itens;
    atualizarBadgeLembretesCRM_(itens.length);

    if (resumo) {
        const hoje = Number(resposta?.totalHoje || 0);
        const vencidos = Number(resposta?.totalVencidos || 0);
        resumo.innerHTML = itens.length
            ? `<span><strong>${itens.length}</strong> ativo(s)</span>${hoje ? `<span class="is-today"><strong>${hoje}</strong> para hoje</span>` : ''}${vencidos ? `<span class="is-overdue"><strong>${vencidos}</strong> vencido(s)</span>` : ''}`
            : '';
    }

    if (!itens.length) {
        lista.innerHTML = '<div class="crm-empty-state">Nenhum lembrete ativo. Você pode adicionar um acima.</div>';
        return;
    }

    lista.innerHTML = itens.map(item => {
        const classe = item.vencido ? 'is-overdue' : (item.hoje ? 'is-today' : '');
        const status = item.vencido ? 'VENCIDO' : (item.hoje ? 'HOJE' : 'AGENDADO');
        return `
            <article class="crm-reminder-card ${classe}">
                <div class="crm-reminder-date">
                    <span>${escaparHtmlCRM_(item.dataBR)}</span>
                    <small>${status}</small>
                </div>
                <div class="crm-reminder-text">${escaparHtmlCRM_(item.assunto)}</div>
                <button type="button" class="crm-reminder-done" onclick="concluirLembreteCRMFrontend('${escaparHtmlCRM_(item.id)}')">✓ Concluir</button>
            </article>`;
    }).join('');
}

async function carregarLembretesCRM(mostrarAoEntrar = false) {
    try {
        const resposta = await fetchFromGS('listarLembretes', { _: String(Date.now()) });
        if (resposta?.error || resposta?.success === false) {
            throw new Error(resposta?.error || resposta?.message || 'Falha ao carregar lembretes.');
        }

        if (!document.getElementById('btn-lembretes-crm')) inicializarBotaoLembretesCRM();
        garantirModalLembretesCRM_();
        renderizarLembretesCRM_(resposta);

        if (mostrarAoEntrar && Array.isArray(resposta?.itens) && resposta.itens.length) {
            const modal = document.getElementById('modal-lembretes-crm');
            const inputData = document.getElementById('crm-lembrete-data');
            if (inputData && !inputData.value) inputData.value = dataLocalISOCRM_();
            modal?.classList.add('active');
            return true;
        }
        return false;
    } catch (erro) {
        console.error('Erro ao carregar lembretes:', erro);
        atualizarBadgeLembretesCRM_(0);
        return false;
    }
}

async function salvarLembreteCRMFrontend() {
    const assuntoEl = document.getElementById('crm-lembrete-assunto');
    const dataEl = document.getElementById('crm-lembrete-data');
    const assunto = String(assuntoEl?.value || '').trim();
    const data = String(dataEl?.value || '').trim();

    if (!assunto || !data) {
        alert('Preencha o assunto e a data do lembrete.');
        return;
    }

    try {
        await postParaGoogleSheets('salvarLembrete', { assunto, data });
        if (assuntoEl) assuntoEl.value = '';
        await carregarLembretesCRM(false);
    } catch (erro) {
        alert('Erro ao salvar lembrete: ' + (erro.message || erro));
    }
}

async function concluirLembreteCRMFrontend(id) {
    if (!id) return;
    try {
        await postParaGoogleSheets('concluirLembrete', { id });
        await carregarLembretesCRM(false);
    } catch (erro) {
        alert('Erro ao concluir lembrete: ' + (erro.message || erro));
    }
}


// ============================================================
// 📜 COMPRA E VENDA - VERIFICAÇÃO DE CPF ANTES DOS MODELOS
// ============================================================
let compraVendaVerificacaoState = { cpf: '', resposta: null, verificado: false };

function garantirEtapaVerificacaoCompraVendaCRM_(modal, iframe) {
    let etapa = document.getElementById('compra-venda-verificacao-crm');
    if (etapa) return etapa;

    etapa = document.createElement('section');
    etapa.id = 'compra-venda-verificacao-crm';
    etapa.className = 'cv-check-stage';
    etapa.innerHTML = `
        <div class="cv-check-card">
            <div class="cv-check-eyebrow">ETAPA 1 DE 2</div>
            <h2>Verificar contratos por CPF</h2>
            <p class="cv-check-help">Antes de escolher Compra e Venda, Transferência ou Atualização, consulte o CPF para ver todo o histórico já salvo.</p>

            <div class="cv-check-search">
                <input id="cv-cpf-consulta" type="text" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" aria-label="CPF">
                <button type="button" onclick="pesquisarHistoricoCompraVendaCRM()">🔎 Buscar CPF</button>
            </div>

            <div id="cv-historico-status" class="cv-check-status"></div>
            <div id="cv-historico-resultado" class="cv-history-results">
                <div class="cv-empty">Digite o CPF para verificar se já existem contratos salvos.</div>
            </div>

            <div class="cv-check-actions">
                <button type="button" class="cv-secondary" onclick="fecharModalCompraVendaCRM()">Cancelar</button>
                <button id="cv-continuar-modelos" type="button" class="cv-primary" onclick="continuarCompraVendaAposConsultaCRM()" disabled>Continuar para escolher o modelo →</button>
            </div>
        </div>`;

    iframe.parentNode.insertBefore(etapa, iframe);

    const input = etapa.querySelector('#cv-cpf-consulta');
    input?.addEventListener('input', e => {
        let v = String(e.target.value || '').replace(/\D/g, '').slice(0, 11);
        v = v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        e.target.value = v;
        compraVendaVerificacaoState.verificado = false;
        const btn = document.getElementById('cv-continuar-modelos');
        if (btn) btn.disabled = true;
    });
    input?.addEventListener('keydown', e => {
        if (e.key === 'Enter') pesquisarHistoricoCompraVendaCRM();
    });

    return etapa;
}

function renderizarHistoricoCompraVendaCRM_(resposta) {
    const area = document.getElementById('cv-historico-resultado');
    const status = document.getElementById('cv-historico-status');
    if (!area) return;

    const itens = Array.isArray(resposta?.itens) ? resposta.itens : [];

    if (!itens.length) {
        if (status) status.innerHTML = '<span class="cv-ok-dot"></span> CPF consultado: nenhum contrato anterior encontrado.';
        area.innerHTML = '<div class="cv-empty cv-empty-success">Pessoa sem contrato anterior nesta planilha. Você já pode continuar para criar um documento.</div>';
        return;
    }

    if (status) status.innerHTML = `<span class="cv-found-dot"></span> Encontrado(s) <strong>${itens.length}</strong> contrato(s). O mais recente aparece primeiro.`;

    area.innerHTML = itens.map((item, indice) => {
        const campos = Array.isArray(item.campos) ? item.campos.filter(c => String(c.valor || '').trim() !== '') : [];
        return `
            <details class="cv-history-card" ${indice === 0 ? 'open' : ''}>
                <summary>
                    <div>
                        <span class="cv-history-number">Contrato ${escaparHtmlCRM_(item.contrato || 'sem número')}</span>
                        <strong>${escaparHtmlCRM_(item.proprietario || 'Nome não informado')}</strong>
                    </div>
                    <span class="cv-history-date">${escaparHtmlCRM_(item.data || '')} ${escaparHtmlCRM_(item.ano || '')}</span>
                </summary>
                <div class="cv-history-grid">
                    ${campos.map(c => `<div class="cv-history-field"><small>${escaparHtmlCRM_(c.campo)}</small><span>${escaparHtmlCRM_(c.valor)}</span></div>`).join('')}
                </div>
            </details>`;
    }).join('');
}

async function pesquisarHistoricoCompraVendaCRM() {
    const input = document.getElementById('cv-cpf-consulta');
    const status = document.getElementById('cv-historico-status');
    const area = document.getElementById('cv-historico-resultado');
    const continuar = document.getElementById('cv-continuar-modelos');
    const cpf = String(input?.value || '').replace(/\D/g, '');

    if (cpf.length !== 11) {
        if (status) status.textContent = 'Digite um CPF com 11 números.';
        if (continuar) continuar.disabled = true;
        return;
    }

    if (status) status.innerHTML = '<span class="cv-loading-dot"></span> Consultando a planilha...';
    if (area) area.innerHTML = '<div class="cv-empty">Buscando histórico...</div>';
    if (continuar) continuar.disabled = true;

    try {
        const resposta = await fetchFromGS('listarContratosCompraVendaPorCPF', { cpf, _: String(Date.now()) });
        if (resposta?.success === false || resposta?.error) {
            throw new Error(resposta?.error || resposta?.message || 'Falha ao consultar contratos.');
        }

        compraVendaVerificacaoState = { cpf, resposta, verificado: true };
        renderizarHistoricoCompraVendaCRM_(resposta);
        if (continuar) continuar.disabled = false;
    } catch (erro) {
        compraVendaVerificacaoState = { cpf: '', resposta: null, verificado: false };
        if (status) status.textContent = 'Não foi possível consultar o CPF.';
        if (area) area.innerHTML = `<div class="cv-empty cv-error">${escaparHtmlCRM_(erro.message || erro)}</div>`;
    }
}

function continuarCompraVendaAposConsultaCRM() {
    if (!compraVendaVerificacaoState.verificado) return;

    const etapa = document.getElementById('compra-venda-verificacao-crm');
    const iframe = document.getElementById('compra-venda-iframe-crm');
    if (!iframe) return;

    if (etapa) etapa.style.display = 'none';
    iframe.style.display = 'block';

    const cpf = compraVendaVerificacaoState.cpf;
    const primeiro = compraVendaVerificacaoState.resposta?.itens?.[0];

    iframe.addEventListener('load', function preencherAposAbrir() {
        try {
            const win = iframe.contentWindow;
            const doc = iframe.contentDocument;
            const cpfEl = doc?.getElementById('cpf');
            if (cpfEl) {
                cpfEl.value = cpf.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
            }

            if (primeiro && Array.isArray(primeiro.valores) && typeof win?.preencherDados === 'function') {
                const v = primeiro.valores;
                win.preencherDados({
                    nome: v[3] || '', cpf: v[4] || '', rg: v[5] || '', cep: v[6] || '',
                    endereco: v[7] || '', bairro: v[8] || '', municipio: v[9] || '', uf: v[10] || '',
                    frente: String(v[14] || '').replace(/m$/i, ''),
                    lateral: String(v[15] || '').replace(/m$/i, '')
                });
            }
        } catch (erro) {
            console.warn('Não foi possível pré-preencher Compra e Venda:', erro);
        }
    }, { once: true });

    iframe.srcdoc = COMPRA_VENDA_HTML_CRM;
}


// ============================================================
// ADC CARTÕES V3 — MODAL RECONSTRUÍDO / SCROLL ESTÁVEL
// ============================================================
(function instalarModalCartoesV3() {
    const VERSAO = '3';

    function htmlModalCartoesV3() {
        return `
            <div class="cartoes-v3-shell" role="dialog" aria-modal="true" aria-labelledby="cartoes-v3-titulo">
                <div class="cartoes-v3-top">
                    <div class="cartoes-v3-title-row">
                        <button type="button" class="cartoes-v3-close" onclick="fecharModal('modal-multiplas-entregas')" aria-label="Fechar">×</button>
                        <h3 class="cartoes-v3-title" id="cartoes-v3-titulo"><i class="fas fa-id-card"></i> Adicionar Cartões</h3>
                    </div>
                    <div class="cartoes-v3-tabs" role="tablist" aria-label="Modo de cadastro">
                        <button type="button" id="cartoes-tab-manual" class="cartoes-v3-tab active" role="tab" aria-selected="true" onclick="selecionarModoCadastroCartoes('manual')">✍ Manual</button>
                        <button type="button" id="cartoes-tab-digitalizado" class="cartoes-v3-tab" role="tab" aria-selected="false" onclick="selecionarModoCadastroCartoes('digitalizado')">📷 Digitalizado</button>
                    </div>
                </div>

                <div id="cartoes-modal-scroll" class="cartoes-v3-body">
                    <p id="cartoes-manual-ajuda" class="cartoes-v3-help">Digite normalmente. No campo <strong>Endereço</strong>, pressione <strong>ENTER</strong> ou <strong>TAB</strong> para criar o próximo cartão. A tela desce automaticamente para a nova linha.</p>

                    <details id="cartoes-dados-gerais" class="cartoes-v3-details" open>
                        <summary>Dados gerais <span class="cartoes-v3-details-copy">Quantidade, tipo e número</span></summary>
                        <div class="cartoes-v3-general">
                            <div class="cartoes-v3-grid">
                                <div class="cartoes-v3-field"><label for="mult-qtd">Quantidade</label><input type="number" id="mult-qtd" min="1" value="1"></div>
                                <div class="cartoes-v3-field"><label for="mult-data">Data</label><input type="text" id="mult-data" readonly></div>
                                <div class="cartoes-v3-field"><label for="mult-tipo">Tipo</label><select id="mult-tipo"><option value="">Selecione...</option><option value="SHOPEE">SHOPEE</option><option value="CARTÃO">CARTÃO</option><option value="CARTA">CARTA</option></select></div>
                                <div class="cartoes-v3-field"><label for="mult-numero">Nº</label><input type="text" id="mult-numero"></div>
                                <div class="cartoes-v3-field full"><label for="mult-obs">Observação</label><input type="text" id="mult-obs" placeholder="Opcional"></div>
                            </div>
                        </div>
                    </details>

                    <section id="cartoes-digitalizado-area" class="cartoes-v3-scanner" style="display:none;">
                        <div class="cartoes-v3-scanner-head"><strong>📷 Digitalizar destinatário</strong><span id="cartoes-scanner-alvo">Cartão 1</span></div>
                        <div class="cartoes-v3-video-wrap">
                            <video id="cartoes-scanner-video" playsinline muted></video>
                            <div id="cartoes-scanner-sem-camera">Inicie a câmera ou escolha uma foto do cartão.</div>
                            <div class="cartoes-v3-guide"></div>
                        </div>
                        <div class="cartoes-v3-scanner-actions">
                            <button type="button" class="cartoes-v3-btn" onclick="iniciarCameraCartoes()">🎥 Iniciar câmera</button>
                            <button type="button" id="cartoes-btn-capturar" class="cartoes-v3-btn primary" onclick="capturarCartaoParaOCR()" disabled>📸 Capturar</button>
                            <label class="cartoes-v3-file-label">🖼️ Escolher foto<input type="file" accept="image/*" capture="environment" onchange="processarArquivoCartaoOCR(event)"></label>
                        </div>
                        <div id="cartoes-scanner-status">Clique em “Iniciar câmera”.</div>
                        <div class="cartoes-v3-progress"><div id="cartoes-scanner-progress-bar"></div></div>
                        <canvas id="cartoes-scanner-canvas"></canvas>
                        <div id="cartoes-ocr-review">
                            <div class="cartoes-v3-ocr-grid">
                                <div class="cartoes-ocr-field"><label for="cartoes-ocr-nome">Nome reconhecido</label><input id="cartoes-ocr-nome" type="text"></div>
                                <div class="cartoes-ocr-field"><label for="cartoes-ocr-endereco">Endereço reconhecido</label><input id="cartoes-ocr-endereco" type="text"></div>
                            </div>
                            <div class="cartoes-v3-ocr-actions">
                                <button type="button" class="cartoes-v3-btn primary" onclick="usarDadosCartaoOCR(true)">✓ Usar e próximo</button>
                                <button type="button" class="cartoes-v3-btn" onclick="usarDadosCartaoOCR(false)">✓ Usar dados</button>
                                <button type="button" class="cartoes-v3-btn" onclick="limparResultadoCartaoOCR()">↺ Limpar</button>
                            </div>
                            <details class="cartoes-v3-raw"><summary>Ver texto reconhecido</summary><pre id="cartoes-ocr-texto-bruto"></pre></details>
                        </div>
                    </section>

                    <section class="cartoes-v3-list-section">
                        <div class="cartoes-v3-list-head">
                            <div class="cartoes-v3-list-title"><i class="fas fa-list"></i> Lista de entregas</div>
                            <span id="mult-contador">1 entrega</span>
                        </div>
                        <div id="mult-lista-entregas"></div>
                    </section>
                </div>

                <div class="cartoes-v3-footer">
                    <div id="mult-status-message" style="display:none;"></div>
                    <div class="cartoes-v3-footer-actions">
                        <button type="button" id="btnAdicionarMulti" class="cartoes-v3-action add" onclick="adicionarEntrega(null, true)"><i class="fas fa-plus"></i> Adicionar outro</button>
                        <button type="button" id="btnEnviarMulti" class="cartoes-v3-action send" onclick="enviarTodasEntregas()"><i class="fas fa-paper-plane"></i> Enviar tudo</button>
                        <button type="button" class="cartoes-v3-action cancel" onclick="fecharModal('modal-multiplas-entregas')">Cancelar</button>
                    </div>
                </div>
            </div>`;
    }

    window.garantirEstruturaModalCartoesV3 = function garantirEstruturaModalCartoesV3() {
        const modal = document.getElementById('modal-multiplas-entregas');
        if (!modal) return null;
        if (modal.dataset.cartoesV3 === VERSAO && modal.querySelector('.cartoes-v3-shell')) return modal;
        pararCameraCartoes?.();
        modal.innerHTML = htmlModalCartoesV3();
        modal.dataset.cartoesV3 = VERSAO;
        return modal;
    };

    function rolarParaEntregaV3(item, focar = true) {
        const area = document.getElementById('cartoes-modal-scroll');
        if (!area || !item) return;
        requestAnimationFrame(() => {
            const destino = Math.max(0, item.offsetTop - area.clientHeight + item.offsetHeight + 22);
            area.scrollTo({ top: destino, behavior: 'smooth' });
            if (focar) setTimeout(() => item.querySelector('.nome-input')?.focus({ preventScroll: true }), 180);
        });
    }
    window.rolarParaEntregaCartoesV3 = rolarParaEntregaV3;

    // Substitui somente a criação das linhas do ADC CARTÕES.
    window.adicionarEntrega = function adicionarEntregaV3(dadosIniciais = {}, rolar = false) {
        const lista = document.getElementById('mult-lista-entregas');
        if (!lista) return null;
        contadorEntregas++;
        const novaEntrega = document.createElement('div');
        novaEntrega.className = 'entrega-item';
        novaEntrega.dataset.index = String(contadorEntregas - 1);
        novaEntrega.innerHTML = `
            <div class="entrega-header">
                <div class="entrega-numero">${contadorEntregas}</div>
                <div class="entrega-header-actions">
                    <button type="button" class="entrega-icon-btn btn-scan-entrega" onclick="abrirScannerCartoesParaLinha(this.closest('.entrega-item'))" title="Digitalizar neste cartão" aria-label="Digitalizar este cartão">📷</button>
                    <button type="button" class="entrega-icon-btn entrega-delete-btn" onclick="removerEntrega(this)" title="Remover esta linha" aria-label="Remover este cartão"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
            <div class="entrega-fields">
                <div class="entrega-field"><label>Nome</label><input type="text" class="nome-input" placeholder="Nome completo" autocomplete="name"></div>
                <div class="entrega-field"><label>Endereço</label><input type="text" class="endereco-input" placeholder="Rua e número" autocomplete="street-address"></div>
            </div>`;
        lista.appendChild(novaEntrega);

        const nomeInp = novaEntrega.querySelector('.nome-input');
        const endInp = novaEntrega.querySelector('.endereco-input');
        if (nomeInp) nomeInp.value = String(dadosIniciais?.nome || '').toUpperCase();
        if (endInp) endInp.value = String(dadosIniciais?.endereco || '').toUpperCase();

        nomeInp?.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                endInp?.focus();
            }
        });

        endInp?.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter' && e.key !== 'Tab') return;
            e.preventDefault();
            const itens = [...document.querySelectorAll('#mult-lista-entregas .entrega-item')];
            const atual = itens.indexOf(novaEntrega);
            if (atual === itens.length - 1) {
                const proxima = window.adicionarEntrega({}, true);
                if (proxima) rolarParaEntregaV3(proxima, true);
            } else {
                const proxima = itens[atual + 1];
                rolarParaEntregaV3(proxima, true);
            }
        });

        atualizarContador();
        if (contadorEntregas === 1 && nomeInp) nomeInp.focus();
        if (rolar || contadorEntregas > 1) rolarParaEntregaV3(novaEntrega, false);
        return novaEntrega;
    };

    // Garante que o HTML V3 exista ANTES de a função antiga inicializar os campos.
    if (typeof window.abrirModal === 'function') {
        const abrirOriginal = window.abrirModal;
        window.abrirModal = function abrirModalComCartoesV3(id) {
            if (id === 'modal-multiplas-entregas') garantirEstruturaModalCartoesV3();
            return abrirOriginal(id);
        };
    }

    function iniciar() {
        garantirEstruturaModalCartoesV3();
        const modal = document.getElementById('modal-multiplas-entregas');
        if (!modal) return;

        // Evita que wheel/touch acabem rolando o dashboard por trás.
        modal.addEventListener('wheel', function(e) {
            const area = document.getElementById('cartoes-modal-scroll');
            if (!area || !modal.classList.contains('active')) return;
            if (e.target.closest('.cartoes-v3-body')) return; // a área interna trata normalmente
            area.scrollTop += e.deltaY;
            e.preventDefault();
        }, { passive: false });

        // Ao redimensionar/abrir teclado, mantém shell preso à viewport real.
        const ajustarViewport = () => {
            const shell = modal.querySelector('.cartoes-v3-shell');
            if (!shell || !window.visualViewport) return;
            if (window.matchMedia('(max-width:700px)').matches) {
                shell.style.height = `${Math.round(window.visualViewport.height)}px`;
                shell.style.maxHeight = `${Math.round(window.visualViewport.height)}px`;
            } else {
                shell.style.removeProperty('height');
                shell.style.removeProperty('max-height');
            }
        };
        ajustarViewport();
        window.visualViewport?.addEventListener('resize', ajustarViewport);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once:true });
    else iniciar();
})();
