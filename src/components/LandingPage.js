'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import CameraScanner from './CameraScanner';

export default function LandingPage({ duckNumbers, onNumberDetected, onRefreshNeeded }) {
  const [mode, setMode] = useState(null); // null, 'camera', 'manual', of 'admin'
  const [isDesktop, setIsDesktop] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [showAdminInput, setShowAdminInput] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [newDuckNumber, setNewDuckNumber] = useState('');
  const [addSuccess, setAddSuccess] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  
  useEffect(() => {
    // Detecteer of het apparaat een desktop/laptop is
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    setIsDesktop(!isMobileDevice);
    
    // Detecteer of we in Vercel draaien
    if (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')) {
      setIsDemoMode(true);
    }
  }, []);

  // Functie om admin toegang te valideren
  const validateAdminAccess = () => {
    if (adminCode === '2001') {
      setMode('admin');
      setAdminError('');
      setShowAdminInput(false);
    } else {
      setAdminError('Ongeldige code');
    }
  };

  // Functie om een nieuw eendnummer toe te voegen
  const addNewDuckNumber = async () => {
    // Valideer het formaat van het nummer (moet 4 cijfers zijn)
    if (!/^\d{1,4}$/.test(newDuckNumber.trim())) {
      setAdminError('Voer een geldig nummer in (1-4 cijfers)');
      return;
    }

    // Pad het nummer met voorloopnullen indien nodig
    const paddedNumber = newDuckNumber.trim().padStart(4, '0');

    // Controleer of het nummer al bestaat
    if (duckNumbers.includes(paddedNumber)) {
      setAdminError('Dit nummer bestaat al in de database');
      return;
    }

    try {
      // Maak een POST-verzoek naar een API-route om het nummer op te slaan
      const response = await fetch('/api/add-duck-number', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ number: paddedNumber }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Kon nummer niet opslaan');
      }

      // Verwerk het antwoord
      const data = await response.json();
      
      // Toon de juiste succes-melding
      setSuccessMessage(data.message || 'Nummer succesvol toegevoegd!');
      setAddSuccess(true);
      setNewDuckNumber('');
      setAdminError('');
      
      // Verberg de succes-melding na 3 seconden
      setTimeout(() => {
        setAddSuccess(false);
        setSuccessMessage('');
      }, 3000);
      
      // Vernieuw de lijst met eendnummers als we niet in demo-modus zijn
      // of als we in demo-modus zijn maar wel een "isDemo" vlag hebben in het antwoord
      if (!isDemoMode || !data.isDemo) {
        await onRefreshNeeded();
      } else if (isDemoMode && data.isDemo) {
        // In demo-modus: voeg het nummer tijdelijk toe aan de lijst voor demo-doeleinden
        onNumberDetected(paddedNumber, true);
      }
      
    } catch (error) {
      console.error('Fout bij toevoegen van nummer:', error);
      setAdminError('Fout bij opslaan: ' + error.message);
    }
  };

  // Functie om de verwijdering van een eendnummer te bevestigen
  const confirmDelete = (number) => {
    setSelectedNumber(number);
    setIsConfirmingDelete(true);
    setAdminError('');
  };

  // Functie om de verwijdering te annuleren
  const cancelDelete = () => {
    setSelectedNumber(null);
    setIsConfirmingDelete(false);
  };

  // Functie om een eendnummer te verwijderen
  const deleteDuckNumber = async () => {
    if (!selectedNumber) return;
    
    try {
      // Maak een DELETE-verzoek naar een API-route om het nummer te verwijderen
      const response = await fetch(`/api/delete-duck-number?number=${selectedNumber}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Kon nummer niet verwijderen');
      }

      // Verwerk het antwoord
      const data = await response.json();
      
      // Toon de juiste succes-melding
      setSuccessMessage(data.message || 'Nummer succesvol verwijderd!');
      setDeleteSuccess(true);
      setSelectedNumber(null);
      setIsConfirmingDelete(false);
      setAdminError('');
      
      // Verberg de succes-melding na 3 seconden
      setTimeout(() => {
        setDeleteSuccess(false);
        setSuccessMessage('');
      }, 3000);
      
      // Vernieuw de lijst met eendnummers als we niet in demo-modus zijn
      // of als we in demo-modus zijn maar wel een "isDemo" vlag hebben in het antwoord
      if (!isDemoMode || !data.isDemo) {
        await onRefreshNeeded();
      }
      
    } catch (error) {
      console.error('Fout bij verwijderen van nummer:', error);
      setAdminError('Fout bij verwijderen: ' + error.message);
      setIsConfirmingDelete(false);
    }
  };

  // Als er nog geen modus is gekozen, toon landingspagina
  if (!mode) {
    return (
      <div className="relative h-screen w-full overflow-hidden flex flex-col">
        {/* Container voor titel, afbeelding en knoppen */}
        <div className="relative z-10 flex flex-col h-full justify-between items-center">
          {/* Titel bovenaan */}
          <div className="mt-8 text-center">
            <h1 className="text-3xl font-bold text-black drop-shadow-lg">
              DuckCheck
            </h1>
            {isDemoMode && (
              <p className="text-sm text-orange-500 mt-1">Demo Modus</p>
            )}
          </div>
          
          {/* Afbeelding in het midden */}
          <div className="flex justify-center">
            <Image
              src="/duck-image.jpg"
              alt="Rubberen eend"
              width={200}
              height={200}
              className="rounded-full shadow-lg"
              priority
            />
          </div>
          
          {/* Knoppen onderaan */}
          <div className="mb-16 px-6 w-full">
            <div className="flex flex-col space-y-4 max-w-xs mx-auto">
              <button
                onClick={() => setMode('camera')}
                className="bg-yellow-500 hover:bg-yellow-600 text-white py-4 px-6 rounded-xl text-xl font-bold shadow-lg transition-all"
              >
                Camera (Beta)
              </button>
              <button
                onClick={() => setMode('manual')}
                className="bg-blue-500 hover:bg-blue-600 text-white py-4 px-6 rounded-xl text-xl font-bold shadow-lg transition-all"
              >
                Handmatig
              </button>
              
              {/* Admin knop - stijlvol en discreet */}
              <div className="mt-8 flex justify-center">
                {!showAdminInput ? (
                  <button
                    onClick={() => setShowAdminInput(true)}
                    className="text-sm text-gray-500 underline"
                  >
                    Beheerder
                  </button>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="flex items-center">
                      <input
                        type="password"
                        value={adminCode}
                        onChange={(e) => setAdminCode(e.target.value)}
                        placeholder="Voer code in"
                        className="px-3 py-2 border rounded-l focus:outline-none"
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') validateAdminAccess();
                        }}
                      />
                      <button
                        onClick={validateAdminAccess}
                        className="px-3 py-2 bg-gray-700 text-white rounded-r"
                      >
                        OK
                      </button>
                    </div>
                    {adminError && (
                      <p className="text-red-500 text-sm mt-1">{adminError}</p>
                    )}
                  </div>
                )}
              </div>
              
              {isDesktop && (
                <div className="text-center text-sm text-gray-600 mt-2 p-2 bg-gray-100 rounded-lg">
                  Let op: Op laptops/desktops wordt de frontcamera gebruikt omdat achtercamera's meestal niet beschikbaar zijn.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // Admin modus
  if (mode === 'admin') {
    return (
      <div className="p-4 max-w-lg mx-auto">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-xl font-bold">DuckCheck Beheer</h1>
          <button 
            onClick={() => setMode(null)}
            className="px-3 py-1 bg-gray-200 text-gray-800 rounded-lg text-sm"
          >
            Terug
          </button>
        </div>
        
        {isDemoMode && (
          <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm">
            <p>Je gebruikt de demo-modus op Vercel. Wijzigingen worden niet permanent opgeslagen.</p>
          </div>
        )}
        
        {/* Nieuw nummer toevoegen */}
        <div className="mb-6 p-4 bg-white rounded-lg shadow">
          <h2 className="text-lg font-bold mb-3">Nieuw eendnummer toevoegen</h2>
          <div className="flex">
            <input
              type="text"
              value={newDuckNumber}
              onChange={(e) => setNewDuckNumber(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="Voer eendnummer in"
              className="flex-1 px-3 py-2 border rounded-l focus:outline-none"
              maxLength={4}
            />
            <button
              onClick={addNewDuckNumber}
              className="px-3 py-2 bg-green-500 text-white rounded-r"
            >
              Toevoegen
            </button>
          </div>
          {adminError && (
            <p className="text-red-500 text-sm mt-1">{adminError}</p>
          )}
          {(addSuccess || deleteSuccess) && (
            <p className="text-green-500 text-sm mt-1">{successMessage}</p>
          )}
        </div>
        
        {/* Lijst van eendnummers */}
        <div className="p-4 bg-white rounded-lg shadow">
          <h2 className="text-lg font-bold mb-3">Eendnummer Database</h2>
          <p className="text-sm text-gray-500 mb-2">Totaal: {duckNumbers.length} nummers</p>
          
          {isConfirmingDelete ? (
            <div className="mb-4 p-3 border border-orange-300 bg-orange-50 rounded-lg">
              <p className="mb-2 text-center">
                Weet je zeker dat je nummer <strong>{selectedNumber}</strong> wilt verwijderen?
              </p>
              <div className="flex justify-center space-x-3">
                <button 
                  onClick={deleteDuckNumber}
                  className="px-3 py-1 bg-red-500 text-white rounded-lg text-sm"
                >
                  Ja, verwijderen
                </button>
                <button
                  onClick={cancelDelete}
                  className="px-3 py-1 bg-gray-300 text-gray-800 rounded-lg text-sm"
                >
                  Annuleren
                </button>
              </div>
            </div>
          ) : null}
          
          <div className="max-h-80 overflow-y-auto border rounded">
            <div className="grid grid-cols-4 gap-2 p-2">
              {duckNumbers.map((number, index) => (
                <div 
                  key={index} 
                  className="flex justify-between items-center py-1 px-2 bg-gray-100 rounded text-sm group hover:bg-gray-200"
                >
                  <span>{number}</span>
                  <button
                    onClick={() => confirmDelete(number)}
                    className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Verwijderen"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // Als er een modus is gekozen, toon de CameraScanner met de juiste instellingen
  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">DuckCheck</h1>
        <button 
          onClick={() => setMode(null)}
          className="px-3 py-1 bg-gray-200 text-gray-800 rounded-lg text-sm"
        >
          Terug
        </button>
      </div>
      
      <CameraScanner 
        duckNumbers={duckNumbers} 
        initialMode={mode === 'manual' ? 'manual' : 'camera'} 
        onNumberDetected={onNumberDetected}
      />
    </div>
  );
} 