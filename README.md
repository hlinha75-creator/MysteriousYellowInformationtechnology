# Notag Bot

Bot Discord da guild Notag para Albion Online.

## Rodando no VS Code

1. Abra esta pasta no VS Code:
   `C:\Users\Lucas\Documents\bot notag`
2. Instale as dependencias:
   ```bash
   npm install
   ```
3. Copie `.env.example` para `.env` e preencha pelo menos:
   ```env
   DISCORD_TOKEN=
   CLIENT_ID=
   GUILD_ID=
   DATABASE_PATH=./data/notag.sqlite
   NODE_ENV=development
   ```
4. Registre os comandos no Discord:
   ```bash
   npm run deploy:commands
   ```
5. Inicie o bot:
   ```bash
   npm start
   ```

No VS Code tambem existe uma configuracao de debug chamada `Iniciar bot`.

## Scripts uteis

- `npm run start`: inicia o bot.
- `npm run deploy:commands`: registra os comandos slash.
- `npm run clear:commands`: limpa comandos antigos globais e da guild.
- `npm run backup:db`: cria backup manual do SQLite.
- `npm run restore:db`: restaura backup manual.
- `npm run audit:channels`: audita canais do servidor.
- `npm run audit:nicks`: audita apelidos.
- `npm run rename:channels`: padroniza nomes de canais.

## Como commitar pelo VS Code

1. Abra a aba **Source Control** no menu lateral.
2. Confira os arquivos alterados.
3. Clique no `+` dos arquivos que quer incluir no commit.
4. Escreva uma mensagem, por exemplo:
   `chore: preparar projeto para vscode`
5. Clique em **Commit**.
6. Clique em **Sync Changes** ou rode:
   ```bash
   git push -u origin main
   ```

## Repositorio remoto

Este projeto deve apontar para:

```bash
git remote add origin https://github.com/hlinha75-creator/MysteriousYellowInformationtechnology.git
git branch -M main
git push -u origin main
```

Se o `origin` ja existir, use:

```bash
git remote set-url origin https://github.com/hlinha75-creator/MysteriousYellowInformationtechnology.git
```

## Seguranca

- Nunca envie `.env` para o Git.
- Nunca envie `data/notag.sqlite` para o Git.
- O banco real fica em `data/notag.sqlite`.
- Backups ficam em `data/backups/`.
- Antes de remover um modulo, confirme se ele nao aparece em `src/index.js`, `src/commands/handlers.js`, `src/interactions/` ou nas migrations.

## Limpeza do bot

Para refazer o bot com menos coisas, o caminho mais seguro e escolher uma lista curta de funcionalidades que ficam. Depois disso, removemos comandos, handlers, modulos e tabelas que nao forem mais usados.

Funcionalidades conectadas hoje:

- registro de membro
- eventos e voz
- saldos, CSV e financeiro
- enquetes
- leiloes
- objetivos
- verificacao de guild Albion
- relatorios diarios e de membros
- templates de evento
- season
- FAQ/tutorial
- pet
- analytics/dashboard
- raid Avalon
