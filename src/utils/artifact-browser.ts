import path from 'path';
import { getCharacterPlanData } from './character-plans';
import { collectSetItems, normalizeSetId } from './artifact-set-items';
import { getBuildMainStatSlots, statName, type RankedStat, type RankedSubstat } from './build-stats';
import {
  getBestBuildUsage,
  getWipNoteItems,
  type BuildUsage,
} from './build-usage';
import { loadJSON, readJSONFile, toTitleCase } from './content';
import { getLocale, t } from './i18n';
import { TranslationHelper } from './translator';
import { resolveArtifactAssetImage } from './item-assets';

export type OwnedSetUsage = {
  characterId: string;
  characterName: string;
  characterRarity: string;
  href: string;
  isWip: boolean;
  pieces: number;
  slots: { key: string; label: string; stats: RankedStat[] }[];
  substats: RankedSubstat[];
};

const bonusKeys = ['1p', '2p', '4p'] as const;

type LabelRef = readonly [string, string];

const tagOptionGroups = [
  {
    label: ['ui', 'Stat'],
    options: [
      { id: 'atk', label: ['stat', 'atk%'], tags: ['atk', 'atk-set'] },
      { id: 'hp', label: ['stat', 'hp%'], tags: ['hp', 'hp-set'] },
      { id: 'def', label: ['stat', 'def%'], tags: ['def', 'def-set'] },
      { id: 'er', label: ['stat', 'er'], tags: ['er-set'] },
      { id: 'em', label: ['stat', 'em'], tags: ['em', 'em-set'] },
      { id: 'crit-rate', label: ['stat', 'cr'], tags: ['cr'] },
    ],
  },
  {
    label: ['ui', 'Damage Type'],
    options: [
      {
        id: 'physical',
        label: ['stat', 'physical-dmg'],
        tags: ['physical-set'],
      },
      {
        id: 'anemo',
        label: ['stat', 'anemo-dmg'],
        tags: ['anemo', 'anemo-set'],
      },
      {
        id: 'geo',
        label: ['stat', 'geo-dmg'],
        tags: ['geo', 'geo-set'],
      },
      {
        id: 'electro',
        label: ['stat', 'electro-dmg'],
        tags: ['electro', 'electro-set'],
      },
      {
        id: 'dendro',
        label: ['stat', 'dendro-dmg'],
        tags: ['dendro', 'dendro-set'],
      },
      {
        id: 'hydro',
        label: ['stat', 'hydro-dmg'],
        tags: ['hydro', 'hydro-set'],
      },
      {
        id: 'pyro',
        label: ['stat', 'pyro-dmg'],
        tags: ['pyro', 'pyro-set'],
      },
      {
        id: 'cryo',
        label: ['stat', 'cryo-dmg'],
        tags: ['cryo', 'cryo-set'],
      },
    ],
  },
  {
    label: ['ui', 'Talents'],
    options: [
      { id: 'normal-attack', label: ['ability', 'na'], tags: ['na'] },
      { id: 'charged-attack', label: ['ability', 'ca'], tags: ['ca'] },
      { id: 'plunging-attack', label: ['ability', 'plunge'], tags: ['plunge'] },
      { id: 'skill', label: ['ability', 'skill'], tags: ['skill'] },
      { id: 'burst', label: ['ability', 'burst'], tags: ['burst'] },
    ],
  },
  {
    label: ['ui', 'Utility'],
    options: [
      {
        id: 'healing',
        label: ['stat', 'healing-bonus'],
        tags: ['healing', 'healing-set'],
      },
      { id: 'shield', label: ['ability', 'shield'], tags: ['shield'] },
      {
        id: 'elemental-res',
        label: ['stat', 'elemental-res'],
        tags: ['elemental-res'],
      },
    ],
  },
  {
    label: ['ui', 'Special Mechanics'],
    options: [
      { id: 'lunar', label: ['element', 'lunar'], tags: ['lunar'] },
      {
        id: 'stellar',
        label: ['element', 'stellar-glimmer'],
        tags: ['stellar'],
      },
      {
        id: 'nightsoul',
        label: ['ability', 'nightsoul-blessing'],
        tags: ['nightsoul'],
      },
      { id: 'hexerei', label: ['ability', 'hexerei'], tags: ['hexerei'] },
    ],
  },
] as const satisfies readonly {
  label: LabelRef;
  options: readonly {
    id: string;
    label: LabelRef;
    tags: readonly string[];
  }[];
}[];

