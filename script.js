// ============================================================
// doGet - Buscar dados
// ============================================================
function doGet(e) {
  const callback = e.parameter.callback;
  const acao = e.parameter.acao;
  let result = {};

  try {
    if (acao === 'getNumero') {
      result.numero = getProximoNumeroDeclaracao();
    } else if (acao === 'buscarCPF') {
      const cpf = e.parameter.cpf;
      result = buscarDadosPorCPF(cpf);
    } else if (acao === 'buscarEnderecos') {
      const query = e.parameter.q;
      result = buscarEnderecos(query);
    } 
    // ========== AGENDA ==========
    else if (acao === 'listarAgenda') {
      result = listarAgenda();
    }
    // ========== CARTÕES E RESPONSÁVEIS ==========
    else if (acao === 'listarCartoes') {
      result = listarCartoes();
    }
    else if (acao === 'listarResponsaveis') {
      result = listarResponsaveis();
    }
  } catch (err) {
    result.error = "Erro interno: " + err.toString();
  }

  if (callback) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(result) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// doPost - Salvar e Deletar dados
// ============================================================
function doPost(e) {
  try {
    const acao = e.parameter.acao;
    const dadosRaw = e.parameter.dados;

    if (acao === 'salvarDeclaracao') {
      const dados = JSON.parse(dadosRaw);
      salvarDeclaracaoResidencia(dados);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' }));
    }
    // ========== AGENDA ==========
    else if (acao === 'salvarAgenda') {
      const dados = JSON.parse(dadosRaw);
      salvarAgenda(dados);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' }));
    }
    else if (acao === 'deletarAgenda') {
      const id = parseInt(dadosRaw);
      deletarAgenda(id);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' }));
    }
    // ========== CARTÕES E RESPONSÁVEIS ==========
    else if (acao === 'salvarCartao') {
      const dados = JSON.parse(dadosRaw);
      salvarCartao(dados);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' }));
    }
    else if (acao === 'deletarCartoesMes') {
      const dados = JSON.parse(dadosRaw);
      deletarCartoesMes(dados);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' }));
    }
    // ========== GERENCIAR RESPONSÁVEIS ==========
    else if (acao === 'salvarResponsavel') {
      const nome = dadosRaw;
      salvarResponsavel(nome);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' }));
    }
    else if (acao === 'deletarResponsavel') {
      const nome = dadosRaw;
      deletarResponsavel(nome);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' }));
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Ação não reconhecida.' }));
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Erro ao salvar: ' + err.toString() }));
  }
}

// ============================================================
// FUNÇÕES DA DECLARAÇÃO DE RESIDÊNCIA
// ============================================================

function salvarDeclaracaoResidencia(dados) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DECLARAÇÃO DE RESIDENCIA");
  sheet.appendRow(dados);
}

function getProximoNumeroDeclaracao() {
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DECLARAÇÃO DE RESIDENCIA");
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha === 0) return "0000001";
  const ultimoNumero = aba.getRange(ultimaLinha, 1).getValue();
  let novoNumero = parseInt(ultimoNumero.toString().replace(/^0+/, '')) + 1;
  if (isNaN(novoNumero)) novoNumero = 1;
  return novoNumero.toString().padStart(7, '0');
}

function buscarDadosPorCPF(cpf) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DECLARAÇÃO DE RESIDENCIA");
  const dados = sheet.getDataRange().getValues();
  const cpfLimpo = String(cpf || '').replace(/\D/g, '');

  for (let i = 1; i < dados.length; i++) {
    let rawCpf = dados[i][12];
    if (typeof rawCpf === 'number') {
      rawCpf = rawCpf.toString().padStart(11, '0');
    }
    const cpfPlanilha = String(rawCpf || '').replace(/\D/g, '');

    if (cpfPlanilha && cpfPlanilha === cpfLimpo) {
      return {
        encontrado: true,
        dados: {
          nome: dados[i][3],
          endereco: dados[i][4],
          numero_endereco: dados[i][5],
          complemento: dados[i][6],
          cep: dados[i][7],
          bairro: dados[i][8],
          uf: dados[i][9],
          nacionalidade: dados[i][10],
          estado_civil: dados[i][11],
          cpf: dados[i][12],
          rg: dados[i][13],
          emissor: dados[i][14],
          propria: dados[i][15] === "Casa Própria",
          alugada: dados[i][16] === "Alugada",
          emprestada: dados[i][17] === "Emprestada"
        }
      };
    }
  }
  return { encontrado: false };
}

