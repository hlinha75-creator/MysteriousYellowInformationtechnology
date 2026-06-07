# MEMORY.md - NOTAG Bot

Este arquivo guarda as decisoes permanentes do projeto. Antes de alterar o bot, leia este arquivo junto com o codigo atual.

## Objetivo

Bot Discord da guild NOTAG para Albion Online.

O bot existe para organizar eventos, controlar participacao em voz, calcular loot split, manter saldos de prata, registrar membros, lidar com saques/depositos e reduzir trabalho manual da staff.

Prioridade do projeto:
- simples de manter;
- seguro para saldos;
- facil para membros usarem por botoes;
- comandos slash apenas para setup e manutencao;
- se ficar complexo demais, preferir refazer simples em vez de evoluir sem controle.

## Stack

- Node.js
- discord.js
- SQLite via `better-sqlite3`
- Replit para desenvolvimento/testes
- Discloud para rodar em producao
- Git/GitHub para versionamento

## Arquivos Sensiveis

Nunca colocar no Git:
- `.env`
- token do Discord;
- banco SQLite real;
- backups reais do banco;
- `node_modules`.

Banco principal:
- `data/notag.sqlite`

Historico financeiro importante:
- tabela `balances`: saldo atual;
- tabela `balance_transactions`: ledger/historico;
- tabela `audit_logs`: auditoria geral.

## IDs Principais

Servidor:
- guildId: `1480232409105699030`

Bot:
- clientId: `1465328470312747181`

## Cargos

- ADM: `1481251362447823010`
- Staff: `1481251363013791754`
- Tesoureiro: `1481251364523741376`
- Caller: `1481251363705851954`
- Recrutador: `1481251365064806451`
- Membro: `1481251365131911314`
- Convidado: `1481251365857525782`
- Sem tag: `1495210632839172107`

O dono e o owner do servidor Discord.

## Canais

- Criar evento: `1481397653316178022`
- Participar/eventos: `1481397657065754797`
- Deposito rapido: `1481251393967886518`
- Financeiro: `1481318081145077812`
- Consultar saldo: `1481284047526166731`
- Logs banco: `1481251396413296773`
- Saldos guilda: `1481251411726438435`
- Painel ADM: `1486152824067719258`
- Arquivar/CSV: `1499357332231163924`
- Registrar nick: `1492707388552253525`
- Solicitacoes de registro: `1482334949540626462`
- Voz aguardando evento: `1492707400485179664`

Categorias:
- Eventos ativos: `1481251398246203402`
- Eventos encerrados: `1511385037864570970`

## Permissoes

Criar evento:
- caller;
- staff;
- adm;
- recrutador;
- owner.

Aprovar pagamento:
- staff;
- adm;
- tesoureiro;
- owner.

Importar/exportar CSV:
- staff;
- adm;
- tesoureiro;
- owner.

Retirar saldo manualmente:
- staff;
- adm;
- tesoureiro;
- owner.

Aprovar registro:
- staff;
- adm;
- recrutador;
- owner.

Assumir/gerenciar evento:
- staff;
- caller;
- tesoureiro;
- recrutador;
- adm;
- owner.

Criar enquete:
- membro;
- caller;
- staff;
- adm;
- recrutador;
- tesoureiro;
- owner.

Iniciar/finalizar evento:
- criador do evento diretamente;
- staff/adm/owner apenas com confirmacao quando nao for o criador.

## Registro

Quando alguem entra no Discord:
- recebe cargo Sem tag.

Quando preenche registro com nick do Albion:
- recebe Convidado;
- vai para pendencia no canal de solicitacoes de registro.

Staff/ADM/Recrutador podem resolver registro:
- manter Convidado;
- aprovar como Membro.

Quando vira Membro:
- remover Convidado.

## Eventos

Painel de criar evento fica no canal Criar evento.

O modal de criar evento pode ser enviado vazio. Padroes:
- Titulo: `FastContent`
- Descricao: `Pergunte na Call`
- Local: `Pergunte na Call`
- Horario UTC-3: 10 minutos a frente da hora atual
- Vagas: `1,1,1,17`

Formato de vagas:
- Tank, Healer, Sup, DPS
- exemplo: `3,3,2,12`

Eventos suportam multiplos eventos simultaneos.

Evento criado aparece no canal Participar/eventos.

