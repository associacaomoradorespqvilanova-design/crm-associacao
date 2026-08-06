let dadosAgenda = [];
let dadosCartoes = [];
let idCounterAgenda = 1;
let idCounterCartoes = 1;
let telefoneCount = 1;
let cursoCount = 0;
let expCount = 0;
let fotoBase64 = null;

let editingAgendaId = null;
let editingCartaoId = null;
let lastSearchedCPF = '';

// 🔥 INSIRA A URL DO SEU APPS SCRIPT AQUI
const URL_API_GS = "COLE_AQUI_A_SUA_URL_DO_APPS_SCRIPT"; 

// ==========================================================
// 🔥 COMUNICAÇÃO JSONP DO STAGE TELECOM (IGNORA CORS)
// ==========================================================

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

// ==========================================================
// LÓGICAS DO CRM (LOGIN E PAINEL)
// ==========================================================
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
        if (activeModal) {
            activeModal.classList.remove('active');
        }
        const comprovante = document.getElementById('modal-comprovante-print');
        if (comprovante && comprovante.style.display === 'flex') {
            fecharComprovantePrint();
        }
    }
});

function login() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const errorBox = document.getElementById('login-error');
    errorBox.style.display = 'none';
    if(user === 'admin' && pass === '123') {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('dashboard-screen').style.display = 'block';
        renderizarTabelas();
        verificarProximaAgendaPopup();
    } else { errorBox.style.display = 'block'; }
}

// ==========================================================
// AGENDA E CARTÕES (LÓGICA PRINCIPAL)
// ==========================================================

async function renderizarTabelas() { 
    await renderizarAgenda(); 
    await renderizarCartoes(); 
}

