# Monte Peralba (`dolomiti`): fauna by altitude band

The animals of the Peralba course, from the summit snowfield (2,678 m) through the Alta and Bassa Val Sesis to the Forra dell'Acquatona (1,026 m), Carnic Alps, Sappada. These are the bands in `animals.kinds` of `tools/bake/worlds/dolomiti.json`: the bake spawns a species only where the real bed altitude lies inside its band, at most `max` per stage, six animals per stage. Checked on 28/10/2026.

| Species (key) | Band, cap | Stages it spawns on (bake of 28/10) | Why there | Sources |
|---|---|---|---|---|
| Alpine marmot, *Marmota marmota* (`marmot`) | 1500-2700 m, at most 2 | 1, 2 | Alpine meadows and screes above the forest; not in the forest valley floor of the Bassa Val Sesis | [Wikipedia](https://en.wikipedia.org/wiki/Alpine_marmot) |
| Chamois, *Rupicapra rupicapra* (`chamois`) | 1000-2600 m, at most 3 | 1-4 | Rock and alpine grass in summer, steep forest lower down (also in the Acquatona gorge) | [Wikipedia](https://en.wikipedia.org/wiki/Chamois) |
| Mountain hare, *Lepus timidus varronis* (`hare`) | 1300-2800 m, at most 1 | 1-3 | The Alpine mountain hare lives from the upper forest to the alpine zone; in summer coat (grey-brown, white belly and scut, black ear tips) | [Wikipedia](https://en.wikipedia.org/wiki/Mountain_hare) |
| Alpine chough, *Pyrrhocorax graculus* (`chough`) | 1600-3000 m, at most 2 | 1 | Breeds on cliffs at 1,260-2,880 m and feeds on alpine grass; walks and hops on the ground, flies off when startled | [Wikipedia](https://en.wikipedia.org/wiki/Alpine_chough) |
| Golden eagle, *Aquila chrysaetos* (`eagle`) | 1000-3000 m, flying, at most 1 | 1-4 | Soars over the whole valley; never comes down to drink | [Wikipedia](https://en.wikipedia.org/wiki/Golden_eagle) |
| Brown alpine cow, Bruna alpina (`cow`) | 1200-1800 m, ground under 30 % slope | 2, 3 | Summer pastures of Cima Sappada and the Val Sesis (the Rifugio Sorgenti del Piave at 1,830 m is in the alpine pasture); none in the Acquatona gorge | [Rifugio Sorgenti del Piave](https://www.turismofvg.it/en/mountain365/rifugio-sorgenti-del-piave) |

**Not on this course: the Alpine ibex.** The spec list had it, but no ibex colony is documented on the Peralba: the Eastern Alps colonies of Veneto, Trentino and Friuli (about 700 animals in five colonies) are the Marmolada, Pale di San Martino, Antelao-Marmarole-Sorapis and others, and a search of the Peralba (Hochweißstein) found none. So the ibex was taken out of this world on 28/10 and lives in the Antelao world (the Antelao-Marmarole-Sorapis colony, docs/mountains/antelao.md). Source: [MUVE, Studiamo insieme lo stambecco](https://msn.visitmuve.it/wp-content/uploads/2022/06/Studiamo-insieme-lo-stambecco.pdf).

**Still to confirm:** a malga with cattle inside the Val Sesis itself (the pastures round Cima Sappada and the Sorgenti del Piave are summer grazing land, but no page found on 28/10 names the herd).

## Models

Every species is a free model reshaped and repainted at load time in `src/render/animals/species.js` (credits in `assets/CREDITS.md`). The Peralba ones: marmot from the Poly by Google gopher, chamois from the Poly goat, mountain hare from the Poly jackrabbit (ears shortened to about the head's length, black tips), chough from the Poly raven (yellow bill, red legs), golden eagle from the Poly soaring bird, the cow from the Quaternius cow (grey-brown Bruna alpina with the pale muzzle ring and a brass bell on a leather strap at the throat). Lineup: `docs/screens/animals-dolomiti.png`.
