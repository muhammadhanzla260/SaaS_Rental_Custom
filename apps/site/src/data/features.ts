/** Event-rental feature list (E3). Edit here; the page, search and counts follow. */
export type FeatureCat = 'Booking' | 'Payments' | 'Messaging' | 'Operations' | 'Growth' | 'Admin';
export type Feature = { cat: FeatureCat; title: string; text: string; soon?: boolean };

export const CAT_COLORS: Record<FeatureCat, [string, string]> = {
  Booking: ['#E6ECFF', '#233FB8'], Payments: ['#E3F5EC', '#0B6145'], Messaging: ['#FFF1DC', '#8A4A00'],
  Operations: ['#FCE8F1', '#9B2160'], Growth: ['#E0F2F7', '#0A5566'], Admin: ['#F1EAFE', '#5B2DB0'],
};

const f = (cat: FeatureCat, title: string, text: string, soon = false): Feature => ({ cat, title, text, soon });

export const FEATURES: Feature[] = [
  f('Booking', 'Live availability by unit', 'Every unit checked against the calendar, cleaning buffers included.'),
  f('Booking', 'Pricing engine', 'Staffed, drop-off and pick-up prices with overtime by the minute.'),
  f('Booking', 'Travel fees by distance', 'Driving miles from the nearest warehouse, with a free zone.'),
  f('Booking', 'Editable after booking', 'Change anything; every save re-checks stock and keeps a version.'),
  f('Booking', 'Booking calendar', 'Week and day views per location, quotes shown as holds-nothing.'),
  f('Booking', 'Coupons & discounts', 'Percent or fixed, plus custom and non-taxable lines.'),
  f('Payments', 'E-signature', 'Versioned rental agreement, typed signature, IP and timestamp.'),
  f('Payments', 'Online deposits', 'Card deposits through your own Stripe account.'),
  f('Payments', 'Auto-charged balances', 'Saved card charged on event day, receipt sent.'),
  f('Payments', 'Manual payments', 'Cash, checks and purchase orders with a follow-up date.'),
  f('Payments', 'Rain checks & credits', 'Turn payments into credit and apply it to new orders.'),
  f('Payments', 'Refunds', 'Full or partial refunds to card, logged on the order.'),
  f('Messaging', 'Your own SMTP', 'Gmail, Microsoft 365, Zoho or any mail server, per location.'),
  f('Messaging', 'SMS reminders', 'Texts from your number with quiet hours.'),
  f('Messaging', 'Scheduled automations', 'Days before or after, event start or end, at a time you choose.'),
  f('Messaging', 'HTML template upload', 'Send your own HTML or XML exactly as designed.'),
  f('Messaging', 'Message log', 'Every email and text exactly as the customer saw it.'),
  f('Operations', 'Ops board', 'Deposits needed, late payments, calls due and cold quotes in one place.'),
  f('Operations', 'Crew portal', 'Phone portal with a 5-phase checklist and photo proof.'),
  f('Operations', 'Live GPS & ETA', 'Tracking only while en route, with automatic heads-up texts.'),
  f('Operations', 'Damage & maintenance', 'Damage reports hold items from bookings until fixed.'),
  f('Operations', 'Inventory & units', 'Serials, statuses and the next booking for every unit.'),
  f('Growth', 'Lead pipeline', 'Reply-time targets and automatic follow-ups on day 1, 3 and 7.'),
  f('Growth', '32 reports', 'Sales, money, customers, products and employees.'),
  f('Growth', 'Commissions', 'Commission rates per salesperson, reported automatically.'),
  f('Growth', 'Review requests', 'Sent the day after each event, linking to your reviews.'),
  f('Growth', 'Website booking widget', 'Let customers check dates and request quotes on your site.', true),
  f('Admin', 'Multiple locations', 'Each with its own timezone, tax, numbering and mail.'),
  f('Admin', 'Roles & permissions', 'Owner, admin, manager, sales, coach, crew, accountant, viewer.'),
  f('Admin', 'Brand & logo editor', 'Colour, logo variants, corners and custom domain.'),
  f('Admin', 'Audit log', 'Who changed what, and when, on every record.'),
  f('Admin', 'Passkeys & two-step', 'Modern sign-in for every team member.'),
  f('Admin', 'CSV import & export', 'Bring products and customers in; take your data out.'),
  f('Admin', 'API & webhooks', 'Connect your own tools.', true),
];

