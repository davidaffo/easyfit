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

La build viene generata in `docs/`, pronta per GitHub Pages. Nelle impostazioni
del repository seleziona **Deploy from a branch**, il branch desiderato e la
cartella **/docs**.

Verifica del motore:

```bash
npm test
```

## Come viene generato un workout

Il motore locale v6 separa due decisioni:

1. **Exercise selector** — filtra per attrezzatura, split e preferenze globali. In modalità adattiva sceglie 2, 3 o 4 famiglie di movimento in base ai minuti disponibili e ruota spinta, tirata, dominante di ginocchio e dominante d’anca usando deficit, recupero e storico reale. Non chiede quanti giorni a settimana l’utente intenda allenarsi. Gli slot restanti dipendono da volume e frequenza degli ultimi sette giorni, prontezza stimata, preferenze e storico recente.
2. **Prescription** — distribuisce il volume settimanale sulle esposizioni ancora necessarie e applica una doppia progressione individuale a serie, ripetizioni, RIR, recupero e carico.

Il volume usa un conteggio frazionario: una serie vale `1` per il muscolo primario e `0,5` per i muscoli secondari. Un contatto indiretto conta come esposizione solo quando raggiunge almeno una serie equivalente nella stessa sessione. I target non sono massimali: per l’ipertrofia partono da 7, 10 o 12 serie equivalenti settimanali per principianti, intermedi ed esperti e vengono distribuiti sulle esposizioni mancanti. Una sessione adattiva iniziale non interpreta più “tutti recuperati” come “allena tutto”: seleziona un sottoinsieme coerente e lascia alle sessioni successive la rotazione delle famiglie omesse. Dopo più di dieci giorni di pausa attiva inoltre un rientro graduale con massimo due serie per esercizio.

La durata impone anche un tetto semplice al numero di esercizi: massimo 3 fino a 30 minuti, 6 a 45 minuti, 7 a 60 minuti e 8 oltre i 60. La stima include cinque minuti iniziali, tempi di esecuzione e recuperi prescritti.

La prontezza stimata non pretende di misurare il recupero biologico. È un indicatore interno che decresce con volume, vicinanza al cedimento e sovraperformance nelle ripetizioni; quando è bassa limita le serie e abbassa la priorità del distretto, senza modificare di nascosto il RIR scelto o trasformare automaticamente il programma in una bro split.

I **Focus exercises** sono tre movimenti principali persistenti (spinta, tirata e parte inferiore). Quando uno è compatibile con i muscoli del giorno viene messo per primo. Il ciclo predefinito dura quattro esecuzioni effettivamente completate — circa un mese per un focus eseguito una volta a settimana — quindi passa automaticamente a un esercizio compatibile della stessa famiglia. La durata resta configurabile tra 2 e 8 esposizioni. Non esistono fasi “tecnica/incremento/test”: la progressione è continua e usa lo stesso calcolo basato sulle serie realmente registrate.

