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

Il motore locale v15 separa due decisioni:

1. **Exercise selector** — filtra per attrezzatura e preferenze globali. Soltanto gli ID Wger presenti nel registro revisionato manualmente possono entrare nel generatore: non esiste classificazione tramite parole nel nome. Ogni esercizio approvato deve avere già nel bundle guida inglese e immagine locale. Il Catalogo essenziale usa un solo rappresentante per famiglia wger, pattern e attrezzatura, evitando che pause, prese o angoli appena diversi affollino la generazione. Il motore adattivo sceglie fino a una famiglia upper e una lower realmente pronte, in base al debito reale; i pattern ruotano indipendentemente. Le sedute più lunghe aumentano serie e accessori senza privilegiare strutturalmente l’upper body. Non esistono split selezionabili e non viene chiesto quanti giorni a settimana l’utente intenda allenarsi.
2. **Prescription** — distribuisce il volume del ciclo mobile sulle esposizioni ancora necessarie e applica una doppia progressione individuale a serie, ripetizioni, RIR, recupero e carico.

Il volume usa serie equivalenti senza falsa precisione: una serie vale `1` per il muscolo direttamente allenato e `0,5` per un sinergista significativo. Stimolo produttivo, aderenza alla prescrizione e fatica sono tre segnali distinti: andare a cedimento non sottrae stimolo, ma aumenta la fatica. Per l’ipertrofia il target iniziale è 8 serie equivalenti e può adattarsi persistentemente nel range 6–10. Un miglioramento conferma la dose corrente; l'aumento richiede invece almeno tre esposizioni primarie, aderenza alta, recupero adeguato, un plateau misurabile e almeno 21 giorni dall'ultima variazione. Lo stimolo vale interamente per sette giorni e sfuma fino al decimo, evitando il salto artificiale di una finestra rigida. La priorità combina deficit di volume, una frequenza pesata in modo diverso per obiettivo, tempo dall’ultimo stimolo e recupero. Dopo più di dieci giorni di pausa si attiva un rientro graduale con massimo due serie per esercizio.

La durata impone anche un tetto semplice al numero di esercizi: massimo 3 fino a 30 minuti, 6 a 45 minuti, 7 a 60 minuti e 8 oltre i 60. La stima include sette minuti iniziali, setup per ogni esercizio, tempi di esecuzione e recuperi prescritti.

La composizione limita anche la fatica sistemica: fino a 30 minuti usa normalmente 2 multiarticolari e 1 accessorio; sotto i 60 minuti non supera 2 multiarticolari e da 60 minuti non supera 3. Ogni prescrizione viene ridotta o esclusa prima dell'inserimento se non entra nel budget, con una tolleranza massima di due minuti. Il carico pianificato viene aggiornato dopo ogni scelta, così gli accessori non ignorano lo stimolo già assegnato dai multiarticolari. Se cambia un’impostazione che influenza la prescrizione — obiettivo, livello, RIR, attrezzatura, carichi disponibili, durata, filtri o limiti — la scheda pronta viene rigenerata automaticamente. Lingua e configurazione del backup non la invalidano; un workout già aperto non viene sostituito durante l’esecuzione.

La prontezza stimata non pretende di misurare il recupero biologico. È arrotondata a passi di 5 e decresce con volume, vicinanza al cedimento e sovraperformance nelle ripetizioni; sotto la soglia di sicurezza esclude il movimento dalla generazione adattiva, senza modificare di nascosto il RIR scelto. Nella schermata Recupero l’utente può indicare “più affaticato” o “più fresco” per ogni gruppo: la correzione entra nel ranking e si dimezza automaticamente ogni 24 ore.

Non esistono più Focus exercises configurabili. Il ranking mantiene automaticamente lo stesso esercizio per le prime quattro esposizioni consecutive dello stesso pattern, finché recupero, volume, filtri e attrezzatura lo rendono appropriato. In seguito il vantaggio di continuità decade e una variante può entrare naturalmente. Lo storico e le schede Progressi seguono gli esercizi ricorrenti ricavati dai dati reali, senza stato parallelo da sincronizzare.

