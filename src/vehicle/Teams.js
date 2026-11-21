/**
 * Team configuration. Each team defines its livery (colours + pattern) and its
 * chassis concept (nose, sidepods, wings), so cars differ in shape, not only in
 * colour. Add a team by appending an entry — everything else picks it up.
 *
 * Liveries are original renderings in each team's well-known colour scheme;
 * no logos or official artwork are used.
 *
 * pattern:  'solid'  primary body, secondary floor/lower edge only
 *           'split'  primary upper body, secondary lower body
 *           'stripe' primary body with an accent stripe along the flanks
 * chassis:  nose 'long' | 'short' | 'wide'; pods 'downwash' | 'ramp' | 'slim';
 *           frontWing 'curved' | 'flat'; rearWing 'spoon' | 'flat'; airbox 'tall' | 'low'
 */
export const TEAMS = [
  {
    id: 'ferrari', name: 'Scuderia Ferrari', short: 'FER', country: 'Italy', number: 16,
    primary: 0xc70a0a, secondary: 0x111214, accent: 0xffe14a, wing: 0x111214, helmet: 0xffd21f, numberColor: '#ffffff',
    pattern: 'solid', chassis: { nose: 'long', pods: 'downwash', frontWing: 'curved', rearWing: 'spoon', airbox: 'tall' },
  },
  {
    id: 'mercedes', name: 'Mercedes', short: 'MER', country: 'Germany', number: 63,
    primary: 0xc4c8cc, secondary: 0x141619, accent: 0x00d2be, wing: 0x141619, helmet: 0xf2f2f2, numberColor: '#00d2be',
    pattern: 'split', chassis: { nose: 'short', pods: 'slim', frontWing: 'curved', rearWing: 'flat', airbox: 'low' },
  },
  {
    id: 'mclaren', name: 'McLaren', short: 'MCL', country: 'United Kingdom', number: 4,
    primary: 0xff8000, secondary: 0x22252b, accent: 0x47c7fc, wing: 0xff8000, helmet: 0xffcc00, numberColor: '#1b1d22',
    pattern: 'split', chassis: { nose: 'long', pods: 'ramp', frontWing: 'curved', rearWing: 'spoon', airbox: 'tall' },
  },
  {
    id: 'redbull', name: 'Red Bull Racing', short: 'RBR', country: 'Austria', number: 1,
    primary: 0x1c2a5c, secondary: 0x0e1430, accent: 0xe0242c, wing: 0x1c2a5c, helmet: 0x1c2a5c, numberColor: '#ffc906', noseTip: 0xffc906,
    pattern: 'stripe', chassis: { nose: 'wide', pods: 'downwash', frontWing: 'flat', rearWing: 'spoon', airbox: 'tall' },
  },
  {
    id: 'aston', name: 'Aston Martin', short: 'AMR', country: 'United Kingdom', number: 14,
    primary: 0x00594f, secondary: 0x0b2e2a, accent: 0xcedc00, wing: 0x00594f, helmet: 0xcedc00, numberColor: '#cedc00',
    pattern: 'stripe', chassis: { nose: 'long', pods: 'ramp', frontWing: 'curved', rearWing: 'flat', airbox: 'low' },
  },
  {
    id: 'williams', name: 'Williams', short: 'WIL', country: 'United Kingdom', number: 23,
    primary: 0x00a0de, secondary: 0x041e42, accent: 0xffffff, wing: 0x041e42, helmet: 0x00a0de, numberColor: '#ffffff',
    pattern: 'split', chassis: { nose: 'short', pods: 'slim', frontWing: 'flat', rearWing: 'flat', airbox: 'low' },
  },
  {
    id: 'alpine', name: 'Alpine', short: 'ALP', country: 'France', number: 10,
    primary: 0x0a5ad4, secondary: 0xff87bc, accent: 0xffffff, wing: 0x0b1d3a, helmet: 0xff87bc, numberColor: '#ffffff',
    pattern: 'split', chassis: { nose: 'wide', pods: 'ramp', frontWing: 'curved', rearWing: 'spoon', airbox: 'tall' },
  },
  {
    id: 'haas', name: 'Haas', short: 'HAA', country: 'United States', number: 20,
    primary: 0xf2f2f2, secondary: 0x18191c, accent: 0xd7262e, wing: 0x18191c, helmet: 0xd7262e, numberColor: '#d7262e',
    pattern: 'split', chassis: { nose: 'long', pods: 'downwash', frontWing: 'flat', rearWing: 'flat', airbox: 'tall' },
  },
  {
    id: 'danubio', name: 'Danubio Racing', short: 'DAN', country: 'Hungary', number: 7,
    primary: 0xc4000f, secondary: 0x17181c, accent: 0xffffff, wing: 0x17181c, helmet: 0xffd21f, numberColor: '#ffffff',
    pattern: 'stripe', chassis: { nose: 'long', pods: 'downwash', frontWing: 'curved', rearWing: 'spoon', airbox: 'tall' },
  },
];

export const TEAM_BY_ID = Object.fromEntries(TEAMS.map((t) => [t.id, t]));

/** Fictional driver names for the AI rivals (paired with whichever teams the player did not pick). */
export const AI_DRIVERS = [
  { name: 'M. VARGA', short: 'VAR', skill: 0.975, aggression: 0.75, launch: 0.22 },
  { name: 'L. FONTAINE', short: 'FON', skill: 0.958, aggression: 0.55, launch: 0.3 },
  { name: 'K. BRANDT', short: 'BRA', skill: 0.944, aggression: 0.6, launch: 0.38 },
  { name: 'R. OKAFOR', short: 'OKA', skill: 0.93, aggression: 0.85, launch: 0.26 },
];

export function hex(c) {
  return '#' + c.toString(16).padStart(6, '0');
}
