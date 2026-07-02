# Operacao

## Ambiente Principal

Fluxo atual:

1. Desenvolvimento local no VS Code.
2. Execucao/publicacao no Discloud.

O bot tambem pode rodar localmente para teste, desde que o `.env` esteja preenchido e o token seja valido.

## Requisitos

- Node.js 20 ou superior.
- NPM.
- Token de bot Discord.
- Servidor Discord da Notag.
- Banco SQLite em `data/notag.sqlite`.

## Instalar Dependencias

```bash
npm install
```

## Configurar `.env`

Copie:

```bash
copy .env.example .env
```

Preencha:

```env
DISCORD_TOKEN=
DISCORD_WEBHOOK_URL=
CLIENT_ID=1465328470312747181
GUILD_ID=1480232409105699030
RAID_AVALON_CHANNEL_ID=
RAID_AVALON_MESSAGE_ID=
DATABASE_PATH=./data/notag.sqlite
NODE_ENV=production
DASHBOARD_PORT=3000
```

## Variaveis

| Variavel | Uso |
| --- | --- |
| `DISCORD_TOKEN` | Token do bot. Sensivel. Nunca commitar. |
| `DISCORD_WEBHOOK_URL` | Webhook opcional. A confirmar onde e usado hoje. |
| `CLIENT_ID` | ID da aplicacao/bot no Discord. |
| `GUILD_ID` | ID do servidor Notag. |
| `RAID_AVALON_CHANNEL_ID` | Canal especifico de Raid Avalon. A confirmar uso atual. |
| `RAID_AVALON_MESSAGE_ID` | Mensagem especifica de Raid Avalon. A confirmar uso atual. |
| `DATABASE_PATH` | Caminho do banco SQLite. Padrao: `./data/notag.sqlite`. |
| `NODE_ENV` | Ambiente: `development` ou `production`. |
| `DASHBOARD_PORT` | Porta do dashboard local. Padrao no exemplo: `3000`. |

## Rodar Localmente

```bash
npm start
```

Ao iniciar, o bot:

- roda migrations;
- cria backup de startup;
- marca eventos que estavam rodando para revisao se necessario;
- fecha sessoes de voz abertas;
- conecta no Discord;
- inicia rotinas periodicas.

## Registrar Comandos

```bash
npm run deploy:commands
```

Rode quando mudar `src/commands/definitions.js`.

## Limpar Comandos

```bash
npm run clear:commands
```

Use se o Discord ficou com comando antigo ou duplicado.

Depois rode:

```bash
npm run deploy:commands
```

## Atualizar Paineis

No Discord:

```text
/setup
```

Isso recria/atualiza paineis fixos nos canais configurados em `src/config/ids.js`.

## Backups

O projeto tem backup automatico no startup e antes de migrations pendentes.

Tambem existe backup manual:

```bash
npm run backup:db
```

E restore manual:

```bash
npm run restore:db
```

Cuidados:

- antes de restaurar, confira qual backup sera usado;
- nunca restaure por impulso se o bot esta em producao;
- se possivel, pare o bot antes de restaurar banco.

## Rotinas Automaticas Do Bot

Quando fica online, o bot agenda:

- atualizar mensagens de eventos em andamento a cada 60s;
- verificar avisos de inicio de evento a cada 30s;
- atualizar leiloes abertos a cada 60s;
- processar escolhas vencidas da campanha a cada 10 min;
- atualizar progresso da campanha a cada 10 min;
- limpar canais de revisao expirados a cada 1h;
- postar backup diario de saldos se necessario a cada 1h;
- postar lembrete semanal Albion se necessario;
- postar previa mensal de inatividade se necessario.

## Dashboard

Ha arquivos estaticos e scripts em `dashboard/`, alem de servidor em `src/server/dashboard.server.js`.

Hoje o uso informado e local. Se for publicar em producao, confirmar:

- se a porta `DASHBOARD_PORT=3000` esta liberada;
- se o dashboard expõe dados reais;
- se precisa de senha/autenticacao.

## Discloud

Existe `discloud.config`.

Antes de subir:

1. Confirmar `.env` no ambiente da Discloud.
2. Confirmar `DATABASE_PATH`.
3. Garantir que `data/notag.sqlite` correto esta disponivel, se o deploy depender dele.
4. Rodar `npm run deploy:commands` quando comandos mudarem.
5. Ver logs de inicializacao.

## Checklist Depois De Deploy

- Bot apareceu online.
- `/setup` funciona.
- Painel ADM atualiza.
- `/saldo` responde.
- Criar evento de teste se for ambiente seguro.
- Conferir se banco usado e o certo.
- Conferir se logs nao mostram erro de migration.

## Quando Algo Der Errado

1. Veja log do bot.
2. Confira se `.env` esta correto.
3. Confira se o token nao expirou/trocou.
4. Confira se o banco existe em `DATABASE_PATH`.
5. Confira se os IDs de canais/cargos em `src/config/ids.js` ainda existem.
6. Rode `/auditar_canais` para comparar canais conhecidos pelo bot.
7. Se comandos sumiram, rode `npm run deploy:commands`.
