export async function loadDuckNumbers() {
  try {
    const response = await fetch('/ducknumber.csv');
    const csvText = await response.text();
    
    // Verwerk de CSV data
    const numbers = csvText
      .split(',')
      .map(num => num.trim())
      .filter(Boolean);
    
    return numbers;
  } catch (error) {
    console.error('Fout bij het laden van duck numbers:', error);
    return [];
  }
} 