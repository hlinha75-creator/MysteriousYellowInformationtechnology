# Notag Bot

Bot Discord da guild Notag para Albion Online.

## Setup

1. Instale dependências:
   ```bash
   npm install
   ```
2. Copie `.env.example` para `.env` e preencha `DISCORD_TOKEN`.
3. Registre comandos:
   ```bash
   npm run deploy:commands
   ```
4. Inicie:
   ```bash
   npm start
   ```

## Scripts manuais

- `npm run deploy:commands`: registra os comandos novos.
- `npm run clear:commands`: limpa comandos antigos globais e da guild. Nunca roda automaticamente.
- `npm run backup:db`: cria backup manual do SQLite.

## Segurança financeira

- O banco real fica em `data/notag.sqlite` e nao deve ir para o Git.
- Toda operacao financeira critica usa transacao SQLite.
- `balances` guarda saldo atual.
- `balance_transactions` guarda o historico para auditoria e reconstrucao.
- Backups sao criados antes de migrations, importacao CSV e aprovacao financeira.
