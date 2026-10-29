/**
 * Freedom Fun USA's Terms of Lease, from the Odoo printable contract
 * (custom_rental/views/rental_printable_contract_template.xml), as the demo
 * workspace's rental agreement. The initial boxes become policy ticks.
 */
import type { Agreement } from '@rental/core';

const BODY = `## Terms of lease
In addition to the terms below and the operating guidelines on the rented items, the Lessee (customer) agrees to supervise operation of the rented items and agrees that if an item is damaged, the Lessee will reimburse Freedom Fun USA for the full price to fix the damage and/or the full replacement value of the rented item. If the customer has purchased the damage waiver and the damage is deemed to be accidental, Freedom Fun USA will cover the cost of the damage. This is at the sole discretion of Freedom Fun USA and the customer agrees to this policy. Before signing, the Lessee agrees that they have read the entire contract, agree to all terms and conditions herein, and have had all their questions answered to their full satisfaction and understanding.

## Delivery, operations and payment
The Lessee grants Freedom Fun USA and its employees and contractors the right to enter the event address given by the Lessee to deliver and return the rented equipment at appropriate times. All payments must be made at the time of delivery. No refunds are made after the equipment has been delivered. The customer agrees to the full payment and refund policy on the website.
The Lessee agrees to provide one electrical outlet within 50 feet, at 115 volts with 20 amperes capacity, for each event and/or blower. If a blower stops working, remove all users immediately and check the problem. Make sure the air tubes of inflatables are secured to the blower. The electrical cord should be plugged into an outlet and be the only thing operating on that circuit; check the circuit breakers too. Service calls due to electricity are charged an additional $50.00.

## General rules for safety
Inflatable units must be operated on a smooth, compatible surface such as grass or a hard-top surface. Units may NOT be operated on rough surfaces such as rocks, brick, glass or any jagged objects. Units MUST be properly anchored before use, per the instructions provided by Freedom Fun USA.
Never use the units in high or gusty winds, thunderstorms or lightning. A unit can turn over in high winds even when anchored, and this could seriously injure the users. Do NOT resume use until the adverse weather has ceased. Always follow the manufacturer's guidelines on the unit itself.
Always have an adult present who has reviewed and understands both this contract and the rules posted on the unit, to supervise the players. Never leave users unsupervised. Never allow more users than the maximum per age group stated in this lease and on the unit.

## Drop-off, overnight and pick-up rentals
The Lessee agrees the equipment will be cleaned and stored in a protected area, out of the elements. A $75 per hour cleaning charge applies to dirty equipment not returned in drop-off condition, and a $75 charge applies if the equipment is not ready for pickup and our personnel must pack it. Large jumps and slides should be clean and dry where possible; the pickup crew will roll and pack them. These charges are placed on the card on file.

## Additional terms of lease
Freedom Fun USA is not responsible for bad weather, disruption of electrical service or other unfavorable conditions, and no charges or fees are reimbursed as a result. ABSOLUTELY NO silly string or similar items (food, drinks, confetti, foam or trash) in or around the rentals at any time. Silly string and similar objects permanently damage vinyl inflatables; the Lessee is responsible for the full replacement value of the unit, or a $75.00 cleaning fee if the unit is found not to be permanently damaged.
The Lessee agrees not to operate the units contrary to this contract and the rules of use on each unit. The leased equipment is for the Lessee's own use and is not to be loaned, sub-let, mortgaged or otherwise disposed of. The Lessee is liable for any loss of the equipment by fire, theft or any other cause.

## Hold harmless
The Lessee agrees to indemnify and hold Freedom Fun USA harmless from any and all claims, actions, suits, proceedings, costs, expenses, fees, damages and liabilities, including reasonable attorney's fees and costs, arising from injury, damage or death to persons or property in connection with or resulting from the use of the leased equipment, including its manufacture, selection, delivery, possession, use, operation or return.
The Lessee releases and holds Freedom Fun USA harmless from injuries or damages incurred through use of the leased equipment. Freedom Fun USA cannot under any circumstances be held liable for injuries resulting from inappropriate use, acts of God, nature, or other conditions beyond its control or knowledge. The Lessee also indemnifies Freedom Fun USA against any loss, damage, theft or destruction of the equipment during the lease and any extensions.

## Disclaimer of warranties
Freedom Fun USA makes no warranty of any kind, express or implied, as to the condition or performance of any leased equipment. The Lessee agrees to stop using the equipment immediately and contact Freedom Fun USA if any of it shows a defect or improper working condition. The Lessee uses the equipment at their own risk.

## Breach, indemnity and arbitration
If the Lessee breaches any term of this lease, the Lessee pays all consequential damages and indemnifies Freedom Fun USA for all costs of enforcing the lease or defending any claim or lawsuit arising from operation of the equipment, including any judgment, attorney's fees and costs. If Freedom Fun USA determines, at its own discretion, that the Lessee has failed to comply with this lease, it may terminate this agreement, re-enter the property and retake the equipment, declare any outstanding balance immediately due, start legal proceedings to recover the equipment or money, and/or pursue any other remedy available by law. If a conflict arises, Freedom Fun USA and the Lessee will abide by Texas state law and forgo filing a lawsuit to resolve the dispute.

## Acknowledgement
BY SIGNING, I — THE LESSEE, CONTACT PERSON, LESSEE REPRESENTATIVE OR OTHER INDIVIDUAL ASSUMING THE ROLE OF LESSEE — ACKNOWLEDGE THAT I HAVE COMPLETELY READ AND UNDERSTAND THIS CONTRACT AND ANY ACCOMPANYING ADDENDUMS, HAVE BEEN INSTRUCTED BY FREEDOM FUN USA PERSONNEL ON THE EQUIPMENT, HAVE HAD ALL MY QUESTIONS ANSWERED TO MY SATISFACTION, AND AM FULLY RESPONSIBLE FOR FOLLOWING THE TERMS OF THIS RENTAL CONTRACT.`;

export const FREEDOM_FUN_AGREEMENT: Agreement = {
  version: '2026-10',
  title: 'Freedom Fun USA rental contract',
  body: BODY,
  rainCheckMonths: 12,
  policies: [
    { key: 'weather', title: 'Weather & payment', text: 'Weather cancellations become a rain check valid for {months} months. No refunds after the equipment is delivered.' },
    { key: 'setup', title: 'Setup & electricity', text: 'One 115 V / 20 A outlet within 50 ft for each blower, on its own circuit. Electrical service calls cost $50.' },
    { key: 'supervise', title: 'Adult supervision & safety', text: 'An adult who has read this contract and the unit rules supervises at all times. No use in high winds, rain or lightning.' },
    { key: 'dropoff', title: 'Drop-off & pickup charges', text: 'Equipment returned dirty is cleaned at $75/hour; $75 if it is not ready for pickup. Charged to the card on file.' },
    { key: 'no_mess', title: 'No silly string', text: 'No silly string, food, drinks, confetti or foam in or around the rentals. Damage is charged at full replacement value.' },
    { key: 'waiver', title: 'Damage waiver', text: 'Covers accidental damage, at our discretion. Without it, you pay the full repair or replacement value.' },
  ],
};
