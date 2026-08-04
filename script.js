// --- DADOS INICIAIS ---
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

// Variáveis de controle para itens dinâmicos
let telefoneCount = 1;
let cursoCount = 0;
let expCount = 0;

// --- RELÓGIO COM ANIMAÇÃO DE PAPEL VIRANDO ---
function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-BR', { hour12: false });
    const clockEl = document.getElementById('current-time');
    
    // Só anima se o horário mudou
    if (clockEl.innerText !== timeString) {
        clockEl.innerText = timeString;
        // Reseta a animação para tocar de novo
        clockEl.style.animation = 'none';
        setTimeout(() => {
            clockEl.style.animation = 'paperFlip 0.4s ease-in-out';
        }, 10);
    }
}
setInterval(updateClock, 1000);
updateClock();

// --- FECHAR MODAL COM ESC ---
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const activeModal = document.querySelector('.modal-overlay.active');
        if (activeModal) activeModal.classList.remove('active');
    }
});

// --- LOGIN ---
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
        tr.innerHTML = `<td>${dataFormatada}</td><td>${item.periodo}</td><td style="font-weight:600;">${item.nome}</td><td>${item.endereco}</td><td>${item.telefone}</td>`;
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
        tr.innerHTML = `<td>${dataFormatada}</td><td><strong>${valores.cezar > 0 ? valores.cezar : '-'}</strong></td><td><strong>${valores.walter > 0 ? valores.walter : '-'}</strong></td><td style="color:#4a7c2e; font-weight:700;">${totalDia}</td>`;
        tbody.appendChild(tr);
    }
    document.getElementById('total-cezar').innerText = totalCezar;
    document.getElementById('total-walter').innerText = totalWalter;
}

function salvarAgenda() {
    const nome = document.getElementById('ag-nome').value;
    const data = document.getElementById('ag-data').value;
    const periodo = document.getElementById('ag-periodo').value;
    const endereco = document.getElementById('ag-end').value;
    const telefone = document.getElementById('ag-tel').value;
    if(!nome || !data) { alert("Preencha pelo menos o Nome e a Data."); return; }
    dadosAgenda.push({ id: idCounterAgenda++, nome, data, periodo, endereco, telefone });
    fecharModal('modal-agenda'); renderizarAgenda();
    document.getElementById('ag-nome').value = ''; document.getElementById('ag-data').value = ''; document.getElementById('ag-periodo').value = ''; document.getElementById('ag-end').value = ''; document.getElementById('ag-tel').value = '';
}

function salvarCartoes() {
    const responsavel = document.getElementById('card-responsavel').value;
    const qtd = parseInt(document.getElementById('card-qtd').value);
    const data = document.getElementById('card-data').value;
    if(!qtd || !data) { alert("Preencha a Quantidade e a Data."); return; }
    dadosCartoes.push({ id: idCounterCartoes++, responsavel, qtd, data });
    fecharModal('modal-cartoes'); renderizarCartoes();
    document.getElementById('card-qtd').value = ''; document.getElementById('card-data').value = '';
}

// ==========================================
// LÓGICAS DO MÓDULO CURRÍCULO
// ==========================================

// 1. Buscar CEP
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

// 2. Adicionar Telefone (Máx 3)
function adicionarTelefone() {
    if (telefoneCount < 3) {
        telefoneCount++;
        document.getElementById(`cv-tel-container-${telefoneCount}`).style.display = 'block';
        if (telefoneCount === 3) {
            document.getElementById('btn-add-tel').style.display = 'none';
        }
    }
}

// 3. Adicionar Curso
function adicionarCurso() {
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

// 4. Adicionar Experiência (Máx 6)
function adicionarExperiencia() {
    if (expCount >= 6) {
        alert("Limite de 6 experiências atingido.");
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

// 5. Remover Item Dinâmico
function removerItem(id) {
    const el = document.getElementById(id);
    if (el) {
        if (id.startsWith('curso-')) cursoCount--;
        if (id.startsWith('exp-')) expCount--;
        el.remove();
    }
}

// ==========================================
// GERAR CURRÍCULO EM PDF (Design Gracioso)
// ==========================================
async function gerarCurriculo() {
    const nome = document.getElementById('cv-nome').value;
    if (!nome) { alert("Por favor, preencha pelo menos o Nome Completo."); return; }

    // Coletar dados básicos
    const nascimento = document.getElementById('cv-nascimento').value;
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

    // Montar endereço
    let endereco = `${logradouro}, ${numero}`;
    if (bairro) endereco += ` - ${bairro}`;
    if (cidade) endereco += ` - ${cidade}`;

    // Montar lista de telefones (ignorar vazios)
    let tels = [tel1, tel2, tel3].filter(t => t.trim() !== '');

    // Coletar Cursos
    const cursosNodes = document.querySelectorAll('#cursos-container .dynamic-item');
    const cursos = [];
    cursosNodes.forEach(node => {
        const curso = node.querySelector('.input-curso').value || 'Curso não informado';
        const inst = node.querySelector('.input-inst').value || 'Instituição não informada';
        const periodo = node.querySelector('.input-periodo').value || 'Período não informado';
        cursos.push({ curso, inst, periodo });
    });

    // Coletar Experiências
    const expNodes = document.querySelectorAll('#exp-container .dynamic-item');
    const experiencias = [];
    expNodes.forEach(node => {
        const empresa = node.querySelector('.input-empresa').value || 'Empresa não informada';
        const funcao = node.querySelector('.input-funcao').value || 'Função não informada';
        const periodo = node.querySelector('.input-periodo-exp').value || 'Período não informado';
        experiencias.push({ empresa, funcao, periodo });
    });

    // Alimentar o layout oculto do PDF
    document.getElementById('pdf-nome').innerText = nome;
    document.getElementById('pdf-tel').innerText = tels.length > 0 ? tels.join(' / ') : '(Não informado)';
    document.getElementById('pdf-email').innerText = email || '(Não informado)';
    document.getElementById('pdf-endereco').innerText = endereco || '(Não informado)';
    document.getElementById('pdf-objetivo').innerText = objetivo || 'Não informado.';

    // Habilidades (Transformar texto em Lista)
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

    // Cursos no PDF
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

    // Experiências no PDF
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

    // Gerar o PDF (usando html2canvas e jsPDF)
    const pdfContent = document.getElementById('cv-pdf-layout');
    pdfContent.style.display = 'block';

    try {
        const canvas = await html2canvas(pdfContent, { scale: 2, useCORS: true, logging: false });
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);

        // Abrir em nova guia
        const pdfBlob = pdf.output('blob');
        window.open(URL.createObjectURL(pdfBlob), '_blank');

        pdfContent.style.display = 'none';
        fecharModal('modal-curriculo');

    } catch (error) {
        console.error("Erro ao gerar PDF:", error);
        alert("Ocorreu um erro ao gerar o currículo.");
        pdfContent.style.display = 'none';
    }
}

// ==========================================
// ABRIR E FECHAR MODAIS
// ==========================================
function abrirModal(id) { document.getElementById(id).classList.add('active'); }
function fecharModal(id) { document.getElementById(id).classList.remove('active'); }
document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('active'); });
});
