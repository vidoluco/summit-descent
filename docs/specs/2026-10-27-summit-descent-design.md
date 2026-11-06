# Summit Descent: design del pezzo 1

Data: 27/10/2026. Stato: approvato a voce ("si fai parti pure"), stile visivo da scegliere sui mockup.

## Cosa e'

Gioco 3D nel browser. Ogni giocatore e' una goccia d'acqua che scende la parte ripida di una montagna vera, dalla vetta fino al fondovalle.
Due giocatori a schermo diviso sul Mac o sulla TV; ognuno guida con il proprio telefono,
che apre una pagina controller scansionando un QR code sulla stessa rete Wi-Fi. Niente app da installare.

Il progetto intero e' diviso in quattro pezzi; questo documento copre solo il **pezzo 1**:

| Pezzo | Contenuto | Stato |
|---|---|---|
| 1 | Motore, controller da telefono, gara in modalita' breve su una montagna (Dolomiti), tutte le meccaniche base, animali | questo documento |
| 2 | Altre montagne (Alpi svizzere, Carpazi, Everest, K2, Indonesia), modalita' reale, voto della mappa dai telefoni | dopo |
| 3 | Modalita' cooperativa | dopo |
| 4 | Ciclo dell'acqua completo, audio, rifinitura | dopo |

Fuori scope nel pezzo 1: voto, menu montagne, modalita' reale, co-op, adattatore AirConsole.

## Vincoli

- Tutto locale. Il server gira sul Mac, nessun servizio esterno a runtime. Rete solo durante il bake dei dati.
- Grafica seria: niente personaggi fatti di primitive (lezione di Web Swing, giudicato "roba da PS1").
  La goccia e' un materiale trasparente con rifrazione e occhi; gli animali sono modelli glTF CC0 veri
  (Quaternius, Kenney, Poly Pizza CC0) con animazioni; il terreno viene da elevazione reale.
- Stile scelto dal proprietario su tre mockup renderizzati (vedi Stile).
- 60 fps target a schermo diviso su un Mac Apple Silicon, quindi il budget di draw e' per due viste.
- Controlli: joystick sullo schermo del telefono e un pulsante (scatto). Niente giroscopio: col joystick
  non serve HTTPS.
- Bilingue inglese e italiano (richiesta del 27/10/2026). Tutti i testi visibili (schermo del gioco, HUD,
  pagina controller, nomi di luoghi e animali mostrati) passano da `src/i18n/` con un dizionario per lingua
  (`en.js`, `it.js`, stesse chiavi, un test verifica che coincidano). Nessuna stringa visibile scritta nel
  codice. Lingua di partenza dal browser (`navigator.language`: `it*` -> italiano, altrimenti inglese),
  cambiabile dallo schermo di attesa; ogni telefono puo' avere la sua lingua. Il nome del gioco resta
  "Summit Descent" in entrambe.

## Stack

Three.js e esbuild come `~/Developer/web-swing`; Node 24; `ws` per WebSocket; `qrcode` per il QR;
`geotiff` per il bake; `playwright-core` con il chromium headless gia' in `~/Library/Caches/ms-playwright`
per screenshot e test nel browser. Test logici con `node --test`.

## Struttura

```
summit-descent/
  server/            server HTTP + WebSocket (unita' net)
  controller/        pagina del telefono (unita' net)
  src/net/           trasporto e input lato gioco (unita' net)
  src/sim/           simulazione pura, nessun import da three (unita' sim)
  src/world/         caricamento dei dati del mondo (unita' bake, lato runtime)
  src/render/        scena, materiali, telecamere, schermo diviso (dopo la scelta dello stile)
  src/main.js        collega tutto (dopo la scelta dello stile)
  tools/bake/        bake offline DEM + OSM -> data/worlds/<id>/ (unita' bake)
  data/raw/          tile e estratti scaricati, fuori da git
  data/worlds/       mondi pronti
  mockups/<stile>/   mockup statici
  docs/mockups/      screenshot dei mockup
  test/
```

## Contratto 1: rete

Il server ascolta su `0.0.0.0:5190`, stampa l'URL di rete locale (primo IPv4 non interno) e serve:

