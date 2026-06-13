const ROLE_LIMITS = {
  tank: 3,
  healer: 3,
  support: 2,
  dps: 15
};

const ROLE_LABELS = {
  tank: 'Tank',
  healer: 'Healer',
  support: 'Suporte',
  dps: 'DPS'
};

const RAID_BUILDS = [
  { role: 'tank', weapon: 'Martelo', url: 'https://albiononlinegrind.com/build/main-tank-predatorz' },
  { role: 'tank', weapon: 'Incubus', url: 'https://albiononlinegrind.com/build/incubus-mace-tank-group-fame-farm-build' },
  { role: 'tank', weapon: 'Quebra-Reinos', url: 'https://albiononlinegrind.com/build/ava-realmbreaker' },
  { role: 'tank', weapon: 'Monge Negro', url: 'https://albiononlinegrind.com/build/ava-black-monk-swap' },
  { role: 'healer', weapon: 'Queda Santa', url: 'https://albiononlinegrind.com/build/healer-bau-estradas-avalonianas' },
  { role: 'healer', weapon: 'Avivador', url: 'https://albiononlinegrind.com/build/healer-bau-estradas-avalonianas' },
  { role: 'healer', weapon: 'Corrompido', url: 'https://albiononlinegrind.com/build/ava-group-priest-swap' },
  { role: 'healer', weapon: 'Raiz-Ferre', url: 'https://albiononlinegrind.com/build/ava-ironroot' },
  { role: 'support', weapon: 'Chama Sombra', url: 'https://albiononlinegrind.com/build/chama-sombra-bau-estradas-avalonianas' },
  { role: 'support', weapon: 'Danação', url: 'https://albiononlinegrind.com/build/damnation-staff-support-zvz-build' },
  { role: 'dps', weapon: 'Prisma', url: 'https://albiononlinegrind.com/build/prisma-bau-estradas-avalonianas' },
  { role: 'dps', weapon: 'Águia', url: 'https://albiononlinegrind.com/build/guia-bau-estradas-avaloninanas' },
  { role: 'dps', weapon: 'Fura-Bruma', url: 'https://albiononlinegrind.com/build/mistpiercer-pve-build-for-gold-chests' },
  { role: 'dps', weapon: 'Repetidor', url: 'https://albiononlinegrind.com/build/group-dungeon-weeping-pve' }
];

const BUILD_BY_WEAPON = new Map(RAID_BUILDS.map((build) => [normalizeBuildKey(build.weapon), build]));

function normalizeBuildKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function getBuildByWeapon(weapon) {
  return BUILD_BY_WEAPON.get(normalizeBuildKey(weapon)) || null;
}

module.exports = {
  BUILD_BY_WEAPON,
  RAID_BUILDS,
  ROLE_LABELS,
  ROLE_LIMITS,
  getBuildByWeapon,
  normalizeBuildKey
};
