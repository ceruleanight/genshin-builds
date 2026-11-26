import translationAliases from '../data/translation-aliases.json';
import artifactData from '../data/artifacts/artifact_sets.json';

type SetItem = { name: string; pieces: number };
type Group = { items?: SetItem[]; choices?: { items?: SetItem[] }[] };
type Entry = Group & { groups?: Group[] };
type Recommendations = { artifact_sets?: Entry[]; conditional?: Entry[] };
type Effect = Record<string, string | undefined>;
type ArtifactSet = { rarity: number; tags?: string[]; '2p'?: Effect; '4p'?: Effect };

const aliases: Record<string, string> = translationAliases.set;
const sets: Record<string, ArtifactSet> = artifactData;
const twoPieceSets = Object.entries(sets)
  .filter(([, set]) => set['2p'])
  .sort(([, a], [, b]) => b.rarity - a.rarity);

export function normalizeSetId(id: string) {
  return Object.hasOwn(aliases, id) ? aliases[id] : id;
}

export function hasSetBonus(id: string, pieces: 2 | 4) {
  return Object.hasOwn(sets, id) && Boolean(sets[id][pieces === 2 ? '2p' : '4p']);
}

function getGroupItems(group: Group) {
  return [...(group.items ?? []), ...(group.choices ?? []).flatMap((choice) => choice.items ?? [])];
}

export function collectSetItems(data: Recommendations | null, pieces: 2 | 4) {
  const ranked = (data?.artifact_sets ?? []).flatMap((entry, index) =>
    (entry.groups ?? []).flatMap(getGroupItems).map((item) => ({ item, rank: index + 1 })),
  );
  const conditional = (data?.conditional ?? []).flatMap((entry) =>
    (entry.groups ?? [entry]).flatMap(getGroupItems).map((item) => ({ item, rank: undefined })),
  );

  return [...ranked, ...conditional].flatMap(({ item, rank }) => {
    if (Number(item.pieces) !== pieces || !item.name) return [];
    const id = normalizeSetId(item.name);
    if (Object.hasOwn(sets, id)) return hasSetBonus(id, pieces) ? [{ id, rank }] : [];
    if (pieces !== 2) return [];

    // Build guides use set-effect tags for interchangeable two-piece bonuses.
    return twoPieceSets.flatMap(([setId, set]) =>
      set.tags?.includes(id) ? [{ id: setId, rank }] : [],
    );
  });
}