- `/` la pagina del gioco (host), `/pad` la pagina controller, `/qr.svg?u=<url>` il QR in SVG.
- `/ws?role=host` per il gioco, `/ws?role=pad&id=<uuid>` per i telefoni. L'id lo genera il telefono e lo tiene
  in `localStorage`, cosi' una riconnessione riprende lo stesso posto.

Stanza unica, due posti (slot 0 e 1). Un terzo telefono riceve `{t:'full'}` e resta in attesa.
Messaggi JSON:

| Direzione | Messaggio | Note |
|---|---|---|
| server -> host | `{t:'join', slot, color}` | `color` assegnato dal server: slot 0 azzurro, slot 1 corallo |
| server -> host | `{t:'leave', slot}` | il posto resta riservato all'id per 60 s |
| pad -> server -> host | `{t:'in', slot, x, y, b, seq}` | `x,y` in [-1,1], `b` 0/1 pulsante, 30 Hz e a ogni cambio |
| host -> server -> pad | `{t:'fx', slot, kind}` | `kind`: `buzz`, `freeze`, `drink`, `finish`; il pad vibra (`navigator.vibrate`) e mostra lo stato |
| host -> server -> pad | `{t:'hud', slot, mass, place}` | facoltativo, il pad mostra dimensione e posizione |
| host -> server -> pad | `{t:'phase', slot, phase}` | aggiunto il 27/10/2026: `lobby`, `ready`, `solo`, `race`, `next`, `results`; il pad dice cosa fa SCATTO in quel momento |
| server -> host | `{t:'full', waiting}` | aggiunto il 27/10/2026: un telefono e' in coda, lo schermo mostra "la stanza e' piena" |
| pad -> server -> host | `{t:'vote', slot, world, lock}` | aggiunto il 28/10/2026, voto della montagna nella lobby: `world` e' l'id della scheda che il telefono mostra (`random` per "sorpresa"), `lock: true` quando il giocatore la tocca per votarla; SCATTO vota la scheda mostrata. Il server controlla l'id (`[a-z0-9_-]{1,32}`) e mette lo slot |
| host -> server -> pad | `{t:'menu', slot, worlds, phase, focus, ballot, other, pick, spin, winner, landed, candidates, loading}` | aggiunto il 28/10/2026: lo stato del voto per quel telefono. `phase`: `vote`, `agree` (stessa montagna), `roll` (moneta fra due voti diversi, `spin` e' la scheda illuminata, `landed` quando si ferma), `done`; `focus`/`ballot` del telefono, `other` il voto dell'altro, `pick` la montagna scelta, `loading` mentre la TV la carica |

Il server non contiene logica di gioco: inoltra e assegna i posti.

**Voto della montagna** (28/10/2026, `src/game/vote.js`, `src/game/mountains.js`): con almeno un telefono collegato la
lobby diventa la galleria delle sette montagne (Peralba, Antelao, Cervino, Văiuga, Everest, K2, Kerinci) piu' "sorpresa",
con il dipinto della vetta, nome vero, bandiera, quota della vetta, dislivello, durata della gara e tre animali che
compaiono davvero su quel percorso (un test lo verifica su `world.json`). Il cancello della lobby chiude il voto (due
telefoni: entrambi votano; uno solo: SCATTO tenuto premuto); stessa montagna: si parte; montagne diverse: una moneta
fra le due, con l'animazione sulla TV e sui telefoni; "sorpresa" vale qualsiasi montagna. Un telefono che esce durante
il verdetto lo annulla. Una montagna diversa da quella caricata ricarica la pagina della TV su `?world=<id>` e la gara
parte da sola quando tornano i telefoni che hanno votato (`sessionStorage`, chiave `summit-descent.handoff`).

Lato gioco, `src/net/input.js` esporta `createInput(transport)` con
`get(slot) -> {x, y, boost, connected}` e `send(slot, msg)`. `transport` e' un oggetto
`{onMessage(fn), send(msg)}`; l'implementazione WebSocket sta in `src/net/ws-transport.js`.
Il gioco non sa da dove arriva l'input: un futuro adattatore AirConsole implementa lo stesso trasporto.
Senza telefoni, la tastiera fa da riserva solo per sviluppo (WASD + Shift, frecce + Invio).

## Contratto 2: dati del mondo

`data/worlds/<id>/world.json` piu' `height.bin` (Float32 little endian, riga per riga, `w*h` valori in metri).
Coordinate: metri, `y` in alto, `x` verso est, `z` verso sud (nord e' `-z`). Origine alla vetta.

```json
{
  "id": "dolomiti",
  "name": "Dolomiti, Monte Peralba",
  "mode": "short",
  "height": { "file": "height.bin", "w": 0, "h": 0, "x0": 0, "z0": 0, "step": 4 },
  "seaLevel": 0,
  "course": [ { "x": 0, "y": 0, "z": 0, "hw": 20 } ],
  "branches": [ { "from": 0, "to": 0, "kind": "shortcut", "points": [ { "x": 0, "y": 0, "z": 0, "hw": 8 } ] } ],
  "checkpoints": [ 0 ],
  "zones": [ { "kind": "ice", "from": 0, "to": 0 } ],
  "spawns": {
    "start": [ { "x": 0, "y": 0, "z": 0 } ],
    "water": [ { "x": 0, "y": 0, "z": 0 } ],
    "animals": [ { "kind": "marmot", "x": 0, "y": 0, "z": 0 } ],
    "obstacles": [ { "kind": "rock", "x": 0, "y": 0, "z": 0, "r": 2 } ]
  },
  "finish": 0,
  "backdrop": { "file": "backdrop.bin", "w": 0, "h": 0, "x0": 0, "z0": 0, "step": 60 }
}
```

- `course`: linea centrale del percorso della tappa, punti ogni ~10 m, `hw` mezza larghezza del letto
  in metri. Indici di `checkpoints`, `zones`, `finish`, `branches.from/to` si riferiscono a questi punti.
- `branches`: percorsi alternativi che lasciano il corso a `from` e rientrano a `to`. `kind` e' `shortcut`
  (piu' corto, cascate e salti) o `safe`.
- `zones.kind`: `ice` (alta quota, si congela), `sun` (evapora piu' in fretta), `rain` (nuvola che fa piovere
  gocce raccoglibili), `waterfall`.
- `height`: griglia di gioco ad alta risoluzione che copre il corridoio; il campionamento a runtime e' bilineare
  e uguale nel bake e in gioco (stessa funzione di `web-swing/tools/dem-lib.mjs`).
- `backdrop`: griglia grossolana delle montagne intorno, solo per il disegno.
- Il letto del fiume e' scavato nel terreno dal bake, cosi' la goccia ci scorre dentro seguendo la pendenza.

### Modalita' breve: tappe 1:1 collegate dalla nuvola

Decisione del 27/10/2026 (sostituisce la prima versione con le quote riscalate): **le montagne sono sempre in
scala reale 1:1, in pianta e in quota, con la morfologia vera.** Nessuna riscalatura, nessuna ricucitura.

Si gioca solo la parte ripida (decisione del 27/10/2026: "se e' pressoche' pianeggiante come il Piave non e'
piu' divertente"). La modalita' breve dura 3-5 minuti: a 25-35 m/s servono circa 6-8 km giocati in tutto. Il percorso e' una sequenza di **tappe**, ognuna un tratto
vero e continuo lungo 1-2 km, con il terreno attorno alle quote e nelle posizioni reali. Il bake sceglie le
tappe in automatico fra i tratti con piu' dislivello e pendenza lungo il corso d'acqua vero (vetta e nevaio,
canaloni, cascate, forra, torrente), e si ferma al **fondovalle**: il primo tratto in cui la pendenza media
scende sotto una soglia (per le Dolomiti la valle del Piave verso Sappada o il lago di Santa Croce, da
decidere sui dati). Niente pianura, laguna o mare giocati.

Fra una tappa e la successiva la goccia fa il **ciclo dell'acqua**: alla fine della tappa evapora, sale in
una nuvola, il cielo la porta a valle (transizione di 3-4 s con la telecamera in volo sopra il terreno vero
fra i due punti) e ricade come pioggia all'inizio della tappa successiva. Le due gocce restano in gara
durante la transizione: l'ordine e il distacco si conservano (chi arriva prima alla fine della tappa ricade
prima). La transizione e' anche il momento di caricamento della tappa dopo.
Aggiornamento 28/10/2026, dopo il primo playtest (secondi passati fermi in una nuvola parcheggiata, fino a 15 s per
tappa, e una goccia tagliata a 3 m dal traguardo): il distacco portato da una tappa all'altra arriva al massimo a 3 s
(`CLOUD.gapMax` in `src/game/race.js`), chi e' gia' arrivato aspetta l'altra al massimo 8 s (`CLOUD.wait`), e una
goccia che rotola a meno di 120 m dal traguardo quando il tempo scade ha fino a 10 s in piu' per passarlo (`FINALE`).
L'ordine resta; i secondi tolti sono la rimonta che la nuvola regala. Alla rivincita servono i due SCATTO.

Formato: `world.json` ha un campo `stages: [...]`; ogni tappa ha la sua griglia `height` ad alta
risoluzione (file separato per tappa), il suo `course`, i suoi indici (checkpoint, zone, rami, spawn, finish
locali alla tappa) e coordinate in un sistema locale con origine al punto di partenza della tappa, piu'
`origin` (lat, lon, quota) per collocarla nel mondo vero. Il `backdrop` grossolano copre tutto il tragitto
in coordinate globali per le montagne lontane e il volo della nuvola. La sim gioca una tappa alla volta.

Dati di elevazione: Copernicus GLO-30 ovunque come base; dove esiste un modello piu' fine e libero si usa
quello (swissALTI3D per la Svizzera, DTM regionali di Veneto e Trentino per le Dolomiti, da verificare
licenza e accesso). Dove la risoluzione e' 30 m si aggiunge dettaglio procedurale (massi, pareti di forra,
increspature del letto) sopra la forma vera, senza spostarla.

La modalita' reale (pezzo 2) e' tutta la parte ripida continua in 1:1, dalla vetta al fondovalle, senza
salti, con lo stesso formato e una sola tappa lunga caricata a pezzi.

## Contratto 3: simulazione

`src/sim/index.js` esporta `createSim(world, {mode: 'race', players: 2, seed})`. Nessun import da three:
la sim gira in node per i test e nel browser per il gioco. Deterministica a parita' di seed e input.

- `sim.step(dt, inputs)` con `dt = 1/60` fisso e `inputs[slot] = {x, y, boost}`.
- `sim.state`: `{ t, phase: 'countdown'|'race'|'done', players: [...], pickups: [...], animals: [...], events: [...] }`.
- Ogni giocatore: `{pos, vel, mass, radius, status: 'rolling'|'airborne'|'frozen'|'evaporated'|'finished', progress, lap, checkpoint, place, freeze, boostCooldown}`.
- `events` si svuota a ogni passo: `{kind: 'pickup'|'drink'|'freeze'|'thaw'|'evaporate'|'respawn'|'bump'|'steal'|'checkpoint'|'finish'|'splash', slot, ...}`.
  Il rendering li usa per effetti e il gioco li manda ai telefoni come `fx`.

### Meccaniche

- **Discesa**: la goccia e' spinta dalla gravita' lungo il gradiente del terreno, con attrito; nel letto del
  fiume scorre veloce, fuori dal letto rallenta molto. Il joystick sterza rispetto alla direzione del percorso
  (avanti = verso valle), non rispetto al mondo.
- **Massa**: la massa determina raggio (radice cubica), velocita' massima e peso negli urti. Si parte con
  massa 1. Gocce d'acqua sparse e la pioggia aumentano la massa (fino a 4).
- **Evaporazione**: perdita lenta continua, piu' rapida nelle zone `sun` e sulle rocce calde. Sotto massa 0,25
  la goccia evapora e riparte dall'ultimo checkpoint con massa 1, perdendo qualche secondo.
- **Ghiaccio**: nelle zone `ice` la goccia accumula `freeze` se va piano; a 1 diventa un cubetto e scivola
  senza sterzo finche' il giocatore non preme scatto piu' volte per romperlo.
- **Scatto**: il pulsante da' una spinta in avanti, costa un po' di massa, ricarica in 2 s.
- **Bivi**: ai `branches` il giocatore sceglie la strada sterzando. Le scorciatoie sono piu' corte ma hanno
  salti e cascate (fase `airborne`) e si rischia di uscire dal letto.
- **Animali**: vagano vicino al percorso. Se una goccia passa lenta entro il loro raggio, si avvicinano e
  bevono (perdita di massa a sorsi, evento `drink`). Scattare via li interrompe. Specie e regole sotto.

### Animali: specie vere, stile del gioco

Requisito del 27/10/2026: ogni montagna ha **solo animali che vivono davvero li'**, alla quota della tappa in
cui compaiono (spawn per fascia di quota). La lista definitiva di ogni montagna si verifica su fonti
(parchi nazionali, IUCN) quando la montagna entra nel gioco; quella sotto e' la prima stesura.

| Montagna | Specie |
|---|---|
| Dolomiti, Monte Peralba (pezzo 1) | marmotta alpina, stambecco, camoscio, aquila reale (in volo), gracchio alpino, lepre variabile, mucche al pascolo in fondovalle |
| Alpi svizzere | stambecco, camoscio, marmotta, gipeto, pernice bianca, mucca bruna col campanaccio |
| Carpazi | camoscio dei Carpazi, orso bruno, lince, lupo, cervo, pecore della stana col cane pastore |
| Everest, versante Nepal | yak, leopardo delle nevi, tahr dell'Himalaya, panda rosso (boschi bassi), danfe (monal) |
| K2, Baltoro | stambecco siberiano, leopardo delle nevi, orso bruno himalayano, pika, gipeto |
| Indonesia | dipende dal vulcano scelto: Rinjani macachi e gufo di Rinjani; Semeru lutung e aquila di Giava; Kerinci tigre di Sumatra e tapiro. Niente oranghi fuori da Sumatra e Borneo |

Stile: specie riconoscibile (proporzioni, corna, mantello e disegni giusti), resa nel linguaggio Cartoon
premium: sfaccettature, palette calda, contorni, proporzioni appena addolcite. A runtime ogni animale riceve
lo **stesso materiale cartoon** del resto del mondo (colori campionati dalla texture originale e quantizzati
sulla palette), cosi' modelli di fonti diverse sembrano dello stesso gioco. Animazioni minime: fermo,
cammina, beve; uccelli: vola, plana.

Fonti, solo gratuite (decisione del 27/10/2026): modelli CC0 o CC-BY (Quaternius, Kenney, Poly Pizza,
Sketchfab CC0/CC-BY), crediti in `assets/CREDITS.md`. Una specie che manca **non si sostituisce con una
simile e non si costruisce con primitive**: si ricava da un modello gratuito della stessa forma (un caprino
per stambecco, camoscio, tahr, markhor; un grande felino per leopardo delle nevi e tigre; un galliforme per
danfe e pernice) modificato in Blender headless (corna, orecchie, coda, mantello e disegni), installato con
Homebrew quando serve. Se nemmeno cosi' viene bene, la specie resta fuori finche' non c'e' un modello
all'altezza.
- **Interazione**: urti fra le gocce con massa; uno scatto contro l'altra goccia ruba massa (`steal`).
- **Fuori percorso**: se una goccia resta lontana dal corso per 3 s riparte dall'ultimo checkpoint.
- **Arrivo**: chi raggiunge il fondovalle (indice `finish` dell'ultima tappa, uno specchio d'acqua o un
  traguardo sul torrente a valle) finisce; `place` 1 o 2. Il secondo ha 30 s per arrivare.
- **Ciclo dell'acqua** (base): la partenza e' un fiocco di neve che si scioglie in goccia; all'arrivo la
  goccia evapora in una nuvola. Il ciclo completo e' il pezzo 4.

## Stile

Tre direzioni da mockup renderizzati sulla stessa scena (Dolomiti vere, schermo diviso, due gocce, una
marmotta), tutte con un livello alto di qualita':

1. **Cartoon premium**: terreno sfaccettato a colori pieni, illuminazione morbida con occlusione ambientale,
   contorni leggeri, acqua stilizzata brillante. Riferimento di qualita': Tiny Glade, Alba.
2. **Illustrato**: pittorico, palette calda, bordi morbidi, cielo dipinto.
3. **Realistico stilizzato**: materiali fisici, atmosfera e foschia, acqua con riflessi, colori piu' saturi del
   vero.

**Scelta il 27/10/2026: direzione 1, Cartoon premium.** Riferimento visivo: la fila in alto di
`docs/mockups/gemini-reference-3-stili.png` (generata con Gemini): terreno a sfaccettature in fasce di colore
pieno, vetta dolomitica rosa al tramonto con neve, abeti e larici, prati verde acido, torrente azzurro con
schiuma bianca ai bordi, gocce con occhioni. Il mockup Three.js in `mockups/cartoon/` e' la base tecnica.
Ritaglio della sola fila Cartoon: `docs/mockups/gemini-reference-cartoon.png`.

Indicazioni del proprietario sui primi mockup (27/10/2026):
- Il riferimento e' **morbido**: prati come colline arrotondate con solo un accenno di sfaccettature, fiume e
  argini a curve che scorrono, ombre morbide, contorni scuri sottili. I nostri erano "spigolosi, dritti, rigidi".
- Gli animali devono essere tondi e morbidi, con la sagoma della specie chiara: la prima marmotta (un ratto
  deformato) sembrava un castoro squadrato.
- **Sfondo stilizzato, percorso vero** (scelto il 27/10/2026): dove si corre il terreno resta vero 1:1. Le
  cime lontane restano nella posizione e alla quota vere, ma pareti piu' verticali, guglie e canaloni lungo le
  creste vere e un grembiule di neve pulito le fanno leggere come il massiccio del riferimento. Il DEM a 30 m
  non risolve le guglie vere delle Dolomiti, quindi lo sfondo vero da solo resta un muro largo.

## Schermo e telecamere

Schermo diviso **affiancato** (sinistra slot 0, destra slot 1): con una telecamera da inseguimento in
discesa serve piu' altezza che larghezza. Una sola scena, un renderer, due viewport con scissor.
Quando un solo telefono e' collegato la vista occupa tutto lo schermo. In attesa dei giocatori lo schermo
mostra la montagna, il QR e gli slot.

Regia (28/10/2026, `src/game/view.js` e `src/main.js`): a ogni partenza il dipinto della vetta a tutto schermo per
1,6 s col nome della montagna e della prima tappa (ogni percorso parte dalla vetta, quindi una telecamera in 3D che
guarda indietro vedrebbe solo il bordo della cima e il cielo vuoto), poi dissolve nell'inquadratura 3D alta dietro le
gocce che guarda verso valle, e la gru scende nella telecamera di gara durante il conto alla rovescia. Alla fine di
ogni tappa, mentre la goccia evapora e aspetta l'altra, la telecamera della nuvola sale di 160 m, si sposta piu' in
basso sul pendio e si gira verso la vetta vera (la montagna appena scesa riempie l'inquadratura, non un muro di neve a
pochi metri), e torna verso valle nella prima parte del volo, prima del velo che cambia tappa (su un salto breve,
sotto il velo). Lo schermo dei
risultati ha dietro il dipinto della vetta del mondo appena corso.

## Errori

- Telefono che si disconnette: la sua goccia rallenta e si ferma, lo schermo mostra "in attesa di
  <colore>"; la riconnessione con lo stesso id riprende la goccia.
- Server non raggiungibile dal telefono: la pagina del gioco mostra l'URL esatto e ricorda di stare sulla
  stessa rete.
- Bake: se Overpass non risponde si usa l'estratto Geofabrik (`nord-est` Italia) con osmium, come in Web Swing.

## Test

- `node --test`: protocollo e assegnazione dei posti del server (con client `ws` veri), riconnessione,
  stanza piena; sim deterministica su un mondo sintetico (discesa, massa, evaporazione, ghiaccio, animali,
  urti, bivi, arrivo, respawn); bake: ogni tappa scende in modo monotono, le quote coincidono col DEM vero, gli indici sono
  validi, il campionamento coincide fra bake e runtime.
- Nel browser con playwright: due pad simulati, una gara giocata da un bot fino al fondovalle, fps misurati a
  schermo diviso, screenshot.
- Verifica finale a mano: due telefoni veri sulla rete di casa.
