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

// --- RELÓGIO ---
function updateClock() {
    const now = new Date();
    document.getElementById('current-time').innerText = now.toLocaleTimeString('pt-BR', { hour12: false });
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

// --- GERAR PDF DO CURRÍCULO ---
async function gerarCurriculo() {
    const nome = document.getElementById('cv-nome').value;
    if(!nome) { alert("Por favor, preencha pelo menos o Nome Completo."); return; }
    
    document.getElementById('pdf-nome').innerText = nome;
    document.getElementById('pdf-tel').innerText = document.getElementById('cv-tel').value || '(Não informado)';
    document.getElementById('pdf-email').innerText = document.getElementById('cv-email').value || '(Não informado)';
    document.getElementById('pdf-endereco').innerText = document.getElementById('cv-endereco').value || '(Não informado)';
    document.getElementById('pdf-objetivo').innerText = document.getElementById('cv-objetivo').value || 'Não informado.';
    document.getElementById('pdf-curso').innerText = document.getElementById('cv-curso').value || 'Não informado';
    document.getElementById('pdf-instituicao').innerText = document.getElementById('cv-instituicao').value || 'Não informado';
    document.getElementById('pdf-experiencia').innerText = document.getElementById('cv-experiencia').value || 'Não informado.';
    document.getElementById('pdf-habilidades').innerText = document.getElementById('cv-habilidades').value || 'Não informado.';

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

function abrirModal(id) { document.getElementById(id).classList.add('active'); }
function fecharModal(id) { document.getElementById(id).classList.remove('active'); }
document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('active'); });
});
