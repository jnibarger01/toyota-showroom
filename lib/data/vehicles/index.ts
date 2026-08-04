import type { Vehicle } from "../../types/vehicle";
import { fourRunner } from "./4runner";
import { tacoma } from "./tacoma";
import { camry } from "./camry";

/** Single source of truth for the vehicle catalog. Add new models here only. */
export const VEHICLES: readonly Vehicle[] = [fourRunner, tacoma, camry];

export function getVehicleBySlug(slug: string): Vehicle | undefined {
  return VEHICLES.find((vehicle) => vehicle.slug === slug);
}

export function getAllVehicleSlugs(): string[] {
  return VEHICLES.map((vehicle) => vehicle.slug);
}