Evento aberto deve mostrar:
- titulo;
- descricao;
- local;
- horario UTC-3;
- vagas por funcao;
- quem ocupou cada vaga.

Evento em andamento deve ficar compacto, mas mostrar:
- tempo em andamento;
- vagas resumidas;
- participantes e funcao de cada um;
- sala de voz;
- criador.

Botoes em andamento:
- Quero participar;
- Assistir;
- Pausar participacao;
- Finalizar;
- Cancelar.

`Quero participar`:
- entra na primeira funcao com vaga livre;
- se ja participava, usa a funcao existente;
- se o usuario estiver em voz, o bot tenta mover para a sala do evento.
- se o evento estiver lotado, nao criar reserva; apenas sugerir Assistir.

`Assistir`:
- coloca como espectador;
- move para a sala se o usuario estiver em voz;
- nao conta tempo.

`Pausar participacao`:
- fecha a sessao de voz aberta;
- para o tempo;
- move para aguardando evento se estiver na sala do evento.

Se o player sair da sala de voz:
- participacao pausa automaticamente;
- se voltar, soma os periodos corretamente.

Tempo contado:
- somente depois que o evento inicia;
- espectador nunca conta;
- quem entra depois conta a partir da entrada;
- quem sai antes recebe proporcional;
- sessoes sobrepostas devem ser mescladas/clippadas para evitar tempo maior que a duracao do evento.

Ao iniciar:
- criar sala temporaria em Eventos ativos;
- mover participantes que ja estao em voz;
- apagar a mensagem de aviso de 1 minuto, se existir;
- apagar cargo temporario de aviso, se existir.

Ao finalizar:
- fechar sessoes de voz;
- mover todos para Aguardando evento;
- apagar sala temporaria;
- apagar mensagem/cargo temporario de aviso;
- apagar o embed do evento no canal Participar/eventos;
- abrir revisao de loot no financeiro.

Ao cancelar:
- apagar sala temporaria;
- apagar mensagem/cargo temporario de aviso;
- apagar o embed do evento no canal Participar/eventos;
- registrar motivo.

Staff/ADM/owner podem cancelar evento de outro criador com confirmacao, igual iniciar/finalizar.

## Enquetes

Enquetes sao criadas por `/enquete`.

Quem pode criar:
- membro ou superior.

Fluxo:
- criador abre modal;
- se deixar vazio, pergunta padrao: `Voce quer Raid Avalon hoje? Que horas?`;
- se deixar vazio, opcoes padrao: `17h, 18h, 19h, 20h, 21h, 22h, 23h`;
- bot posta no canal Participar/eventos;
- bot menciona os cargos configurados de membro e superiores;
- membros votam usando String Select Menu com multiplas escolhas;
- cada membro pode votar em varios horarios;
- se votar novamente, substitui o voto anterior;
- placar atualiza na embed;
- placar deve mostrar quantidade e quem votou em cada horario;
- fechamento e manual;
- somente o criador fecha;
- ao fechar, bot pergunta ao criador se deseja criar evento;
- se criar evento, usar horario mais votado;
- em empate, usar a primeira opcao empatada na ordem da enquete.

Votos de enquete ficam no SQLite.

## Aviso de 1 Minuto

Todos usam UTC-3 como referencia de horario de Albion.

Quando faltar 1 minuto para o evento:
- criar cargo temporario;
- dar cargo aos inscritos;
- nao incluir espectadores no aviso;
- mencionar no canal Participar/eventos;
- avisar que o evento nao inicia automaticamente;
- guardar `warning_message_id` para apagar depois.

Quando o evento iniciar/cancelar/finalizar:
- apagar a mensagem do aviso;
- apagar o cargo temporario.

## Revisao de Participacao

Depois de finalizar, o criador preenche:
- loot total;
- reparo;
- sacos de prata;
- taxa %.

Calculo:
- loot liquido = loot total + sacos de prata - reparo - taxa%.

Antes de enviar para pagamento:
- criador/gestor autorizado pode editar participante;
- adicionar participante;
- remover participante;
- alterar funcao;
- alterar tempo manual;
- recalcular split.

Editar/adicionar/remover participantes deve usar User Select Menu do Discord sempre que possivel.

Todo ajuste manual precisa logar:
- quem fez;
- antes/depois;
- motivo;
- evento.