Le regole derivano dal [position stand ACSM 2026](https://pubmed.ncbi.nlm.nih.gov/41843416/), dalla [meta-regressione dose-risposta su volume e frequenza](https://pubmed.ncbi.nlm.nih.gov/41343037/), dalla [meta-analisi full body vs split](https://pubmed.ncbi.nlm.nih.gov/38595233/) e dalle [meta-regressioni sulla prossimità al cedimento](https://pubmed.ncbi.nlm.nih.gov/38970765/). La letteratura non dimostra che una split sia intrinsecamente superiore a parità di volume: Easyfit usa la multifrequenza per distribuire meglio il lavoro, mantenere alta la qualità delle serie e non lasciare un gruppo scoperto per un’intera settimana.

La doppia progressione è una scelta operativa semplice, non una presunta superiorità fisiologica: studi controllati mostrano che [progredire nelle ripetizioni o nel carico](https://pubmed.ncbi.nlm.nih.gov/36199287/) produce adattamenti simili, con un possibile piccolo vantaggio specifico della progressione di carico per la forza. Per il RIR, [1–2 RIR e cedimento hanno prodotto ipertrofia simile](https://pubmed.ncbi.nlm.nih.gov/38393985/) nello studio disponibile, mentre il cedimento ha causato più perdita di ripetizioni e fatica acuta.

## Carico, ripetizioni e RIR

- La prima volta che compare un esercizio con carico esterno, Easyfit chiede il peso all’utente: non esistono kg iniziali predefiniti.
- Ogni esercizio ha un intervallo sensato per l’obiettivo: forza `3–6` o `6–10`, ipertrofia `8–12` o `10–15`, forma fisica `10–15` o `12–20`, distinguendo multiarticolari e accessori.
- La doppia progressione mantiene il peso e aggiunge al massimo una ripetizione target per sessione. Quando la capacità registrata raggiunge il limite alto al RIR scelto, usa il più piccolo carico superiore dichiarato dall’utente e riparte dal limite basso. Se il salto disponibile supera il 10%, mantiene peso e ripetizioni invece di forzarlo.
- Se un peso già eseguito viene rimosso dall’inventario, sceglie un carico disponibile inferiore e mantiene le ripetizioni; non aumenta mai peso e ripetizioni nello stesso passaggio. Se esistono soltanto salti superiori non sicuri, richiede una nuova calibrazione.
- In onboarding e Impostazioni si indicano i kg realmente disponibili per manubrio, kettlebell, bilanciere/EZ, macchine e cavi; si possono usare i preset o aggiungere valori personalizzati.
- Ogni serie conserva separatamente ripetizioni e peso prescritti e valori realmente eseguiti. Il RIR viene chiesto una sola volta, al completamento dell’esercizio, ma resta modificabile su qualsiasi serie.
- Il RIR target globale è selezionabile da `0` a `4+`; un singolo esercizio può sovrascriverlo. Il motore rispetta il valore scelto senza correggerlo di nascosto, mentre continua a ridurre il volume quando la prontezza è bassa.
- Dal menu dell’esercizio si possono impostare massimo serie e limiti minimo/massimo di ripetizioni. I tetti globali predefiniti sono 3 serie per i multiarticolari e 4 per gli accessori, entrambi modificabili dalle impostazioni.
- La progressione considera tutte le serie completate. Se il RIR viene inserito soltanto alla fine, per le altre serie usa il RIR target già prescritto; non scarta i dati precedenti.
- Il carico sale soltanto quando almeno l’80% delle serie è completato e anche la prestazione più debole sostiene il limite alto al RIR target. Una singola serie eccezionale non nasconde le altre.
- L’e1RM usa Brzycki fino a 10 ripetizioni equivalenti ed Epley oltre 10, dove Brzycki diventa instabile.
- L’e1RM rimane una metrica di storico e calibrazione; dopo il primo carico la progressione operativa usa peso, ripetizioni e RIR realmente registrati.
- Alla prima comparsa di un esercizio a corpo libero viene chiesto il massimo di ripetizioni pulite; la prima prescrizione sottrae il RIR target e rispetta il limite di ripetizioni dell’esercizio.
- Per corpo libero ed elastici vengono adattate le ripetizioni, non viene inventato un carico in kg.
- RIR, ripetizioni effettive, serie completate e tipo di esercizio contribuiscono anche alla fatica stimata.

## Catalogo esercizi

Il catalogo è uno snapshot statico curato a partire dall’API inglese di [wger](https://wger.de), aggiornato manualmente durante lo sviluppo. L’app non sincronizza dati a runtime, non effettua chiamate all’API wger e non classifica esercizi dal testo: importa pattern, muscoli frazionari, attrezzatura, tipo di carico ed eleggibilità già materializzati nel JSON. Gli ID e i nomi inglesi restano stabili; l’eventuale traduzione italiana viene conservata separatamente.

Per aggiornare manualmente gli snapshot durante lo sviluppo:

```bash
npm run sync:wger
```

Il comando è solo uno strumento di sviluppo e non viene incluso nel bundle della PWA. Al termine ricostruisce automaticamente anche `docs/`; con un server di sviluppo o una PWA già aperta basta quindi ricaricare la pagina.

Gli snapshot inclusi sono:

- `src/generated/wger-exercises.json`: snapshot sorgente wger;
- `src/generated/exercise-catalog.json`: catalogo statico curato usato dal generatore;
- `src/generated/wger-exercise-details.json`: snapshot completo delle descrizioni usato solo durante lo sviluppo;
- `src/generated/exercise-details.json`: guide degli esercizi approvati incorporate nell’app;
- `public/exercise-images/`: immagini scaricate localmente durante la sync e precaricate dalla PWA per l’uso offline.

Il ranking favorisce i movimenti fondamentali. I record Wger non approvati restano negli snapshot sorgente per consultazione e sviluppo, ma non vengono più inseriti nel bundle runtime. Licenza e autore vengono conservati per ciascuna voce approvata.

## Backup locale e Nextcloud

Da **Impostazioni → Backup e cloud** si può:

- esportare un JSON versionato contenente profilo, preferenze, limiti esercizi, storico e workout in corso;
- importare un backup locale, validato prima della conferma e della sostituzione dei dati;
- caricare o ripristinare `easyfit-backup.json` direttamente da una cartella Nextcloud tramite WebDAV.

Per un account Nextcloud normale si usa l’URL mostrato in **File → Impostazioni WebDAV**, per esempio `https://cloud.example.com/remote.php/dav/files/USERNAME/Easyfit/`, insieme a username e app password. Le condivisioni pubbliche scrivibili recenti usano `/public.php/dav/files/TOKEN`; se sono protette, si usa `anonymous` come username e la password della condivisione. L’app password non viene salvata: resta in memoria soltanto finché il pannello Nextcloud è aperto e non entra mai nel JSON esportato.

**Carica / sovrascrivi** usa `PUT`, mentre **Ripristina dal cloud** usa `GET` e richiede conferma prima di sostituire i dati locali. Non esistono sincronizzazione, merge o upload in background: entrambe le operazioni partono esclusivamente dai pulsanti del pannello. WebDAV richiede HTTPS, salvo server locali. Essendo una PWA statica, una Nextcloud su un dominio differente deve consentire dal browser le richieste WebDAV/CORS provenienti dal dominio dell’app; in caso contrario import ed export locali continuano a funzionare senza configurazioni server.

## Funzioni incluse

- onboarding in tre passaggi senza previsione artificiale dei giorni settimanali;
- generazione esclusivamente adattiva per prontezza stimata, volume frazionario, frequenza misurata, durata e attrezzatura;
- rigenerazione automatica della scheda pronta quando cambiano le impostazioni di allenamento;
- sessione iniziata persistente: può essere messa in pausa tornando alla navigazione, ripresa dalla home oppure scartata con conferma; sopravvive anche al reload della PWA;
- equilibrio per durata tra multiarticolari prioritari e accessori mirati;
- multifrequenza adattiva con massimo una famiglia upper e una lower per sessione e rotazione basata sullo storico reale;
- calibrazione del primo carico, delle ripetizioni massime a corpo libero ed e1RM progressivo;
- filtri globali per corpo libero ridondante, addominali diretti e polpacci, più registro esplicito che esclude movimenti ibridi, olimpici o ambigui da ogni generazione;
- Catalogo essenziale attivo di default; le microvarianti restano ricercabili e apribili esplicitamente nella sostituzione;
- rientro graduale automatico dopo oltre dieci giorni di pausa;
- sostituzione di un esercizio con uno compatibile;
- menu esercizio con lista ricercabile di sostituzioni compatibili, rimozione dal workout o esclusione permanente ripristinabile;
- refresh con scelta esplicita fra le tipologie di workout compatibili con recupero e attrezzatura attuali;
- continuità automatica per pattern, senza Focus configurabili o stato duplicato;
- registrazione modificabile di serie, ripetizioni, peso e RIR;
- stato per gruppo muscolare con recupero, stimolo nel ciclo mobile, recenza e priorità 0–100;
- nomi inglesi canonici con traduzione italiana opzionale;
- immagine locale visibile e guida inglese apribile per ogni esercizio approvato dal generatore;
- timer di recupero;
- area Progressi con riepilogo settimanale degli esercizi ricorrenti, schede Forza, Volume, Record e Attività, più storico del singolo esercizio;
- menu Impostazioni completo e reset confermato di profilo, storico, workout e preferenze locali;
- backup JSON con import/export e upload/ripristino manuale Nextcloud WebDAV;
- installazione PWA e uso offline.

Tutti i dati utente restano in `localStorage` per impostazione predefinita. Vengono inviati fuori dal dispositivo soltanto quando l’utente preme esplicitamente **Carica / sovrascrivi**.
