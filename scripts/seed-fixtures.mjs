/**
 * The people, creators, and words the local development world is made of.
 *
 * Every person here is invented. None is a real individual, none is modelled on
 * one, and none carries a photograph of anybody: the images this data produces
 * are generated from the fixture itself — two colours and a few soft shapes —
 * so the repository owns every byte it seeds and nothing scraped, licensed, or
 * likeness-bearing can enter a developer's database through this path.
 *
 * They are adults, they are fictional, and the bios are written the way real
 * ones are: uneven in length, occasionally awkward, sometimes very short. A
 * fixture set where every bio is two tidy sentences makes a product look finished
 * when it is not, and hides exactly the layout problems a long name or an
 * unbroken word is going to cause.
 *
 * Everything is deterministic. The same fixture produces the same identity, the
 * same handle, the same colours, and the same relationships every time, so two
 * developers looking at the same seed are looking at the same world.
 */

/**
 * The interface language every seeded person shares.
 *
 * Discovery requires a shared language between two people, so a world where
 * nobody shared one would be a world with an empty Discover. Everybody speaks
 * this one and most speak a second, which is what makes the "you both speak"
 * chip on a card carry real information rather than the same information twice.
 */
export const commonLanguage = 'en';

/**
 * Consumers, in the order they are created.
 *
 * `tone` is the pair of colours their generated imagery is built from, chosen
 * per person so a list is scannable and so the same person looks the same on
 * every surface. `region` and `languages` are what discovery actually filters
 * and ranks on, so they vary genuinely rather than decoratively.
 */
