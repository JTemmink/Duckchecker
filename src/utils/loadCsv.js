export async function loadDuckNumbers() {
  try {
    // Probeer eerst vanuit de hoofdmap (public directory)
    console.log('Proberen duck numbers te laden vanuit de public map...');
    
    let response;
    try {
      response = await fetch('/Ducknumbers.csv');
      // Als de status niet ok is, gooi een error zodat we de fallback kunnen proberen
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (fetchError) {
      console.warn('Kon Ducknumbers.csv niet laden vanuit public map:', fetchError);
      // Probeer fallback met relatief pad
      console.log('Proberen met alternatief pad...');
      response = await fetch('Ducknumbers.csv');
      
      if (!response.ok) {
        throw new Error(`Ook fallback fetch mislukt! status: ${response.status}`);
      }
    }
    
    // Als we hier komen, is één van beide fetches geslaagd
    console.log('CSV bestand succesvol opgehaald, status:', response.status);
    const csvText = await response.text();
    console.log('CSV lengte:', csvText.length, 'tekens');
    
    if (csvText.length < 10) {
      console.warn('CSV bestand is verdacht kort!');
    }
    
    // Debug: eerste deel van de CSV-tekst loggen
    console.log('Begin van CSV:', csvText.substring(0, 100).replace(/\n/g, '\\n'));
    
    // Verbeterde CSV verwerking:
    // 1. Vervang nieuwe regels door komma's om één string te maken
    // 2. Split op komma's om nummers te krijgen
    // 3. Verwijder witruimtes, lege waarden en dubbelingen
    const numbers = csvText
      .replace(/\r?\n/g, ',') // Vervang regeleinden door komma's
      .split(',')
      .map(num => num.trim()) // Verwijder witruimte
      .filter(Boolean) // Verwijder lege waarden
      .filter((value, index, self) => self.indexOf(value) === index) // Verwijder duplicaten
      .map(num => num.padStart(4, '0')); // Standaardiseer naar 4 cijfers met padding
    
    console.log('Geladen nummers (eerste 10):', numbers.slice(0, 10));
    console.log('Totaal aantal geladen nummers:', numbers.length);
    
    if (numbers.length === 0) {
      console.error('Geen nummers geladen uit CSV! Oorspronkelijke CSV-inhoud:', csvText);
      throw new Error('Geen nummers geladen uit CSV-bestand');
    }
    
    // Hard-coded fallback voor het geval het CSV-bestand niet goed is geladen
    // Dit kan worden gebruikt tijdens het debuggen
    if (numbers.length < 5) {
      console.warn('Erg weinig nummers geladen, voeg fallback test-nummers toe...');
      // Voeg enkele test-nummers toe zodat de app tenminste kan werken
      ['0001', '0002', '0003', '0123', '1234', '4321'].forEach(num => {
        if (!numbers.includes(num)) {
          numbers.push(num);
        }
      });
    }
    
    return numbers;
  } catch (error) {
    console.error('Fout bij het laden van duck numbers:', error);
    
    // Retourneer een minimale set test-nummers om de app te laten werken
    console.warn('Fallback naar hard-coded test-nummers vanwege fout...');
    return ['0001', '0002', '0003', '0123', '1234', '4321'];
  }
} 