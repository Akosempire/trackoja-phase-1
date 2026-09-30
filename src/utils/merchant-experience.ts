export function routeModule(route: string): string | undefined {
  if (route.startsWith('/inventory') || route.startsWith('/pharmacy')) return 'inventory';
  if (route.startsWith('/sales') || route === '/payments' || route === '/kitchen') return 'sales';
  if (route.startsWith('/customers')) return 'customers';
  if (route.startsWith('/jobs')) return 'tailoring';
}

export function navigationGroup(route: string): string {
  if (['/payments', '/devices'].includes(route)) return 'Payments and connections';
  if (['/reports', '/staff'].includes(route)) return 'Management';
  if (['/settings', '/billing', '/support', '/more'].includes(route)) return 'Account';
  return 'Business operations';
}

export function merchantPrimaryAction(category: string, modules: string[], can: (permission: string) => boolean, pathname: string) {
  if ((category === 'tailor' || category === 'other') && modules.includes('tailoring') && can('job:create'))
    return { label: 'New job', route: '/jobs?new=1', scan: false };
  if (category === 'restaurant' && modules.includes('sales') && can('sales:create'))
    return { label: 'New order', route: '/sales/checkout', scan: false };
  if (modules.includes('inventory') && can('inventory:view') && (pathname.startsWith('/inventory') || !can('sales:create') || !modules.includes('sales')))
    return { label: 'Scan', route: '/inventory/products?scan=1', scan: true };
  if (modules.includes('sales') && can('sales:create'))
    return { label: modules.includes('inventory') ? 'Scan' : 'New sale', route: modules.includes('inventory') ? '/sales/checkout?scan=1' : '/sales/checkout', scan: modules.includes('inventory') };
  return { label: 'New sale', route: null, scan: false };
}