const tagGroups = tagOptionGroups.flatMap((group) => group.options);

/**
 * Localized bonus text as stored in `artifact_sets.json`.
 *
 * English is treated as the fallback language when a requested locale is
 * missing from a bonus entry.
 */
type LocalizedArtifactEffect = {
  en?: string;
  [lang: string]: string | undefined;
};

/**
 * Raw artifact set record loaded from the shared artifact data file.
 */
type ArtifactSetData = {
  rarity: number;
  version_released?: string;
  tags?: string[];
  '1p'?: LocalizedArtifactEffect;
  '2p'?: LocalizedArtifactEffect;
  '4p'?: LocalizedArtifactEffect;
};

function getArtifactSetTagGroups(tags: string[]) {
  const tagSet = new Set(tags);

  return tagGroups
    .filter((group) => group.tags.some((tag) => tagSet.has(tag)))
    .map((group) => group.id);
}

/**
 * Builds a reverse index of artifact sets mentioned as 4-piece options.
 *
 * Only builds marked `best: true` are scanned. Both ranked set rows and
 * conditional set groups are included because the artifact page labels this as
 * a 4-piece mention, not a ranking position.
 *
 * @param locale Locale dictionary bundle used for character display names.
 * @param lang Active language code used for character links.
 * @returns Artifact set IDs mapped to characters that mention them as 4-piece.
 */
