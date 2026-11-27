import { compareCharacterCards } from './character-sort.mjs';
import { parseJson, readPlans, readRoster } from './roster-store';

type FilterKind = 'character' | 'weapon' | 'artifact';
const sortStorageKeys = {
    character: 'genshin-builds:character-sort',
    weapon: 'genshin-builds:weapon-sort',
    artifact: 'genshin-builds:artifact-sort',
} as const;
const highPriorityImageCount = 4;

const selectors = {
    character: {
        card: '[data-character-card]',
        count: '[data-character-count]',
        empty: '[data-character-empty]',
    },
    weapon: {
        card: '[data-weapon-card]',
        count: '[data-weapon-count]',
        empty: '[data-weapon-empty]',
    },
    artifact: {
        card: '[data-artifact-card]',
        count: '[data-artifact-count]',
        empty: '[data-artifact-empty]',
    },
} as const;

const form = document.querySelector<HTMLFormElement>('[data-filter-kind]');
const kind = form?.dataset.filterKind as FilterKind | undefined;

const cardValue = (card: HTMLElement, name: string) => card.dataset[name] ?? '';

type ArtifactCharacterUsage = {
    characterId: string;
    characterName: string;
    pieces: number;
};

function matchesArtifactCharacter(
    card: HTMLElement,
    query: string,
    roster: ReturnType<typeof readRoster> | null,
    defaults: ReturnType<typeof readPlans>,
) {
    if (!roster) return false;
    const usage = JSON.parse(card.dataset.usageJson ?? '[]') as ArtifactCharacterUsage[];
    return usage.some((entry) => {
        if (!entry.characterName.toLowerCase().includes(query)) return false;
        if (!roster.owned.has(entry.characterId)) return true;
        const plan = roster.plans[entry.characterId] ?? defaults[entry.characterId];
        return plan?.sets.includes(`${card.dataset.id}:${entry.pieces}`) ?? false;
    });
}

function compareCatalogCards(
    left: HTMLElement,
    right: HTMLElement,
    sort: string,
) {
    const byName = cardValue(left, 'name').localeCompare(cardValue(right, 'name'));

    if (sort === 'release') {
        return (
            Number.parseFloat(cardValue(right, 'versionReleased')) -
            Number.parseFloat(cardValue(left, 'versionReleased')) || byName
        );
    }

    return byName;
}

