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

  useEffect(() => {
    async function fetchData() {
      try {
        setIsLoading(true);
        const numbers = await loadDuckNumbers();
        setDuckNumbers(numbers);
      } catch (err) {
        setError('Fout bij het laden van de nummers. Vernieuw de pagina om het opnieuw te proberen.');
        console.error('Fout:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, []);

  const handleNumberDetected = (number: string, isValid: boolean) => {
    setLastDetectedNumber(number);
    setLastValidationResult(isValid);
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
        />
      )}
    </main>
  );
}
