const { EmbedBuilder } = require('discord.js');

const color = 0xd69e2e;

function buildSeason32Embeds() {
  return [
    new EmbedBuilder()
      .setTitle('Resultado da Season 32 - NoTag')
      .setColor(color)
      .setDescription([
        'Salve, guilda.',
        '',
        'A Season 32 esta chegando ao fim e fizemos um levantamento geral dos resultados da NoTag com base nos dados da temporada, rankings, contribuicoes por atividade e movimentacao financeira.',
        '',
        '**Guilda:** NoTag',
        '**Alianca:** Fatal Error',
        '**Ranking:** #121',
        '**Bracket:** Silver',
        '**Season Points:** **65.627 / 80.000**',
        '**Faltaram para Gold:** **14.373 pontos**',
        '',
        'Mesmo nao alcancando Gold, a guilda teve uma boa movimentacao e varios membros contribuiram em diferentes areas da temporada.'
      ].join('\n'))
      .setTimestamp(new Date()),

    new EmbedBuilder()
      .setTitle('Principais fontes de pontos')
      .setColor(color)
      .setDescription([
        '1. **Guild Challenge** - 15.900 pontos',
        '2. **PvE Outlands/Roads** - 10.000 pontos',
        '3. **The Depths** - 7.400 pontos',
        '4. **Gathering Outlands/Roads** - 7.400 pontos',
        '5. **Crystal Creatures** - 5.940 pontos',
        '6. **Outlands Treasures** - 5.616 pontos',
        '7. **Smugglers** - 5.320 pontos',
        '8. **Hideout Power Cores** - 5.250 pontos',
        '',
        '**Leitura rapida**',
        'A maior parte da nossa pontuacao veio de Guild Challenge, PvE, The Depths, Gathering, Crystal Creatures, Treasures, Smugglers e Cores.',
        '',
        'Isso mostra que a guilda teve uma base forte em conteudo PvE e atividades de mundo aberto.'
      ].join('\n')),

    new EmbedBuilder()
      .setTitle('Top contribuidores estimados')
      .setColor(color)
      .setDescription([
        'Calculo proporcional usado: contribuicao do jogador na categoria / total da categoria x pontos de temporada da categoria.',
        '',
        '1. **RobertXVII** - 2.283,1 pontos estimados',
        '2. **VnfaTI** - 2.174,2 pontos estimados',
        '3. **Tmaiusculo** - 2.096,9 pontos estimados',
        '4. **VULTO** - 1.947,4 pontos estimados',
        '5. **BSAlGunner** - 1.754,9 pontos estimados',
        '6. **zNeii** - 1.743,9 pontos estimados',
        '7. **Horsix** - 1.723,7 pontos estimados',
        '8. **SShadowless** - 1.711,3 pontos estimados',
        '9. **XyoNN** - 1.663,6 pontos estimados',
        '10. **joker1998** - 1.527,3 pontos estimados',
        '',
        'Observacao: esse ranking e estimado com base nos dados visiveis dos prints. Algumas categorias aparecem arredondadas no jogo, entao pode haver pequena diferenca.'
      ].join('\n')),

    new EmbedBuilder()
      .setTitle('MVPs por categoria')
      .setColor(color)
      .addFields(
        { name: 'PvE Outlands/Roads', value: '**VULTO** - 2.403.255', inline: true },
        { name: 'Gathering Outlands/Roads', value: '**zNeii** - 136.037', inline: true },
        { name: 'The Depths', value: '**VnfaTI** - 101.642', inline: true },
        { name: 'Outlands Treasures', value: '**VnfaTI** - 207.663', inline: true },
        { name: 'Smugglers', value: '**jordansPt** - 561.661', inline: true },
        { name: 'Crystal Creatures', value: '**Tmaiusculo** - 104.152', inline: true },
        { name: 'Hideout Power Cores', value: '**Tmaiusculo** - 435.160', inline: true },
        { name: 'Corrupted Dungeons', value: '**RobertXVII** - 48.282', inline: true },
        { name: 'Hellgates', value: '**RobertXVII** - 76.340', inline: true },
        { name: 'Castles & Castle Outposts', value: '**Tmaiusculo** - 17.185', inline: true }
      ),

    new EmbedBuilder()
      .setTitle('Resumo financeiro')
      .setColor(color)
      .addFields(
        {
          name: 'Resultado financeiro',
          value: [
            '**Entradas totais:** 5.814.646.929',
            '**Saidas totais:** 5.878.867.661',
            '**Saldo liquido:** -64.220.732',
            '**Movimentacoes analisadas:** 758'
          ].join('\n')
        },
        {
          name: 'Maiores saldos positivos',
          value: [
            '1. **iiElmagicYT** - +972.796.501',
            '2. **Hlinha** - +642.464.750',
            '3. **MoneyMaker555** - +350.000.000',
            '4. **RedPandaXV** - +228.926.666',
            '5. **bheotrem** - +101.119.000'
          ].join('\n'),
          inline: true
        },
        {
          name: 'Maiores saidas liquidas',
          value: [
            '1. **Horsix** - -620.000.000',
            '2. **Tmaiusculo** - -328.863.256',
            '3. **TChicoBr1Again** - -240.000.000',
            '4. **Nagacaburos** - -136.736.715',
            '5. **RobertXVll** - -116.332.000'
          ].join('\n'),
          inline: true
        },
        {
          name: 'Observacao',
          value: 'Saida de silver nao significa problema automaticamente. Pode ser pagamento de split, compra de item, reembolso, logistica, craft, transporte, HO ou organizacao da guilda.'
        }
      ),

    new EmbedBuilder()
      .setTitle('Membros e movimentacao')
      .setColor(color)
      .addFields(
        {
          name: 'Dados gerais',
          value: [
            '**Membros listados:** 259',
            '**Online no momento do levantamento:** 12',
            '**Ativos recentes / online:** 103',
            '**Staff/cargos de confianca identificados:** 39'
          ].join('\n')
        },
        {
          name: 'Movimentacao administrativa',
          value: [
            '**Registros analisados:** 440',
            '',
            '- Alteracoes de cargo: 195',
            '- Convites: 73',
            '- Membros aceitos: 67',
            '- Kicks: 56',
            '- Saidas voluntarias: 49'
          ].join('\n')
        },
        {
          name: 'Leitura',
          value: 'A guilda teve bastante movimentacao durante a season, tanto em recrutamento quanto em organizacao interna.'
        }
      ),

    new EmbedBuilder()
      .setTitle('Pontos positivos e atencoes')
      .setColor(color)
      .addFields(
        {
          name: 'Pontos positivos da Season 32',
          value: [
            '- A guilda chegou ao **rank #121**',
            '- Tivemos boa pontuacao em PvE e Guild Challenge',
            '- Varios membros se destacaram em categorias diferentes',
            '- A guilda movimentou quase **6 bilhoes de silver**',
            '- Houve bastante atividade administrativa e organizacao interna',
            '- Conseguimos identificar melhor quem contribui em cada tipo de conteudo'
          ].join('\n')
        },
        {
          name: 'Pontos de atencao',
          value: [
            '- Nao alcancamos Gold',
            '- A pontuacao ficou concentrada em poucos jogadores',
            '- Algumas categorias ficaram zeradas ou muito baixas',
            '- Precisamos registrar melhor o motivo das retiradas financeiras',
            '- Precisamos criar metas minimas para a proxima season',
            '- Precisamos organizar melhor as chamadas para atividades que dao Season Points'
          ].join('\n')
        }
      ),

    new EmbedBuilder()
      .setTitle('Plano sugerido para a Season 33')
      .setColor(color)
      .addFields(
        {
          name: 'Meta por membro',
          value: [
            '**Staff / Officer:** 1M+ de contribuicao',
            '**Membros ativos PvE:** 500k+',
            '**Membros casuais:** 200k+',
            '**Recrutas novos:** 50k a 100k'
          ].join('\n')
        },
        {
          name: 'Organizacao',
          value: [
            '- Criar ranking semanal',
            '- Premiar MVPs por categoria',
            '- Registrar motivo de toda retirada financeira',
            '- Fazer chamadas focadas em atividades que geram Season Points',
            '- Separar grupos para PvE, Gathering, Smugglers, Cores e Treasures',
            '- Acompanhar a evolucao da guilda durante a season, nao so no final'
          ].join('\n')
        },
        {
          name: 'Obrigado a todos',
          value: [
            'Obrigado a todos que participaram, pontuaram, ajudaram em conteudo, movimentaram economia, organizaram grupos, recrutaram membros ou contribuiram de alguma forma.',
            '',
            'A Season 32 serviu para mostrar onde estamos fortes e onde precisamos melhorar.',
            '',
            'Na Season 33, a meta e voltar mais organizados, com mais constancia e brigando por um resultado melhor.',
            '',
            '**GG NoTag.**'
          ].join('\n')
        }
      )
  ];
}

module.exports = {
  buildSeason32Embeds
};