export const consumers = [
  {
    bio: 'Architect. I cook far too much for one person and I am always looking for somebody to help finish it.',
    displayName: 'Mara Oduya',
    languages: ['sw'],
    region: 'KE',
    tone: ['#7a3f52', '#241722'],
  },
  {
    bio: 'Sound engineer, night owl, terrible at chess but very willing to lose.',
    displayName: 'Tomás Iglesias',
    languages: ['es'],
    region: 'ES',
    tone: ['#2f4a5e', '#161f2b'],
  },
  {
    bio: 'Long walks, longer books. Currently rereading everything I loved at twenty to see whether it holds up.',
    displayName: 'Yuki Tanabe',
    languages: ['ja'],
    region: 'JP',
    tone: ['#6a4230', '#241a18'],
  },
  {
    bio: 'Pastry, mostly. I get up at four and I am asleep by nine, which makes me either very boring or very reliable.',
    displayName: 'Élodie Marchand',
    languages: ['fr'],
    region: 'FR',
    tone: ['#4a3a63', '#1f1b2e'],
  },
  {
    bio: 'I fix bicycles and I am learning to sail. Neither is going especially well.',
    displayName: 'Niall Brennan',
    languages: ['ga'],
    region: 'IE',
    tone: ['#2e4a3d', '#172420'],
  },
  {
    bio: 'Radiographer. Ask me about anything except work and I will talk for hours.',
    displayName: 'Priya Raghunathan',
    languages: ['ta'],
    region: 'IN',
    tone: ['#5e3a2c', '#26191a'],
  },
  {
    bio: '',
    displayName: 'Ana Sofia Ferreira',
    languages: ['pt'],
    region: 'PT',
    tone: ['#3f4a2e', '#1e2417'],
  },
  {
    bio: 'Translator. I think in three languages and lose my keys in all of them.',
    displayName: 'Lena Vogt',
    languages: ['de'],
    region: 'DE',
    tone: ['#4a2f3a', '#2a1c26'],
  },
  {
    bio: 'Marine biologist, which mostly means spreadsheets and occasionally means a boat.',
    displayName: 'Kwame Mensah',
    languages: ['ak'],
    region: 'GH',
    tone: ['#2c4a4a', '#152525'],
  },
  {
    bio: 'I run a very small record shop. Come in, do not buy anything, stay two hours.',
    displayName: 'Silje Hauge',
    languages: ['no'],
    region: 'NO',
    tone: ['#3a3f5e', '#1b1d2b'],
  },
  {
    bio: 'Nurse on nights. My idea of a good time is a quiet room and somebody else cooking.',
    displayName: 'Beatriz Salgado',
    languages: ['es'],
    region: 'MX',
    tone: ['#5e2f3a', '#26161c'],
  },
  {
    bio: 'Furniture, mostly chairs. I have made forty and sat comfortably in about six.',
    displayName: 'Anders Lindqvist',
    languages: ['sv'],
    region: 'SE',
    tone: ['#4a4230', '#241f17'],
  },
  {
    // Deliberately hostile, and it stays: an unbreakable run is what makes a
    // grid column wider than its viewport, and a seeded world is the only place
    // a developer meets one before a user does.
    bio: 'Ceramicist. Supercalifragilisticexpialidociousandthensome, and clay under my nails.',
    displayName: 'Maximilianovitch Wolfeschle',
    languages: ['de'],
    region: 'AT',
    tone: ['#3f2c4a', '#1e1626'],
  },
  {
    bio: 'Cartographer for a living, lost in my own city for fun.',
    displayName: 'Iris Ohene',
    languages: ['nl'],
    region: 'NL',
    tone: ['#2e3f4a', '#171f24'],
  },
  {
    bio: 'Teaching myself to weld. So far I have made a lamp and a small fire.',
    displayName: 'Dario Costa',
    languages: ['it'],
    region: 'IT',
    tone: ['#5e4a2c', '#262115'],
  },
  {
    bio: 'Bookbinder. I am the reason your grandmother’s atlas still opens flat.',
    displayName: 'Hannah Feldman',
    languages: ['he'],
    region: 'IL',
    tone: ['#4a2c2c', '#241616'],
  },
  {
    bio: 'Climbing, coffee, and an unreasonable number of houseplants.',
    displayName: 'Jonas Halvorsen',
    languages: ['da'],
    region: 'DK',
    tone: ['#2c4a3f', '#16241f'],
  },
  {
    bio: 'Documentary sound. I have recorded three volcanoes and one very loud cafe.',
    displayName: 'Rafaela Duarte',
    languages: ['pt'],
    region: 'BR',
    tone: ['#5e3f2c', '#261f16'],
  },
  {
    bio: 'Physiotherapist. I will absolutely comment on how you are standing.',
    displayName: 'Ayla Demir',
    languages: ['tr'],
    region: 'TR',
    tone: ['#4a3a2c', '#241d16'],
  },
  {
    bio: 'I make maps of imaginary places and sell them to people who know they are imaginary.',
    displayName: 'Oskar Nowak',
    languages: ['pl'],
    region: 'PL',
    tone: ['#3a2c4a', '#1d1624'],
  },
  {
    bio: 'Chef, but the kind who cooks for forty people at a time and likes it.',
    displayName: 'Grace Mwangi',
    languages: ['sw'],
    region: 'KE',
    tone: ['#4a2c3f', '#24161f'],
  },
  {
    bio: 'Astronomer. Yes, I have seen it. No, it is not a planet.',
    displayName: 'Ji-woo Park',
    languages: ['ko'],
    region: 'KR',
    tone: ['#2c3a4a', '#161d24'],
  },
  {
    bio: 'Retraining as a midwife at thirty-eight and enjoying it more than anything I did before.',
    displayName: 'Clara Bianchi',
    languages: ['it'],
    region: 'CH',
    tone: ['#5e4a3f', '#26211f'],
  },
  {
    bio: 'Sign painter. Everything I own has slightly wet paint on it.',
    displayName: 'Femi Adeyemi',
    languages: ['yo'],
    region: 'NG',
    tone: ['#4a4a2c', '#242416'],
  },
  {
    bio: 'Software, reluctantly. Woodwind, enthusiastically.',
    displayName: 'Nadia Haddad',
    languages: ['ar'],
    region: 'MA',
    tone: ['#3f2c3a', '#1f161d'],
  },
  {
    bio: 'I run long distances slowly and talk the whole way. Warned you.',
    displayName: 'Sam Okonkwo',
    languages: ['ig'],
    region: 'NG',
    tone: ['#2c4a2c', '#162416'],
  },
  {
    bio: 'Archivist. My job is remembering things on behalf of a whole city.',
    displayName: 'Marta Kowalczyk',
    languages: ['pl'],
    region: 'PL',
    tone: ['#4a3f2c', '#241f16'],
  },
  {
    bio: 'Tattooing for nine years. Mostly plants, occasionally something with teeth.',
    displayName: 'Rin Matsuda',
    languages: ['ja'],
    region: 'JP',
    tone: ['#3a4a2c', '#1d2416'],
  },
  {
    bio: 'Ex-dancer, current physio, permanent nuisance about posture.',
    displayName: 'Louise Dupont',
    languages: ['fr'],
    region: 'BE',
    tone: ['#4a2c4a', '#241624'],
  },
  {
    bio: 'Beekeeper. Forty thousand colleagues and none of them answer email.',
    displayName: 'Ivan Petrov',
    languages: ['bg'],
    region: 'BG',
    tone: ['#2c4a5e', '#162426'],
  },
  {
    bio: 'Costume, mostly theatre. I can age anybody forty years in an afternoon.',
    displayName: 'Zainab Qureshi',
    languages: ['ur'],
    region: 'PK',
    tone: ['#5e2c4a', '#261624'],
  },
  {
    bio: 'Glassblower. Hot, loud, and worth it.',
    displayName: 'Eleni Papadaki',
    languages: ['el'],
    region: 'GR',
    tone: ['#2c5e4a', '#162624'],
  },
];