type UiRow = [title: string, sub: string, value: string, valueColor: string];
export type Module = { id: string; tag: string; bg: string; fg: string; glow: string; h: string; p: string; pts: string[]; ui: UiRow[] };

export const MODULES: Module[] = [
  { id: 'book', tag: 'Quotes & bookings', bg: '#E6ECFF', fg: '#2C4FE0', glow: '#2C4FE0', h: 'Quote in a minute. Never double-book again.', p: 'Live availability by unit, a pricing engine that knows rental, and an order where every field stays editable after booking.', pts: ['Availability by unit and minute', 'Overtime, travel, surface fees', 'Edit anything after booking', 'Version history on every change', 'Coupons, discounts, custom lines', 'Booking calendar by location'], ui: [['Castle Bounce House', 'Staffed · 5 h', '$325.00', '#fff'], ['Travel · 8.4 mi past free zone', 'Staffed rate $2.50 / mi', '$21.00', '#fff'], ['Third castle at 2 PM', 'All units are out', 'Refused', '#FF8A8E'], ['Order total', 'Tax 8.25% included', '$618.11', '#D4FF3A']] },
  { id: 'pay', tag: 'Payments', bg: '#E3F5EC', fg: '#0B7A55', glow: '#0B7A55', h: 'Signed, paid and booked without a phone call.', p: 'One link to review, accept policies, e-sign and pay the deposit. Balances charge on event day and receipts send themselves.', pts: ['E-signature with audit trail', 'Deposit 30 / 50 / full / custom', 'Card saved for the balance', 'Record cash, checks and POs', 'Refunds, credits and rain checks', 'Invoices with payment schedule'], ui: [['Deposit · card •4242', 'Oct 23 · receipt PAY-AUS-00412', '$185.43', '#3DD39A'], ['Agreement signed', 'Maria Gonzalez · typed signature', '✓', '#3DD39A'], ['Balance auto-charge', 'Sat, Nov 7 · 8:00 AM', '$432.68', '#D4FF3A'], ['Rain check RC-0012', 'Credit · valid 12 months', '$185.43', '#C9B4FF']] },
  { id: 'auto', tag: 'Automations', bg: '#FFF1DC', fg: '#A85A00', glow: '#F5B04C', h: 'Set up once. Every message sends itself.', p: 'Connect your own mail server and SMS number, then pick the timings. Every message is logged and can never go out twice.', pts: ['Your own SMTP and sending number', 'Instant and scheduled messages', 'Upload your own HTML templates', 'Quiet hours for texts', 'Office alerts for declined cards', 'Message log kept 2 years'], ui: [['Quote sent', 'Sign & pay link', 'Instantly', '#D4FF3A'], ['Pre-event reminder', 'Email', '3 days before', '#D4FF3A'], ['Contact check', 'Text to the on-site contact', '2 days before', '#D4FF3A'], ['Review request', 'Email', 'Day after', '#D4FF3A']] },
  { id: 'crew', tag: 'Crew portal & GPS', bg: '#FCE8F1', fg: '#9B2160', glow: '#B0306A', h: 'Crews know the plan. You see them live.', p: 'A phone portal with a 5-phase checklist, photo proof and EVENT START, and an admin map that shows every crew in real time.', pts: ['5-phase checklist per job', 'Photo proof on load, setup, close-out', 'Start En Route with live GPS', 'Automatic 5-minute heads-up text', 'Damage report → maintenance flag', 'Coach ratings from checklist scores'], ui: [['Alex Kim · en route', 'Q-AUS-01043 · Cedar Park', 'ETA 6 min', '#D4FF3A'], ['Chris Doyle · event running', 'Started 11:04 · 4 min late', '80%', '#fff'], ['Eli Brooks · close-out', 'Damage reported · 2 photos', 'Flag ON', '#FF8A8E'], ['Load checklist', 'Photo of loaded equipment', '100%', '#3DD39A']] },
  { id: 'reports', tag: 'Reports', bg: '#E0F2F7', fg: '#0A5566', glow: '#0E7490', h: 'Know where the money is, without a spreadsheet.', p: '32 ready-made reports grouped the way rental owners think: sales, money, gateway, customers, products and employees.', pts: ['Month to date & sales by city', 'Receivables by age', 'Credits and rain checks', 'Gateway reconciliation', 'Sales by item and category', 'Commission by salesperson'], ui: [['Revenue · October', '86 orders', '$30,710', '#D4FF3A'], ['Collected', '72% of revenue', '$22,100', '#3DD39A'], ['Outstanding', '19 orders', '$8,610', '#F5B04C'], ['Commission · Sam O.', '5% of paid orders', '$412.30', '#fff']] },
  { id: 'brand', tag: 'Brand & settings', bg: '#F1EAFE', fg: '#5B2DB0', glow: '#6D3FD6', h: 'It looks like your business, everywhere.', p: 'Your logo, colours and domain on every quote, email, invoice and the crew portal, with locations, roles and rules set your way.', pts: ['Logo editor with 3 variants', 'Brand colour with contrast check', 'Custom domain for customer links', 'Multiple locations & warehouses', '8 roles and fine permissions', 'Rental rules: deposits, buffers, fees'], ui: [['Brand colour', 'Berry · contrast 6.4:1 passes', '#B0306A', '#FF8FC7'], ['Custom domain', 'quotes.lakesideparty.com', 'Verified', '#3DD39A'], ['Locations', 'Austin · Dallas · Houston · Phoenix', '4', '#fff'], ['Team', 'Owner, managers, sales, coaches', '8 roles', '#fff']] },
];

