export async function loadDuckNumbers() {
  try {
    const response = await fetch('/Ducknumbers.csv');
    const csvText = await response.text();
    
    // Verbeterde CSV verwerking:
    // 1. Vervang nieuwe regels door komma's om één string te maken
    // 2. Split op komma's om nummers te krijgen
    // 3. Verwijder witruimtes, lege waarden en dubbelingen
    const numbers = csvText
      .replace(/\r?\n/g, ',') // Vervang regeleinden door komma's
      .split(',')
      .map(num => num.trim()) // Verwijder witruimte
      .filter(Boolean) // Verwijder lege waarden
      .filter((value, index, self) => self.indexOf(value) === index); // Verwijder duplicaten
    
    console.log('Geladen nummers (eerste 5):', numbers.slice(0, 5));
    console.log('Totaal aantal geladen nummers:', numbers.length);
    
    return numbers;
  } catch (error) {
    console.error('Fout bij het laden van duck numbers:', error);
    return [];
  }
} 