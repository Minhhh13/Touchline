/**
 * Name pools for the procedurally generated football universe.
 * Nationality mix shifts by era so the 1990s squads feel British-heavy and the
 * 2010s squads feel cosmopolitan, matching how the real top flight evolved.
 */

export interface NationPool {
  code: string
  name: string
  flag: string
  first: string[]
  last: string[]
}

export const NATIONS: NationPool[] = [
  {
    code: 'ENG',
    name: 'England',
    flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    first: ['Alan', 'Andy', 'Ashley', 'Ben', 'Callum', 'Chris', 'Craig', 'Danny', 'Darren', 'David', 'Dean', 'Gary', 'Harry', 'Ian', 'Jack', 'James', 'Jamie', 'Jordan', 'Kevin', 'Kieran', 'Lee', 'Luke', 'Mark', 'Mason', 'Matt', 'Michael', 'Neil', 'Nicky', 'Ollie', 'Paul', 'Phil', 'Reece', 'Rob', 'Ryan', 'Sam', 'Scott', 'Steve', 'Tom', 'Tony', 'Tyler', 'Wayne'],
    last: ['Adams', 'Ashworth', 'Barlow', 'Bennett', 'Brooks', 'Carter', 'Clarke', 'Cole', 'Collins', 'Dawson', 'Dixon', 'Ellis', 'Fletcher', 'Foster', 'Gibbs', 'Hadley', 'Harrison', 'Hughes', 'Jenkins', 'Kirkland', 'Lambert', 'Marsh', 'Mills', 'Morgan', 'Nolan', 'Parker', 'Pearce', 'Reid', 'Riley', 'Robson', 'Shaw', 'Shelton', 'Simmons', 'Stokes', 'Thorne', 'Turner', 'Walker', 'Watson', 'Webb', 'Whitfield', 'Wright'],
  },
  {
    code: 'SCO',
    name: 'Scotland',
    flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    first: ['Alasdair', 'Andrew', 'Callum', 'Colin', 'Duncan', 'Ewan', 'Fraser', 'Gordon', 'Graeme', 'Hamish', 'Iain', 'Kenny', 'Lewis', 'Murray', 'Ross', 'Scott', 'Stuart'],
    last: ['Buchanan', 'Cameron', 'Campbell', 'Douglas', 'Ferguson', 'Fraser', 'Gallacher', 'Hendry', 'Lennon', 'MacLeod', 'McAllister', 'McGregor', 'McKay', 'McLaren', 'Robertson', 'Strachan', 'Sutherland'],
  },
  {
    code: 'WAL',
    name: 'Wales',
    flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
    first: ['Aled', 'Carwyn', 'Dafydd', 'Dylan', 'Gareth', 'Geraint', 'Iestyn', 'Owain', 'Rhys', 'Tomos'],
    last: ['Bowen', 'Davies', 'Evans', 'Griffiths', 'Jones', 'Llewellyn', 'Morgan', 'Owen', 'Price', 'Pritchard', 'Rees', 'Thomas', 'Vaughan', 'Williams'],
  },
  {
    code: 'IRL',
    name: 'Ireland',
    flag: '🇮🇪',
    first: ['Aidan', 'Ciaran', 'Conor', 'Darragh', 'Declan', 'Eoin', 'Fergal', 'Kieran', 'Liam', 'Niall', 'Padraig', 'Ronan', 'Seamus', 'Shane'],
    last: ['Brady', 'Byrne', 'Doyle', 'Duffy', 'Fitzpatrick', 'Gallagher', 'Keane', 'Kelly', 'Maguire', 'McCarthy', 'Murphy', 'Nolan', "O'Brien", "O'Connor", "O'Neill", 'Quinn', 'Walsh'],
  },
  {
    code: 'FRA',
    name: 'France',
    flag: '🇫🇷',
    first: ['Alexandre', 'Antoine', 'Benoît', 'Clément', 'Didier', 'Florian', 'Hugo', 'Julien', 'Karim', 'Laurent', 'Lucas', 'Mathieu', 'Moussa', 'Nabil', 'Olivier', 'Rémi', 'Thierry', 'Yannick'],
    last: ['Bernard', 'Blanchard', 'Charpentier', 'Dubois', 'Durand', 'Fontaine', 'Garnier', 'Lefebvre', 'Leroy', 'Marchand', 'Mercier', 'Moreau', 'Perrin', 'Renard', 'Rousseau', 'Sylla', 'Traoré', 'Vidal'],
  },
  {
    code: 'ESP',
    name: 'Spain',
    flag: '🇪🇸',
    first: ['Adrián', 'Álvaro', 'Carlos', 'Dani', 'Diego', 'Fernando', 'Iker', 'Javi', 'Jorge', 'Juan', 'Marcos', 'Mikel', 'Pablo', 'Raúl', 'Rodrigo', 'Sergio', 'Unai', 'Xabi'],
    last: ['Alonso', 'Álvarez', 'Castro', 'Delgado', 'Díaz', 'Fernández', 'Gómez', 'Herrera', 'Ibáñez', 'Jiménez', 'Márquez', 'Navarro', 'Ortega', 'Ramos', 'Romero', 'Ruiz', 'Serrano', 'Vázquez'],
  },
  {
    code: 'ITA',
    name: 'Italy',
    flag: '🇮🇹',
    first: ['Alessandro', 'Andrea', 'Davide', 'Emanuele', 'Fabio', 'Federico', 'Giorgio', 'Lorenzo', 'Luca', 'Marco', 'Matteo', 'Nicola', 'Riccardo', 'Roberto', 'Simone', 'Stefano'],
    last: ['Barone', 'Bianchi', 'Caruso', 'Colombo', 'Conti', 'De Luca', 'Esposito', 'Ferrara', 'Gallo', 'Greco', 'Lombardi', 'Mancini', 'Marino', 'Moretti', 'Ricci', 'Romano', 'Santoro', 'Vitale'],
  },
  {
    code: 'GER',
    name: 'Germany',
    flag: '🇩🇪',
    first: ['Christoph', 'Dennis', 'Felix', 'Florian', 'Jan', 'Jonas', 'Kai', 'Leon', 'Lukas', 'Marcel', 'Matthias', 'Maximilian', 'Niklas', 'Philipp', 'Sebastian', 'Timo', 'Tobias'],
    last: ['Bauer', 'Becker', 'Brandt', 'Fischer', 'Hartmann', 'Hoffmann', 'Keller', 'Krüger', 'Lange', 'Neumann', 'Richter', 'Schäfer', 'Schmidt', 'Schulz', 'Vogel', 'Wagner', 'Weber', 'Zimmermann'],
  },
  {
    code: 'NED',
    name: 'Netherlands',
    flag: '🇳🇱',
    first: ['Bas', 'Daley', 'Davy', 'Jeroen', 'Joost', 'Kevin', 'Luuk', 'Maarten', 'Marten', 'Niels', 'Pieter', 'Ruud', 'Sven', 'Thijs', 'Wesley', 'Wout'],
    last: ['Bakker', 'Bos', 'De Boer', 'De Jong', 'De Vries', 'Dekker', 'Hendriks', 'Jansen', 'Kuipers', 'Meijer', 'Mulder', 'Smit', 'Van Dijk', 'Van den Berg', 'Van der Meer', 'Visser', 'Vos'],
  },
  {
    code: 'POR',
    name: 'Portugal',
    flag: '🇵🇹',
    first: ['André', 'Bernardo', 'Bruno', 'Diogo', 'Fábio', 'Gonçalo', 'João', 'Nuno', 'Pedro', 'Rafael', 'Ricardo', 'Rúben', 'Tiago', 'Vítor'],
    last: ['Almeida', 'Carvalho', 'Costa', 'Ferreira', 'Fonseca', 'Lopes', 'Machado', 'Martins', 'Mendes', 'Neves', 'Oliveira', 'Pereira', 'Pinto', 'Ribeiro', 'Rocha', 'Santos', 'Teixeira'],
  },
  {
    code: 'BRA',
    name: 'Brazil',
    flag: '🇧🇷',
    first: ['Anderson', 'Bruno', 'Caio', 'Douglas', 'Éder', 'Everton', 'Felipe', 'Gabriel', 'Gustavo', 'Júlio', 'Lucas', 'Matheus', 'Rafael', 'Rodrigo', 'Thiago', 'Vinícius', 'Wellington'],
    last: ['Alves', 'Araújo', 'Barbosa', 'Batista', 'Cardoso', 'Correia', 'da Silva', 'dos Santos', 'Fernandes', 'Gonçalves', 'Lima', 'Moraes', 'Nascimento', 'Ribeiro', 'Rodrigues', 'Souza', 'Vieira'],
  },
  {
    code: 'ARG',
    name: 'Argentina',
    flag: '🇦🇷',
    first: ['Agustín', 'Alejandro', 'Cristian', 'Ezequiel', 'Facundo', 'Federico', 'Gonzalo', 'Joaquín', 'Lautaro', 'Leandro', 'Lucas', 'Matías', 'Nicolás', 'Pablo', 'Santiago', 'Tomás'],
    last: ['Acosta', 'Aguirre', 'Benítez', 'Cabrera', 'Córdoba', 'Domínguez', 'Fernández', 'Giménez', 'Ledesma', 'Medina', 'Molina', 'Pereyra', 'Quiroga', 'Rojas', 'Sosa', 'Suárez', 'Torres'],
  },
  {
    code: 'NGA',
    name: 'Nigeria',
    flag: '🇳🇬',
    first: ['Adebayo', 'Chidi', 'Chukwu', 'Emeka', 'Femi', 'Ikenna', 'Kelechi', 'Nnamdi', 'Obinna', 'Olu', 'Samuel', 'Taiwo', 'Tunde', 'Victor'],
    last: ['Abubakar', 'Adeyemi', 'Afolabi', 'Akinyemi', 'Babangida', 'Eze', 'Ikechukwu', 'Nwankwo', 'Obi', 'Okafor', 'Okonkwo', 'Oladipo', 'Olawale', 'Onyekachi', 'Yusuf'],
  },
  {
    code: 'GHA',
    name: 'Ghana',
    flag: '🇬🇭',
    first: ['Abdul', 'Ebenezer', 'Emmanuel', 'Isaac', 'Joseph', 'Kofi', 'Kwadwo', 'Kwame', 'Kwesi', 'Michael', 'Prince', 'Richmond', 'Samuel', 'Yaw'],
    last: ['Acheampong', 'Adjei', 'Agyemang', 'Amoah', 'Annan', 'Appiah', 'Asante', 'Boateng', 'Essien', 'Frimpong', 'Gyan', 'Mensah', 'Owusu', 'Quaye', 'Tetteh'],
  },
  {
    code: 'CIV',
    name: 'Ivory Coast',
    flag: '🇨🇮',
    first: ['Abdoulaye', 'Bakary', 'Cheick', 'Didier', 'Emmanuel', 'Franck', 'Ibrahim', 'Jean-Philippe', 'Kolo', 'Lassina', 'Max', 'Seydou', 'Souleymane', 'Yaya'],
    last: ['Bamba', 'Coulibaly', 'Diabaté', 'Diomandé', 'Doumbia', 'Gnonsiane', 'Kalou', 'Koné', 'Kouassi', 'Ouattara', 'Sanogo', 'Touré', 'Traoré', 'Zokora'],
  },
  {
    code: 'SEN',
    name: 'Senegal',
    flag: '🇸🇳',
    first: ['Abdou', 'Alioune', 'Amadou', 'Boubacar', 'Cheikhou', 'Demba', 'Idrissa', 'Ismaïla', 'Kalidou', 'Mamadou', 'Moussa', 'Pape', 'Sadio', 'Youssouf'],
    last: ['Ba', 'Cissé', 'Diagne', 'Diallo', 'Diatta', 'Diop', 'Faye', 'Gueye', 'Mbaye', 'Mendy', 'Ndiaye', 'Niang', 'Sarr', 'Seck', 'Sow'],
  },
  {
    code: 'BEL',
    name: 'Belgium',
    flag: '🇧🇪',
    first: ['Axel', 'Dries', 'Hans', 'Jan', 'Jelle', 'Kevin', 'Koen', 'Leander', 'Maxime', 'Michy', 'Thibaut', 'Thomas', 'Timothy', 'Youri'],
    last: ['Claes', 'De Smet', 'Dewulf', 'Goossens', 'Jacobs', 'Janssens', 'Lambrechts', 'Maes', 'Mertens', 'Peeters', 'Vermeulen', 'Vertonghen', 'Wouters', 'Willems'],
  },
  {
    code: 'SWE',
    name: 'Sweden',
    flag: '🇸🇪',
    first: ['Anders', 'Björn', 'Emil', 'Erik', 'Fredrik', 'Gustav', 'Henrik', 'Johan', 'Karl', 'Magnus', 'Niklas', 'Oskar', 'Patrik', 'Viktor'],
    last: ['Andersson', 'Berg', 'Carlsson', 'Ekström', 'Eriksson', 'Forsberg', 'Johansson', 'Karlsson', 'Larsson', 'Lindqvist', 'Nilsson', 'Olsson', 'Persson', 'Svensson'],
  },
  {
    code: 'NOR',
    name: 'Norway',
    flag: '🇳🇴',
    first: ['Anders', 'Christian', 'Erling', 'Even', 'Henrik', 'Jonas', 'Kristian', 'Lars', 'Magnus', 'Martin', 'Ole', 'Sander', 'Sondre', 'Tore'],
    last: ['Berge', 'Dahl', 'Eriksen', 'Haaland', 'Hansen', 'Iversen', 'Johnsen', 'Kristiansen', 'Larsen', 'Moen', 'Nilsen', 'Olsen', 'Pedersen', 'Solbakken'],
  },
  {
    code: 'DEN',
    name: 'Denmark',
    flag: '🇩🇰',
    first: ['Anders', 'Casper', 'Christian', 'Frederik', 'Jesper', 'Kasper', 'Lasse', 'Mads', 'Magnus', 'Mikkel', 'Morten', 'Nicklas', 'Rasmus', 'Simon'],
    last: ['Andersen', 'Christensen', 'Dalsgaard', 'Hansen', 'Jensen', 'Jørgensen', 'Kjær', 'Larsen', 'Madsen', 'Nielsen', 'Pedersen', 'Poulsen', 'Rasmussen', 'Sørensen'],
  },
  {
    code: 'CRO',
    name: 'Croatia',
    flag: '🇭🇷',
    first: ['Ante', 'Dario', 'Dejan', 'Domagoj', 'Ivan', 'Josip', 'Luka', 'Marko', 'Mateo', 'Nikola', 'Petar', 'Šime', 'Tomislav', 'Zvonimir'],
    last: ['Babić', 'Brozović', 'Horvat', 'Jurić', 'Knežević', 'Kovač', 'Kovačević', 'Marić', 'Matić', 'Novak', 'Perić', 'Petrović', 'Tomić', 'Vuković'],
  },
  {
    code: 'SRB',
    name: 'Serbia',
    flag: '🇷🇸',
    first: ['Aleksandar', 'Branislav', 'Dušan', 'Filip', 'Luka', 'Marko', 'Milan', 'Miloš', 'Nemanja', 'Nikola', 'Predrag', 'Sergej', 'Stefan', 'Uroš'],
    last: ['Đorđević', 'Ilić', 'Jovanović', 'Kostić', 'Lukić', 'Marković', 'Milinković', 'Nikolić', 'Pavlović', 'Petrović', 'Radovanović', 'Stanković', 'Stojković', 'Vidić'],
  },
  {
    code: 'USA',
    name: 'United States',
    flag: '🇺🇸',
    first: ['Brad', 'Brandon', 'Christian', 'Clint', 'DaMarcus', 'Josh', 'Kyle', 'Landon', 'Matt', 'Tim', 'Tyler', 'Walker', 'Weston', 'Zack'],
    last: ['Adams', 'Bradley', 'Cooper', 'Dempsey', 'Donovan', 'Friedel', 'Howard', 'Jackson', 'McKennie', 'Morris', 'Pulisic', 'Reyna', 'Robinson', 'Steffen'],
  },
  {
    code: 'JPN',
    name: 'Japan',
    flag: '🇯🇵',
    first: ['Daichi', 'Hiroki', 'Kaoru', 'Keisuke', 'Kenta', 'Ritsu', 'Ryo', 'Shinji', 'Takumi', 'Takehiro', 'Wataru', 'Yuto', 'Yuya'],
    last: ['Endo', 'Hasebe', 'Honda', 'Inamoto', 'Ito', 'Kagawa', 'Kubo', 'Mitoma', 'Morita', 'Nagatomo', 'Okazaki', 'Sato', 'Suzuki', 'Tanaka'],
  },
  {
    code: 'KOR',
    name: 'South Korea',
    flag: '🇰🇷',
    first: ['Chan-ho', 'Dong-gook', 'Heung-min', 'Hwang', 'Hyun-jun', 'Ji-sung', 'Jin-su', 'Kang-in', 'Min-jae', 'Seung-woo', 'Sung-yong', 'Woo-young', 'Young-pyo'],
    last: ['Cho', 'Choi', 'Hwang', 'Jung', 'Kang', 'Kim', 'Ko', 'Lee', 'Lim', 'Park', 'Seo', 'Shin', 'Son', 'Yoon'],
  },
  {
    code: 'AUS',
    name: 'Australia',
    flag: '🇦🇺',
    first: ['Aaron', 'Brett', 'Craig', 'Harry', 'Jackson', 'Lucas', 'Mark', 'Mathew', 'Mile', 'Mitchell', 'Riley', 'Tim', 'Tom', 'Trent'],
    last: ['Bosnich', 'Cahill', 'Emerton', 'Jedinak', 'Kewell', 'Leckie', 'Mooy', 'Neill', 'Ryan', 'Schwarzer', 'Souttar', 'Viduka', 'Wilkshire'],
  },
]

