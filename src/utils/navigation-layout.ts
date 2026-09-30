/** Takes already permission-filtered destinations; never introduces a route. */
export function mobileDestinations<T extends { to: string }>(preferred: T[], permitted: T[]): T[] {
  const unique = (items: T[]) => items.filter((item, index) =>
    item.to !== '/more' && items.findIndex((candidate) => candidate.to === item.to) === index);
  const choices = unique(preferred);
  const payments = permitted.find((item) => item.to === '/payments');
  const first = choices.filter((item) => item.to !== '/payments').slice(0, payments ? 3 : 4);
  const selected = payments ? [...first, payments] : first;
  return unique([...selected, ...permitted]).slice(0, 4);
}

/** Route-owned widths remain stable when a module loads a table or an error. */
export function platformUsesWideLayout(pathname: string): boolean {
  return ['/platform/businesses', '/platform/billing', '/platform/audit', '/platform/activation']
    .some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
