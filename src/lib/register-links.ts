/** Register links, built in-app (never stored). `name` is the full domain, e.g. "qzx.com". */
export function registerLinks(name: string) {
  const d = encodeURIComponent(name.toLowerCase());
  return [
    { key: "cloudflare", label: "Cloudflare", href: `https://domains.cloudflare.com/?domain=${d}` },
    { key: "namecheap", label: "Namecheap", href: `https://www.namecheap.com/domains/registration/results/?domain=${d}` },
    { key: "godaddy", label: "GoDaddy", href: `https://www.godaddy.com/domainsearch/find?domainToCheck=${d}` },
  ] as const;
}
