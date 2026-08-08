# Easyfit

PWA mobile-first per generare e registrare workout personali con il minimo numero di scelte.

## Avvio

```bash
npm install
npm run dev
```

Build di produzione:

```bash
npm run build
npm run preview
```

Verifica del motore:

```bash
npm test
```

## Come viene generato un workout

Il motore locale separa due decisioni:

1. **Exercise selector** — filtra per attrezzatura e split, poi combina recupero stimato, volume e frequenza degli ultimi sette giorni, equilibrio dei pattern, familiarità, preferenze e storico recente.
2. **Prescription** — sceglie serie, ripetizioni, RIR target, recupero e carico usando obiettivo, livello ed e1RM personale.

I **Focus exercises** sono tre movimenti principali persistenti (spinta, tirata e parte inferiore). Quando uno è compatibile con i muscoli del giorno viene messo per primo. Non esistono fasi “tecnica/incremento/test”: la progressione è continua e usa lo stesso calcolo basato sulle serie realmente registrate.

I riferimenti di programmazione sono il [position stand ACSM 2026](https://pubmed.ncbi.nlm.nih.gov/41843416/) e le [raccomandazioni IUSCA per l’ipertrofia](https://doi.org/10.47206/ijsc.v1i1.81). Il recupero resta una stima orientativa, non una misura fisiologica o medica.

## Carico, ripetizioni e RIR

- La prima volta che compare un esercizio con carico esterno, Easyfit chiede il peso all’utente: non esistono kg iniziali predefiniti.
- Ogni serie conserva separatamente ripetizioni e peso prescritti e valori realmente eseguiti. Il RIR viene chiesto una sola volta, al completamento dell’esercizio, ma resta modificabile su qualsiasi serie.
- La calibrazione privilegia le serie con un RIR realmente inserito; non inventa un RIR per tutte le altre serie.
- La capacità della serie è stimata come `ripetizioni + RIR`.
- L’e1RM usa Brzycki fino a 10 ripetizioni equivalenti ed Epley oltre 10, dove Brzycki diventa instabile.
- Il carico successivo deriva dall’e1RM e dall’intensità dell’obiettivo, con variazione limitata a circa ±7,5% per sessione e arrotondamento all’incremento utilizzabile.
- Per corpo libero ed elastici vengono adattate le ripetizioni, non viene inventato un carico in kg.
- RIR, ripetizioni effettive, serie completate e tipo di esercizio contribuiscono anche alla fatica stimata.

## Catalogo esercizi

Il catalogo è uno snapshot normalizzato dell’API inglese di [wger](https://wger.de), aggiornato manualmente durante lo sviluppo. L’app non sincronizza dati a runtime e non effettua chiamate all’API wger. Gli ID e i nomi inglesi restano stabili; l’eventuale traduzione italiana viene conservata separatamente e l’app torna automaticamente all’inglese quando manca.

Per aggiornare manualmente gli snapshot durante lo sviluppo:

```bash
npm run sync:wger
```

Il comando è solo uno strumento di sviluppo e non viene incluso nel bundle della PWA. Al termine ricostruisce automaticamente anche il `dist`; con un server di sviluppo o una PWA già aperta basta quindi ricaricare la pagina.

Gli snapshot inclusi sono:

- `src/generated/wger-exercises.json`: indice leggero usato dal generatore;
- `src/generated/wger-exercise-details.json`: descrizioni incorporate nell’app;
- `public/exercise-images/`: immagini scaricate localmente durante la sync e precaricate dalla PWA per l’uso offline.

Il ranking favorisce i movimenti fondamentali, ma mantiene le varianti wger disponibili per l’evoluzione della ricerca e della sostituzione esercizi. Licenza e autore vengono conservati per ciascuna voce.

## Funzioni incluse

- onboarding in tre passaggi;
- generazione per recupero, split, durata e attrezzatura;
- calibrazione del primo carico ed e1RM progressivo;
- sostituzione di un esercizio con uno compatibile;
- menu esercizio con lista ricercabile di sostituzioni compatibili, rimozione dal workout o esclusione permanente ripristinabile;
- refresh dell’intero workout mantenendo durata, muscoli target e focus compatibile;
- Focus exercises persistenti, modificabili e senza fasi artificiali;
- registrazione modificabile di serie, ripetizioni, peso e RIR;
- volume e frequenza settimanali per gruppo muscolare;
- nomi inglesi canonici con traduzione italiana opzionale;
- immagine visibile nel workout quando disponibile e guida wger apribile con istruzioni inglesi e attribuzione;
- timer di recupero;
- cronologia generale, storico del singolo esercizio con trend e stato di recupero;
- menu Impostazioni completo e reset confermato di profilo, storico, workout e preferenze locali;
- installazione PWA e uso offline.

Tutti i dati utente restano in `localStorage` in questa versione MVP.
