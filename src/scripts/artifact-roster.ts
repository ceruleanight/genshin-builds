import type { OwnedSetUsage } from '../utils/artifact-browser';
import {
    isRosterEvent, parseJson, readPlans, readRoster,
    readSetting, rosterKeys, saveSetting,
} from './roster-store';

type StatRow = { label: string; ranks: Map<string, number> };
type Slot = { label: string; stats: Map<string, StatRow> };
const unranked = Number.POSITIVE_INFINITY;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function renderUsage(
    panel: HTMLElement,
    usage: OwnedSetUsage[],
    statsBySlot: Map<string, Slot>,
    labels: Record<string, string | undefined>,
    ignoredSubstats: { id: string; label: string }[],
) {
    const characters = new Map<string, { name: string; href: string; rarity: string; pieces: Set<number> }>();
    for (const entry of usage) {
        const person = characters.get(entry.characterId) ?? {
            name: entry.characterName, href: entry.href, rarity: entry.characterRarity, pieces: new Set<number>(),
        };
        person.pieces.add(entry.pieces);
        characters.set(entry.characterId, person);
    }

    const names = element('ul', undefined, 'artifact-owned-names');
    for (const person of [...characters.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        const item = element('li');
        const pieces = [...person.pieces].sort((a, b) => b - a)
            .map((count) => count === 4 ? labels.labelFour : labels.labelTwo);
        const link = element('a', person.name + ' · ' + pieces.join(' / '),
            'browser-usage-chip');
        link.href = person.href;
        link.dataset.rarity = person.rarity;
        item.append(link);
        names.append(item);
    }

    const slots = [...statsBySlot.values()].map(({ label, stats }) => {
        const section = element('div', undefined, 'artifact-owned-slot');
        const list = element('ul');
        const ordered = [...stats.values()].map(({ label, ranks }) => ({
            label, ranks, best: Math.min(...ranks.values()),
        })).sort((a, b) =>
            a.best - b.best || b.ranks.size - a.ranks.size || a.label.localeCompare(b.label),
        );

        for (const { label, ranks, best } of ordered) {
            const item = element('li', undefined, 'artifact-owned-stat');
            item.append(
                element('span', best === unranked ? '–' : String(best), 'artifact-owned-rank'),
                element('strong', label),
                element('span', [...ranks].map(([id]) => {
                    const name = characters.get(id)?.name ?? '';
                    return name;
                }).sort((a, b) => a.localeCompare(b)).join(', '), 'artifact-owned-who'),
            );
            list.append(item);
        }
        section.append(element('h4', label), list);
        return section;
    });

    const substatsById = new Map<string, { label: string; rank: number; characters: Set<string> }>();
    const neededIds = new Set<string>();
    for (const entry of usage) {
        for (const stat of entry.substats) {
            const row = substatsById.get(stat.id) ?? {
                label: stat.label,
                rank: stat.rank,
                characters: new Set<string>(),
            };
            row.rank = Math.min(row.rank, stat.rank);
            row.characters.add(entry.characterId);
            substatsById.set(stat.id, row);
            for (const id of stat.covers) neededIds.add(id);
        }
    }

    const substatSections: HTMLElement[] = [];
    if (substatsById.size > 0) {
        const needed = element('div', undefined, 'artifact-owned-substats');
        needed.append(element('h4', labels.labelSubstatsNeeded));
        const list = element('ul');
        for (const { label, rank, characters: characterIds } of [...substatsById.values()]
            .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))) {
            const item = element('li', undefined, 'artifact-owned-stat');
            item.append(
                element('span', String(rank), 'artifact-owned-rank'),
                element('strong', label),
                element('span', [...characterIds].map((id) => characters.get(id)?.name ?? '')
                    .filter(Boolean).sort((a, b) => a.localeCompare(b)).join(', '), 'artifact-owned-who'),
            );
            list.append(item);
        }
        needed.append(list);

        if (usage.every(({ substats }) => substats.length > 0)) {
            const ignored = element('div', undefined, 'artifact-owned-substats');
            ignored.append(element('h4', labels.labelSubstatsIgnored));
            const ignoredList = element('ul', undefined, 'artifact-owned-ignored');
            for (const stat of ignoredSubstats.filter(({ id }) => !neededIds.has(id))) {
                ignoredList.append(element('li', stat.label));
            }
            ignored.append(ignoredList);
            substatSections.push(needed, ignored);
        } else {
            substatSections.push(needed);
        }
    }

    panel.replaceChildren(names, ...slots, ...substatSections);
}