/**
 * Creators, in the order they are created.
 *
 * The first four are deliberately richer than the rest — more published items,
 * more imagery, a club with invitations — because a product demonstrates its
 * ceiling with a few pages that are genuinely full rather than with a dozen that
 * are all equally sparse.
 */
export const creators = [
  {
    bio: 'Wheel-thrown stoneware in small runs. Everything here is made in a converted dairy outside Lisbon, and everything is meant to be used rather than looked at.',
    clubs: [
      {
        benefits: [
          'Kiln notes the week they are written',
          'The pieces that did not survive, and why',
          'First refusal on a small run',
        ],
        description:
          'Work in progress, kiln notes, and the pieces that do not survive the firing.',
        membership: {
          monthlyMinor: '1200',
          yearlyMinor: '12000',
        },
        name: 'The Kiln Room',
      },
    ],
    displayName: 'Ember Vale Ceramics',
    flagship: true,
    handle: 'embervale',
    items: [
      {
        body: 'Six weeks between the first throw and the last glaze, and about a third of it survived. What did is here.',
        images: 3,
        summary: 'The autumn run, and what came out of it.',
        title: 'Autumn run: forty pieces, thirteen survivors',
      },
      {
        body: 'A slower, wetter clay than I usually work with. It records everything your hands do, which is either the point or the problem.',
        images: 2,
        summary: 'Working with a clay that remembers.',
        title: 'Notes on a difficult body',
      },
      {
        body: 'Members only, because it is mostly me complaining about a kiln.',
        images: 2,
        members: true,
        summary: 'The firing that went wrong, in detail.',
        title: 'What happened in the January firing',
      },
      {
        images: 1,
        summary: 'Where everything here is made.',
        title: 'The dairy, before and after',
      },
    ],
    links: [{ label: 'Studio', url: 'https://example.invalid/embervale' }],
    region: 'ES',
    tone: ['#7a4a30', '#2b1c16'],
  },
  {
    bio: 'Field recordings and slow music. I spend most of the year somewhere with bad weather and good acoustics.',
    clubs: [
      {
        benefits: [
          'One unedited field recording a week',
          'The notes that came with it',
          'The tape that did not make the cut',
        ],
        description: 'Unedited field recordings, one a week, with the notes.',
        membership: {
          monthlyMinor: '800',
          yearlyMinor: '8000',
        },
        name: 'Raw Tape',
      },
    ],
    displayName: 'North Sound',
    flagship: true,
    handle: 'northsound',
    items: [
      {
        body: 'Eleven hours of tape from a fjord in February, cut to nineteen minutes. The wind does most of the work.',
        images: 2,
        summary: 'Nineteen minutes from eleven hours.',
        title: 'Fjord, February',
      },
      {
        body: 'Everything in this one was recorded inside a disused grain silo. Nothing was added afterwards.',
        images: 2,
        summary: 'One room, no processing.',
        title: 'Silo',
      },
      {
        images: 3,
        members: true,
        summary: 'The tapes that did not make it.',
        title: 'Offcuts, 2026',
      },
      {
        body: 'A short one about why I stopped using a shotgun microphone for almost everything.',
        images: 1,
        summary: 'A change of equipment, and why.',
        title: 'On putting the shotgun mic away',
      },
    ],
    links: [{ label: 'Listen', url: 'https://example.invalid/northsound' }],
    region: 'FR',
    tone: ['#2f4a5e', '#141d26'],
  },
  {
    bio: 'Botanical illustration, mostly of things nobody considers worth illustrating. Weeds, seed heads, the plants in car parks.',
    clubs: [
      {
        benefits: [
          'Full-resolution plates',
          'The working sketches behind them',
          'A note on what each one is',
        ],
        description:
          'Full-resolution plates and the working sketches behind them.',
        membership: {
          monthlyMinor: '1500',
        },
        name: 'The Plate Room',
      },
    ],
    displayName: 'Quiet Herbarium',
    flagship: true,
    handle: 'quietherbarium',
    items: [
      {
        body: 'Twelve plates of plants growing in the cracks of one street. It took a year because I wanted each at its own best moment.',
        images: 3,
        summary: 'A year on one street.',
        title: 'Pavement, twelve plates',
      },
      {
        images: 2,
        summary: 'Seed heads, after everything else has gone.',
        title: 'What is left in November',
      },
      {
        body: 'The sketches, the mistakes, and the two plates I abandoned.',
        images: 3,
        members: true,
        summary: 'Everything that did not make the final set.',
        title: 'Working drawings for Pavement',
      },
    ],
    links: [],
    region: 'ES',
    tone: ['#3f5e3a', '#1a2418'],
  },
  {
    bio: 'I build furniture from single trees. One tree, one commission, everything from it — including the parts nobody wants.',
    clubs: [
      {
        benefits: [
          'A month of one tree, photographed weekly',
          'What changed and what did not',
        ],
        description:
          'Commission diaries, from the standing tree to the finished room.',
        name: 'One Tree',
      },
    ],
    displayName: 'Single Stem',
    flagship: true,
    handle: 'singlestem',
    items: [
      {
        body: 'An ash that came down in a storm and became a dining table, two benches, a shelf, and about two hundred spoons.',
        images: 3,
        summary: 'One ash, four months, one room.',
        title: 'The storm ash',
      },
      {
        images: 2,
        summary: 'Why the offcuts matter more than the table.',
        title: 'What to do with the rest of it',
      },
      {
        body: 'Members only. The full diary, including the fortnight I got the joinery wrong.',
        images: 2,
        members: true,
        summary: 'The whole commission, mistakes included.',
        title: 'Storm ash: the full diary',
      },
      {
        images: 1,
        summary: 'The workshop, at six in the morning.',
        title: 'Where this happens',
      },
    ],
    links: [
      { label: 'Commissions', url: 'https://example.invalid/singlestem' },
    ],
    region: 'FR',
    tone: ['#5e4a2c', '#241d14'],
  },
  {
    bio: 'Letterpress, small editions, and a very heavy machine that predates everybody I know.',
    clubs: [],
    displayName: 'Iron Press',
    flagship: false,
    handle: 'ironpress',
    items: [
      {
        images: 2,
        summary: 'A short run of forty.',
        title: 'Edition of forty',
      },
      {
        images: 1,
        summary: 'Setting a page by hand.',
        title: 'Composing stick',
      },
      {
        images: 1,
        summary: 'Why the paper decides how the ink behaves.',
        title: 'Paper before pressure',
      },
      {
        images: 1,
        summary: 'Cleaning and oiling a machine built in 1912.',
        title: 'A morning with the press',
      },
    ],
    links: [],
    region: 'ES',
    tone: ['#4a3a2c', '#1f1a14'],
  },
  {
    bio: 'Natural dye. Everything in the studio is a colour something grew.',
    clubs: [
      {
        benefits: [
          'Every batch, including the failures',
          'Temperatures, timings, and what they cost',
        ],
        description: 'Dye recipes and the failures behind them.',
        membership: {
          monthlyMinor: '900',
          yearlyMinor: '9000',
        },
        name: 'Vat Notes',
      },
    ],
    displayName: 'Madder & Weld',
    flagship: false,
    handle: 'madderweld',
    items: [
      {
        images: 2,
        summary: 'Six months of one plant.',
        title: 'A season of madder',
      },
      {
        images: 1,
        members: true,
        summary: 'The recipe, properly.',
        title: 'Indigo, honestly',
      },
      {
        images: 1,
        summary: 'The yellow hidden in an ordinary hedgerow.',
        title: 'Weld from the roadside',
      },
      {
        images: 1,
        summary: 'Eight fibres, one pot, eight different colours.',
        title: 'What the cloth changes',
      },
    ],
    links: [],
    region: 'FR',
    tone: ['#5e2c3f', '#26161f'],
  },
  {
    bio: 'Knives. Kitchen only, nothing decorative, everything sharpened before it leaves.',
    clubs: [],
    displayName: 'Cold Forge',
    flagship: false,
    handle: 'coldforge',
    items: [
      {
        images: 2,
        summary: 'What a good edge actually is.',
        title: 'On edges',
      },
      {
        images: 1,
        summary: 'A petty knife, start to finish.',
        title: 'One knife',
      },
      {
        images: 1,
        summary: 'The geometry behind a knife that feels quiet in use.',
        title: 'Balance at the pinch',
      },
      {
        images: 1,
        summary: 'Three steels after a year in working kitchens.',
        title: 'Patina is a record',
      },
    ],
    links: [],
    region: 'ES',
    tone: ['#2c3a4a', '#141d24'],
  },
  {
    bio: 'Analogue photography of empty places, which is most places at four in the morning.',
    clubs: [],
    displayName: 'Fourth Hour',
    flagship: false,
    handle: 'fourthhour',
    items: [
      {
        images: 3,
        summary: 'Twelve frames, one night.',
        title: 'One roll, one night',
      },
      {
        images: 2,
        summary: 'Why the darkroom is the point.',
        title: 'Printing it myself',
      },
      {
        images: 1,
        summary: 'The colour of the city before its first bus.',
        title: 'Blue before morning',
      },
      {
        images: 1,
        summary: 'Contact sheets from walks that found nothing.',
        title: 'The frames I passed over',
      },
    ],
    links: [],
    region: 'FR',
    tone: ['#3a3a4a', '#1c1c24'],
  },
  {
    bio: 'Sourdough, and a small bakery that opens three days a week and sells out on all of them.',
    clubs: [],
    displayName: 'Three Days',
    flagship: false,
    handle: 'threedays',
    items: [
      {
        images: 2,
        summary: 'The starter, at eleven years old.',
        title: 'Eleven years of one culture',
      },
      { images: 1, summary: 'Why only three days.', title: 'On opening less' },
      {
        images: 1,
        summary: 'Four loaves from the same dough and four different clocks.',
        title: 'Weather in the proof',
      },
      {
        images: 1,
        summary: 'What remains when the shutters come down.',
        title: 'After sell-out',
      },
    ],
    links: [],
    region: 'ES',
    tone: ['#5e4a3a', '#26201a'],
  },
  {
    bio: 'Bookbinding and box making. If it needs to survive a hundred years, I can probably help.',
    clubs: [
      {
        benefits: [
          'What is on the bench this week',
          'The tools, and why those ones',
        ],
        description: 'Structures, in detail, with the templates.',
        name: 'The Bench',
      },
    ],
    displayName: 'Long Grain',
    flagship: false,
    handle: 'longgrain',
    items: [
      {
        images: 2,
        summary: 'A binding that opens flat.',
        title: 'Flat-opening, properly',
      },
      {
        images: 1,
        members: true,
        summary: 'The template, free to members.',
        title: 'Clamshell template',
      },
      {
        images: 1,
        summary: 'Choosing grain direction before the first cut.',
        title: 'Paper has a direction',
      },
      {
        images: 1,
        summary: 'A repair designed to be visible and reversible.',
        title: 'Mending without pretending',
      },
    ],
    links: [],
    region: 'FR',
    tone: ['#4a2c2c', '#241616'],
  },
  {
    bio: 'Stained glass, contemporary, mostly for people who did not think they wanted stained glass.',
    clubs: [],
    displayName: 'Lead Line',
    flagship: false,
    handle: 'leadline',
    items: [
      { images: 2, summary: 'A window for a stairwell.', title: 'Stairwell' },
      {
        images: 1,
        summary: 'Cutting curves without swearing.',
        title: 'On curves',
      },
      {
        images: 1,
        summary: 'Three transparent greys and the light between them.',
        title: 'Building a quiet shadow',
      },
      {
        images: 1,
        summary: 'The full-size drawing underneath every finished window.',
        title: 'Before the first cut',
      },
    ],
    links: [],
    region: 'ES',
    tone: ['#2c4a5e', '#142326'],
  },
  {
    bio: 'Small-batch perfume from things that grow within a day of here.',
    clubs: [],
    displayName: 'Within a Day',
    flagship: false,
    handle: 'withinaday',
    items: [
      {
        images: 2,
        summary: 'Everything within fifty miles.',
        title: 'A local accord',
      },
      {
        images: 1,
        summary: 'Why it does not last as long.',
        title: 'On natural fixatives',
      },
      {
        images: 1,
        summary: 'One garden sampled at four hours of the same day.',
        title: 'A garden changes by noon',
      },
      {
        images: 1,
        summary: 'How one drop can make a blend easier to hear.',
        title: 'The smallest note',
      },
    ],
    links: [],
    region: 'FR',
    tone: ['#4a3f5e', '#1e1a26'],
  },
];

/** The subject a fixture signs in as, stable across runs. */
export function subjectFor(kind, index) {
  return `${kind}-${String(index + 1).padStart(2, '0')}@velora.seed`;
}