if (kind) {
    const selector = selectors[kind];
    const cards = Array.from(
        document.querySelectorAll<HTMLElement>(selector.card),
    );
    const count = document.querySelector<HTMLElement>(selector.count);
    const empty = document.querySelector<HTMLElement>(selector.empty);
    const grid = kind === 'artifact' ? cards[0]?.parentElement : null;
    const artifactSetFilter = kind === 'artifact'
        ? document.querySelector<HTMLElement>('[data-artifact-set-filter]')
        : null;
    const artifactSetOptions = Array.from(
        artifactSetFilter?.querySelectorAll<HTMLButtonElement>('[data-artifact-set-option]') ?? [],
    );
    const artifactSetOptionList = artifactSetFilter?.querySelector<HTMLElement>('.artifact-set-filter-options');
    const artifactSetSort = artifactSetFilter?.querySelector<HTMLSelectElement>('[data-artifact-set-sort]');
    const rosterRoot =
        kind === 'artifact'
            ? document.querySelector<HTMLElement>('[data-artifact-roster]')
            : null;
    const artifactDefaults = readPlans(parseJson(rosterRoot?.dataset.defaults ?? null));
    const artifactCharacterIds = new Set(Object.keys(artifactDefaults));
    const searchInput = form?.elements.namedItem('search');
    const sortSelect = form?.elements.namedItem('sort');
    const sortStorageKey = sortStorageKeys[kind];

    const layoutArtifactCards = () => {
        if (!grid) return;
        grid.classList.remove('is-packed');
        grid.style.gridAutoRows = 'auto';
        grid.style.gridAutoFlow = 'row';
        for (const card of cards) card.style.gridRowEnd = '';

        const visibleCards = cards.filter((card) => !card.hidden);
        const heights = visibleCards.map((card) => card.getBoundingClientRect().height);
        const rowGap = Number.parseFloat(getComputedStyle(grid).rowGap) || 0;

        grid.style.gridAutoRows = '1px';
        grid.style.gridAutoFlow = 'row dense';
        for (const [index, card] of visibleCards.entries()) {
            const span = Math.max(1, Math.ceil((heights[index] + rowGap) / (1 + rowGap)));
            card.style.gridRowEnd = `span ${span}`;
        }
        grid.classList.add('is-packed');
    };

    const sortArtifactSetOptions = () => {
        if (!artifactSetOptionList || !artifactSetSort) return;
        artifactSetOptionList.append(
            ...[...artifactSetOptions].sort((left, right) =>
                compareCatalogCards(left, right, artifactSetSort.value),
            ),
        );
    };

    if (searchInput instanceof HTMLInputElement) {
        const searchParam = new URLSearchParams(window.location.search).get('search');
        if (searchParam !== null) {
            const matchingCard = cards.find((card) => card.dataset.id === searchParam);
            searchInput.value = matchingCard?.dataset.name ?? searchParam;
        }
    }

    const getElementYPosition = (element: HTMLElement) => {
        let currentElement: HTMLElement | null = element;
        let elementYPosition = 0;

        while (currentElement) {
            elementYPosition += currentElement.offsetTop;
            currentElement = currentElement.offsetParent as HTMLElement | null;
        }

        return elementYPosition;
    };

    const updateVisibleImageLoading = () => {
        const orderedCards = cards[0]?.parentElement
            ? Array.from(
                cards[0].parentElement.querySelectorAll<HTMLElement>(selector.card),
            )
            : cards;
        let highPriorityCount = 0;

        orderedCards.forEach((card) => {
            const image = card.querySelector<HTMLImageElement>('img');
            if (!image) return;

            const isAboveFold =
                !card.hidden && getElementYPosition(image) <= window.innerHeight;

            image.setAttribute('loading', isAboveFold ? 'eager' : 'lazy');
            if (isAboveFold && highPriorityCount < highPriorityImageCount) {
                image.setAttribute('fetchpriority', 'high');
                highPriorityCount += 1;
            } else {
                image.removeAttribute('fetchpriority');
            }
        });
    };

    if (sortSelect instanceof HTMLSelectElement) {
        try {
            const savedSort = localStorage.getItem(sortStorageKey);
            if (
                savedSort &&
                [...sortSelect.options].some((option) => option.value === savedSort)
            ) {
                sortSelect.value = savedSort;
            }
        } catch {
            // Storage can be unavailable in private or restricted browser contexts.
        }

        sortSelect.addEventListener('change', () => {
            try {
                localStorage.setItem(sortStorageKey, sortSelect.value);
            } catch {
                // Sorting still works for the current visit without persistence.
            }
        });
    }

    const applyFilters = () => {
        if (!form) return;

        const values = Object.fromEntries(new FormData(form));
        const search = String(values.search ?? '')
            .trim()
            .toLowerCase();
        const characterSearch = String(values.character ?? '')
            .trim()
            .toLowerCase();
        const roster = characterSearch && kind === 'artifact'
            ? readRoster(artifactCharacterIds)
            : null;
        const selectedArtifactSets = artifactSetFilter
            ? new Set(
                artifactSetOptions
                    .filter((option) => option.getAttribute('aria-pressed') === 'true')
                    .map((option) => option.dataset.id ?? ''),
            )
            : null;
        let visibleCount = 0;

        if (sortSelect instanceof HTMLSelectElement) {
            const sort = String(values.sort ?? sortSelect.value);

            cards[0]?.parentElement?.append(
                ...[...cards].sort((left, right) =>
                    kind === 'character'
                        ? compareCharacterCards(left, right, sort)
                        : compareCatalogCards(left, right, sort),
                ),
            );
        }

        cards.forEach((card) => {
            const matches = Object.entries(values).every(([name, value]) => {
                const selected = String(value);
                if (
                    !selected ||
                    name === 'search' ||
                    name === 'character' ||
                    name === 'sort' ||
                    (characterSearch && name === 'roster')
                ) return true;

                const key = name === 'updated' ? 'recentUpdated' : name;
                const cardValue = card.dataset[key] ?? '';
                return name === 'tagGroups'
                    ? cardValue.split(' ').includes(selected)
                    : cardValue === selected;
            });
            const characterMatches =
                !characterSearch ||
                (kind === 'artifact' &&
                    matchesArtifactCharacter(
                        card,
                        characterSearch,
                        roster,
                        artifactDefaults,
                    ));
            const visible =
                matches &&
                (!search || card.dataset.name?.toLowerCase().includes(search)) &&
                characterMatches &&
                (!selectedArtifactSets || selectedArtifactSets.has(card.dataset.id ?? ''));

            card.hidden = !visible;
            if (visible) visibleCount += 1;
        });

        if (count) {
            count.textContent = `${visibleCount} ${count.dataset.resultsLabel ?? ''}`;
        }
        if (empty) empty.hidden = visibleCount > 0;
        layoutArtifactCards();
        updateVisibleImageLoading();
    };

    artifactSetFilter?.addEventListener('click', (event) => {
        const target = event.target instanceof Element
            ? event.target.closest<HTMLButtonElement>('[data-artifact-set-option]')
            : null;
        if (!target) return;
        target.setAttribute('aria-pressed', String(target.getAttribute('aria-pressed') !== 'true'));
        applyFilters();
    });
    artifactSetFilter
        ?.querySelector<HTMLButtonElement>('[data-artifact-set-select-all]')
        ?.addEventListener('click', () => {
            for (const option of artifactSetOptions) option.setAttribute('aria-pressed', 'true');
            applyFilters();
        });
    artifactSetFilter
        ?.querySelector<HTMLButtonElement>('[data-artifact-set-clear]')
        ?.addEventListener('click', () => {
            for (const option of artifactSetOptions) option.setAttribute('aria-pressed', 'false');
            applyFilters();
        });
    artifactSetSort?.addEventListener('change', sortArtifactSetOptions);

    form?.addEventListener('change', applyFilters);
    form?.addEventListener('input', applyFilters);
    form?.addEventListener('submit', (event) => event.preventDefault());
    if (sortSelect instanceof HTMLSelectElement) {
        sortSelect.addEventListener('change', applyFilters);
    }
    window.addEventListener('resize', () => {
        layoutArtifactCards();
        updateVisibleImageLoading();
    });
    sortArtifactSetOptions();
    applyFilters();
}

