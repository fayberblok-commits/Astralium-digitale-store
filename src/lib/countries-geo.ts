/**
 * Country centroids for the Manager's Office world map (Phase 4
 * upgrade). A compact [latitude, longitude] table for the ISO 3166-1
 * alpha-2 codes a digital store realistically sees, plus display names
 * for the office country list. The map itself is a dependency-free SVG
 * dot plot (equirectangular projection) rendered by the overview
 * panel — no map tiles, no third-party services, consistent with the
 * store's first-party-only analytics rule.
 *
 * Projection helpers are pure and unit-tested.
 */

export interface CountryGeo { name: string; lat: number; lon: number }

export const COUNTRY_GEO: Record<string, CountryGeo> = {
  MA: { name: "Morocco", lat: 31.8, lon: -6.0 },
  DZ: { name: "Algeria", lat: 28.0, lon: 2.6 },
  TN: { name: "Tunisia", lat: 33.9, lon: 9.6 },
  LY: { name: "Libya", lat: 26.3, lon: 17.2 },
  EG: { name: "Egypt", lat: 26.8, lon: 30.8 },
  SA: { name: "Saudi Arabia", lat: 24.6, lon: 46.7 },
  AE: { name: "United Arab Emirates", lat: 24.2, lon: 53.8 },
  QA: { name: "Qatar", lat: 25.3, lon: 51.2 },
  KW: { name: "Kuwait", lat: 29.3, lon: 47.5 },
  OM: { name: "Oman", lat: 21.5, lon: 57.8 },
  JO: { name: "Jordan", lat: 31.2, lon: 36.6 },
  LB: { name: "Lebanon", lat: 33.9, lon: 35.9 },
  IQ: { name: "Iraq", lat: 33.2, lon: 43.7 },
  YE: { name: "Yemen", lat: 15.6, lon: 47.6 },
  PS: { name: "Palestine", lat: 31.9, lon: 35.2 },
  SD: { name: "Sudan", lat: 12.9, lon: 30.2 },
  FR: { name: "France", lat: 46.6, lon: 2.4 },
  ES: { name: "Spain", lat: 40.2, lon: -3.6 },
  PT: { name: "Portugal", lat: 39.6, lon: -8.0 },
  IT: { name: "Italy", lat: 42.8, lon: 12.8 },
  DE: { name: "Germany", lat: 51.1, lon: 10.4 },
  GB: { name: "United Kingdom", lat: 54.0, lon: -2.5 },
  IE: { name: "Ireland", lat: 53.2, lon: -8.2 },
  NL: { name: "Netherlands", lat: 52.2, lon: 5.3 },
  BE: { name: "Belgium", lat: 50.6, lon: 4.6 },
  CH: { name: "Switzerland", lat: 46.8, lon: 8.2 },
  AT: { name: "Austria", lat: 47.6, lon: 13.8 },
  PL: { name: "Poland", lat: 51.9, lon: 19.4 },
  CZ: { name: "Czechia", lat: 49.8, lon: 15.5 },
  SK: { name: "Slovakia", lat: 48.7, lon: 19.7 },
  HU: { name: "Hungary", lat: 47.2, lon: 19.5 },
  RO: { name: "Romania", lat: 45.9, lon: 25.0 },
  BG: { name: "Bulgaria", lat: 42.8, lon: 25.5 },
  GR: { name: "Greece", lat: 39.1, lon: 21.8 },
  HR: { name: "Croatia", lat: 45.3, lon: 16.4 },
  SE: { name: "Sweden", lat: 62.0, lon: 15.0 },
  NO: { name: "Norway", lat: 60.5, lon: 8.5 },
  DK: { name: "Denmark", lat: 56.0, lon: 10.0 },
  FI: { name: "Finland", lat: 61.9, lon: 25.7 },
  EE: { name: "Estonia", lat: 58.7, lon: 25.0 },
  LV: { name: "Latvia", lat: 56.9, lon: 24.6 },
  LT: { name: "Lithuania", lat: 56.0, lon: 23.9 },
  UA: { name: "Ukraine", lat: 48.4, lon: 31.2 },
  TR: { name: "Türkiye", lat: 38.9, lon: 35.2 },
  RU: { name: "Russia", lat: 60.0, lon: 90.0 },
  US: { name: "United States", lat: 39.8, lon: -98.6 },
  CA: { name: "Canada", lat: 56.1, lon: -106.3 },
  MX: { name: "Mexico", lat: 23.9, lon: -102.6 },
  GT: { name: "Guatemala", lat: 15.5, lon: -90.3 },
  CO: { name: "Colombia", lat: 4.6, lon: -74.1 },
  PE: { name: "Peru", lat: -9.2, lon: -75.0 },
  CL: { name: "Chile", lat: -31.8, lon: -70.5 },
  AR: { name: "Argentina", lat: -38.4, lon: -63.6 },
  BR: { name: "Brazil", lat: -14.2, lon: -51.9 },
  VE: { name: "Venezuela", lat: 6.4, lon: -66.6 },
  NG: { name: "Nigeria", lat: 9.1, lon: 8.7 },
  GH: { name: "Ghana", lat: 7.9, lon: -1.2 },
  CI: { name: "Côte d'Ivoire", lat: 7.6, lon: -5.6 },
  SN: { name: "Senegal", lat: 14.4, lon: -17.1 },
  CM: { name: "Cameroon", lat: 5.7, lon: 12.7 },
  KE: { name: "Kenya", lat: 0.5, lon: 37.9 },
  ET: { name: "Ethiopia", lat: 9.1, lon: 40.5 },
  ZA: { name: "South Africa", lat: -28.9, lon: 24.7 },
  AO: { name: "Angola", lat: -12.3, lon: 17.9 },
  MZ: { name: "Mozambique", lat: -17.3, lon: 35.5 },
  IN: { name: "India", lat: 20.6, lon: 78.9 },
  PK: { name: "Pakistan", lat: 30.4, lon: 69.3 },
  BD: { name: "Bangladesh", lat: 23.7, lon: 90.4 },
  LK: { name: "Sri Lanka", lat: 7.9, lon: 80.8 },
  NP: { name: "Nepal", lat: 28.4, lon: 84.1 },
  ID: { name: "Indonesia", lat: -2.2, lon: 118.0 },
  MY: { name: "Malaysia", lat: 4.2, lon: 101.9 },
  SG: { name: "Singapore", lat: 1.4, lon: 103.8 },
  TH: { name: "Thailand", lat: 15.9, lon: 101.0 },
  VN: { name: "Vietnam", lat: 14.1, lon: 108.3 },
  PH: { name: "Philippines", lat: 12.9, lon: 121.8 },
  CN: { name: "China", lat: 35.0, lon: 105.0 },
  HK: { name: "Hong Kong", lat: 22.4, lon: 114.1 },
  TW: { name: "Taiwan", lat: 23.7, lon: 121.0 },
  JP: { name: "Japan", lat: 36.2, lon: 138.3 },
  KR: { name: "South Korea", lat: 37.0, lon: 127.9 },
  AU: { name: "Australia", lat: -25.3, lon: 133.8 },
  NZ: { name: "New Zealand", lat: -41.8, lon: 172.8 },
  IR: { name: "Iran", lat: 32.4, lon: 53.7 },
  IL: { name: "Israel", lat: 31.0, lon: 34.9 },
  KZ: { name: "Kazakhstan", lat: 48.2, lon: 66.9 },
  UZ: { name: "Uzbekistan", lat: 41.4, lon: 64.6 },
  AZ: { name: "Azerbaijan", lat: 40.1, lon: 47.7 },
  GE: { name: "Georgia", lat: 42.3, lon: 43.7 },
};

/** Equirectangular projection into an SVG viewport of width×height. */
export function projectToSvg(lat: number, lon: number, width: number, height: number): { x: number; y: number } {
  const x = ((lon + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

export function countryName(code: string): string {
  return COUNTRY_GEO[code]?.name ?? code;
}