function initArtifactRoster(root: HTMLElement) {
    const form = document.querySelector<HTMLFormElement>('form[data-filter-kind="artifact"]');
    const filter = root.querySelector<HTMLSelectElement>('[data-artifact-roster-filter]');
    const count = root.querySelector<HTMLElement>('[data-roster-count]');
    const mode = root.querySelector<HTMLSelectElement>('[data-artifact-stat-mode]');
    const hideNames = root.querySelector<HTMLInputElement>('[data-artifact-hide-names]');
    const hideRanked = root.querySelector<HTMLInputElement>('[data-artifact-hide-ranked]');
    if (!form || !filter || !count || !mode || !hideNames || !hideRanked) return;

    const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-artifact-view]')];
    const defaults = readPlans(parseJson(root.dataset.defaults ?? null));
    const ignoredSubstats: { id: string; label: string }[] = JSON.parse(root.dataset.ignoredSubstats ?? '[]');
    const knownIds = new Set(Object.keys(defaults));
    const cards = [...document.querySelectorAll<HTMLElement>('[data-artifact-card]')].flatMap((card) => {
        const panel = card.querySelector<HTMLElement>('[data-artifact-owned]');
        const usage: OwnedSetUsage[] = JSON.parse(card.dataset.usageJson ?? '[]');
        return panel ? [{ card, panel, usage }] : [];
    });

    function render() {
        if (!form || !filter || !count || !mode || !hideNames || !hideRanked) return;
        const { owned, plans } = readRoster(knownIds);
        const view = readSetting(rosterKeys.filter);
        filter.value = view === 'needed' || view === 'unneeded' ? view : '';
        mode.value = readSetting(rosterKeys.statMode) === 'top' ? 'top' : 'all';
        hideNames.checked = readSetting(rosterKeys.hideNames) === 'true';
        hideRanked.checked = readSetting(rosterKeys.hideRanked) === 'true';
        document.body.toggleAttribute('data-hide-ranked', hideRanked.checked);
        root.closest('[data-artifact-browser]')?.toggleAttribute('data-hide-names', hideNames.checked);
        count.textContent = String(owned.size);

        let needed = 0;
        for (const { card, panel, usage } of cards) {
            const selected = usage.filter(({ characterId, pieces }) =>
                owned.has(characterId) &&
                (plans[characterId] ?? defaults[characterId]).sets.includes(card.dataset.id + ':' + pieces),
            );
            card.dataset.roster = selected.length > 0 ? 'needed' : 'unneeded';
            if (selected.length === 0) {
                const message = owned.size ? root.dataset.notNeeded : root.dataset.noCharacters;
                panel.replaceChildren(element('p', message, 'browser-usage-empty'));
                continue;
            }
            needed += 1;
            const statsBySlot = new Map<string, Slot>();
            for (const entry of selected) {
                const plan = plans[entry.characterId] ?? defaults[entry.characterId];
                for (const { key, label, stats } of entry.slots) {
                    const picked = stats.filter((stat) => plan.stats[key]?.includes(stat.id));
                    const chosen = mode.value === 'top' ? picked.slice(0, 1) : picked;
                    if (chosen.length === 0) continue;
                    const slot = statsBySlot.get(key) ?? { label, stats: new Map<string, StatRow>() };
                    for (const { id, label, rank } of chosen) {
                        const row = slot.stats.get(id) ?? { label, ranks: new Map<string, number>() };
                        row.ranks.set(entry.characterId, rank === 0 ? unranked : rank);
                        slot.stats.set(id, row);
                    }
                    statsBySlot.set(key, slot);
                }
            }
            renderUsage(panel, selected, statsBySlot, root.dataset, ignoredSubstats);
        }

        for (const button of buttons) {
            const value = button.dataset.artifactView;
            button.setAttribute('aria-pressed', String(filter.value === value));
            const total = value === 'needed' ? needed : value === 'unneeded' ? cards.length - needed : cards.length;
            const output = button.querySelector<HTMLElement>('[data-view-count]');
            if (output) output.textContent = String(total);
        }
        form.dispatchEvent(new Event('input', { bubbles: true }));
    }

    for (const button of buttons) {
        button.addEventListener('click', () => {
            saveSetting(rosterKeys.filter, button.dataset.artifactView ?? '');
            render();
        });
    }
    for (const [control, key] of [
        [mode, rosterKeys.statMode],
        [hideNames, rosterKeys.hideNames],
        [hideRanked, rosterKeys.hideRanked],
    ] as const) {
        control.addEventListener('change', () => {
            saveSetting(key, control instanceof HTMLInputElement ? String(control.checked) : control.value);
            render();
        });
    }
    window.addEventListener('storage', (event) => {
        if (isRosterEvent(event) || Object.values(rosterKeys).some((key) => key === event.key)) {
            render();
        }
    });
    render();
}

const root = document.querySelector<HTMLElement>('[data-artifact-roster]');
if (root) initArtifactRoster(root);