/** Rent Hatch 2.0: the agent that will run each feature, and what it does. */
export const FEATURE_AGENTS: Record<string, [agent: string, does: string]> = {"Live availability by unit": ["Quote", "Checks every unit before it offers a date"], "Pricing engine": ["Quote", "Prices each order the second a lead asks"], "Travel fees by distance": ["Quote", "Measures the drive and adds the fee"], "Editable after booking": ["Quote", "Applies customer changes and re-prices"], "Booking calendar": ["Dispatch", "Keeps the calendar full and clash-free"], "Coupons & discounts": ["Quote", "Offers discounts only inside your limits"], "E-signature": ["Collections", "Chases unsigned agreements"], "Online deposits": ["Collections", "Collects the deposit before the date is lost"], "Auto-charged balances": ["Collections", "Charges on event day, retries failed cards"], "Manual payments": ["Collections", "Matches cash and checks to the right invoice"], "Rain checks & credits": ["Weather", "Offers rain checks before the storm hits"], "Refunds": ["Collections", "Drafts refunds for your approval"], "Your own SMTP": ["Setup", "Connects and tests your mail server"], "SMS reminders": ["Messaging", "Texts customers at the right time"], "Scheduled automations": ["Messaging", "Decides what to send and when"], "HTML template upload": ["Messaging", "Writes templates in your tone"], "Message log": ["Messaging", "Answers simple replies and logs every one"], "Ops board": ["Dispatch", "Clears the board before you open it"], "Crew portal": ["Dispatch", "Briefs every crew on their jobs"], "Live GPS & ETA": ["Dispatch", "Re-plans routes and texts new ETAs"], "Damage & maintenance": ["Inventory", "Reads damage photos and books repairs"], "Inventory & units": ["Inventory", "Blocks broken units, flags low stock"], "Lead pipeline": ["Front Desk", "Replies to leads in seconds, 24/7"], "32 reports": ["Analyst", "Answers money questions in plain words"], "Commissions": ["Analyst", "Works out commissions every month"], "Review requests": ["Messaging", "Asks happy customers for a review"], "Website booking widget": ["Front Desk", "Takes bookings from your website"], "Multiple locations": ["Setup", "Sets up a new location for you"], "Roles & permissions": ["Setup", "Invites your team with the right roles"], "Brand & logo editor": ["Setup", "Builds your brand from your logo"], "Audit log": ["Analyst", "Logs every agent action with its reason"], "Passkeys & two-step": ["Setup", "Turns on two-step for your whole team"], "CSV import & export": ["Setup", "Imports your old data and checks the maths"], "API & webhooks": ["Setup", "Connects the tools you already use"]};

/** Rent Hatch 2.0: the agent behind each module on the features page. */
export const MODULE_AGENTS: Record<string, [agent: string, does: string]> = {"book": ["Quote", "Builds the quote, checks units and prices it the moment a lead asks."], "pay": ["Collections", "Chases signatures, deposits and balances, and retries cards within your rules."], "auto": ["Messaging", "Writes and sends every message in your tone, and answers simple replies."], "crew": ["Dispatch", "Plans routes, assigns crews and re-plans the day when someone runs late."], "reports": ["Analyst", "Answers your questions in plain words and sends a Monday brief."], "brand": ["Setup", "Imports your products, prices and customers and sets everything up."]};
