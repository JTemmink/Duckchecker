'use client';
import { useState } from 'react';
import Image from 'next/image';
import CameraScanner from './CameraScanner';

export default function LandingPage({ duckNumbers }) {
  const [mode, setMode] = useState(null); // null, 'camera', of 'manual'

  // Als er nog geen modus is gekozen, toon landingspagina
  if (!mode) {
    return (
      <div className="relative h-screen w-full overflow-hidden flex flex-col">
        {/* Achtergrondafbeelding met rubberen eend */}
        <div className="absolute inset-0 z-0">
          <Image
            src="/duck-image.jpg"
            alt="Rubberen eend"
            fill
            style={{ objectFit: 'cover' }}
            priority
          />
        </div>
        
        {/* Container voor titel en knoppen */}
        <div className="relative z-10 flex flex-col h-full justify-between">
          {/* Titel bovenaan */}
          <div className="mt-8 text-center">
            <h1 className="text-3xl font-bold text-white drop-shadow-lg">
              DuckCheck
            </h1>
          </div>
          
          {/* Knoppen onderaan */}
          <div className="mb-16 px-6 w-full">
            <div className="flex flex-col space-y-4 max-w-xs mx-auto">
              <button
                onClick={() => setMode('camera')}
                className="bg-yellow-500 hover:bg-yellow-600 text-white py-4 px-6 rounded-xl text-xl font-bold shadow-lg transition-all"
              >
                Camera
              </button>
              <button
                onClick={() => setMode('manual')}
                className="bg-blue-500 hover:bg-blue-600 text-white py-4 px-6 rounded-xl text-xl font-bold shadow-lg transition-all"
              >
                Handmatig
              </button>
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
      />
    </div>
  );
} 