let dadosAgenda = [
    { id: 1, nome: "João Silva", data: "2026-08-05", periodo: "Manhã", endereco: "Qd 12", telefone: "99999-9999" },
    { id: 2, nome: "Maria Oliveira", data: "2026-08-15", periodo: "Tarde", endereco: "Qd 08", telefone: "98888-8888" }
];

let dadosCartoes = [
    { id: 1, responsavel: 'cezar', qtd: 30, data: '2026-08-03' },
    { id: 2, responsavel: 'walter', qtd: 34, data: '2026-08-08' },
    { id: 3, responsavel: 'cezar', qtd: 18, data: '2026-08-28' },
    { id: 4, responsavel: 'walter', qtd: 25, data: '2026-08-28' }
];

let idCounterAgenda = 3;
let idCounterCartoes = 5;
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
// 🔥 COMUNICAÇÃO CORRIGIDA (FETCH PURO, SEM JSONP)
// ==========================================================
async function chamarGS(acao, params = {}) {
    const urlParams = new URLSearchParams({ acao, ...params });
    const url = `${URL_API_GS}?${urlParams.toString()}`;
    const resposta = await fetch(url);
    if (!resposta.ok) throw new Error(`Erro HTTP ${resposta.status}`);
    return await resposta.json();
}

async function postGS(acao, dados = {}) {
    const formData = new URLSearchParams();
    formData.append('acao', acao);
    for (let key in dados) formData.append(key, dados[key]);
    await fetch(URL_API_GS, { method: 'POST', body: formData, mode: 'no-cors' });
}

// ==========================================================
// LÓGICAS DO CRM (AGENDA, CARTÕES, CURRÍCULO)
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
        if (activeModal) activeModal.classList.remove('active');
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

function verificarProximaAgendaPopup() {
    const hoje = new Date();
    const proximos = dadosAgenda.map(item => ({ ...item, dataObj: new Date(item.data + 'T00:00:00') }))
        .filter(item => item.dataObj >= hoje).sort((a, b) => a.dataObj - b.dataObj).slice(0, 2);
    if (proximos.length > 0) {
        const content = document.getElementById('popup-login-content');
        let html = `<p><strong>Você tem os seguintes compromissos agendados:</strong></p><ul>`;
        proximos.forEach(item => {
            const dataFormatada = new Date(item.data + 'T00:00:00').toLocaleDateString('pt-BR');
            html += `<li><strong>${dataFormatada}</strong> - ${item.nome} (${item.periodo}) - Quadra ${item.endereco}</li>`;
        });
        html += `</ul>`;
        content.innerHTML = html;
        abrirModal('modal-popup-login');
    }
}

function renderizarTabelas() { renderizarAgenda(); renderizarCartoes(); }

