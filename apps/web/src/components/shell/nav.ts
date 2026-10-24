import type { Permission, Role } from '@rental/core';

/** Icon paths from the design's Sidebar.dc.html (24×24, stroke 1.8). */
export const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  ops: 'M12 3 2 20h20zM12 10v4M12 17v.01',
  calendar: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4',
  orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  pos: 'M3 5h18v10H3zM7 19h10M12 15v4',
  customers: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.9M15 3.1a3.5 3.5 0 0 1 0 6.8',
  products: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  inventory: 'M3 7h18v4H3zM5 11v9h14v-9M10 15h4',
  invoices: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  leads: 'M3 4h18l-7 8v6l-4 2v-8z',
  crew: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  locations: 'M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 9h1M15 9h1M8 13h1M15 13h1',
  team: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4',
  messaging: 'M4 5h16v12H8l-4 4z',
  workspace: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.8.7-1.4 1.5-1.4H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8zM7.5 12.5h.01M9.5 8.5h.01M14.5 8.5h.01',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  overview: 'M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z',
  orgs: 'M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 9h1M15 9h1M8 13h1M15 13h1',
  audit: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
  users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
  plans: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
} as const;
export type IconKey = keyof typeof ICONS;

export type NavItem = {
  id: string;
  label: string;
  icon: IconKey;
  /** Relative to /<slug>. Omitted = arrives in a later phase (shown with its phase tag, not clickable). */
  href?: string;
  phase?: number;
  /** Shown only to people with this permission. */
  permission?: Permission;
  /** Hidden for these roles. */
  hideFor?: readonly Role[];
  /** Matches these extra path prefixes as active. */
  match?: string[];
};

export type NavGroup = { label: string; items: NavItem[] };

export const ORG_NAV: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { id: 'home', label: 'Home', icon: 'home', href: '' },
      { id: 'ops', label: 'Action needed', icon: 'ops', phase: 3 },
      { id: 'calendar', label: 'Calendar', icon: 'calendar', href: '/calendar' },
      { id: 'orders', label: 'Orders', icon: 'orders', href: '/orders', match: ['/orders/'] },
      { id: 'pos', label: 'New order', icon: 'pos', href: '/orders/new', permission: 'orders.create' },
      { id: 'customers', label: 'Customers', icon: 'customers', href: '/customers' },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { id: 'products', label: 'Products', icon: 'products', href: '/catalog' },
      { id: 'inventory', label: 'Inventory', icon: 'inventory', phase: 1 },
    ],
  },
  {
    label: 'Money',
    items: [
      { id: 'invoices', label: 'Invoices & payments', icon: 'invoices', phase: 2 },
      { id: 'reports', label: 'Reports', icon: 'reports', phase: 3 },
    ],
  },
  {
    label: 'Growth',
    items: [
      { id: 'leads', label: 'Leads', icon: 'leads', phase: 4 },
      { id: 'crew', label: 'Coaches & crew', icon: 'crew', phase: 4 },
    ],
  },
  {
    label: 'Settings',
    items: [
      { id: 'workspace', label: 'Workspace & brand', icon: 'workspace', href: '/settings/workspace', permission: 'settings.manage' },
      { id: 'locations', label: 'Locations', icon: 'locations', href: '/settings/locations', permission: 'settings.manage' },
      { id: 'team', label: 'Team & roles', icon: 'team', href: '/settings/team', permission: 'members.manage' },
      { id: 'messaging', label: 'Email & SMS', icon: 'messaging', phase: 2 },
      { id: 'activity', label: 'Activity log', icon: 'activity', href: '/settings/activity', permission: 'settings.manage' },
    ],
  },
];

export const CONSOLE_NAV: NavGroup[] = [
  {
    label: 'Platform',
    items: [
      { id: 'orgs', label: 'Organizations', icon: 'orgs', href: '' },
      { id: 'audit', label: 'Audit log', icon: 'audit', href: '/audit' },
      { id: 'plans', label: 'Plans & pricing', icon: 'plans', phase: 6 },
      { id: 'users', label: 'Users', icon: 'users', phase: 6 },
    ],
  },
];