async function renderizarAgenda() {
    const resp = await fetchFromGS('listarAgenda');
    dadosAgenda = resp.itens || [];

    const tbody = document.getElementById('agenda-list');
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    tbody.innerHTML = '';

    const sorted = [...dadosAgenda].sort((a, b) => new Date(a.data) - new Date(b.data));
    let hojeEncontrado = false;
    let amanhaEncontrado = false;

    sorted.forEach(item => {
        const tr = document.createElement('tr');
        const dataItem = new Date(item.data + 'T00:00:00');
        dataItem.setHours(0,0,0,0);
        
        const dataFormatada = dataItem.toLocaleDateString('pt-BR');

        const diffTime = dataItem - hoje;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            tr.className = 'highlight-row pulse-row';
            hojeEncontrado = true;
        } else if (diffDays === 1) {
            tr.className = 'highlight-row pulse-row';
            amanhaEncontrado = true;
        } else if (diffDays < 0) {
            return; 
        }

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

    if (hojeEncontrado || amanhaEncontrado) {
        const titulo = document.getElementById('popup-login-content');
        let msg = '';
        if (hojeEncontrado) msg += '📅 Você tem um evento HOJE!<br>';
        if (amanhaEncontrado) msg += '📅 Você tem um evento AMANHÃ!<br>';
        titulo.innerHTML = msg;
        abrirModal('modal-popup-login');
    }
}

async function renderizarCartoes() {
    const resp = await fetchFromGS('listarCartoes');
    dadosCartoes = resp.itens || [];

    const tbody = document.getElementById('cards-list');
    tbody.innerHTML = '';
    let totalCezar = 0, totalWalter = 0;
    const agrupadoPorData = {};

    dadosCartoes.forEach(item => {
        if(!agrupadoPorData[item.data]) agrupadoPorData[item.data] = { cezar: 0, walter: 0, ids: [] };
        if(item.responsavel === 'cezar') {
            agrupadoPorData[item.data].cezar += item.qtd;
            totalCezar += item.qtd;
        }
        if(item.responsavel === 'walter') {
            agrupadoPorData[item.data].walter += item.qtd;
            totalWalter += item.qtd;
        }
        agrupadoPorData[item.data].ids.push(item.id);
    });

    for (const [data, valores] of Object.entries(agrupadoPorData).sort((a,b) => new Date(a[0]) - new Date(b[0]))) {
        const tr = document.createElement('tr');
        const dataFormatada = new Date(data + 'T00:00:00').toLocaleDateString('pt-BR');
        const totalDia = valores.cezar + valores.walter;
        
        tr.innerHTML = `
            <td>${dataFormatada}</td>
            <td><strong>${valores.cezar > 0 ? valores.cezar : '-'}</strong></td>
            <td><strong>${valores.walter > 0 ? valores.walter : '-'}</strong></td>
            <td style="color:#4a7c2e; font-weight:700;">${totalDia}</td>
            <td>
                <button class="btn-edit" onclick="excluirMesCartao('cezar', '${data}')" title="Excluir Mês Cezar" style="color:#ff4757; margin-right:5px;">📆🗑️</button>
                <button class="btn-edit" onclick="excluirMesCartao('walter', '${data}')" title="Excluir Mês Walter" style="color:#ff4757;">📆🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    }

    if (tbody.children.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">Nenhum registro de cartão.</td></tr>';
    }

    document.getElementById('total-cezar').innerText = totalCezar;
    document.getElementById('total-walter').innerText = totalWalter;
}

// ==========================================================
// FUNÇÕES DE SALVAR E DELETAR AGENDA
// ==========================================================

async function salvarAgenda() {
    const nome = document.getElementById('ag-nome').value;
    const data = document.getElementById('ag-data').value;
    const periodo = document.getElementById('ag-periodo').value;
    const endereco = document.getElementById('ag-end').value;
    const telefone = document.getElementById('ag-tel').value;
    if(!nome || !data) { alert("Preencha pelo menos o Nome e a Data."); return; }

    const novoItem = { id: Date.now(), nome, data, periodo, endereco, telefone };
    await postParaGoogleSheets('salvarAgenda', novoItem);
    fecharModal('modal-agenda');
    await renderizarAgenda();
    document.getElementById('ag-nome').value = ''; document.getElementById('ag-data').value = ''; document.getElementById('ag-periodo').value = ''; document.getElementById('ag-end').value = ''; document.getElementById('ag-tel').value = '';
}

async function deletarItemAgenda(id) {
    if (!confirm('Tem certeza que deseja excluir este compromisso?')) return;
    await postParaGoogleSheets('deletarAgenda', id);
    await renderizarAgenda();
}

// ==========================================================
// FUNÇÕES DE SALVAR E DELETAR CARTÕES
// ==========================================================

async function salvarCartoes() {
    const responsavel = document.getElementById('card-responsavel').value;
    const qtd = parseInt(document.getElementById('card-qtd').value);
    const data = document.getElementById('card-data').value;
    if(!qtd || !data) { alert("Preencha a Quantidade e a Data."); return; }

    const novoItem = { id: Date.now(), responsavel, qtd, data };
    await postParaGoogleSheets('salvarCartao', novoItem);
    fecharModal('modal-cartoes');
    await renderizarCartoes();
    document.getElementById('card-qtd').value = ''; document.getElementById('card-data').value = '';
}

async function excluirMesCartao(responsavel, dataExemplo) {
    const partes = dataExemplo.split('/');
    const mes = parseInt(partes[1]);
    const ano = parseInt(partes[2]);

    const confirmar = confirm(`Excluir TODOS os cartões do mês ${mes}/${ano} do responsável ${responsavel.toUpperCase()}?`);
    if (!confirmar) return;

    await postParaGoogleSheets('deletarCartoesMes', { responsavel, mes, ano });
    await renderizarCartoes();
}

// ==========================================================
// LÓGICA UNIFICADA DO COMPROVANTE (Com e Sem Assinatura)
// ==========================================================

let tipoComprovanteAtual = 'assinatura';

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
        if (lastSearchedCPF !== cpf) {
            lastSearchedCPF = cpf;
            buscarCPFPrint();
        }
    } else {
        lastSearchedCPF = '';
    }
}

async function abrirComprovantePrint(tipo) {
    tipoComprovanteAtual = tipo;
    document.getElementById('menu-comprovante').style.display = 'none';

    const bgImage = tipo === 'assinatura' 
        ? "https://i.imgur.com/lFhk0Hq.png" 
        : "https://i.imgur.com/l47wlMJ.png";
    
    document.getElementById('modal-comprovante-print').querySelector('div[style*="background-image"]').style.backgroundImage = `url('${bgImage}')`;

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
        if (URL_API_GS.includes('COLE_AQUI')) {
            throw new Error("A URL do Apps Script não foi configurada!");
        }
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
    } catch (e) { 
        console.error(e);
        alert("Erro de conexão ao buscar o CEP."); 
    }
}

async function buscarCPFPrint() {
    const cpf = document.getElementById('print-cpf').value.replace(/\D/g,'');
    if (cpf.length !== 11) { alert("CPF inválido"); return; }
    try {
        if (URL_API_GS.includes('COLE_AQUI')) {
            throw new Error("A URL do Apps Script não foi configurada!");
        }
        const r = await fetchFromGS('buscarCPF', { cpf: cpf });
        
        if (r.erro) { 
            alert("ERRO DO APPS SCRIPT: " + r.erro); 
            return; 
        }

        if (!r.encontrado) { 
            alert("CPF NÃO LOCALIZADO na planilha."); 
            return; 
        }
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
    } catch (e) { 
        console.error(e);
        alert("Erro de comunicação: " + e.message); 
    }
}

function detectarGeneroENacionalidadeComprovante() {
    const nomeInput = document.getElementById('print-nome');
    const nome = nomeInput.value.trim().toUpperCase();
    
    if (nome.length < 2) return;

    const primeiroNome = nome.split(' ')[0].toLowerCase();
    
    let genero = 'MASCULINO';
    
    const excecoesMasculinas = ['joaquim', 'luca', 'noa', 'nicola'];
    if (excecoesMasculinas.includes(primeiroNome)) {
        genero = 'MASCULINO';
    } 
    else if (['mar', 'luz', 'flor', 'marjorie', 'alice', 'constance'].includes(primeiroNome)) {
        genero = 'FEMININO';
    }
    else if (primeiroNome.endsWith('a') || primeiroNome.endsWith('e') || primeiroNome.endsWith('i') || 
             primeiroNome.endsWith('ad') || primeiroNome.endsWith('ra') || primeiroNome.endsWith('na') || 
             primeiroNome.endsWith('la') || primeiroNome.endsWith('da') || primeiroNome.endsWith('ia')) {
        genero = 'FEMININO';
    }
    else {
        genero = 'MASCULINO';
    }

    if (genero === 'FEMININO') {
        document.getElementById('print-nacionalidade').value = 'BRASILEIRA';
        document.getElementById('print-estado_civil').value = 'SOLTEIRA';
    } else {
        document.getElementById('print-nacionalidade').value = 'BRASILEIRO';
        document.getElementById('print-estado_civil').value = 'SOLTEIRO';
    }
}

// ==========================================================
// 🚀 BUSCA DE ENDEREÇOS
// ==========================================================
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

    if (searchController) {
        searchController.abort();
        searchController = null;
    }

    clearTimeout(debounceTimerEndereco);

    if (queryOriginal.length < 2) {
        container.style.display = 'none';
        return;
    }

    if (enderecoCache[queryOriginal]) {
        exibirSugestoes(container, enderecoCache[queryOriginal]);
        return;
    }

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
        } finally {
            searchController = null;
        }
    }, 40);
}

function exibirSugestoes(container, resultados) {
    container.innerHTML = '';
    if (!resultados || resultados.length === 0) {
        container.style.display = 'none';
        return;
    }

    resultados.forEach(item => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = `
            <strong>${item.endereco}</strong>
            <small>${item.bairro || ''} - ${item.uf || ''} (CEP: ${item.cep || 'N/I'})</small>
        `;
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

// ==========================================================
// IMPRESSÃO E SALVAMENTO DO COMPROVANTE
// ==========================================================
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

// ==========================================================
// FUNÇÕES DO CURRÍCULO
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
                fotoBase64 = canvas.toDataURL('image/jpeg');
                const preview = document.getElementById('cv-photo-preview');
                preview.src = fotoBase64;
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
    if (telefoneCount < 3) {
        telefoneCount++;
        document.getElementById(`cv-tel-container-${telefoneCount}`).style.display = 'block';
        if (telefoneCount === 3) {
            document.getElementById('btn-add-tel').style.display = 'none';
        }
    }
}

function adicionarCurso() {
    if (cursoCount >= 3) {
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
    cursoCount++;
}

function adicionarExperiencia() {
    if (expCount >= 6) {
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
    expCount++;
}

function removerItem(id) {
    const el = document.getElementById(id);
    if (el) {
        if (id.startsWith('curso-')) cursoCount--;
        if (id.startsWith('exp-')) expCount--;
        el.remove();
    }
}

async function gerarCurriculo() {
    const nome = document.getElementById('cv-nome').value;
    if (!nome) { alert("Por favor, preencha pelo menos o Nome Completo."); return; }

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
    if (fotoBase64) {
        pdfPhoto.src = fotoBase64;
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

// ==========================================================
// UTILITÁRIOS
// ==========================================================
function abrirModal(id) { document.getElementById(id).classList.add('active'); }
function fecharModal(id) { document.getElementById(id).classList.remove('active'); }
function fecharComprovantePrint() { document.getElementById('modal-comprovante-print').style.display = 'none'; }
