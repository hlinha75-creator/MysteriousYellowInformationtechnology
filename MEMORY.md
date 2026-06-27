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
- ping-main: `1481397657065754797`
- Deposito rapido: `1481251393967886518`
- Financeiro: `1481318081145077812`
- DPS meter: `1482081003143958568`
- Consultar saldo: `1481284047526166731`
- Logs banco: `1481251396413296773`
- Saldos guilda: `1481251411726438435`
- Painel ADM: `1486152824067719258`
- Arquivar/CSV: `1499357332231163924`
- Registrar nick: `1492707388552253525`
- Solicitacoes de registro: `1482334949540626462`
- Lista de membros: `1482334951637516289`
- Painel do membro / assistente geral: `1515255057971548261`
- Pendencias membros / atendimento staff: `1516030220073963520`
- Voz aguardando evento: `1492707400485179664`

Categorias:
- Eventos pendentes/ativos: `1481251398246203402`
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

Verificacao em massa de pedidos pendentes:
- comando `/aprovar_pendentes arquivo:<csv/tsv>`;
- botao de ajuda no Painel ADM: `Verificar pedidos pendentes`;
- permitido para Staff, ADM, Recrutador e owner;
- arquivo pode ser CSV ou TSV;
- aceitar coluna `Character Name`, `Name`, `Nick`, `Player`, `Jogador`, `albion_name` ou primeira coluna quando for lista simples;
- comparar ignorando maiusculas/minusculas e espacos no comeco/fim;
- mostrar previa antes de aplicar;
- encontrados na lista oficial da guild viram Membro;
- remover Convidado quando virar Membro;
- nao encontrados continuam Convidado/pendente;
- gerar CSV de resultado e auditoria.

Lista de membros:
- canal `1482334951637516289`;
- painel fixo criado/atualizado pelo `/setup`;
- mostra resumo de total, membros, convidados, pendentes, sem tag, equipe, registrados e novos 7 dias;
- botoes para atualizar, exportar CSV e ver filtros curtos;
- detalhes e CSV sao respostas efemeras para equipe autorizada.

Painel do membro:
- canal `1515255057971548261`;
- painel fixo criado pelo `/setup`;
- botoes para consultar pontos de influencia e temporada;
- pontos sao lidos dos CSVs em `resources/season32`;
- link de grafico: `https://notag.xyz/S32/pizza.html`;
- builds PvE temporariamente apontam para `https://notag.xyz/builds/pve/Raid/`;
- pergunta para staff, denuncia anonima e sugestao vao para `1516030220073963520`;
- staff pode responder pergunta pelo botao e o bot envia DM ao membro;
- historico mostra eventos participados, horas em evento/voz, saldo acumulado positivo e saldo atual;
- conversar com bot responde palavras-chave simples ou envia pergunta para staff atualizar FAQ;
- Ver/Ocultar por enquanto mostra atalhos importantes sem alterar permissoes automaticamente.

Privacidade de mensagens por cargo:
- mensagem normal em canal de texto e visivel para todos que podem ver o canal;
- para so uma tag enxergar, usar canal/categoria com permissao desse cargo, thread privada ou resposta efemera de botao/comando;
- mencionar cargo nao esconde a mensagem dos outros.

## Eventos

Painel de criar evento fica no canal Criar evento.

O modal de criar evento pode ser enviado vazio. Padroes:
- Titulo: `FastContent`
- Descricao: `Pergunte na Call`
- Local: `Pergunte na Call`
- Horario Albion/server: 10 minutos a frente do relogio do Albion
- Vagas: `1,1,1,17`

Formato de vagas:
- Tank, Healer, Sup, DPS
- exemplo: `3,3,2,12`

Eventos suportam multiplos eventos simultaneos.

Evento criado aparece no canal ping-main.

Evento aberto deve mostrar:
- titulo;
- descricao;
- local;
- horario Albion/server;
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
- apagar o embed do evento no canal ping-main;
- abrir revisao de loot no financeiro.

Ao cancelar:
- apagar sala temporaria;
- apagar mensagem/cargo temporario de aviso;
- apagar o embed do evento no canal ping-main;
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
- bot posta no canal ping-main;
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

## FAQ e Tutoriais

O bot pode responder mensagens simples quando alguem chama:
- `botnotag`;
- `notag bot`;
- `oi bot`;
- `bot tutorial`.

FAQ:
- Membro e Convidado podem perguntar sobre saldo, saque, evento e registro;
- Staff, ADM, Caller e Recrutador podem perguntar tambem sobre deposito, CSV e backup;
- respostas sao por palavras-chave simples;
- sem IA externa por enquanto;
- novas respostas devem ficar em `src/modules/faq/faq.service.js`.

