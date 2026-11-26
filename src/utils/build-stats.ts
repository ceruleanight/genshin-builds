import { loadJSON } from './content';
import { t, type getLocale } from './i18n';
import type { TranslationHelper } from './translator';

// Flower and Plume have fixed main stats.
// https://www.hoyolab.com/article/37985126
const selectableMainStats = {
  sands: ['hp%', 'atk%', 'def%', 'em', 'er'],
  goblet: [
    'hp%', 'atk%', 'def%', 'em', 'anemo-dmg', 'cryo-dmg', 'dendro-dmg',
    'electro-dmg', 'geo-dmg', 'hydro-dmg', 'pyro-dmg', 'physical-dmg',
  ],
  circlet: ['hp%', 'atk%', 'def%', 'em', 'cr', 'cd', 'healing-bonus'],
} satisfies Record<string, string[]>;

const mainStatSlots = [
  { key: 'sands', label: 'Sands' },
  { key: 'goblet', label: 'Goblet' },
  { key: 'circlet', label: 'Circlet' },
] as const;

type Locale = ReturnType<typeof getLocale>;
type SlotKey = keyof typeof selectableMainStats;
type StatEntry = string | { name?: string } | null;
type SubstatItem = Exclude<StatEntry, null>;
type SubstatPriority = SubstatItem | { items: SubstatItem[] };
export type RankedStat = { id: string; label: string; rank: number };
export type RankedSubstat = RankedStat & { covers: string[] };

export function statName(locale: Locale, translator: TranslationHelper, item: StatEntry) {
  const id = typeof item === 'string' ? item : item?.name;
  if (!id) return '';
  return id.includes('[[') ? translator.translateNoteText(id) : t(locale, 'stat', id, undefined, false);
}

export function getBuildMainStatSlots(locale: Locale, translator: TranslationHelper, buildPath: string) {
  const mainStats: Partial<Record<SlotKey, StatEntry[]>> =
    loadJSON(buildPath, 'artifacts-mainstats.json')?.main_stats ?? {};

  return mainStatSlots.map(({ key, label }) => {
    const stats = (mainStats[key] ?? []).flatMap((item, index) => {
      const id = typeof item === 'string' ? item : item?.name;
      return id ? [{ id, label: statName(locale, translator, item), rank: index + 1 }] : [];
    });

    return {
      key,
      label: t(locale, 'ui', label, undefined, false),
      stats,
      value: stats.map((stat) => stat.label).join(' / '),
    };
  });
}

export function getBuildSubstats(locale: Locale, translator: TranslationHelper, buildPath: string) {
  const priorities: SubstatPriority[] = loadJSON(buildPath, 'artifacts-substats.json')?.substats_priority;
  if (!Array.isArray(priorities)) return [];

  return priorities.flatMap((priority, index) => {
    const items = typeof priority === 'object' && priority !== null && 'items' in priority
      ? priority.items
      : [priority];
    return items.flatMap((item: StatEntry) => {
      const name = typeof item === 'string' ? item : item?.name;
      const label = statName(locale, translator, item);
      if (typeof name !== 'string' || !label) return [];

      const tokens = [...name.matchAll(/\[\[stat:([a-z0-9%/-]+)/g)].map((match) => match[1]);
      const covers = tokens.length
        ? tokens.flatMap((id) => id === 'cr/cd' ? ['cr', 'cd'] : [id])
        : name === 'cr/cd' ? ['cr', 'cd'] : [name];

      return [{ id: name, label, rank: index + 1, covers }];
    });
  });
}

export function getAllBuildMainStatSlots(locale: Locale, translator: TranslationHelper, buildPaths: string[]) {
  const builds = buildPaths.map((build) => getBuildMainStatSlots(locale, translator, build));
  return mainStatSlots.map(({ key, label }, index) => {
    const recommendations = builds.flatMap((slots) => slots[index].stats)
      .sort((a, b) => a.rank - b.rank);
    const recommended = new Map<string, RankedStat>();
    for (const stat of recommendations) {
      // CR/CD marks either of two legal circlet main stats at the same rank.
      const ids = stat.id === 'cr/cd' ? ['cr', 'cd'] : [stat.id];
      for (const id of ids) {
        if (!recommended.has(id)) {
          recommended.set(id, { id, label: statName(locale, translator, id), rank: stat.rank });
        }
      }
    }

    const extra = selectableMainStats[key].filter((id) => !recommended.has(id))
      .map((id) => ({ id, label: statName(locale, translator, id), rank: 0 }));
    return {
      key,
      label: t(locale, 'ui', label, undefined, false),
      stats: [...recommended.values(), ...extra],
      value: [...recommended.values()].map((stat) => stat.label).join(' / '),
    };
  });
}
