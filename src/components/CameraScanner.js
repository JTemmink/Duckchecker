'use client';
import { useRef, useState, useEffect, useCallback } from 'react';
import { createWorker } from 'tesseract.js';

export default function CameraScanner({ duckNumbers, onNumberDetected }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [detectedNumber, setDetectedNumber] = useState('');
  const [isValidNumber, setIsValidNumber] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [scanFeedback, setScanFeedback] = useState('');
  const workerRef = useRef(null);
  const intervalRef = useRef(null);
  const [isPaused, setIsPaused] = useState(false);
  const [lastDetectedNumber, setLastDetectedNumber] = useState(null);
  const [verificationInProgress, setVerificationInProgress] = useState(false);
  
  // Instellingen voor het scan-kader als constante (niet als state)
  const scanFrame = {
    width: 280,  // Breedte van het kader in pixels
    height: 100, // Hoogte van het kader in pixels
  };

  // Initialiseer de Tesseract worker
  useEffect(() => {
    const initWorker = async () => {
      workerRef.current = await createWorker('eng');
      // Optimaliseer Tesseract voor cijferherkenning
      await workerRef.current.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '7', // Behandel afbeelding als een enkele tekstregel
        tessjs_create_hocr: '0',
        tessjs_create_tsv: '0',
        tessjs_create_box: '0',
        tessjs_create_unlv: '0',
        tessjs_create_osd: '0'
      });
    };

    initWorker();
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Verwerk een afbeelding voordat OCR wordt uitgevoerd
  const preprocessImage = (canvas) => {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Verhoog contrast
    const factor = 2.5; // Contrast verhogen
    const intercept = 128 * (1 - factor);
    
    for (let i = 0; i < data.length; i += 4) {
      // Converteer naar grayscale voor eenvoudigere verwerking
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      
      // Pas contrast aan
      const adjusted = factor * gray + intercept;
      
      // Binarisatie met drempelwaarde 128
      const threshold = 128;
      const result = adjusted > threshold ? 255 : 0;
      
      // Update alle kanalen
      data[i] = data[i + 1] = data[i + 2] = result;
    }
    
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  };

  // Neem een snapshot en verwerk het met OCR
  const captureImage = useCallback(async () => {
    if (!isStreaming || isProcessing || !workerRef.current) return;
    
    setIsProcessing(true);
    setScanFeedback(verificationInProgress ? 'Nummer verifiëren...' : 'Verwerken...');
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video && canvas) {
      const context = canvas.getContext('2d');
      
      // Bereken de positie van het scan-kader in het midden van de video
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      
      // Stel de canvas afmetingen in op de grootte van het scan-kader
      canvas.width = scanFrame.width;
      canvas.height = scanFrame.height;
      
      // Bereken de coördinaten voor het uitsnijden van het beeld
      const frameX = (videoWidth - scanFrame.width) / 2;
      const frameY = (videoHeight - scanFrame.height) / 2;
      
      // Trek alleen het gedeelte binnen het kader op de canvas
      context.drawImage(
        video,                 // bron
        frameX, frameY,        // beginpunt uitsnede in bronafbeelding
        scanFrame.width, scanFrame.height,  // grootte uitsnede
        0, 0,                  // beginpunt op canvas
        scanFrame.width, scanFrame.height   // grootte op canvas
      );
      
      try {
        // Pas beeldverbetering toe
        preprocessImage(canvas);
        
        // Maak een kopie van het geoptimaliseerde beeld
        const imageData = canvas.toDataURL('image/png');
        
        console.log("Verwerken van geoptimaliseerde afbeelding...");
        
        const { data } = await workerRef.current.recognize(imageData);
        const text = data.text.trim();
        
        // Debug info
        console.log("OCR tekst:", text);
        console.log("OCR confidence:", data.confidence);
        
        // Verbeterde nummerextractie
        // Eerst zoeken naar alle getallen in de gedetecteerde tekst
        const numbersFound = text.match(/\d+/g);
        console.log("Gevonden getallen:", numbersFound);
        
        if (numbersFound && numbersFound.length > 0) {
          // We verwijderen de beperking op 4 cijfers en nemen gewoon het eerste nummer
          const number = numbersFound[0];
          
          // Als we bezig zijn met verificatie
          if (verificationInProgress && lastDetectedNumber) {
            if (number === lastDetectedNumber) {
              // Nummer is geverifieerd, verwerk het nu
              setDetectedNumber(number);
              
              // Controleer of het nummer in de lijst voorkomt
              const isValid = duckNumbers.includes(number);
              setIsValidNumber(isValid);
              
              setScanFeedback(`Nummer geverifieerd: ${number}`);
              
              if (onNumberDetected) {
                onNumberDetected(number, isValid);
              }
              
              // Reset verificatie status
              setVerificationInProgress(false);
              setLastDetectedNumber(null);
              
              // Pauzeer het scannen voor 2 seconden
              setIsPaused(true);
              setTimeout(() => {
                setIsPaused(false);
              }, 2000);
            } else {
              // Getallen komen niet overeen, reset en probeer opnieuw
              setScanFeedback(`Verificatie mislukt, getallen komen niet overeen. Probeer opnieuw...`);
              setVerificationInProgress(false);
              setLastDetectedNumber(null);
            }
          } else {
            // Start verificatieproces
            setScanFeedback(`Mogelijk nummer gevonden: ${number}. Verifiëren...`);
            setLastDetectedNumber(number);
            setVerificationInProgress(true);
            
            // Onmiddellijk nog een keer scannen voor verificatie
            setTimeout(() => {
              setIsProcessing(false); // Reset processing flag voor de tweede scan
              captureImage(); // Roep zichzelf opnieuw aan voor verificatie
            }, 300); // Kleine vertraging om een andere frame te krijgen
          }
        } else {
          // Geen getallen gedetecteerd
          if (verificationInProgress) {
            setScanFeedback('Verificatie mislukt, geen nummers gevonden. Probeer opnieuw...');
            setVerificationInProgress(false);
            setLastDetectedNumber(null);
          } else {
            setDetectedNumber('');
            setIsValidNumber(null);
            setScanFeedback('Geen nummers gedetecteerd. Scannen gaat door...');
          }
        }
      } catch (err) {
        console.error('OCR fout:', err);
        // Reset alle states bij een fout
        setDetectedNumber('');
        setIsValidNumber(null);
        setVerificationInProgress(false);
        setLastDetectedNumber(null);
        setScanFeedback('Fout bij scannen. Probeer opnieuw...');
      } finally {
        setIsProcessing(false);
        // Reset scanFeedback niet, zodat de gebruiker de laatste status kan zien
      }
    } else {
      setIsProcessing(false);
      setScanFeedback('Camera niet beschikbaar');
    }
  }, [duckNumbers, isProcessing, isStreaming, onNumberDetected, verificationInProgress, lastDetectedNumber]);

  // Stop automatisch scannen met useCallback
  const stopAutoScan = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      setScanFeedback('');
    }
  }, []);

  // Start automatisch scannen met useCallback
  const startAutoScan = useCallback(() => {
    // Stop eventueel bestaande interval
    stopAutoScan();
    
    // Geef feedback dat scannen is gestart
    setScanFeedback('Automatisch scannen gestart...');
    
    // Start nieuwe interval
    intervalRef.current = setInterval(() => {
      if (!isProcessing && isStreaming && !isPaused) {
        // Update tekst om te laten zien dat we scannen
        setScanFeedback('Camera scant nu...');
        captureImage();
      }
    }, 1000); // Scan elke seconde
  }, [stopAutoScan, isProcessing, isStreaming, isPaused, captureImage]);

  // Start de camera
  const startCamera = async () => {
    try {
      setScanFeedback('Camera wordt gestart...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: { ideal: 'environment' } }
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsStreaming(true);
        setIsManualMode(false);
        setScanFeedback('Camera draait, scannen start...');
      }
    } catch (err) {
      console.error('Fout bij het starten van de camera:', err);
      setScanFeedback('Fout bij het starten van de camera!');
    }
  };

  // Stop de camera
  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsStreaming(false);
      stopAutoScan();
    }
  };

  // Schakel naar handmatige invoermodus
  const switchToManualMode = () => {
    stopCamera();
    setIsManualMode(true);
    setManualInput('');
    setDetectedNumber('');
    setIsValidNumber(null);
    setScanFeedback('');
  };

  // Schakel terug naar camera-modus
  const switchToCameraMode = () => {
    setIsManualMode(false);
    startCamera();
  };

  // Voeg cijfer toe aan handmatige invoer
  const addDigit = (digit) => {
    const newInput = manualInput + digit;
    setManualInput(newInput);
    
    // Controleer het nummer direct na elke invoer
    setDetectedNumber(newInput);
    const isValid = duckNumbers.includes(newInput);
    setIsValidNumber(isValid);
  };

  // Verwijder laatste cijfer van handmatige invoer
  const removeLastDigit = () => {
    if (manualInput.length > 0) {
      setManualInput(manualInput.slice(0, -1));
      setDetectedNumber('');
      setIsValidNumber(null);
    }
  };

  // Wis handmatige invoer
  const clearInput = () => {
    setManualInput('');
    setDetectedNumber('');
    setIsValidNumber(null);
  };

  // Start automatisch scannen wanneer de camera start
  useEffect(() => {
    if (isStreaming && !isManualMode) {
      startAutoScan();
    } else {
      stopAutoScan();
    }
    
    return () => {
      stopAutoScan();
    };
  }, [isStreaming, isManualMode, startAutoScan, stopAutoScan]);

  // Render het numeric keypad voor handmatige invoer
  const renderKeypad = () => {
    return (
      <div className="flex flex-col items-center w-full max-w-xs mx-auto">
        <div className="w-full p-4 mb-4 text-center bg-gray-100 rounded-lg">
          <input
            type="text"
            value={manualInput}
            readOnly
            className="w-full text-2xl text-center font-mono bg-transparent outline-none"
            placeholder="Voer een nummer in"
          />
        </div>
        
        <div className="grid grid-cols-3 gap-2 w-full">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button
              key={num}
              onClick={() => addDigit(num.toString())}
              className="bg-blue-500 text-white rounded-lg h-14 text-xl font-bold"
            >
              {num}
            </button>
          ))}
          <button
            onClick={clearInput}
            className="bg-yellow-500 text-white rounded-lg h-14 text-xl font-bold"
          >
            C
          </button>
          <button
            onClick={() => addDigit('0')}
            className="bg-blue-500 text-white rounded-lg h-14 text-xl font-bold"
          >
            0
          </button>
          <button
            onClick={removeLastDigit}
            className="bg-red-500 text-white rounded-lg h-14 text-xl font-bold"
          >
            ←
          </button>
        </div>
        
        <button
          onClick={switchToCameraMode}
          className="w-full mt-6 px-4 py-3 bg-green-500 text-white rounded-lg text-lg font-bold"
        >
          Camera gebruiken
        </button>
      </div>
    );
  };

  // Bereken achtergrondkleur voor camera container
  const getCameraContainerClass = () => {
    if (!isValidNumber && detectedNumber) {
      return "border-2 border-red-500 bg-red-100 bg-opacity-30";
    } else if (isValidNumber) {
      return "border-2 border-green-500 bg-green-100 bg-opacity-30";
    } else {
      return "border-2 border-gray-300";
    }
  };

  // Render de UI voor camera-modus met scan-kader
  const renderCamera = () => {
    return (
      <>
        {/* Gedetecteerd nummer boven camerabeeld */}
        {detectedNumber && (
          <div className="mb-4 text-center p-3 bg-gray-100 rounded-lg shadow-md w-full max-w-md">
            <div className="text-4xl font-bold font-mono">{detectedNumber}</div>
          </div>
        )}
        
        <div className={`relative mb-4 rounded-lg overflow-hidden ${getCameraContainerClass()}`}>
          {/* Camera video */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full max-w-md h-auto"
            onPlay={() => setIsStreaming(true)}
          />
          
          {/* Verborgen canvas voor beeldverwerking */}
          <canvas ref={canvasRef} className="hidden" />
          
          {/* Scan-kader overlay */}
          {isStreaming && (
            <div className="absolute top-0 left-0 right-0 bottom-0 flex items-center justify-center pointer-events-none">
              <div 
                className="border-4 border-blue-500 rounded-md bg-transparent"
                style={{
                  width: `${scanFrame.width}px`,
                  height: `${scanFrame.height}px`,
                  boxShadow: '0 0 0 2000px rgba(0, 0, 0, 0.3)'
                }}
              >
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-white drop-shadow-lg font-bold text-sm">
                    Plaats het nummer in dit kader
                  </span>
                </div>
              </div>
            </div>
          )}
          
          {/* Status indicator voor scannen */}
          {isStreaming && (
            <div className="absolute bottom-2 left-2 right-2 bg-black bg-opacity-50 text-white p-2 rounded">
              <div className="flex items-center">
                {isProcessing && (
                  <div className="animate-pulse w-3 h-3 bg-red-500 rounded-full mr-2"></div>
                )}
                <span>{scanFeedback || "Wachten op camera..."}</span>
              </div>
            </div>
          )}
          
          {/* Vinkje of Kruis rechtsonder in camerabeeld */}
          {isValidNumber !== null && detectedNumber && (
            <div className="absolute bottom-16 right-4">
              {isValidNumber ? (
                <div className="text-green-500 text-6xl drop-shadow-lg">✓</div>
              ) : (
                <div className="text-red-500 text-6xl drop-shadow-lg">✗</div>
              )}
            </div>
          )}
        </div>
        
        <div className="flex space-x-4 mb-6">
          {!isStreaming ? (
            <button
              onClick={startCamera}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg"
            >
              Camera starten
            </button>
          ) : (
            <button
              onClick={stopCamera}
              className="px-4 py-2 bg-red-500 text-white rounded-lg"
            >
              Camera stoppen
            </button>
          )}
          
          <button
            onClick={switchToManualMode}
            className="px-4 py-2 bg-green-500 text-white rounded-lg"
          >
            Handmatig invoeren
          </button>
        </div>
      </>
    );
  };

  return (
    <div className="flex flex-col items-center">
      {!isManualMode ? (
        // Camera modus met scan-kader
        renderCamera()
      ) : (
        // Handmatige invoer modus
        renderKeypad()
      )}
      
      {/* Uitgebreide informatie onder camerabeeld */}
      {detectedNumber && isValidNumber !== null && (
        <div className="mt-4 text-center w-full max-w-md">
          <p className={`font-bold mt-2 ${isValidNumber ? 'text-green-600' : 'text-red-600'}`}>
            {isValidNumber 
              ? "Dit nummer komt voor in de lijst!" 
              : "Dit nummer komt niet voor in de lijst."}
          </p>
        </div>
      )}
    </div>
  );
} 