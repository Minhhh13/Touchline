/**
 * Master table of English top-flight clubs covered by the datasets, with the
 * aliases each source uses for them. Colours are approximate kit colours.
 */
export const CLUBS = [
  c('arsenal', 'Arsenal', 'Arsenal', 'ARS', 'London', 'The Gunners', 1886, '#EF0107', '#FFFFFF', 'possession', ['tottenham-hotspur', 'chelsea', 'manchester-united'], ['Arsenal FC']),
  c('aston-villa', 'Aston Villa', 'Aston Villa', 'AVL', 'Birmingham', 'The Villans', 1874, '#670E36', '#95BFE5', 'balanced', ['birmingham-city', 'wolverhampton-wanderers', 'west-bromwich-albion'], ['Aston Villa FC']),
  c('birmingham-city', 'Birmingham City', 'Birmingham', 'BIR', 'Birmingham', 'The Blues', 1875, '#0000FF', '#FFFFFF', 'defensive', ['aston-villa'], ['Birmingham City FC']),
  c('blackburn-rovers', 'Blackburn Rovers', 'Blackburn', 'BLB', 'Blackburn', 'Rovers', 1875, '#009EE0', '#FFFFFF', 'direct', ['burnley', 'bolton-wanderers'], ['Blackburn Rovers FC', 'Blackburn']),
  c('blackpool', 'Blackpool', 'Blackpool', 'BLP', 'Blackpool', 'The Seasiders', 1887, '#F68712', '#FFFFFF', 'direct', [], ['Blackpool FC']),
  c('bolton-wanderers', 'Bolton Wanderers', 'Bolton', 'BOL', 'Bolton', 'The Trotters', 1874, '#FFFFFF', '#000080', 'direct', ['blackburn-rovers', 'wigan-athletic'], ['Bolton Wanderers FC', 'Bolton']),
  c('bournemouth', 'AFC Bournemouth', 'Bournemouth', 'BOU', 'Bournemouth', 'The Cherries', 1899, '#DA291C', '#000000', 'press', ['southampton'], ['Bournemouth', 'A.F.C. Bournemouth', 'AFC Bournemouth']),
  c('brentford', 'Brentford', 'Brentford', 'BRE', 'London', 'The Bees', 1889, '#E30613', '#FBB800', 'direct', ['fulham', 'queens-park-rangers'], ['Brentford FC']),
  c('brighton', 'Brighton & Hove Albion', 'Brighton', 'BHA', 'Brighton', 'The Seagulls', 1901, '#0057B8', '#FFFFFF', 'possession', ['crystal-palace'], ['Brighton & Hove Albion FC', 'Brighton and Hove Albion', 'Brighton']),
  c('burnley', 'Burnley', 'Burnley', 'BUR', 'Burnley', 'The Clarets', 1882, '#6C1D45', '#99D6EA', 'defensive', ['blackburn-rovers'], ['Burnley FC']),
  c('cardiff-city', 'Cardiff City', 'Cardiff', 'CAR', 'Cardiff', 'The Bluebirds', 1899, '#0070B5', '#FFFFFF', 'defensive', ['swansea-city'], ['Cardiff City FC']),
  c('chelsea', 'Chelsea', 'Chelsea', 'CHE', 'London', 'The Blues', 1905, '#034694', '#FFFFFF', 'counter', ['tottenham-hotspur', 'arsenal', 'fulham'], ['Chelsea FC']),
  c('coventry-city', 'Coventry City', 'Coventry', 'COV', 'Coventry', 'The Sky Blues', 1883, '#78D0F3', '#FFFFFF', 'balanced', ['leicester-city'], ['Coventry City FC']),
  c('crystal-palace', 'Crystal Palace', 'Crystal Palace', 'CRY', 'London', 'The Eagles', 1905, '#1B458F', '#C4122E', 'counter', ['brighton'], ['Crystal Palace FC']),
  c('everton', 'Everton', 'Everton', 'EVE', 'Liverpool', 'The Toffees', 1878, '#003399', '#FFFFFF', 'balanced', ['liverpool'], ['Everton FC']),
  c('fulham', 'Fulham', 'Fulham', 'FUL', 'London', 'The Cottagers', 1879, '#FFFFFF', '#000000', 'possession', ['chelsea', 'brentford', 'queens-park-rangers'], ['Fulham FC']),
  c('huddersfield-town', 'Huddersfield Town', 'Huddersfield', 'HUD', 'Huddersfield', 'The Terriers', 1908, '#0E63AD', '#FFFFFF', 'press', ['leeds-united'], ['Huddersfield Town AFC', 'Huddersfield']),
  c('hull-city', 'Hull City', 'Hull', 'HUL', 'Hull', 'The Tigers', 1904, '#F5A12D', '#000000', 'defensive', [], ['Hull City AFC', 'Hull City FC', 'Hull']),
  c('ipswich-town', 'Ipswich Town', 'Ipswich', 'IPS', 'Ipswich', 'The Tractor Boys', 1878, '#3A64A3', '#FFFFFF', 'possession', ['norwich-city'], ['Ipswich Town FC', 'Ipswich']),
  c('leeds-united', 'Leeds United', 'Leeds', 'LEE', 'Leeds', 'The Whites', 1919, '#FFFFFF', '#1D428A', 'press', ['manchester-united', 'huddersfield-town'], ['Leeds United FC', 'Leeds United AFC', 'Leeds']),
  c('leicester-city', 'Leicester City', 'Leicester', 'LEI', 'Leicester', 'The Foxes', 1884, '#003090', '#FDBE11', 'counter', ['nottingham-forest', 'coventry-city'], ['Leicester City FC', 'Leicester']),
  c('liverpool', 'Liverpool', 'Liverpool', 'LIV', 'Liverpool', 'The Reds', 1892, '#C8102E', '#F6EB61', 'press', ['everton', 'manchester-united'], ['Liverpool FC']),
  c('luton-town', 'Luton Town', 'Luton', 'LUT', 'Luton', 'The Hatters', 1885, '#F78F1E', '#002D62', 'direct', ['watford'], ['Luton Town FC', 'Luton']),
  c('manchester-city', 'Manchester City', 'Man City', 'MCI', 'Manchester', 'The Citizens', 1880, '#6CABDD', '#1C2C5B', 'possession', ['manchester-united', 'liverpool'], ['Manchester City FC', 'Man City']),
  c('manchester-united', 'Manchester United', 'Man United', 'MUN', 'Manchester', 'The Red Devils', 1878, '#DA291C', '#FBE122', 'counter', ['liverpool', 'manchester-city', 'leeds-united', 'arsenal'], ['Manchester United FC', 'Man Utd', 'Man United']),
  c('middlesbrough', 'Middlesbrough', 'Middlesbrough', 'MID', 'Middlesbrough', 'Boro', 1876, '#E21A23', '#FFFFFF', 'balanced', ['sunderland', 'newcastle-united'], ['Middlesbrough FC']),
  c('newcastle-united', 'Newcastle United', 'Newcastle', 'NEW', 'Newcastle', 'The Magpies', 1892, '#241F20', '#FFFFFF', 'direct', ['sunderland', 'middlesbrough'], ['Newcastle United FC', 'Newcastle Utd', 'Newcastle']),
  c('norwich-city', 'Norwich City', 'Norwich', 'NOR', 'Norwich', 'The Canaries', 1902, '#FFF200', '#00A650', 'possession', ['ipswich-town'], ['Norwich City FC', 'Norwich']),
  c('nottingham-forest', 'Nottingham Forest', "Nott'm Forest", 'NFO', 'Nottingham', 'The Tricky Trees', 1865, '#DD0000', '#FFFFFF', 'counter', ['leicester-city'], ['Nottingham Forest FC', "Nott'm Forest", 'Nottm Forest']),
  c('portsmouth', 'Portsmouth', 'Portsmouth', 'POR', 'Portsmouth', 'Pompey', 1898, '#001489', '#FFFFFF', 'direct', ['southampton'], ['Portsmouth FC']),
  c('queens-park-rangers', 'Queens Park Rangers', 'QPR', 'QPR', 'London', 'The Hoops', 1882, '#1D5BA4', '#FFFFFF', 'balanced', ['fulham', 'brentford'], ['Queens Park Rangers FC', 'QPR']),
  c('reading', 'Reading', 'Reading', 'REA', 'Reading', 'The Royals', 1871, '#004494', '#FFFFFF', 'defensive', [], ['Reading FC']),
  c('sheffield-united', 'Sheffield United', 'Sheffield Utd', 'SHU', 'Sheffield', 'The Blades', 1889, '#EE2737', '#FFFFFF', 'defensive', ['leeds-united'], ['Sheffield United FC', 'Sheffield Utd']),
  c('southampton', 'Southampton', 'Southampton', 'SOU', 'Southampton', 'The Saints', 1885, '#D71920', '#FFFFFF', 'possession', ['portsmouth', 'bournemouth'], ['Southampton FC']),
  c('stoke-city', 'Stoke City', 'Stoke', 'STK', 'Stoke-on-Trent', 'The Potters', 1863, '#E03A3E', '#FFFFFF', 'direct', [], ['Stoke City FC', 'Stoke']),
  c('sunderland', 'Sunderland', 'Sunderland', 'SUN', 'Sunderland', 'The Black Cats', 1879, '#EB172B', '#FFFFFF', 'direct', ['newcastle-united', 'middlesbrough'], ['Sunderland AFC']),
  c('swansea-city', 'Swansea City', 'Swansea', 'SWA', 'Swansea', 'The Swans', 1912, '#FFFFFF', '#000000', 'possession', ['cardiff-city'], ['Swansea City AFC', 'Swansea City FC', 'Swansea']),
  c('tottenham-hotspur', 'Tottenham Hotspur', 'Spurs', 'TOT', 'London', 'Spurs', 1882, '#132257', '#FFFFFF', 'press', ['arsenal', 'chelsea', 'west-ham-united'], ['Tottenham Hotspur FC', 'Spurs', 'Tottenham']),
  c('watford', 'Watford', 'Watford', 'WAT', 'Watford', 'The Hornets', 1881, '#FBEE23', '#ED2127', 'counter', ['luton-town'], ['Watford FC']),
  c('west-bromwich-albion', 'West Bromwich Albion', 'West Brom', 'WBA', 'West Bromwich', 'The Baggies', 1878, '#122F67', '#FFFFFF', 'balanced', ['aston-villa', 'wolverhampton-wanderers'], ['West Bromwich Albion FC', 'West Brom']),
  c('west-ham-united', 'West Ham United', 'West Ham', 'WHU', 'London', 'The Hammers', 1895, '#7A263A', '#1BB1E7', 'direct', ['tottenham-hotspur', 'chelsea'], ['West Ham United FC', 'West Ham']),
  c('wigan-athletic', 'Wigan Athletic', 'Wigan', 'WIG', 'Wigan', 'The Latics', 1932, '#1D59AF', '#FFFFFF', 'possession', ['bolton-wanderers'], ['Wigan Athletic FC', 'Wigan']),
  c('wolverhampton-wanderers', 'Wolverhampton Wanderers', 'Wolves', 'WOL', 'Wolverhampton', 'Wolves', 1877, '#FDB913', '#231F20', 'counter', ['west-bromwich-albion', 'aston-villa'], ['Wolverhampton Wanderers FC', 'Wolves', 'Wolverhampton']),
  // Clubs that appear in the openfootball tables before 2008 or in the current season.
  c('charlton-athletic', 'Charlton Athletic', 'Charlton', 'CHA', 'London', 'The Addicks', 1905, '#D4021D', '#FFFFFF', 'balanced', ['crystal-palace'], ['Charlton Athletic FC', 'Charlton']),
  c('derby-county', 'Derby County', 'Derby', 'DER', 'Derby', 'The Rams', 1884, '#FFFFFF', '#000000', 'defensive', ['nottingham-forest'], ['Derby County FC', 'Derby']),
  c('sheffield-wednesday', 'Sheffield Wednesday', 'Sheff Wed', 'SHW', 'Sheffield', 'The Owls', 1867, '#0E3F8A', '#FFFFFF', 'defensive', ['sheffield-united'], ['Sheffield Wednesday FC', 'Sheff Wed', 'Sheffield Wed']),
  c('bradford-city', 'Bradford City', 'Bradford', 'BRA', 'Bradford', 'The Bantams', 1903, '#8B1A1A', '#FFBF00', 'defensive', ['leeds-united'], ['Bradford City AFC', 'Bradford City FC', 'Bradford']),
  c('wimbledon', 'Wimbledon', 'Wimbledon', 'WIM', 'London', 'The Dons', 1889, '#1B3F94', '#FFD700', 'direct', [], ['Wimbledon FC']),
  c('oxford-united', 'Oxford United', 'Oxford', 'OXF', 'Oxford', 'The U\'s', 1893, '#FFD700', '#001E5A', 'balanced', [], ['Oxford United FC']),
  c('plymouth-argyle', 'Plymouth Argyle', 'Plymouth', 'PLY', 'Plymouth', 'The Pilgrims', 1886, '#0F6B3F', '#FFFFFF', 'defensive', [], ['Plymouth Argyle FC']),
  c('millwall', 'Millwall', 'Millwall', 'MIL', 'London', 'The Lions', 1885, '#001D5E', '#FFFFFF', 'direct', ['west-ham-united'], ['Millwall FC']),
  c('preston-north-end', 'Preston North End', 'Preston', 'PNE', 'Preston', 'The Lilywhites', 1880, '#FFFFFF', '#001F5B', 'direct', ['blackpool'], ['Preston North End FC', 'Preston']),
  c('stockport-county', 'Stockport County', 'Stockport', 'STO', 'Stockport', 'The Hatters', 1883, '#0C2E6B', '#FFFFFF', 'direct', [], ['Stockport County FC']),
  c('wrexham', 'Wrexham', 'Wrexham', 'WRX', 'Wrexham', 'The Red Dragons', 1864, '#E30613', '#FFFFFF', 'direct', [], ['Wrexham AFC']),
  c('bristol-city', 'Bristol City', 'Bristol City', 'BRC', 'Bristol', 'The Robins', 1894, '#E21C38', '#FFFFFF', 'balanced', [], ['Bristol City FC']),
  // Premier League clubs of 1992-93 to 1997-98 that are not in any later table (appended: club ids are permanent)
  c('oldham-athletic', 'Oldham Athletic', 'Oldham', 'OLD', 'Oldham', 'The Latics', 1895, '#004A99', '#FFFFFF', 'direct', [], ['Oldham Athletic AFC', 'Oldham Athletic FC']),
  c('swindon-town', 'Swindon Town', 'Swindon', 'SWI', 'Swindon', 'The Robins', 1879, '#DA291C', '#FFFFFF', 'possession', ['oxford-united'], ['Swindon Town FC']),
  c('barnsley', 'Barnsley', 'Barnsley', 'BNS', 'Barnsley', 'The Tykes', 1887, '#D71920', '#FFFFFF', 'direct', ['sheffield-wednesday', 'sheffield-united'], ['Barnsley FC']),
]

function c(id, name, shortName, code, city, nickname, founded, primary, secondary, style, rivals, aliases) {
  return { id, name, shortName, code, city, nickname, founded, colours: { primary, secondary }, style, rivals, aliases: [name, shortName, ...aliases] }
}

const ALIAS = new Map()
for (const club of CLUBS) for (const a of club.aliases) ALIAS.set(norm(a), club.id)

export function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[’']/g, '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Resolve any dataset club name to our club id, or undefined. */
export function clubIdFor(name) {
  if (!name) return undefined
  const n = norm(name)
  if (ALIAS.has(n)) return ALIAS.get(n)
  // try stripping suffixes
  const stripped = n.replace(/\b(fc|afc)\b/g, '').replace(/\s+/g, ' ').trim()
  if (ALIAS.has(stripped)) return ALIAS.get(stripped)
  return undefined
}

export const CLUB_BY_ID = Object.fromEntries(CLUBS.map((x) => [x.id, x]))
