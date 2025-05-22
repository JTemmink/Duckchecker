import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // Alleen DELETE-verzoeken toestaan
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Methode niet toegestaan' });
  }

  try {
    const { number } = req.query;
    
    // Valideer het eendnummer
    if (!number || !/^\d{4}$/.test(number)) {
      return res.status(400).json({ error: 'Ongeldig eendnummer. Het moet precies 4 cijfers bevatten.' });
    }
    
    // Pad naar het CSV-bestand
    const csvPath = path.join(process.cwd(), 'public', 'ducknumbers.csv');
    
    // Controleer of het bestand bestaat
    if (!fs.existsSync(csvPath)) {
      return res.status(404).json({ error: 'Database bestand niet gevonden' });
    }
    
    // Lees de huidige eendnummers
    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const currentNumbers = fileContent
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => line.trim());
    
    // Controleer of het nummer bestaat in de lijst
    if (!currentNumbers.includes(number)) {
      return res.status(404).json({ error: 'Dit eendnummer bestaat niet in de database' });
    }
    
    // Verwijder het nummer uit de lijst
    const updatedNumbers = currentNumbers.filter(num => num !== number);
    const updatedContent = updatedNumbers.join('\n');
    
    // Schrijf de bijgewerkte lijst terug naar het bestand
    fs.writeFileSync(csvPath, updatedContent);
    
    // Stuur succesbericht terug
    return res.status(200).json({ success: true, message: 'Eendnummer succesvol verwijderd' });
    
  } catch (error) {
    console.error('Fout bij verwijderen van eendnummer:', error);
    return res.status(500).json({ error: 'Serverfout bij verwerken van verzoek' });
  }
} 