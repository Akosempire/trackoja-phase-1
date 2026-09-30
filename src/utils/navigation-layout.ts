/** Takes already permission-filtered destinations; never introduces a route. */
export function mobileDestinations<T extends { to: string }>(preferred: T[], permitted: T[]): T[] {
  const overview = permitted.find(item => item.to === '/dashboard');
  const more = permitted.find(item => item.to === '/more');
  const choices = [...preferred, ...permitted].filter((item, index, items) =>
    item.to !== '/dashboard' && item.to !== '/more' &&
    permitted.some(candidate => candidate.to === item.to) &&
    items.findIndex(candidate => candidate.to === item.to) === index).slice(0, 2);
  return [...(overview ? [overview] : []), ...choices, ...(more ? [more] : [])];
}

/** Route-owned widths remain stable when a module loads a table or an error. */
export function platformUsesWideLayout(pathname: string): boolean {
  return ['/platform/businesses', '/platform/billing', '/platform/audit', '/platform/activation']
    .some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
