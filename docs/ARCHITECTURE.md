# Arquitetura

## Objetivo

Manter a extensão como uma suíte de módulos independentes, evitando que alterações em uma ferramenta afetem as demais.

## Camadas

### `shared/`

- `runtime.js`: configurações, armazenamento, normalização de texto, leitura de CSV, download local e utilitários de DOM;
- `ui.css`: tokens e componentes visuais usados por todos os módulos.

A camada compartilhada não deve conter seletores específicos do Moodle, Google Drive ou Kahoot.

### `popup/`

Painel central da extensão. Responsável somente por:

- ativar ou desativar módulos;
- editar preferências;
- apresentar instruções rápidas;
- abrir o gerenciamento da extensão.

### `modules/moodle/`

- `importer`: importação e preenchimento de notas e feedbacks;
- `reports`: coleta de totais do curso e geração de planilha;
- `pending`: consulta e download de pendências.

### `modules/drive-pdf/`

Detecta páginas já renderizadas no visualizador e prepara uma janela de impressão. Não modifica o arquivo original.

### `modules/kahoot/`

Lê o CSV, valida as perguntas e interage com o editor. Os seletores ficam isolados neste módulo para facilitar correções quando o Kahoot atualizar a interface.

## Convenções

- classes visuais próprias usam o prefixo `sx-`;
- chaves de configuração ficam agrupadas por módulo;
- scripts de conteúdo devem verificar se o módulo está ativo antes de criar qualquer elemento;
- cada script usa uma marca em `document.documentElement.dataset` para impedir inicialização duplicada;
- falhas parciais devem ser apresentadas na interface, não apenas no console;
- operações longas devem oferecer cancelamento quando possível.

## Publicação

1. atualizar a versão no `manifest.json`;
2. revisar o `README.md`;
3. testar os quatro domínios autorizados;
4. criar um ZIP sem a pasta `.git`;
5. publicar a release com as alterações e limitações conhecidas.
