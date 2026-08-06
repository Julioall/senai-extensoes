# Histórico de versões

## 1.0.2 - 2026-08-05

- Simplifica o nome do módulo para **Kahoot**.
- Altera a ação do Google Drive para um botão verde **Baixar**, com símbolo de download.
- Remove a configuração de margens compactas da interface e passa a usá-la automaticamente.
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
- adiciona cancelamento de relatório;
- adiciona consulta e download de pendências;
- adiciona o módulo Baixar PDF para Google Drive;
- adiciona o módulo Kahoot;
- organiza o projeto por módulos e aplica um design system compartilhado.
