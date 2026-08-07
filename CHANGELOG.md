# Histórico de versões

## 1.1.2 - 2026-08-07

- Corrige o erro **“O editor não está pronto: seleção da alternativa correta”** no Kahoot.
- Remove a exigência do seletor de resposta correta durante o diagnóstico inicial do editor.
- Passa a localizar o controle correto somente depois que a pergunta e as quatro alternativas forem preenchidas.
- Amplia a detecção para controles por `data-functional-selector`, `data-testid`, `aria-checked`, `aria-pressed`, radio, checkbox e botões dentro de cada alternativa.
- Evita confundir o botão de imagem/mídia da alternativa com o seletor de resposta correta.
- Mantém o painel de progresso e o editor liberado durante a automação.

## 1.1.1 - 2026-08-06

- Reduz as dimensões fixas dos modais Moodle e Kahoot e limita o tamanho ao espaço útil da janela.
- Adiciona uma variação ainda mais compacta para telas com pouca altura.
- Faz o botão **Importar!** copiar tamanho, tipografia, raio, borda e cores do botão **Add** do próprio Kahoot.
- Reduz o popup da extensão de 420 px para 372 px.
- Remove a margem e o fundo externo do popup para evitar a aparência de uma janela branca quadrada ao redor do painel.
- Mantém o conteúdo do popup em uma única superfície arredondada, com rolagem somente na lista de recursos.

## 1.1.0 - 2026-08-06

- Adota um design system único em azul para popup, Moodle e Kahoot.
- Simplifica o popup para exibir somente recursos ativos e ferramentas Moodle.
- Remove as seções Comportamento, Acesso e Gerenciar extensão do popup.
- Redesenha o importador Moodle no fluxo **Adicionar → Validar → Executar**, com rolagem interna, resumo de validação e cancelamento.
- Integra o botão azul **Importar!** à barra lateral do editor do Kahoot.
- Adiciona modal de seleção e validação CSV ao Kahoot.
- Executa a automação do Kahoot com a página liberada para interação e um painel discreto de progresso, tempo e opção Ocultar.
- Substitui o modal do Google Drive por um botão verde **Baixar** com contador interno de páginas.
- Faz o preenchimento verde do botão do Drive acompanhar a proporção de páginas identificadas.
- Remove os patches temporários de interface dos módulos Drive e Kahoot.

## 1.0.2 - 2026-08-05

- Simplifica o nome do módulo para **Kahoot**.
- Altera a ação do Google Drive para um botão verde **Baixar**, com símbolo de download.
- Remove a configuração de margens compactas da interface e passa a usá-las automaticamente.
- Reestrutura o importador Moodle com os seletores validados no projeto `importa_notas`.
- Reposiciona o botão **Importar** na navegação de notas, com alternativa flutuante quando necessário.
- Reestrutura a consulta de pendências por curso e categoria, ignorando cursos futuros.
- Gera o relatório em `.xlsx` real, sem o alerta de incompatibilidade do Excel.

## 1.0.1 - 2026-08-05

- Corrige o Kahoot para fechar o modal de importação antes de interagir com o editor e usar os seletores estáveis do Kahoot.
- Substitui a página `about:blank` do módulo Baixar PDF por geração direta de um arquivo PDF real.
- Mantém o botão de importação do Moodle visível na rota de avaliação e orienta a ativação da Avaliação rápida quando necessário.
- Ignora cursos cuja data de início ainda não chegou nas consultas da tela de categoria.
- Torna os indicadores por curso mais visíveis na tela de categoria.
- Prepara a migração dos relatórios para `.xlsx` real.

## 1.0.0

- cria a suíte **SENAI Extensões**;
- adiciona painel unificado de configurações;
- adiciona importação de correções no Moodle em três etapas;
- adiciona aplicação em massa;
- adiciona relatório consolidado por turma;
- adiciona cancelamento da geração do relatório;
- adiciona consulta e download de pendências;
- adiciona o módulo Baixar PDF para Google Drive;
- adiciona o módulo Kahoot;
- organiza o projeto por módulos e aplica um design system compartilhado.