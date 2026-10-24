/**
 * Roles and permissions (Phase 0 · 06 Team & roles). The server checks
 * permissions, never role names, so a person can be granted an extra
 * permission without changing their role.
 */

export const ROLES = ['owner', 'admin', 'manager', 'sales', 'coach', 'crew', 'accountant', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, { label: string; description: string }> = {
  owner: { label: 'Owner', description: 'Everything, including billing and deleting the organization.' },
  admin: { label: 'Admin', description: 'Everything except billing and deleting the organization.' },
  manager: { label: 'Manager', description: 'Orders, calendar, customers, coaches and reports for their locations.' },
  sales: { label: 'Sales', description: 'Leads, orders, quotes and customers. Earns commission.' },
  coach: { label: 'Coach', description: 'Runs assigned events on the phone: checklist, en route, arrival, event start.' },
  crew: { label: 'Crew', description: 'Sees the jobs they are on and helps load, set up and pack.' },
  accountant: { label: 'Accountant', description: 'Invoices, payments, refunds and reports. Read-only orders.' },
  viewer: { label: 'Viewer', description: 'Read-only access.' },
};

/** Chip colours (design system: role chips). */
export const ROLE_TONE: Record<Role, 'owner' | 'info' | 'violet' | 'success' | 'pink' | 'warning' | 'teal' | 'neutral'> = {
  owner: 'owner',
  admin: 'info',
  manager: 'violet',
  sales: 'success',
  coach: 'pink',
  crew: 'warning',
  accountant: 'teal',
  viewer: 'neutral',
};

export const PERMISSIONS = {
  'orders.create': 'Create and book orders',
  'orders.override_price': 'Override line prices',
  'orders.override_tax': 'Override the tax rate on an order',
  'payments.refund': 'Refund and issue credits',
  'reports.view': 'View financial reports',
  'settings.manage': 'Manage locations and email',
  'members.manage': 'Invite and remove people',
  'billing.manage': 'Plan and billing',
  'org.delete': 'Delete the organization',
  'coach.portal': 'Coach portal (assigned orders only)',
} as const;
export type Permission = keyof typeof PERMISSIONS;

const MATRIX: Record<Permission, readonly Role[]> = {
  'orders.create': ['owner', 'admin', 'manager', 'sales'],
  'orders.override_price': ['owner', 'admin', 'manager'],
  'orders.override_tax': ['owner', 'admin', 'manager'],
  'payments.refund': ['owner', 'admin', 'manager', 'accountant'],
  'reports.view': ['owner', 'admin', 'manager', 'accountant'],
  'settings.manage': ['owner', 'admin'],
  'members.manage': ['owner', 'admin'],
  'billing.manage': ['owner'],
  'org.delete': ['owner'],
  'coach.portal': ['coach', 'crew'],
};

/** Rows of the read-only permission matrix shown on the Team screen. */
export const PERMISSION_MATRIX: { key: Permission; label: string; roles: readonly Role[] }[] = (
  ['orders.create', 'orders.override_price', 'payments.refund', 'reports.view', 'settings.manage', 'members.manage'] as const
).map((key) => ({ key, label: PERMISSIONS[key], roles: MATRIX[key] }));

/** Permissions that may be granted to one person on top of their role. */
export const GRANTABLE: readonly Permission[] = ['orders.create', 'orders.override_price', 'orders.override_tax', 'payments.refund', 'reports.view'];

export function can(role: Role, permission: Permission, extra: readonly string[] = []): boolean {
  return MATRIX[permission].includes(role) || (GRANTABLE.includes(permission) && extra.includes(permission));
}

/** Roles that work in the staff app (coach and crew use the coach portal). */
export const STAFF_ROLES: readonly Role[] = ['owner', 'admin', 'manager', 'sales', 'accountant', 'viewer'];
export const FIELD_ROLES: readonly Role[] = ['coach', 'crew'];
/** Roles that can be invited (the owner is set at creation or by transfer). */
export const INVITABLE_ROLES: readonly Role[] = ['admin', 'manager', 'sales', 'coach', 'crew', 'accountant', 'viewer'];
/** Roles offered in onboarding step 5 (coaches are invited later from Team). */
export const ONBOARDING_INVITE_ROLES: readonly Role[] = ['manager', 'sales', 'crew', 'accountant', 'viewer'];
export const SETTINGS_ROLES: readonly Role[] = MATRIX['settings.manage'];
/** Roles whose access can be limited to some locations. */
export const LOCATION_SCOPED_ROLES: readonly Role[] = ['manager', 'sales', 'coach', 'crew'];