document
    .querySelector<HTMLElement>('[data-weapon-browser]')
    ?.addEventListener('click', (event) => {
        const button =
            event.target instanceof Element
                ? event.target.closest<HTMLButtonElement>('[data-weapon-refinement]')
                : null;
        const refinement = button?.dataset.weaponRefinement;
        const card = button?.closest<HTMLElement>('[data-weapon-card]');
        if (!button || !refinement || !card) return;

        card
            .querySelectorAll<HTMLElement>('[data-weapon-refinement]')
            .forEach((item) =>
                item.setAttribute(
                    'aria-pressed',
                    String(item.dataset.weaponRefinement === refinement),
                ),
            );
        const panel = card.querySelector<HTMLElement>(
            '[data-weapon-refinement-panel]',
        );
        if (!panel) return;

        panel.dataset.weaponRefinementPanel = refinement;
        const valuesByPlaceholder = JSON.parse(
            panel.dataset.refinementValues ?? '[]',
        );
        const refinementIndex = Number(refinement.slice(1)) - 1;
        panel
            .querySelectorAll<HTMLElement>('[data-refinement-value-index]')
            .forEach((value) => {
                const values =
                    valuesByPlaceholder[
                        Number(value.dataset.refinementValueIndex)
                    ];
                const selectedValue = values?.[refinementIndex];
                value.textContent = Array.isArray(selectedValue)
                    ? selectedValue.join('/')
                    : String(selectedValue ?? '');
            });
    });
