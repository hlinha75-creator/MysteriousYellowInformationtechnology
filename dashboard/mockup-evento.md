# Mockup - Criacao de Evento NOTAG

Este mockup mostra a ideia de evento compacto onde o jogador clica direto na vaga/arma.

## Evento Aberto

```text
NOTAG APP
┌──────────────────────────────────────────────────────────────┐
│ Raid Avalon HO Loch                                          │
│ Armar T8 + set skip · Criador @Tmaiusculo                    │
│                                                              │
│ 🟦 Aberto        Local: HO Loch        UTC-3: 21:00          │
│                                                              │
│ Tanks 0/3        Healers 0/3        Suportes 0/3        DPS 0/11
│                                                              │
│ 🛡️ TANK                                                       │
│ [Martelo] [Incubus] [Quebra]                                │
│                                                              │
│ 💚 HEALER                                                     │
│ [Hallow] [Fallen] [Raiz]                                    │
│                                                              │
│ 🚩 SUPORTE                                                    │
│ [SC] [Danação] [Enig]                                       │
│                                                              │
│ ⚔️ DPS                                                        │
│ [Repetidor 1] [LC] [Chill] [Repetidor 2] [Repetidor 3]       │
│ [Repetidor 4] [Repetidor 5] [Repetidor 6] [Repetidor 7]      │
│ [Repetidor 8] [Repetidor 9]                                 │
└──────────────────────────────────────────────────────────────┘

[Iniciar] [Cancelar]
```

## Depois Que Pessoas Entram

```text
NOTAG APP
┌──────────────────────────────────────────────────────────────┐
│ Raid Avalon HO Loch                                          │
│ Armar T8 + set skip · Criador @Tmaiusculo                    │
│                                                              │
│ 🟦 Aberto        Local: HO Loch        UTC-3: 21:00          │
│                                                              │
│ Tanks 1/3        Healers 1/3        Suportes 0/3        DPS 2/11
│                                                              │
│ 🛡️ TANK                                                       │
│ [Martelo: @Jokker] [Incubus: Livre] [Quebra: Livre]          │
│                                                              │
│ 💚 HEALER                                                     │
│ [Hallow: @Will] [Fallen: Livre] [Raiz: Livre]                │
│                                                              │
│ 🚩 SUPORTE                                                    │
│ [SC: Livre] [Danação: Livre] [Enig: Livre]                   │
│                                                              │
│ ⚔️ DPS                                                        │
│ [Repetidor 1: @Tmaiusculo] [LC: Livre] [Chill: @Ana]         │
│ [Repetidor 2: Livre] [Repetidor 3: Livre] [Repetidor 4: Livre]
│ [Repetidor 5: Livre] [Repetidor 6: Livre] [Repetidor 7: Livre]
│ [Repetidor 8: Livre] [Repetidor 9: Livre]                   │
└──────────────────────────────────────────────────────────────┘

[Iniciar] [Cancelar]
```

## Regras De Clique

- Clicar em uma vaga livre coloca o jogador naquela vaga.
- Se o jogador ja tinha uma vaga, ele troca para a nova.
- Se a vaga ja estiver ocupada por outra pessoa, o bot avisa: `Essa vaga ja esta ocupada por @Nome`.
- O bot salva:
  - funcao;
  - arma/vaga;
  - usuario Discord;
  - horario de entrada;
  - tempo contado em voz.

## Evento Em Andamento

Quando o criador inicia:

```text
NOTAG APP
┌──────────────────────────────────────────────────────────────┐
│ Raid Avalon HO Loch                                          │
│ 🟢 Em andamento · Criador @Tmaiusculo · Voz: Raid Avalon HO Loch
│                                                              │
│ Tempo: 18m        Local: HO Loch        UTC-3: 21:00         │
│                                                              │
│ Tanks 1/3        Healers 1/3        Suportes 0/3        DPS 2/11
│                                                              │
│ @Jokker       🛡️ Martelo       18m                           │
│ @Will         💚 Hallow        18m                           │
│ @Tmaiusculo   ⚔️ Repetidor 1   18m                           │
│ @Ana          ⚔️ Chill         12m                           │
└──────────────────────────────────────────────────────────────┘

[Quero participar] [Assistir] [Pausar participação] [Finalizar] [Cancelar]
```

## Entrar Depois Do Inicio

Se alguem clicar em `Quero participar`:

```text
Escolha uma vaga livre:

🛡️ Tank: [Incubus] [Quebra]
💚 Healer: [Fallen] [Raiz]
🚩 Suporte: [SC] [Danação] [Enig]
⚔️ DPS: [LC] [Repetidor 2] [Repetidor 3] [Repetidor 4] ...
```

Depois de escolher, o bot:

- adiciona o membro na vaga;
- move para a call se ele estiver em voz;
- começa contar tempo a partir da entrada;
- atualiza o embed compacto.

## Finalizacao E Revisao

Quando o criador clica em `Finalizar`:

```text
Modal Finalizar Evento

Loot total:        12000000
Reparo:           500000
Sacos de prata:   0
Taxa %:           5
DPS meter/link:   opcional
Fama/link:        opcional
CSV loot logger:  anexar depois
```

O bot calcula:

```text
loot liquido = loot total + sacos - reparo - taxa
```

Depois mostra revisao:

```text
NOTAG APP
┌──────────────────────────────────────────────────────────────┐
│ Revisao de participacao                                      │
│ Loot liquido: 10.93m                                         │
│                                                              │
│ @Jokker       🛡️ Martelo       70m       910k                │
│ @Will         💚 Hallow        70m       910k                │
│ @Tmaiusculo   ⚔️ Repetidor 1   70m       910k                │
│ @Ana          ⚔️ Chill         35m       455k                │
└──────────────────────────────────────────────────────────────┘

[Editar membro] [Adicionar membro] [Remover membro] [Enviar financeiro]
```

## Financeiro

```text
NOTAG APP
┌──────────────────────────────────────────────────────────────┐
│ Evento pendente de pagamento                                 │
│ Raid Avalon HO Loch · EVT-000123                             │
│ Criador: @Tmaiusculo                                         │
│ Loot liquido: 10.93m                                         │
│ Participantes: 20                                            │
└──────────────────────────────────────────────────────────────┘

[Aprovar pagamento] [Recusar/Devolver para revisão]
```

Quando a staff aprova:

- bot deposita saldo em todos;
- manda DM para cada membro;
- gera log em `#logs-do-banco`;
- gera backup CSV em `#arquivos-csv`;
- remove/desativa botao de aprovar;
- status vira `✅ Pago`.

## Minha Sugestao De Layout Real No Discord

Para o bot real, eu faria assim:

- Embed principal pequeno, com titulo, status, criador, horario e contadores.
- Botao `Escolher vaga` abre um menu/lista de vagas livres.
- Para Raid Avalon, o bot pode postar uma segunda mensagem compacta chamada `Vagas`, atualizada com os ocupantes.
- Evitar 20 botoes embaixo do embed principal, porque no Discord pode ficar poluido.

Versao mais limpa:

```text
[Escolher vaga] [Ver vagas] [Iniciar] [Cancelar]
```

Ao clicar em `Escolher vaga`, aparece seletor:

```text
Martelo
Incubus
Quebra
Hallow
Fallen
Raiz
SC
Danação
Enig
Repetidor 1
LC
Chill
Repetidor 2...
```

Essa versao fica mais facil de manter e mais bonita no Discord.
