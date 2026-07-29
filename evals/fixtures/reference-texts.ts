// The eval's fixed reference set: one authored source text per shipped language, each
// ~600–1000 characters, factual, and unambiguously in its language. Topics are DISTINCT
// on purpose — if a verdict ever reports cross-language contamination (say, a Spanish
// sentence inside the German case's cards), the topic tells you immediately which source
// text it leaked from.
//
// CONTENT IS STABLE BY CONTRACT. The recorded calibration run in the change's
// verification.md is evidence ABOUT THESE EXACT TEXTS — editing a text afterwards
// silently invalidates that evidence. If a text must change, re-run the full eval and
// record a fresh calibration entry before trusting any threshold again.
//
// The PL text doubles as the fixed source for the five forced-language matrix cases
// (evals/generation-quality.eval.ts), so it carries the most weight: it must be rich
// enough to yield 5 reasonable Q/A cards in ANY target language.

export type ReferenceLanguageCode = "pl" | "en" | "es" | "de" | "fr";

export interface ReferenceText {
  code: ReferenceLanguageCode;
  /** Short English topic label, used in reports to attribute cross-language leaks. */
  topic: string;
  text: string;
}

export const REFERENCE_TEXTS: Record<ReferenceLanguageCode, ReferenceText> = {
  pl: {
    code: "pl",
    topic: "Copernicus and heliocentrism",
    text:
      "Mikołaj Kopernik urodził się w 1473 roku w Toruniu. Był astronomem, matematykiem, " +
      "lekarzem i duchownym. Jego najważniejsze dzieło, „O obrotach sfer niebieskich”, " +
      "ukazało się drukiem w 1543 roku, na krótko przed śmiercią autora. Kopernik przedstawił " +
      "w nim model heliocentryczny: to Słońce, a nie Ziemia, znajduje się w środku układu, " +
      "a planety, w tym Ziemia, krążą wokół niego. Ziemia dodatkowo obraca się wokół własnej " +
      "osi, co tłumaczy dobowy ruch nieba. Teoria ta podważyła obowiązujący od starożytności " +
      "model Ptolemeusza, w którym nieruchoma Ziemia stała w środku wszechświata. Dzieło " +
      "Kopernika zapoczątkowało przewrót naukowy nazywany rewolucją kopernikańską i wpłynęło " +
      "na późniejsze prace Galileusza, Keplera i Newtona. Kopernik studiował w Krakowie, " +
      "Bolonii i Padwie, a większość życia spędził na Warmii, gdzie pracował jako kanonik " +
      "we Fromborku i tam prowadził swoje obserwacje astronomiczne.",
  },
  en: {
    code: "en",
    topic: "Great Barrier Reef",
    text:
      "The Great Barrier Reef, located off the coast of Queensland in northeastern Australia, " +
      "is the largest coral reef system on Earth. It stretches for about 2,300 kilometres and " +
      "is composed of roughly 2,900 individual reefs and some 900 islands. The reef is built " +
      "by billions of tiny organisms called coral polyps, which secrete calcium carbonate " +
      "skeletons over thousands of years. It supports an extraordinary diversity of life, " +
      "including more than 1,500 species of fish, about 400 species of hard coral, and six of " +
      "the world's seven species of sea turtle. In 1981 the reef was declared a UNESCO World " +
      "Heritage Site. Today it faces serious threats: rising sea temperatures cause coral " +
      "bleaching, during which corals expel the microscopic algae that give them both colour " +
      "and most of their nutrients, and repeated mass bleaching events have damaged large " +
      "sections of the reef since 2016.",
  },
  es: {
    code: "es",
    topic: "The Alhambra",
    text:
      "La Alhambra es un conjunto palaciego y una fortaleza situados en una colina de la " +
      "ciudad de Granada, en el sur de España. Fue construida principalmente durante los " +
      "siglos XIII y XIV por los sultanes de la dinastía nazarí, la última dinastía musulmana " +
      "de la península ibérica. Su nombre procede del árabe y significa «la roja», por el " +
      "color de sus muros. El conjunto incluye los Palacios Nazaríes, célebres por sus patios " +
      "con fuentes, sus arcos de yeso tallado y sus azulejos geométricos, así como la " +
      "Alcazaba militar y el palacio renacentista de Carlos V, añadido tras la conquista " +
      "cristiana de 1492. El Patio de los Leones, con su fuente sostenida por doce leones de " +
      "mármol, es uno de los espacios más famosos del arte islámico occidental. En 1984 la " +
      "Alhambra fue declarada Patrimonio de la Humanidad por la Unesco y hoy es uno de los " +
      "monumentos más visitados de España.",
  },
  de: {
    code: "de",
    topic: "Berlin Wall",
    text:
      "Die Berliner Mauer trennte von 1961 bis 1989 die Stadt Berlin in einen östlichen und " +
      "einen westlichen Teil. Die Regierung der DDR ließ sie in der Nacht zum 13. August 1961 " +
      "errichten, um die massenhafte Flucht ihrer Bürger nach West-Berlin zu stoppen. Die " +
      "Mauer war zuletzt über 155 Kilometer lang und bestand aus Betonplatten, Wachtürmen, " +
      "Signalzäunen und einem streng bewachten Todesstreifen. Bei Fluchtversuchen kamen mehr " +
      "als hundert Menschen ums Leben. Am 9. November 1989 verkündete ein Sprecher der " +
      "DDR-Regierung überraschend neue Reiseregelungen, woraufhin noch am selben Abend " +
      "Tausende Menschen zu den Grenzübergängen strömten und die Mauer friedlich geöffnet " +
      "wurde. Der Mauerfall gilt als Symbol für das Ende des Kalten Krieges und machte den " +
      "Weg zur deutschen Wiedervereinigung frei, die am 3. Oktober 1990 vollzogen wurde. " +
      "Heute erinnern Gedenkstätten wie die an der Bernauer Straße an die Teilung der Stadt.",
  },
  fr: {
    code: "fr",
    topic: "Impressionism",
    text:
      "L'impressionnisme est un mouvement artistique né en France dans la seconde moitié du " +
      "XIXe siècle. Ses représentants les plus connus sont Claude Monet, Pierre-Auguste " +
      "Renoir, Edgar Degas, Camille Pissarro et Berthe Morisot. Le nom du mouvement vient du " +
      "tableau de Monet « Impression, soleil levant », exposé en 1874 lors de la première " +
      "exposition du groupe, organisée en marge du Salon officiel qui refusait leurs œuvres. " +
      "Les impressionnistes peignaient souvent en plein air, cherchant à saisir la lumière " +
      "changeante et les instants fugitifs de la vie moderne : bords de Seine, gares, jardins " +
      "et scènes de café. Leur touche rapide et fragmentée, leurs couleurs claires posées " +
      "côte à côte et leurs cadrages inspirés de la photographie ont d'abord choqué la " +
      "critique, avant de transformer profondément la peinture occidentale et d'ouvrir la " +
      "voie aux avant-gardes du XXe siècle.",
  },
};
