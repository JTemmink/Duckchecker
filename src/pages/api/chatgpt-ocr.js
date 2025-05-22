// Dit is een serverless functie voor Next.js
// Deze functie handelt de communicatie met de OpenAI API af,
// waarbij de API-sleutel veilig op de server blijft

export default async function handler(req, res) {
  console.log("API route chatgpt-ocr aangeroepen");
  
  // Alleen POST-verzoeken toestaan
  if (req.method !== 'POST') {
    console.log("Verkeerde methode gebruikt:", req.method);
    return res.status(405).json({ message: 'Alleen POST-methode is toegestaan' });
  }

  try {
    console.log("Request body aanwezig:", !!req.body);
    const { imageBase64 } = req.body;
    
    if (!imageBase64) {
      console.error("Geen afbeelding ontvangen in request body");
      return res.status(400).json({ message: 'Geen afbeelding ontvangen' });
    }
    
    console.log("Afbeelding ontvangen, lengte:", imageBase64.length);
    
    // Haal de API-sleutel op uit de omgevingsvariabelen
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.error('Geen OpenAI API-sleutel gevonden in omgevingsvariabelen');
      return res.status(500).json({ message: 'Server configuratiefout: API-sleutel ontbreekt' });
    }
    
    console.log("API sleutel gevonden, verzoek naar OpenAI wordt voorbereid");
    
    // Controleer of de imageBase64 een geldige data URL is
    if (!imageBase64.startsWith('data:image')) {
      console.error("Ongeldige afbeeldingsdata ontvangen");
      return res.status(400).json({ message: 'Ongeldige afbeeldingsdata' });
    }
    
    // Maak het verzoek naar de OpenAI API
    console.log("OpenAI API aanroepen...");
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'system',
            content: 'Je bent een OCR-hulpmiddel. Je krijgt een afbeelding van een 4-cijferig getal. Retourneer alleen het 4-cijferige getal dat je ziet zonder extra tekst of uitleg. Als je geen 4-cijferig getal kunt vinden, geef dan "NIET GEVONDEN" terug.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Wat is het 4-cijferige getal in deze afbeelding? Geef alleen het getal terug zonder extra tekst.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64
                }
              }
            ]
          }
        ],
        max_tokens: 20
      })
    });
    
    console.log("OpenAI API antwoord ontvangen, status:", openaiResponse.status);
    
    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json();
      console.error('OpenAI API-fout:', errorData);
      return res.status(openaiResponse.status).json({ 
        message: `OpenAI API-fout: ${errorData.error?.message || openaiResponse.statusText}` 
      });
    }
    
    const data = await openaiResponse.json();
    console.log("OpenAI API resultaat:", data);
    
    const extractedText = data.choices[0].message.content.trim();
    console.log("Geëxtraheerde tekst:", extractedText);
    
    // Stuur alleen de geëxtraheerde tekst terug naar de client
    return res.status(200).json({ text: extractedText });
    
  } catch (error) {
    console.error('Fout bij verwerken van ChatGPT OCR-verzoek:', error);
    return res.status(500).json({ message: `Server fout: ${error.message}` });
  }
} 