export const NATION_BY_CODE: Record<string, NationPool> = Object.fromEntries(NATIONS.map((n) => [n.code, n]))

/**
 * Relative weight of each nationality for a given season.
 * British Isles dominate the early 90s; the mix broadens steadily.
 */
export function nationWeight(code: string, season: number): number {
  const t = Math.min(1, Math.max(0, (season - 1992) / 30)) // 0 in 1992, 1 by 2022
  switch (code) {
    case 'ENG':
      return 60 - 32 * t
    case 'SCO':
      return 10 - 7 * t
    case 'WAL':
      return 5 - 3 * t
    case 'IRL':
      return 8 - 5 * t
    case 'FRA':
      return 3 + 7 * t
    case 'ESP':
      return 1 + 7 * t
    case 'ITA':
      return 1.5 + 2.5 * t
    case 'GER':
      return 1 + 3.5 * t
    case 'NED':
      return 3 + 2 * t
    case 'POR':
      return 0.5 + 4.5 * t
    case 'BRA':
      return 1 + 5 * t
    case 'ARG':
      return 0.5 + 3 * t
    case 'NGA':
      return 1.5 + 2.5 * t
    case 'GHA':
      return 0.3 + 1.7 * t
    case 'CIV':
      return 0.2 + 2.3 * t
    case 'SEN':
      return 0.2 + 2.3 * t
    case 'BEL':
      return 0.5 + 3 * t
    case 'SWE':
      return 1.5 + 0.5 * t
    case 'NOR':
      return 2 + 0 * t
    case 'DEN':
      return 1.5 + 1 * t
    case 'CRO':
      return 0.3 + 1.5 * t
    case 'SRB':
      return 0.4 + 1.6 * t
    case 'USA':
      return 0.5 + 1.5 * t
    case 'JPN':
      return 0.1 + 1.4 * t
    case 'KOR':
      return 0.1 + 1 * t
    case 'AUS':
      return 1 + 0.5 * t
    default:
      return 1
  }
}