function buscarEnderecos(query) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DECLARAÇÃO DE RESIDENCIA");
  const dados = sheet.getDataRange().getValues();
  const resultados = [];
  const queryLower = query.toLowerCase();
  for (let i = 1; i < dados.length; i++) {
    const endereco = String(dados[i][4] || "").trim();
    const bairro = String(dados[i][8] || "").trim();
    const uf = String(dados[i][9] || "").trim();
    const cep = String(dados[i][7] || "").trim();
    const enderecoLower = endereco.toLowerCase();
    if (enderecoLower.startsWith(queryLower) || enderecoLower.includes(queryLower)) {
      resultados.push({ endereco, bairro, uf, cep });
      if (resultados.length >= 10) break;
    }
  }
  return resultados;
}

// ============================================================
// 🟢 MÓDULO AGENDA QUADRA
// ============================================================

function getAbaAgenda() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("AGENDA_QUADRA");
  if (!sheet) {
    sheet = ss.insertSheet("AGENDA_QUADRA");
    sheet.getRange(1, 1, 1, 6).setValues([['ID','DATA','HORÁRIO','NOME','ENDEREÇO','TELEFONE']]);
  }
  return sheet;
}

function salvarAgenda(dados) {
  const sheet = getAbaAgenda();
  sheet.appendRow([dados.id, dados.data, dados.periodo, dados.nome, dados.endereco, dados.telefone]);
}

function deletarAgenda(id) {
  const sheet = getAbaAgenda();
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] == id) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

function listarAgenda() {
  const sheet = getAbaAgenda();
  const dados = sheet.getDataRange().getValues();
  const itens = [];
  for (let i = 1; i < dados.length; i++) {
    itens.push({
      id: dados[i][0],
      data: dados[i][1],
      periodo: dados[i][2],
      nome: dados[i][3],
      endereco: dados[i][4],
      telefone: dados[i][5]
    });
  }
  return { itens };
}

// ============================================================
// 🔵 MÓDULO CARTÕES E RESPONSÁVEIS
// ============================================================

function getAbaCartoes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("CARTÕES");
  if (!sheet) {
    sheet = ss.insertSheet("CARTÕES");
    sheet.getRange(1, 1, 1, 4).setValues([['ID','RESPONSÁVEL','QUANTIDADE','DATA']]);
  }
  return sheet;
}

function getAbaResponsaveis() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("RESPONSÁVEIS_CARTÕES");
  if (!sheet) {
    sheet = ss.insertSheet("RESPONSÁVEIS_CARTÕES");
    sheet.getRange(1, 1, 1, 1).setValues([['NOME']]);
  }
  return sheet;
}

function salvarCartao(dados) {
  const sheet = getAbaCartoes();
  sheet.appendRow([dados.id, dados.responsavel, dados.qtd, dados.data]);
}

function deletarCartoesMes(dados) {
  const sheet = getAbaCartoes();
  const allData = sheet.getDataRange().getValues();
  const idsParaDeletar = [];
  
  for (let i = 1; i < allData.length; i++) {
    const rowResp = allData[i][1];
    const rowData = new Date(allData[i][3]);
    const rowMes = rowData.getMonth() + 1;
    const rowAno = rowData.getFullYear();

    if (rowResp === dados.responsavel && rowMes === dados.mes && rowAno === dados.ano) {
      idsParaDeletar.push(i + 1);
    }
  }

  idsParaDeletar.sort((a,b) => b - a);
  for (let linha of idsParaDeletar) {
    sheet.deleteRow(linha);
  }
}

function salvarResponsavel(nome) {
  const sheet = getAbaResponsaveis();
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] === nome) return; // Não cadastra duplicado
  }
  sheet.appendRow([nome]);
}

function deletarResponsavel(nome) {
  const sheet = getAbaResponsaveis();
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] === nome) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

function listarResponsaveis() {
  const sheet = getAbaResponsaveis();
  const dados = sheet.getDataRange().getValues();
  const nomes = [];
  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0]) nomes.push(dados[i][0]);
  }
  return { nomes };
}

function listarCartoes() {
  const sheet = getAbaCartoes();
  const dados = sheet.getDataRange().getValues();
  const itens = [];
  for (let i = 1; i < dados.length; i++) {
    let dataStr = "";
    if (dados[i][3] instanceof Date) {
      const d = dados[i][3];
      dataStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    } else {
      dataStr = String(dados[i][3]);
    }
    itens.push({
      id: dados[i][0],
      responsavel: dados[i][1],
      qtd: dados[i][2],
      data: dataStr
    });
  }
  return { itens };
}
