import { collectSetItems, hasSetBonus, normalizeSetId } from './artifact-set-items';
import { getAllBuildMainStatSlots, getBuildSubstats } from './build-stats';
import { getWipNoteItems } from './build-usage';
import { getPublicCharacterName, getPublicCharacterSlug } from './character-slugs';
import { loadJSON, normalizeVersion, readJSONFile, toTitleCase } from './content';
import { getCharacterBuilds, getContentCharacters } from './content-tree';
import { getLocale, t } from './i18n';
import { resolveArtifactAssetUrl } from './item-assets';
import { localizedPath } from './paths';
import { TranslationHelper } from './translator';
import type { Plan } from '../scripts/roster-store';

const setSections = [
  { pieces: 4, label: 'Plan four piece' },
  { pieces: 2, label: 'Plan two piece' },
] as const;

export function getCharacterPlanData(lang: string) {
  const locale = getLocale(lang);
  const translator = new TranslationHelper(locale, {}, lang);
  return getContentCharacters().flatMap((character) => {
    const builds = getCharacterBuilds(character.characterPath)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((build) => ({ ...build, notes: loadJSON(build.path, 'build-notes.json') }))
      .filter((build) => build.notes?.best === true)
      .map((build) => ({ ...build, recommendations: loadJSON(build.path, 'artifacts-sets.json') }));
    if (!builds.length) return [];

    const id = getPublicCharacterSlug(character);
    const name = getPublicCharacterName(locale, character);
    const metadata = readJSONFile(character.metadataPath);
    const weapon = typeof metadata.weapon === 'string' ? metadata.weapon : '';
    const href = (build: string) => localizedPath(lang, id) + '?build=' + encodeURIComponent(build);
    const buildLabels = builds.map(({ notes, name }) => translator.translateNoteText(
      notes.name?.[lang] ?? notes.name?.en ?? toTitleCase(name),
    ));
    const substatsByBuild = new Map<string, ReturnType<typeof getBuildSubstats>>();
    for (const build of builds) {
      substatsByBuild.set(build.name, getBuildSubstats(locale, translator, build.path));
    }

    const sections = setSections.map(({ pieces, label }) => {
      const ranked = builds.flatMap((build) =>
        collectSetItems(build.recommendations, pieces)
          .map((item) => ({
            ...item,
            href: href(build.name),
            isWip: false,
            substats: substatsByBuild.get(build.name) ?? [],
          })),
      ).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
      const wip = pieces === 4 ? builds.flatMap((build) =>
        getWipNoteItems(build.notes, 'artifact', 'set', normalizeSetId).flatMap((item) =>
          item.id && hasSetBonus(item.id, pieces)
            ? [{
                id: item.id,
                rank: undefined,
                href: href(build.name),
                isWip: true,
                substats: substatsByBuild.get(build.name) ?? [],
              }]
            : [],
        ),
      ) : [];
      const unique = new Map<string, (typeof ranked)[number]>();
      for (const set of [...ranked, ...wip]) {
        if (!unique.has(set.id)) unique.set(set.id, set);
      }
      const sets = [...unique.values()].map((set) => ({
        key: set.id + ':' + pieces,
        setId: set.id,
        pieces,
        name: t(locale, 'artifact', set.id, undefined, false),
        image: resolveArtifactAssetUrl(set.id),
        href: set.href,
        rank: set.rank,
        isWip: set.isWip,
        substats: set.substats,
      }));
      return { pieces, label: t(locale, 'ui', label), sets };
    });
    const slots = getAllBuildMainStatSlots(locale, translator, builds.map((build) => build.path));
    const defaults: Plan = {
      sets: sections.filter(({ pieces }) => pieces === 4).flatMap(({ sets }) => {
        const first = sets.find((set) => !set.isWip);
        return first ? [first.key] : [];
      }),
      stats: Object.fromEntries(slots.map(({ key, stats }) => [
        key,
        stats[0]?.rank > 0 ? [stats[0].id] : [],
      ])),
    };

    return [{
      id,
      name,
      rarity: character.rarity,
      element: character.element,
      elementLabel: t(locale, 'element', character.element),
      href: href(builds[0].name),
      buildLabel: [...new Set(buildLabels)].join(' / '),
      weapon,
      weaponLabel: weapon ? t(locale, 'ui', weapon) : '',
      releaseDate: typeof metadata.release_date === 'string' ? metadata.release_date : '',
      versionReleased: normalizeVersion(metadata.version_released),
      sets: sections.flatMap((section) => section.sets),
      sections,
      slots,
      defaults,
    }];
  }).sort((a, b) =>
    a.elementLabel.localeCompare(b.elementLabel) ||
    Number(b.rarity) - Number(a.rarity) ||
    a.name.localeCompare(b.name),
  );
}