function renderizarAgenda() {
    const tbody = document.getElementById('agenda-list');
    const hoje = new Date(); tbody.innerHTML = '';
    const sorted = [...dadosAgenda].sort((a,b) => new Date(a.data) - new Date(b.data));
    let encontrouProximo = false;
    sorted.forEach(item => {
        const tr = document.createElement('tr');
        const dataItem = new Date(item.data + 'T00:00:00');
        const dataFormatada = dataItem.toLocaleDateString('pt-BR');
        if (!encontrouProximo && dataItem >= hoje) { tr.className = 'highlight-row'; encontrouProximo = true; }
        tr.innerHTML = `
            <td>${dataFormatada}</td>
            <td>${item.periodo}</td>
            <td style="font-weight:600;">${item.nome}</td>
            <td>${item.endereco}</td>
            <td>${item.telefone}</td>
            <td><button class="btn-edit" onclick="editarAgenda(${item.id})" title="Editar">✎</button></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderizarCartoes() {
    const tbody = document.getElementById('cards-list'); tbody.innerHTML = '';
    let totalCezar = 0, totalWalter = 0;
    const sorted = [...dadosCartoes].sort((a,b) => new Date(a.data) - new Date(b.data));
    const agrupadoPorData = {};
    sorted.forEach(item => {
        if(!agrupadoPorData[item.data]) agrupadoPorData[item.data] = { cezar: 0, walter: 0 };
        if(item.responsavel === 'cezar') { agrupadoPorData[item.data].cezar += item.qtd; totalCezar += item.qtd; }
        if(item.responsavel === 'walter') { agrupadoPorData[item.data].walter += item.qtd; totalWalter += item.qtd; }
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
            <td><button class="btn-edit" onclick="editarCartao(${sorted.find(i => i.data === data).id})" title="Editar">✎</button></td>
        `;
        tbody.appendChild(tr);
    }
    document.getElementById('total-cezar').innerText = totalCezar;
    document.getElementById('total-walter').innerText = totalWalter;
}

function editarAgenda(id) {
    const item = dadosAgenda.find(x => x.id === id);
    if (!item) return;
    document.getElementById('ag-nome').value = item.nome;
    document.getElementById('ag-data').value = item.data;
    document.getElementById('ag-periodo').value = item.periodo;
    document.getElementById('ag-end').value = item.endereco;
    document.getElementById('ag-tel').value = item.telefone;
    
    editingAgendaId = id;
    document.getElementById('agenda-modal-title').innerText = "Editar Agendamento";
    abrirModal('modal-agenda');
}

function editarCartao(id) {
    const item = dadosCartoes.find(x => x.id === id);
    if (!item) return;
    document.getElementById('card-responsavel').value = item.responsavel;
    document.getElementById('card-qtd').value = item.qtd;
    document.getElementById('card-data').value = item.data;
    
    editingCartaoId = id;
    document.getElementById('cartao-modal-title').innerText = "Editar Lote";
    abrirModal('modal-cartoes');
}

function salvarAgenda() {
    const nome = document.getElementById('ag-nome').value;
    const data = document.getElementById('ag-data').value;
    const periodo = document.getElementById('ag-periodo').value;
    const endereco = document.getElementById('ag-end').value;
    const telefone = document.getElementById('ag-tel').value;
    if(!nome || !data) { alert("Preencha pelo menos o Nome e a Data."); return; }

    if (editingAgendaId) {
        const idx = dadosAgenda.findIndex(x => x.id === editingAgendaId);
        if (idx !== -1) {
            dadosAgenda[idx] = { ...dadosAgenda[idx], nome, data, periodo, endereco, telefone };
        }
        editingAgendaId = null;
        document.getElementById('agenda-modal-title').innerText = "Novo Agendamento";
    } else {
        dadosAgenda.push({ id: idCounterAgenda++, nome, data, periodo, endereco, telefone });
    }

    fecharModal('modal-agenda'); renderizarAgenda();
    document.getElementById('ag-nome').value = ''; document.getElementById('ag-data').value = ''; document.getElementById('ag-periodo').value = ''; document.getElementById('ag-end').value = ''; document.getElementById('ag-tel').value = '';
}

function salvarCartoes() {
    const responsavel = document.getElementById('card-responsavel').value;
    const qtd = parseInt(document.getElementById('card-qtd').value);
    const data = document.getElementById('card-data').value;
    if(!qtd || !data) { alert("Preencha a Quantidade e a Data."); return; }

    if (editingCartaoId) {
        const idx = dadosCartoes.findIndex(x => x.id === editingCartaoId);
        if (idx !== -1) {
            dadosCartoes[idx] = { ...dadosCartoes[idx], responsavel, qtd, data };
        }
        editingCartaoId = null;
        document.getElementById('cartao-modal-title').innerText = "Adicionar Lote de Cartões";
    } else {
        dadosCartoes.push({ id: idCounterCartoes++, responsavel, qtd, data });
    }

    fecharModal('modal-cartoes'); renderizarCartoes();
    document.getElementById('card-qtd').value = ''; document.getElementById('card-data').value = '';
}

// ==========================================
// LÓGICAS DO CURRÍCULO (GERAÇÃO DE PDF, FOTO, DINÂMICO)
// ==========================================
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

// ==========================================
// LÓGICA DO COMPROVANTE (COM A CORREÇÃO DE CONEXÃO)
// ==========================================

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

async function abrirComprovantePrint() {
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
        // 🔥 USANDO O FETCH CORRIGIDO
        const dados = await chamarGS('getNumero');
        document.getElementById('print-numero').value = dados.numero || '0000001';
    } catch (e) {
        console.error(e);
        alert("Erro ao buscar o número da declaração. Verifique a URL do Apps Script.");
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
        alert("Erro de conexão ao buscar o CEP. Verifique o console (F12)."); 
    }
}

async function buscarCPFPrint() {
    const cpf = document.getElementById('print-cpf').value.replace(/\D/g,'');
    if (cpf.length !== 11) { alert("CPF inválido"); return; }
    try {
        if (URL_API_GS.includes('COLE_AQUI')) {
            throw new Error("A URL do Apps Script não foi configurada!");
        }
        // 🔥 USANDO O FETCH CORRIGIDO (SEM CORS BLOCK)
        const r = await chamarGS('buscarCPF', { cpf: cpf });
        
        if (r.error) { alert(r.error); return; }

        if (!r.encontrado) { 
            alert("CPF NÃO LOCALIZADO na planilha"); 
            return; 
        }
        const d = r.dados;
        document.getElementById('print-nome').value = d.nome || '';
        document.getElementById('print-endereco').value = d.endereco || '';
        document.getElementById('print-bairro').value = d.bairro || '';
        document.getElementById('print-uf').value = d.uf || '';
        document.getElementById('print-cep').value = d.cep || '';
    } catch (e) { 
        console.error(e);
        alert("Erro de comunicação com o Google Sheets ao buscar CPF. Verifique o console (F12)."); 
    }
}

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
    await postGS('salvarDeclaracao', { dados: JSON.stringify(dados) });
}

async function salvarApenas() {
    const btn = document.querySelector('#modal-comprovante-print .btn-save');
    btn.innerText = 'Salvando...'; btn.disabled = true;
    try {
        await salvarDadosComprovante();
        alert("Dados salvos com sucesso!");
        fecharComprovantePrint();
    } catch (e) { alert("Erro ao salvar: " + e.message); } 
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

    } catch (e) { alert("Erro ao salvar: " + e.message); } 
    finally { btn.innerText = '🖨️ Imprimir'; btn.disabled = false; }
}

function abrirModal(id) { document.getElementById(id).classList.add('active'); }
function fecharModal(id) { document.getElementById(id).classList.remove('active'); }
function fecharComprovantePrint() { document.getElementById('modal-comprovante-print').style.display = 'none'; }
