// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import { AU, LIGHT_YEAR, SPEED_OF_LIGHT } from '@/universe/constants';

export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return '—';
  const a = Math.abs(metres);
  if (a < 1000) return `${metres.toFixed(a < 10 ? 1 : 0)} m`;
  if (a < 1e6) return `${(metres / 1000).toFixed(a < 1e4 ? 2 : 1)} km`;
  if (a < 1e9) return `${Math.round(metres / 1000).toLocaleString('en-US')} km`;
  if (a < LIGHT_YEAR * 0.01) return `${(metres / AU).toFixed(a < AU * 10 ? 3 : 1)} AU`;
  return `${(metres / LIGHT_YEAR).toFixed(2)} ly`;
}

export function formatSpeed(mps: number): string {
  const a = Math.abs(mps);
  if (a < 1000) return `${mps.toFixed(a < 10 ? 1 : 0)} m/s`;
  if (a < SPEED_OF_LIGHT * 0.01) return `${(mps / 1000).toFixed(a < 1e5 ? 1 : 0)} km/s`;
  return `${(mps / SPEED_OF_LIGHT).toFixed(a < SPEED_OF_LIGHT * 10 ? 2 : 0)} c`;
}

export function formatTemperature(kelvin: number): string {
  return `${Math.round(kelvin)} K (${Math.round(kelvin - 273.15)} °C)`;
}