Tutoriais:
- `bot tutorial` mostra um menu de tutoriais;
- `bot tutorial completo` tenta mandar o tutorial completo no privado;
- o menu e publico, mas a resposta do item escolhido e efemera;
- permitido para Staff, ADM, Caller, Recrutador e owner.

Tutoriais atuais:
- Eventos;
- Financeiro;
- Deposito;
- Registro;
- CSV e backups;
- Treinamento.

## Aviso de 1 Minuto

Todos os eventos usam o horario do Albion/server como referencia. O bot compara esse horario como UTC, nao como hora local do Brasil.

Quando faltar 1 minuto para o evento:
- criar cargo temporario;
- dar cargo aos inscritos;
- nao incluir espectadores no aviso;
- mencionar no canal ping-main;
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
- campo unico opcional com link/imagem/observacoes de DPS meter, fama total e loot logger.

Discord modal nao aceita upload de arquivo. CSV do loot logger e prints podem ser anexados depois no canal temporario de revisao.

Calculo:
- loot liquido = loot total + sacos de prata - reparo - taxa%.

Antes de enviar para pagamento:
- criador/gestor autorizado pode editar participante;
- adicionar participante;
- remover participante;
- alterar funcao;
- alterar tempo manual;
- recalcular split.

Ao finalizar evento:
- mover membros da sala de voz para Aguardando Evento;
- apagar sala temporaria de voz;
- criar canal temporario de revisao na categoria Eventos pendentes/ativos;
- nome do canal: criador + horario;
- canal visivel para criador, participantes e staff/ADM/tesoureiro;
- criador revisa/edita e clica Enviar Financeiro;
- postar resumo no canal DPS meter mencionando participantes depois da revisao final do criador;
- bot move canal para Eventos encerrados;
- bot posta pedido de aprovacao no Financeiro;
- staff aprova pagamento;
- apos aprovacao, registro fica no Financeiro e o canal temporario de revisao some depois de 14h.

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

## Jogo de Frutas NOTAG

O jogo de frutas e separado do financeiro e nao altera saldo de prata.

Quando um evento e enviado para o financeiro depois da revisao:
- o bot calcula o tempo valido dos participantes;
- espectador nao conta;
- 25 minutos ja contam como 1 bloco de 30 minutos;
- abaixo de 25 minutos nao ganha fruta;
- acima disso, arredondar para o bloco de 30 minutos mais proximo;
- cada bloco gera 1 fruta;
- o evento so pode gerar frutas uma vez.

Frutas:
- Banana de prata: 70%, vale 1 ponto;
- Maca de ouro: 25%, vale 3 pontos;
- Uva esmeralda roxa: 5%, vale 10 pontos.

As frutas sao automaticamente dadas ao bot NOTAG:
- membro nao precisa clicar em nada;
- nao mandar DM;
- postar resumo no chat NOTAG.

Estrelinhas:
- a cada 10 pontos, ganha 1 estrelinha;
- pontos usados viram estrelinha e a sobra continua;
- exemplo: tinha 9 pontos, ganhou 3, vira 1 estrelinha e sobra 2 pontos;
- estrela aparece na lista/ranking;
- no apelido do Discord aparece apenas o numero de estrelas no final;
- exemplo: `Tmaiusculo 1`;
- se ja tiver numero no final, substituir;
- guardar o nome base no banco para nao baguncar apelidos;
- se o bot nao conseguir renomear por hierarquia, registrar mesmo assim e avisar no resumo quando possivel.

Ranking e sorteio:
- todo dia as 18:00 no horario Albion/server;
- postar no chat NOTAG;
- ranking top 20 acumulado;
- sorteio diario junto com ranking;
- participa quem ja ganhou pelo menos 1 fruta alguma vez;
- chance igual para todos;
- pode repetir vencedor em dias diferentes;
- premio e bau numero 1 a 14.

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

O Painel ADM tambem deve mostrar o painel Arquivar:
- exportar saldos;
- lista HTML de saldos;
- exportar logs financeiros;
- exportar auditoria;
- importar CSV;
- Discord x Albion HTML.

## CSV e Backups

Exportar CSV:
- saldos;
- logs financeiros;
- auditoria.

Backup automatico de saldos:
- postar CSV no canal Arquivar/CSV `1499357332231163924`;
- postar depois que um evento e aprovado no financeiro e os saldos sao depositados;
- postar tambem a cada 24 horas;
- usar trava no banco para nao duplicar backup do mesmo evento ou do mesmo ciclo diario;
- CSV deve conter discord_id, discord_name, albion_name, balance e last_updated;
- backup automatico nao altera saldo.

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

Dashboard/API:
- servidor HTTP do dashboard fica desligado no `src/index.js` para economizar RAM no Discloud;
- nao iniciar porta 3000 em producao enquanto a prioridade for manter o bot simples;
- arquivos antigos de dashboard podem permanecer no repositorio, mas nao devem rodar automaticamente.

