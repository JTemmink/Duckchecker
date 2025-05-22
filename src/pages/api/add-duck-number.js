import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // Alleen POST-verzoeken toestaan
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Methode niet toegestaan' });
  }

  try {
    const { number } = req.body;
    
    // Valideer het eendnummer
    if (!number || !/^\d{4}$/.test(number)) {
      return res.status(400).json({ error: 'Ongeldig eendnummer. Het moet precies 4 cijfers bevatten.' });
    }
    
    // Pad naar het CSV-bestand
    const csvPath = path.join(process.cwd(), 'public', 'ducknumbers.csv');
    
    // Controleer of het bestand bestaat, zo niet, maak het aan
    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, '');
    }
    
    // Lees de huidige eendnummers
    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const currentNumbers = fileContent
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => line.trim());
    
    // Controleer of het nummer al bestaat
    if (currentNumbers.includes(number)) {
      return res.status(409).json({ error: 'Dit eendnummer bestaat al in de database' });
    }
    
    // Voeg het nieuwe nummer toe
    const updatedContent = [...currentNumbers, number].join('\n');
    fs.writeFileSync(csvPath, updatedContent);
    
    // Stuur succesbericht terug
    return res.status(200).json({ success: true, message: 'Eendnummer succesvol toegevoegd' });
    
  } catch (error) {
    console.error('Fout bij toevoegen van eendnummer:', error);
    return res.status(500).json({ error: 'Serverfout bij verwerken van verzoek' });
  }
} 