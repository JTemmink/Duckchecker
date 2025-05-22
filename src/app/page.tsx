'use client';

import { useState, useEffect } from 'react';
import LandingPage from '../components/LandingPage';
import { loadDuckNumbers } from '../utils/loadCsv';

export default function Home() {
  const [duckNumbers, setDuckNumbers] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastDetectedNumber, setLastDetectedNumber] = useState<string | null>(null);
  const [lastValidationResult, setLastValidationResult] = useState<boolean | null>(null);

  // Functie om de eendnummers te laden
  const fetchDuckNumbers = async () => {
    try {
      // Gebruik een tijdelijke variabele om de huidige lijst bij te houden
      const currentNumbers = [...duckNumbers];
      
      const numbers = await loadDuckNumbers();
      setDuckNumbers(numbers);
      setError(null);
    } catch (err) {
      setError('Fout bij het laden van de nummers. Vernieuw de pagina om het opnieuw te proberen.');
      console.error('Fout:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDuckNumbers();
  }, []);

  const handleNumberDetected = (number: string, isValid: boolean) => {
    setLastDetectedNumber(number);
    setLastValidationResult(isValid);
  };

  // Functie om data te verversen na toevoegen van een nieuw nummer
  const handleRefreshNeeded = async () => {
    try {
      // Laad alleen de nieuwe nummers, zonder de isLoading state te wijzigen
      const numbers = await loadDuckNumbers();
      setDuckNumbers(numbers);
    } catch (err) {
      console.error('Fout bij het verversen van nummers:', err);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          <p className="mt-4">Nummers laden...</p>
        </div>
      ) : error ? (
        <div className="p-4 bg-red-100 text-red-700 rounded-lg m-4">
          {error}
        </div>
      ) : (
        <LandingPage 
          duckNumbers={duckNumbers} 
          onNumberDetected={handleNumberDetected}
          onRefreshNeeded={handleRefreshNeeded}
        />
      )}
    </main>
  );
}
