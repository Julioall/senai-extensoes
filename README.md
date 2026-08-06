# SENAI Extensões

Suíte modular para Chrome e Microsoft Edge com ferramentas de apoio ao trabalho educacional no Moodle, Google Drive e Kahoot.

## Recursos

### Moodle

- importação de notas, feedbacks e situações por CSV, TSV ou TXT;
- fluxo visual em três etapas: **Adicionar → Validar → Executar**;
- resumo de registros encontrados e não encontrados antes da execução;
- preenchimento em massa de nota e feedback;
- correspondência flexível de nomes;
- relatório `.xlsx` agrupado por turma, com uma coluna para cada unidade curricular;
- cancelamento da geração do relatório;
- identificação de atividades com envios aguardando avaliação;
- exclusão de cursos ainda não iniciados da consulta por categoria;
- download dos envios pendentes quando a estrutura da atividade permitir.

### Google Drive

- detecção contínua das páginas carregadas no visualizador;
- botão verde **Baixar** integrado à página, sem abrir modal;
- contador interno no formato `identificadas/total`;
- preenchimento visual do botão conforme as páginas são descobertas;
- geração local de um arquivo PDF real;
- margens mínimas aplicadas automaticamente;
- preservação do conteúdo e do plano de fundo das páginas.

### Kahoot

- botão azul **Importar!** integrado à barra lateral do editor;
- seleção e validação do CSV em um fluxo guiado;
- validação das colunas e das respostas corretas;
- pré-visualização das perguntas antes da execução;
- preenchimento sequencial no editor do Kahoot;
- painel discreto com andamento, tempo e opção **Ocultar**;
- página do Kahoot permanece disponível para interação durante a automação;
- cancelamento durante a execução.

## Instalação para desenvolvimento

1. Baixe ou clone este repositório.
2. Abra `chrome://extensions/` ou `edge://extensions/`.
3. Ative o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta que contém o arquivo `manifest.json`.

## Formato do CSV para Moodle

```csv
nome;nota;feedback;situacao
Nome Completo do Aluno;85;Feedback individualizado;Corrigido
Outro Aluno;;O arquivo não contém o conteúdo solicitado;Atensão
```

A coluna `nome` é obrigatória. Inclua ao menos uma coluna entre `nota`, `feedback` ou `situacao`.

## Formato do CSV para Kahoot

```csv
pergunta;opcao1;opcao2;opcao3;opcao4;correta
Qual é a capital de Goiás?;Goiânia;Anápolis;Brasília;Rio Verde;1
```

A coluna `correta` deve indicar uma alternativa de `1` a `4`, uma letra de `A` a `D` ou o texto exato da alternativa.

## Estrutura do projeto

```text
background/
  service-worker.js
popup/
  popup.html
  popup.css
  popup.js
shared/
  runtime.js
  ui.css
modules/
  moodle/
    importer/
    pending/
    reports/
  drive-pdf/
  kahoot/
docs/
  ARCHITECTURE.md
```

Cada recurso mantém sua lógica e seus estilos dentro da própria pasta. O diretório `shared/` contém somente configurações, utilitários e componentes visuais comuns.

## Segurança e privacidade

- os dados são processados localmente no navegador;
- nomes, notas, feedbacks e arquivos não são enviados para serviços externos pela extensão;
- as consultas utilizam a sessão já autenticada do usuário nos sites permitidos;
- a extensão não salva automaticamente notas no Moodle: o usuário deve revisar e usar o botão nativo para salvar.

## Compatibilidade

- Moodle Goiás: `ead.fieg.com.br`;
- Moodle Nacional: `ead.senai.br`;
- Google Drive: `drive.google.com`;
- editor do Kahoot: `create.kahoot.it`.

Os seletores do Moodle e do Kahoot podem mudar após atualizações dessas plataformas. Teste os fluxos principais antes de distribuir uma nova versão.