## Financeiro e Saldos

Saldos sao prata do Albion.

Formato de exibicao:
- `1000` = `1k`
- `1000000` = `1m`
- `1250000` = `1.25m`

No banco, sempre salvar valores como inteiros. Nunca salvar `1m`, `1.5m`, texto ou decimal.

Toda alteracao de saldo precisa:
- alterar `balances`;
- criar linha em `balance_transactions`;
- criar auditoria quando aplicavel;
- enviar DM ao membro com:
  - entrou ou saiu;
  - valor;
  - motivo;
  - saldo atual.

Operacoes criticas devem usar transacao SQLite.

Antes de alteracoes financeiras importantes:
- criar backup do banco.

Ao aprovar evento:
- se qualquer deposito falhar, nao depositar para ninguem.

## Saques

Membro solicita saque pelo painel Consultar saldo.

Valor de saque:
- aceitar somente numero inteiro;
- sem ponto;
- sem virgula;
- sem letra;
- sem simbolo;
- exemplo valido: `1000000`.

Se digitar `1m`, `500k`, `1.000.000`, `1,000,000` ou `10;000`:
- bloquear;
- avisar para inserir somente numeros inteiros.

Antes de enviar para staff:
- mostrar confirmacao ao membro;
- mostrar valor digitado;
- mostrar valor entendido formatado;
- mostrar saldo atual;
- botoes Confirmar saque / Cancelar.

Staff no financeiro pode:
- aprovar saque;
- pagar saque;
- recusar saque.

Saldo so sai quando staff clica em Pagar saque.

Recusar saque:
- nao altera saldo;
- remove botoes;
- registra auditoria.

## Deposito Rapido

Canal de deposito rapido:
- `1481251393967886518`

Staff/ADM/Tesoureiro podem criar deposito para varios membros.

Fluxo:
- modal com loot total, reparo, sacos de prata e taxa;
- calcular liquido;
- User Select Menu para selecionar participantes;
- dividir igualmente entre selecionados;
- sempre dividir igual para todos;
- nao usar peso/tempo no deposito rapido;
- confirmar deposito;
- aplicar saldo;
- enviar DM para cada membro.

Se tentar confirmar sem participantes:
- bloquear e avisar.

## Painel ADM

Retirar saldo:
- usar User Select Menu para escolher membro;
- abrir modal com ID preenchido;
- pedir valor;
- pedir motivo;
- se ficar negativo, exigir `CONFIRMAR`.

Saldo negativo:
- permitido;
- exige confirmacao obrigatoria;
- exige motivo;
- precisa logar.

Saque maior que o saldo atual:
- permitido;
- nao bloquear automaticamente;
- bot deve avisar a staff que o saque deixara saldo negativo;
- a decisao de aprovar/pagar/recusar continua com a staff.

## CSV e Backups

Exportar CSV:
- saldos;
- logs financeiros;
- auditoria.

Importar CSV:
- deve mostrar previa antes;
- sobrescrever saldo por `discord_id` e/ou `albion_name`;
- se `albion_name` bater mas `discord_id` for diferente, atualizar para o novo `discord_id`;
- mostrar quantos encontrados;
- quantos nao encontrados;
- total antes;
- total depois;
- exigir confirmacao;
- gerar log/auditoria.

Importacao CSV altera saldo por diferenca:
- cria transacao com diff entre saldo anterior e novo saldo.

## Deploy

Scripts:
- `npm run deploy:commands`: registra slash commands;
- `npm run clear:commands`: limpa comandos antigos, mas so manualmente;
- `npm start`: inicia o bot;
- `npm run backup:db`: backup manual.

`scripts/clearCommands.js` nunca deve rodar automaticamente ao iniciar o bot.

Discloud:
- depois de subir codigo, reiniciar/rebuild conforme necessario;
- banco SQLite real nao deve ir no zip/git.

## Regras de Manutencao

Preferir codigo dividido por modulos:
- events;
- finance;
- registration;
- voice;
- csv;
- audit;
- commands;
- setup.

Nao criar dashboard web agora.

Antes de terminar uma alteracao:
- rodar `node --check` nos arquivos JS alterados;
- se mexer em banco, garantir migracao segura;
- nao alterar `.env`;
- nao commitar banco real.

## Duvidas Pendentes Para Confirmar

Nenhuma no momento.

