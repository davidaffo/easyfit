# Easyfit Catalog Editor

Strumento esclusivamente locale per revisionare il dataset Wger senza aggiungere codice o dipendenze alla PWA di produzione.

1. Avvia `npm run catalog:editor`.
2. Apri `http://127.0.0.1:4178`.
3. Cerca o filtra per stato, lingua, attrezzatura, muscolo, categoria, tipo, pattern, immagine e qualità della guida; abilita o disabilita l'esercizio e compila i metadati espliciti.
4. Salva, quindi usa **Sync Wger + genera** per scaricare le immagini disponibili e rigenerare catalogo, guide e indice offline.
5. Esegui `npm test` prima di committare i file generati.

Le modifiche dichiarative finiscono in `scripts/catalog-overrides.json`; il registro storico in `scripts/curated-exercises.mjs` resta la base. Ogni salvataggio crea inoltre una copia recuperabile in `/tmp`. Il server ascolta solo su loopback, convalida gli ID e i metadati e non è importato dal bundle Vite.

## Criteri di revisione

Mantieni le alternative che cambiano esecuzione, appoggio o attrezzatura: per esempio rematore in piedi, con un braccio su panca e con petto appoggiato; panca piana e inclinata; curl supinato e hammer curl. `executionVariant` nel registro distingue esecuzioni utili con lo stesso pattern e la stessa attrezzatura, evitando che la deduplicazione le confonda. Non aggiungere copie dello stesso esercizio con nomi, lati, pesi nominali o lievi differenze di presa diversi. Il box squat resta escluso per scelta dell'utente; lo squat libero a corpo libero ne copre l'opzione di base.

Controlla insieme nome, guida, immagine, appoggi richiesti e carico. Il rematore a un braccio richiede la panca e conta un manubrio; quello bilaterale in piedi conta due manubri. Una guida testuale completa è sufficiente per includere un esercizio utile: l'assenza dell'immagine non è motivo di esclusione. Le immagini esterne entrano nella PWA solo dopo essere state scaricate da Sync Wger.

**Genera catalogo** usa soltanto i dati già presenti in locale. L'immagine è opzionale: una guida testuale valida può entrare nel catalogo e rimane apribile nel workout. Se aggiungi un'immagine esterna, copiala sotto `public/exercise-images`, indica autore, fonte e licenza nell'editor e usa il percorso `/exercise-images/...`. Non importare file trovati online senza una licenza esplicita compatibile.