function getArtifactSetFourPieceUsage(locale: any, lang: string) {
  return getBestBuildUsage(locale, lang, (buildPath, buildNotes) => {
    return [
      ...collectSetItems(loadJSON(buildPath, 'artifacts-sets.json'), 4),
      ...getWipNoteItems(
        buildNotes,
        'artifact',
        'set',
        normalizeSetId,
      ),
    ];
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds the hover card for one character chip: the main stats for the three
 * artifact slots that vary (Sands, Goblet, Circlet) and the substat priority,
 * taken from the build the chip links to.
 */
function renderUsagePopoverHtml(locale: any, lang: string, usage: BuildUsage) {
  const translator = new TranslationHelper(locale, {}, lang);
  const mainStats = loadJSON(usage.buildPath, 'artifacts-mainstats.json')?.main_stats;
  const substats = loadJSON(usage.buildPath, 'artifacts-substats.json')?.substats_priority;

  if (!mainStats && !substats) return '';

  const buildNotes = loadJSON(usage.buildPath, 'build-notes.json');
  const buildName = translator.translateNoteText(
    buildNotes?.name?.[lang] ?? buildNotes?.name?.en ?? toTitleCase(usage.buildName),
  );

  const slotRows = getBuildMainStatSlots(locale, translator, usage.buildPath)
    .filter((slot) => slot.value)
    .map((slot) => `<div class="usage-popover-row"><span class="usage-popover-slot">${escapeHtml(slot.label)}</span><span class="usage-popover-value">${escapeHtml(slot.value)}</span></div>`)
    .join('');

  const substatChips = (substats ?? [])
    .map((entry: any, index: number) => {
      const items = Array.isArray(entry?.items) ? entry.items : [entry];
      const names = items
        .map((item: any) => statName(locale, translator, item))
        .filter(Boolean);

      return names.length
        ? `<span class="usage-popover-sub"><strong>${index + 1}</strong>${escapeHtml(
            names.join(' \u2248 '),
          )}</span>`
        : '';
    })
    .join('');

  return [
    `<span class="usage-popover-header"><span class="usage-popover-name">${escapeHtml(
      usage.characterName,
    )}</span><span class="usage-popover-build">${escapeHtml(buildName)}</span></span>`,
    slotRows
      ? `<span class="usage-popover-section"><span class="usage-popover-title">${escapeHtml(
          t(locale, 'ui', 'Main Stats', undefined, false),
        )}</span>${slotRows}</span>`
      : '',
    substatChips
      ? `<span class="usage-popover-section"><span class="usage-popover-title">${escapeHtml(
          t(locale, 'ui', 'Substats', undefined, false),
        )}</span><span class="usage-popover-subs">${substatChips}</span></span>`
      : '',
  ].join('');
}

/**
 * Loads and localizes every artifact set for the browser grid.
 *
 * The returned entries keep both display data and filter data together so the
 * Astro component can render cards without reaching back into the raw JSON.
 *
 * @param locale Locale dictionary bundle used for set names.
 * @param lang Active language code used for bonus descriptions.
 * @returns Localized artifact set card entries.
 */
function getArtifactSetEntries(
  locale: any,
  lang: string,
  fourPieceUsageBySet: Map<string, BuildUsage[]>,
) {
  const filePath = path.resolve('src/data/artifacts/artifact_sets.json');
  const artifactData = readJSONFile(filePath) as Record<
    string,
    ArtifactSetData
  >;

  return Object.entries(artifactData).map(([id, info]) => {
    const bonuses = bonusKeys
      .map((key) => ({
        id: key,
        label: key.toUpperCase(),
        html: info[key]?.[lang] ?? info[key]?.en ?? '',
      }))
      .filter((bonus) => bonus.html);

    return {
      id,
      image: resolveArtifactAssetImage(id),
      name: t(locale, 'artifact', id, undefined, false),
      rarity: info.rarity,
      versionReleased: info.version_released ?? '',
      bonuses,
      tags: info.tags ?? [],
      tagGroups: getArtifactSetTagGroups(info.tags ?? []),
      fourPieceUsage: (fourPieceUsageBySet.get(id) ?? []).map((usage) => ({
        ...usage,
        popoverHtml: renderUsagePopoverHtml(locale, lang, usage),
      })),
    };
  });
}

/**
 * Builds the localized artifact set browser data used by the artifact sets page.
 *
 * @param lang Requested language code. Defaults to English.
 * @returns Locale, sorted artifact sets, and filter option data.
 */
export function getArtifactSetBrowserData(lang = 'en') {
  const locale = getLocale(lang);
  const fourPieceUsageBySet = getArtifactSetFourPieceUsage(locale, lang);
  const characters = getCharacterPlanData(lang);
  const characterDefaults = Object.fromEntries(characters.map(({ id, defaults }) => [id, defaults]));
  const ownedUsage = new Map<string, OwnedSetUsage[]>();
  for (const character of characters) {
    const slots = character.slots.map(({ key, label, stats }) => ({ key, label, stats }));
    for (const set of character.sets) {
      const usage = ownedUsage.get(set.setId) ?? [];
      usage.push({
        characterId: character.id, characterName: character.name, characterRarity: character.rarity,
        href: set.href, isWip: set.isWip, pieces: set.pieces, slots,
        substats: set.substats,
      });
      ownedUsage.set(set.setId, usage);
    }
  }

  const artifactSets = getArtifactSetEntries(
    locale,
    lang,
    fourPieceUsageBySet,
  ).map((set) => ({ ...set, ownedUsage: ownedUsage.get(set.id) ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rarities = [
    ...new Set(artifactSets.map((artifactSet) => artifactSet.rarity)),
  ].sort((a, b) => a - b);
  const visibleTagOptionGroups = tagOptionGroups
    .map((group) => ({
      label: t(locale, group.label[0], group.label[1], undefined, false),
      options: group.options
        .filter((option) =>
          artifactSets.some((artifactSet) =>
            artifactSet.tagGroups.includes(option.id),
          ),
        )
        .map((option) => ({
          id: option.id,
          label: t(locale, option.label[0], option.label[1], undefined, false),
        })),
    }))
    .filter((group) => group.options.length > 0);

  return {
    artifactSets,
    characterDefaults,
    ignoredSubstats: ['hp', 'atk', 'def', 'hp%', 'atk%', 'def%', 'em', 'er', 'cr', 'cd']
      .map((id) => ({ id, label: t(locale, 'stat', id, undefined, false) })),
    lang,
    locale,
    rarities,
    tagOptionGroups: visibleTagOptionGroups,
  };
}
