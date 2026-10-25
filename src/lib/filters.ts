import { t } from "@/lib/copy/fa";
export type PremiumFilter = "any" | "premium" | "standard";
export type SortMode = "original" | "votes";

export type RoundFilters = {
  minVotes: number | null;
  maxVotes: number | null;
  premium: PremiumFilter;
  minPrice: number | null;
  maxPrice: number | null;
  sort: SortMode;
};

export type FilterableDomain = {
  votes: number;
  isPremium: boolean;
  price: number | null;
  position: number;
};

export function emptyFilters(): RoundFilters {
  return {
    minVotes: null,
    maxVotes: null,
    premium: "any",
    minPrice: null,
    maxPrice: null,
    sort: "original",
  };
}

function optionalNumber(value: unknown): number | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function normalizeFilters(input: Partial<Record<keyof RoundFilters, unknown>>): {
  filters: RoundFilters;
  error?: string;
} {
  const minVotes = optionalNumber(input.minVotes);
  const maxVotes = optionalNumber(input.maxVotes);
  const minPrice = optionalNumber(input.minPrice);
  const maxPrice = optionalNumber(input.maxPrice);
  const filters: RoundFilters = {
    minVotes,
    maxVotes,
    premium: input.premium === "premium" || input.premium === "standard" ? input.premium : "any",
    minPrice,
    maxPrice,
    sort: input.sort === "votes" ? "votes" : "original",
  };

  if ((minVotes != null && minVotes < 0) || (maxVotes != null && maxVotes < 0)) {
    return { filters, error: t.filters.negative };
  }
  if (minVotes != null && maxVotes != null && minVotes > maxVotes) {
    return { filters, error: t.filters.voteRange };
  }
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    return { filters, error: t.pool.err.priceRange };
  }
  if (input.minVotes != null && String(input.minVotes).trim() && minVotes == null) {
    return { filters, error: t.filters.minVotesNum };
  }
  if (input.maxVotes != null && String(input.maxVotes).trim() && maxVotes == null) {
    return { filters, error: t.filters.maxVotesNum };
  }
  if (input.minPrice != null && String(input.minPrice).trim() && minPrice == null) {
    return { filters, error: t.filters.minPriceNum };
  }
  if (input.maxPrice != null && String(input.maxPrice).trim() && maxPrice == null) {
    return { filters, error: t.filters.maxPriceNum };
  }

  return { filters };
}

export function matchesFilters(domain: FilterableDomain, filters: RoundFilters) {
  if (filters.minVotes != null && domain.votes < filters.minVotes) return false;
  if (filters.maxVotes != null && domain.votes > filters.maxVotes) return false;
  if (filters.premium === "premium" && !domain.isPremium) return false;
  if (filters.premium === "standard" && domain.isPremium) return false;
  if (filters.minPrice != null && (domain.price == null || domain.price < filters.minPrice)) return false;
  if (filters.maxPrice != null && (domain.price == null || domain.price > filters.maxPrice)) return false;
  return true;
}

export function applyFilters<T extends FilterableDomain>(domains: T[], filters: RoundFilters) {
  const matched = domains.filter((domain) => matchesFilters(domain, filters));
  if (filters.sort === "votes") {
    matched.sort((a, b) => b.votes - a.votes || a.position - b.position);
  } else {
    matched.sort((a, b) => a.position - b.position);
  }
  return matched;
}

export function describeFilters(filters: RoundFilters, parentTitle: string) {
  const parts = [t.common.derivedFrom(parentTitle)];
  if (filters.minVotes != null) parts.push(t.filters.atLeastVotes(filters.minVotes));
  if (filters.maxVotes != null) parts.push(t.filters.atMostVotes(filters.maxVotes));
  if (filters.premium === "premium") parts.push(t.derive.onlyPremium);
  if (filters.premium === "standard") parts.push(t.derive.onlyStandard);
  if (filters.minPrice != null) parts.push(t.filters.priceFrom(filters.minPrice));
  if (filters.maxPrice != null) parts.push(t.filters.priceTo(filters.maxPrice));
  parts.push(filters.sort === "votes" ? t.derive.orderVotes : t.filters.sortOriginal);
  return parts.join(" · ");
}