Interface de eventos:
- evento aberto deve ser compacto e mais horizontal;
- criador aparece no topo da descricao;
- status usa simbolo visual;
- vagas usam cores por funcao: azul Tank, verde Healer, amarelo Suporte, vermelho DPS;
- inscricao em evento aberto usa botoes por funcao em vez de menu select;
- Discord nao tem botao amarelo nativo, entao Suporte usa emoji amarelo em botao cinza;
- ao iniciar evento, a sala de voz usa o titulo do evento como nome.
- simulador HTML usa imagens locais em `dashboard/assets/event-icons`;
- para usar as mesmas imagens no bot real do Discord em botoes/textos, enviar como emojis personalizados do servidor e cadastrar os IDs no codigo.
- Raid Avalon Full usa botoes por funcao: Tank, Healer, Suporte, DPS;
- ao clicar numa funcao, abre menu com slots especificos livres daquela funcao;
- slots de Raid Avalon: Tank Martelo/Incubus/Quebra Reinos, Healer Hallow/Fallen/Raiz, Suporte SC/Danacao/Enig, DPS Aguia/Uivo Frio/Furabruma/Repetidor 1-8;
- uma vaga de arma nao pode ser ocupada por duas pessoas ao mesmo tempo;
- se o usuario ja tinha uma vaga, escolher outra troca a vaga dele.
- novo anuncio de Raid Avalon deve ser compacto, sem duplicar DG/build/local em campos separados;
- botoes da Raid Avalon ficam em linhas: Tank/Healer/Suporte/DPS, depois Assistir/Scout/Looter/Uper, depois gerenciamento;
- emojis personalizados cadastrados no codigo para Tank, Healer, Support, DPS, Martelo, Incubus, RealBreaker, QuesaSanta, Fallen, Iron, Shadow, Damnation, Enig, LightCaller, Chill, Furabruma e Repetidor;
- IDs corrigidos: QuesaSanta `1481801328161329152`, Fallen `1517097238336110742`, Iron `1517097588518813767`, Furabruma `1517189201232138240`;
- emoji Furabruma cadastrado com ID `1517189201232138240`;
- IDs enviados para Shadow/Damnation/Enig sao iguais aos de QuesaSanta/Fallen/Iron e podem precisar correcao.
- pontos de carreira sao por tempo: a cada 30 minutos conta +1 ponto;
- ao aprovar pagamento, cada participante recebe pontos na classe e na funcao/arma;
- exemplo: 3h de Tank/Martelo = +6 em Classe Tank e +6 em Martelo;
- em eventos comuns sem arma, usar funcao padrao: Tank=Incubus, Healer=Hallow/Queda Santa, Suporte=SC/Chama Sombra, DPS=Furabruma;
- financeiro tem botao `Recusar e devolver`, que volta evento para revisao e reabre/avisa o canal do criador.

Painel do membro / Builds:
- botao `Builds PvE` mostra catalogo por conteudo;
- Furabruma preenchida com img `https://prnt.sc/ShmbQMoteKMi` e detalhes `https://albionfreemarket.com/builds/details/6a33dba765245f624c119f2e`;
- Repetidor preenchido com img `https://prnt.sc/j8TM6Ug0Qsve` e detalhes `https://albionfreemarket.com/builds/details/6a3418bb65245f624c119f56`;
- demais builds ficam como `img pendente` e `detalhes pendente` para preencher depois.
- botoes de evento sem parametro extra usam sufixo no custom_id (`:main` ou `:raid`) para evitar erro Discord `COMPONENT_CUSTOM_ID_DUPLICATED`.

Enquete diaria Black For-Fun:
- todo dia as 10:00 UTC o bot cria enquete no canal membro `1481363760110243910`;
- pergunta disponibilidade entre 10h e 03h para content black "for fun";
- membros podem escolher varios horarios;
- ao passar de 10 votantes, menciona staff/caller/adm uma vez;
- ao chegar em 20 votantes, cria evento normal `Black For-Fun` no horario mais votado;
- composicao do evento automatico: Tank 2, Healer 2, Suporte 1, DPS 15;
- interessados no horario vencedor sao adicionados no evento automaticamente;
- 15 minutos antes do horario mais votado o bot inicia o evento e move quem estiver em voz.

Tag temporaria de evento:
- todo evento criado ganha cargo temporario mencionavel com nome `DDMMasHHh`;
- exemplo: `1906as07h`;
- cargo e dado aos participantes conforme entram no evento;
- bot menciona o cargo no chat membro 10 minutos antes e novamente no horario;
- cargo deve ser deletado automaticamente apos 24 horas.

Antes de terminar uma alteracao:
- rodar `node --check` nos arquivos JS alterados;
- se mexer em banco, garantir migracao segura;
- nao alterar `.env`;
- nao commitar banco real.

## Duvidas Pendentes Para Confirmar

Nenhuma no momento.

