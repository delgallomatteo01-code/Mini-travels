# Guida al trasferimento dei dati

Il pacchetto esportato da ChatGPT Sites contiene **solo il codice**. Il database live (viaggi, itinerari, impostazioni) e i file caricati (logo personalizzato, foto, biglietti) sono rimasti sul sito originale. Questa guida spiega come portarli nella nuova installazione **senza scrivere nulla sul sito originale**: si fanno solo letture ed esportazioni.

## Cosa si trasferisce e come

| Dato | Come | Automatico? |
|---|---|---|
| Viaggio (titolo, destinazione, date, copertina) + itinerario completo (giorni, ordine, note, costi, stati, link) | Esporta JSON → Importa viaggio | Sì, ID e campi conservati |
| Riferimenti ai biglietti | inclusi nel JSON | Sì, ma **i file no** |
| File dei biglietti (PDF, immagini, Wallet, .ics) | scaricali dal vecchio Riepilogo e ricaricali dall'attività | No |
| Nome app, sottotitolo, nomi, colori, didascalie | ricopiali in Impostazioni | No (il vecchio sito non li esporta) |
| Logo, foto profilo, polaroid personalizzate | scaricale dal vecchio sito e ricaricale in Impostazioni | No |
| Giornate bloccate | preferenza locale del browser | No, si reimpostano col lucchetto |

## Passi

1. **Nel vecchio sito**, per ogni viaggio: apri il viaggio → Riepilogo → Gestione dati → **Esporta JSON**. Ottieni `<id-viaggio>-itinerario.json` con `{ trip, activities }`.
2. Sempre nel vecchio sito, dalla sezione "Tutti i biglietti" scarica i documenti (icona download) e salvali con il nome dell'attività.
3. **Nella nuova app**: Impostazioni → Trasferimento dati → **Importa viaggio (JSON)** e scegli il file. Ripeti per ogni viaggio.
   - Il viaggio viene creato con lo **stesso ID** (es. `parigi-2026`), quindi i giorni (`sep11`…`sep18` o `day-AAAA-MM-GG`) restano collegati alle attività.
   - Se un viaggio con quell'ID esiste già (per esempio hai creato prima l'esempio Parigi), l'app chiede se importarlo come copia con un nuovo ID. Non sovrascrive e non cancella mai nulla.
   - Il messaggio finale indica quanti biglietti vanno ricaricati.
4. Apri ogni attività che aveva un biglietto e usa **Sostituisci** per caricare il file scaricato al passo 2. Finché non lo fai, aprire il vecchio biglietto mostra "Documento non trovato in questa installazione".
5. In Impostazioni ricopia testi e colori e ricarica logo e foto, se li avevi personalizzati.
6. Verifica nel Riepilogo che conteggi e costi coincidano con quelli del vecchio sito.

## Differenza tra i due import

- **Impostazioni → Importa viaggio**: crea un viaggio nuovo (migrazione o ripristino da backup). Non tocca gli altri.
- **Riepilogo → Importa JSON**: sostituisce, dopo conferma, le attività **del viaggio aperto** (come nel sito originale). Accetta sia `{ trip, activities }` sia un semplice elenco di attività. È annullabile subito dopo con "Annulla".

## Backup della nuova installazione

Impostazioni → **Scarica backup completo** produce un unico JSON (`format: "me-viaggi-backup"`) con tutti i viaggi, gli itinerari e le impostazioni. Si reimporta con "Importa viaggio". Non contiene i file: per un backup completo salva anche lo storage (`DATA_DIR/files` sul server Node, il bucket R2 su Cloudflare).
