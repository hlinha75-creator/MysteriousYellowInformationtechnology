# Comandos e painéis

Esta lista corresponde aos comandos registrados por `src/commands/definitions.js`.
Sempre que ela mudar, publique novamente com:

```bash
npm run deploy:commands
```

## Comandos slash ativos

### `/setup`

Posta ou atualiza os painéis fixos. Exige `ManageGuild` no Discord e permissão interna de staff, ADM ou tesouraria.

### `/saldo`

Consulta o próprio saldo. Staff e tesouraria podem usar a opção `membro` para consultar outra pessoa.

### `/registro`

Abre o formulário de registro do personagem Albion.

### `/mesclar_contas`

Mescla duas contas Discord do mesmo jogador mediante prévia e confirmação da staff. Saldos, voz, eventos e carreira são consolidados no perfil principal.

### `/publicar_rank`

Publica manualmente o ranking diário ou semanal de fama. Exige permissão administrativa de importação.

### `/exportar`

Gera HTML com opção de baixar CSV. Tipos ativos:

- `balances`
- `transactions`
- `audit`
- `voice_daily`
- `voice`
- `members_discord`

A opção `data`, quando aplicável, usa `AAAA-MM-DD`.

### `/importar`

Importa CSV de saldos com prévia, totais antes/depois e confirmação explícita.

### `/sincronizar_albion`

Recebe CSV/TSV e oferece três tipos:

- `membros`: concilia lista Albion, vínculos e cargos.
- `fama_total`: atualiza PvE, PvP, coleta e craft.
- `fama_pve`: atualiza apenas PvE.

Nenhuma alteração é aplicada antes da confirmação.

### `/inativos`

Gera prévia de inatividade:

- `eventos`: Membro para Convidado.
- `convidados`: Convidado para Sem Tag.

Aceita `dias_minimos` e, para eventos, `tempo_minimo`.

### `/give`

Gerencia sorteios com os subcomandos `criar`, `editar`, `cancelar`, `encerrar` e `refazer`. A entrega do prêmio fica vinculada ao pagador informado.

### `/verificacao_guild`

Gerencia a campanha de confirmação em voz com os subcomandos `iniciar`, `confirmar`, `atualizar`, `status` e `finalizar`.

## Funcionalidades removidas

Não registrar nem reativar sem nova decisão explícita:

- `/objetivo`
- `/list`
- `/albion`
- `/relatorio_diario`
- `/renomear_canais`
- `/auditar_canais`
- defesa temporária da HO de Sunstrand Shoal
- catálogo de Builds PvE do painel antigo do membro

As migrations históricas podem permanecer para compatibilidade com bancos existentes.

## Painéis e portal

O `/setup` mantém os painéis operacionais de eventos, registro, saldo, depósito, administração, membros, arquivos e tutorial. Os fluxos principais também estão disponíveis no portal web conforme o cargo:

- membro: perfil, eventos, rankings e saques;
- Caller/Recrutador: cadastros autorizados;
- Staff/ADM: dashboard completo, eventos, financeiro, cadastros e importações.

As permissões internas ficam em `src/config/permissions.js`.