Le regole derivano dal [position stand ACSM 2026](https://pubmed.ncbi.nlm.nih.gov/41843416/), dalla [meta-regressione dose-risposta su volume e frequenza](https://pubmed.ncbi.nlm.nih.gov/41343037/), dalla [meta-analisi full body vs split](https://pubmed.ncbi.nlm.nih.gov/38595233/) e dalle [meta-regressioni sulla prossimità al cedimento](https://pubmed.ncbi.nlm.nih.gov/38970765/). La letteratura non dimostra che una split sia intrinsecamente superiore a parità di volume: Easyfit usa la multifrequenza per distribuire meglio il lavoro, mantenere alta la qualità delle serie e non lasciare un gruppo scoperto per un’intera settimana.

La doppia progressione è una scelta operativa semplice, non una presunta superiorità fisiologica: studi controllati mostrano che [progredire nelle ripetizioni o nel carico](https://pubmed.ncbi.nlm.nih.gov/36199287/) produce adattamenti simili, con un possibile piccolo vantaggio specifico della progressione di carico per la forza. Per il RIR, [1–2 RIR e cedimento hanno prodotto ipertrofia simile](https://pubmed.ncbi.nlm.nih.gov/38393985/) nello studio disponibile, mentre il cedimento ha causato più perdita di ripetizioni e fatica acuta.

## Carico, ripetizioni e RIR

- La prima volta che compare un esercizio con carico esterno, Easyfit chiede il peso all’utente: non esistono kg iniziali predefiniti.
- Ogni esercizio ha un intervallo sensato per l’obiettivo: forza `3–6` o `6–10`, ipertrofia `8–12` o `10–15`, forma fisica `10–15` o `12–20`, distinguendo multiarticolari e accessori.
- La doppia progressione mantiene il peso e aggiunge al massimo una ripetizione target per sessione. Quando la capacità registrata raggiunge il limite alto al RIR scelto, aumenta del minimo disponibile (`2,5 kg` per bilanciere/macchine, `1 kg` per manubrio o kettlebell) e riparte dal limite basso.
- Ogni serie conserva separatamente ripetizioni e peso prescritti e valori realmente eseguiti. Il RIR viene chiesto una sola volta, al completamento dell’esercizio, ma resta modificabile su qualsiasi serie.
- Il RIR target globale è selezionabile da `0` a `4+`; un singolo esercizio può sovrascriverlo. Il motore rispetta il valore scelto senza correggerlo di nascosto, mentre continua a ridurre il volume quando la prontezza è bassa.
- Dal menu dell’esercizio si possono impostare massimo serie e limiti minimo/massimo di ripetizioni. I tetti globali predefiniti sono 3 serie per i multiarticolari e 4 per gli accessori, entrambi modificabili dalle impostazioni.
- La calibrazione privilegia le serie con un RIR realmente inserito; non inventa un RIR per tutte le altre serie.
- La capacità della serie è stimata come `ripetizioni + RIR`.
- L’e1RM usa Brzycki fino a 10 ripetizioni equivalenti ed Epley oltre 10, dove Brzycki diventa instabile.
- L’e1RM rimane una metrica di storico e calibrazione; dopo il primo carico la progressione operativa usa peso, ripetizioni e RIR realmente registrati.
- Alla prima comparsa di un esercizio a corpo libero viene chiesto il massimo di ripetizioni pulite; la prima prescrizione sottrae il RIR target e rispetta il limite di ripetizioni dell’esercizio.
- Per corpo libero ed elastici vengono adattate le ripetizioni, non viene inventato un carico in kg.
- RIR, ripetizioni effettive, serie completate e tipo di esercizio contribuiscono anche alla fatica stimata.

## Catalogo esercizi

Il catalogo è uno snapshot normalizzato dell’API inglese di [wger](https://wger.de), aggiornato manualmente durante lo sviluppo. L’app non sincronizza dati a runtime e non effettua chiamate all’API wger. Gli ID e i nomi inglesi restano stabili; l’eventuale traduzione italiana viene conservata separatamente e l’app torna automaticamente all’inglese quando manca.

Per aggiornare manualmente gli snapshot durante lo sviluppo:

```bash
npm run sync:wger
```

Il comando è solo uno strumento di sviluppo e non viene incluso nel bundle della PWA. Al termine ricostruisce automaticamente anche `docs/`; con un server di sviluppo o una PWA già aperta basta quindi ricaricare la pagina.

Gli snapshot inclusi sono:

- `src/generated/wger-exercises.json`: indice leggero usato dal generatore;
- `src/generated/wger-exercise-details.json`: descrizioni incorporate nell’app;
- `public/exercise-images/`: immagini scaricate localmente durante la sync e precaricate dalla PWA per l’uso offline.

Il ranking favorisce i movimenti fondamentali, ma mantiene le varianti wger disponibili per l’evoluzione della ricerca e della sostituzione esercizi. Licenza e autore vengono conservati per ciascuna voce.

## Backup locale e Nextcloud

Da **Impostazioni → Backup e cloud** si può:

- esportare un JSON versionato contenente profilo, preferenze, limiti esercizi, storico e workout in corso;
- importare un backup locale, validato prima della conferma e della sostituzione dei dati;
- caricare o ripristinare `easyfit-backup.json` direttamente da una cartella Nextcloud tramite WebDAV.

Per un account Nextcloud normale si usa l’URL mostrato in **File → Impostazioni WebDAV**, per esempio `https://cloud.example.com/remote.php/dav/files/USERNAME/Easyfit/`, insieme a username e app password. Le condivisioni pubbliche scrivibili recenti usano `/public.php/dav/files/TOKEN`; se sono protette, si usa `anonymous` come username e la password della condivisione. URL e username vengono salvati nel profilo; la password resta solo nella memoria della schermata, viene rimossa anche da backup importati e non finisce mai in `localStorage` o nel JSON esportato.

La sincronizzazione è esplicita: **Carica / sovrascrivi** usa `PUT`, mentre **Ripristina dal cloud** usa `GET` e richiede conferma prima di sostituire i dati locali. Essendo una PWA statica, una Nextcloud su un dominio differente deve consentire dal browser le richieste WebDAV/CORS provenienti dal dominio dell’app; in caso contrario import ed export locali continuano a funzionare senza configurazioni server.

## Funzioni incluse

- onboarding in tre passaggi senza previsione artificiale dei giorni settimanali;
- generazione per prontezza stimata, volume frazionario, frequenza misurata, split, durata e attrezzatura;
- multifrequenza adattiva con 2–4 famiglie per sessione e rotazione basata sullo storico reale;
- calibrazione del primo carico, delle ripetizioni massime a corpo libero ed e1RM progressivo;
- filtri globali per corpo libero ridondante, addominali diretti e polpacci, più esclusione automatica dei movimenti ibridi/olimpici dalla modalità Massa;
- rientro graduale automatico dopo oltre dieci giorni di pausa;
- sostituzione di un esercizio con uno compatibile;
- menu esercizio con lista ricercabile di sostituzioni compatibili, rimozione dal workout o esclusione permanente ripristinabile;
- refresh dell’intero workout mantenendo durata, muscoli target e focus compatibile;
- Focus exercises a cicli configurabili, con rotazione automatica dopo quattro esecuzioni per impostazione predefinita;
- registrazione modificabile di serie, ripetizioni, peso e RIR;
- volume e frequenza settimanali per gruppo muscolare;
- nomi inglesi canonici con traduzione italiana opzionale;
- immagine visibile nel workout quando disponibile e guida wger apribile con istruzioni inglesi e attribuzione;
- timer di recupero;
- area Progressi con riepilogo settimanale dei focus, schede Forza, Volume, Record e Attività, più storico del singolo esercizio;
- menu Impostazioni completo e reset confermato di profilo, storico, workout e preferenze locali;
- backup JSON con import/export e upload/ripristino Nextcloud WebDAV senza persistenza della password;
- installazione PWA e uso offline.

Tutti i dati utente restano in `localStorage` per impostazione predefinita. Vengono inviati fuori dal dispositivo solo quando l’utente esporta un file o preme esplicitamente **Carica / sovrascrivi** nel pannello Nextcloud.
