/**
 * Canonical CSV fixture for the dealer-inventory feed adapter (#20).
 *
 * Option ids are real catalog ids from `lib/data/options/*` — never display labels. Kept as a
 * string constant so unit tests and `scripts/generate-static-api.ts` share one source of truth
 * without reading the filesystem at runtime in the browser.
 */
export const DEALER_INVENTORY_CSV_FIXTURE = `unit_id,vehicle_id,option_ids,dealer_id,dealer_name,distance_miles,availability
inv-4r-near,4runner,paint-218-blueprint;wheels-weisu-machined;trim-grille-blackout,dealer-austin,Austin Toyota,12,in_stock
inv-4r-build,4runner,paint-070-midnight-black;wheels-weisu-bronze;accessory-roof-rack,dealer-dallas,Dallas Toyota,85,buildable
inv-tac-near,tacoma,paint-040-super-white;wheels-trail-machined;accessory-roof-rack,dealer-austin,Austin Toyota,18,in_stock
inv-cam-build,camry,paint-040-super-white;wheels-sport-machined,dealer-houston,Houston Toyota,210,buildable
inv-ae86-far,ae86,paint-040-super-white,dealer-denver,Denver Toyota,920,in_stock
`;
