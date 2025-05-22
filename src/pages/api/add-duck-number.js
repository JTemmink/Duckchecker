// Vercel KV is een serverless key-value store die we kunnen gebruiken in plaats van lokale bestanden
// Aangezien we dit nu nog niet hebben ingesteld, maken we een mockup die werkt met lokale bestanden
// maar die later eenvoudig kan worden vervangen door Vercel KV of een andere database

import fs from 'fs';
import path from 'path';

// Hulpfunctie om met zowel lokale ontwikkeling als Vercel prod om te gaan
async function loadDuckNumbers() {
  try {
    // In productie (Vercel) kunnen we niet schrijven naar het bestandssysteem
    if (process.env.VERCEL) {
      // Gebruik een mockup voor demonstratie
      // In een echte app zou je hier Vercel KV, Supabase, MongoDB of een andere database gebruiken
      console.log('Vercel-omgeving gedetecteerd, mockup data wordt gebruikt');
      return [];
    }
    
    // Lokale ontwikkeling - gebruik bestanden
    const csvPath = path.join(process.cwd(), 'public', 'ducknumbers.csv');
    
    // Controleer of het bestand bestaat
    if (!fs.existsSync(csvPath)) {
      console.log('CSV bestand niet gevonden, nieuw bestand aanmaken');
      fs.writeFileSync(csvPath, '');
      return [];
    }
    
    // Lees het bestand
    const fileContent = fs.readFileSync(csvPath, 'utf8');
    return fileContent
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => line.trim());
      
  } catch (error) {
    console.error('Fout bij laden van duck numbers:', error);
    return [];
  }
}

// Hulpfunctie om duck numbers op te slaan
async function saveDuckNumbers(numbers) {
  try {
    // In productie (Vercel) kunnen we niet schrijven naar het bestandssysteem
    if (process.env.VERCEL) {
      // Mockup voor demonstratie
      console.log('Vercel-omgeving gedetecteerd, opslaan niet mogelijk');
      return true;
    }
    
    // Lokale ontwikkeling - gebruik bestanden
    const csvPath = path.join(process.cwd(), 'public', 'ducknumbers.csv');
    const content = numbers.join('\n');
    fs.writeFileSync(csvPath, content);
    return true;
    
  } catch (error) {
    console.error('Fout bij opslaan van duck numbers:', error);
    return false;
  }
}

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
    
    // Laad huidige nummers
    const currentNumbers = await loadDuckNumbers();
    
    // Controleer of het nummer al bestaat
    if (currentNumbers.includes(number)) {
      return res.status(409).json({ error: 'Dit eendnummer bestaat al in de database' });
    }
    
    // Voeg het nieuwe nummer toe
    const updatedNumbers = [...currentNumbers, number];
    
    // Sla de bijgewerkte lijst op
    const success = await saveDuckNumbers(updatedNumbers);
    
    if (!success && process.env.VERCEL) {
      // In Vercel geven we een speciale melding
      return res.status(200).json({ 
        success: true, 
        message: 'Eendnummer wordt niet werkelijk opgeslagen in deze demo-omgeving',
        isDemo: true 
      });
    } else if (!success) {
      throw new Error('Kon nummers niet opslaan');
    }
    
    // Stuur succesbericht terug
    return res.status(200).json({ success: true, message: 'Eendnummer succesvol toegevoegd' });
    
  } catch (error) {
    console.error('Fout bij toevoegen van eendnummer:', error);
    return res.status(500).json({ error: 'Serverfout bij verwerken van verzoek' });
  }
} 