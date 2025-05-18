'use client';
import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
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
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [showDebug, setShowDebug] = useState(false);
  const [debugImage, setDebugImage] = useState(null);
  const [useImageProcessing, setUseImageProcessing] = useState(true);
  const [ocrQuality, setOcrQuality] = useState('balanced');
  
  // Instellingen voor het scan-kader als constante (niet als state)
  const scanFrame = {
    width: 180,  // Breedte van het kader in pixels (iets breder voor meer context)
    height: 70, // Hoogte van het kader in pixels (iets hoger voor meer ruimte rond cijfers)
  };

  // Initialiseer de Tesseract worker
  useEffect(() => {
    const initWorker = async () => {
      workerRef.current = await createWorker('eng');
      // Roep de updateOcrParameters aan in plaats van directe parameters
      await updateOcrParameters();
    };

    initWorker();
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, [ocrQuality]);

  // Functie om OCR parameters te updaten op basis van kwaliteit
  const updateOcrParameters = async () => {
    if (!workerRef.current) return;
    
    // Basisinstellingen voor alle kwaliteitsniveaus
    const baseParams = {
      tessedit_char_whitelist: '0123456789',
      tessjs_create_hocr: '0',
      tessjs_create_tsv: '0',
      tessjs_create_box: '0',
      tessjs_create_unlv: '0',
      tessjs_create_osd: '0',
      segment_nonalphabetic_script: '1', // Betere segmentatie voor cijfers
      textord_space_size_is_variable: '0' // Vaste spatiëring (beter voor cijfers)
    };
    
    // Kwaliteitsspecifieke parameters
    let qualityParams = {};
    
    switch (ocrQuality) {
      case 'fast':
        qualityParams = {
          tessedit_pageseg_mode: '7', // Eén regel tekst
          tessedit_ocr_engine_mode: '3', // Alleen LSTM (sneller)
          textord_heavy_nr: '1',
          textord_min_linesize: '2.5',
          classify_bln_numeric_mode: '1',
          preserve_interword_spaces: '0',
        };
        break;
        
      case 'accurate':
        qualityParams = {
          tessedit_pageseg_mode: '6', // Blok tekst (nauwkeuriger voor getallen)
          tessedit_ocr_engine_mode: '2', // LSTM (nauwkeuriger)
          lstm_choice_mode: '2', // Meerdere opties evalueren
          lstm_choice_iterations: '10', // Meer iteraties voor LSTM
          textord_really_old_xheight: '0', // Moderne teksthoogte berekening
          textord_force_make_prop_words: '0',
          tessedit_do_invert: '0',
          tessedit_good_quality_rating: '0.95',
        };
        break;
        
      default: // 'balanced'
        qualityParams = {
          tessedit_pageseg_mode: '7', 
          tessedit_ocr_engine_mode: '2',
          textord_heavy_nr: '1',
          textord_min_linesize: '2.5',
          classify_bln_numeric_mode: '1',
          preserve_interword_spaces: '0',
          tessedit_do_invert: '0',
        };
    }
    
    // Combineer basis en kwaliteitsparameters
    const combinedParams = { ...baseParams, ...qualityParams };
    
    // Update Tesseract worker
    await workerRef.current.setParameters(combinedParams);
  };

  // Verwerk een afbeelding voordat OCR wordt uitgevoerd
  const preprocessImage = (canvas) => {
    if (!useImageProcessing) return canvas; // Skip als beeldverwerking uit staat
    
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // VERBETERDE BEELDVERWERKING VOOR BREDER KADER
    // Bij bredere afbeeldingen moet je meer letten op contrast
    const factor = 3.0; // Hoger contrast voor betere cijferherkenning in breder kader
    const intercept = 128 * (1 - factor);
    
    // Bereken gemiddelde helderheid om adaptieve threshold te bepalen
    let totalBrightness = 0;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      totalBrightness += gray;
    }
    const avgBrightness = totalBrightness / (data.length / 4);
    
    // Bepaal een dynamische threshold op basis van de helderheid
    const threshold = avgBrightness > 128 ? 140 : 120;
    
    for (let i = 0; i < data.length; i += 4) {
      // Verbeterde grayscale conversie - standaard formule
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      
      // Contrast aanpassen
      const adjusted = factor * gray + intercept;
      
      // Binaire conversie (zwart-wit) met dynamische drempelwaarde
      const result = adjusted > threshold ? 255 : 0;
      
      // Alle kleurkanalen gelijk maken
      data[i] = data[i + 1] = data[i + 2] = result;
    }
    
    // Update afbeelding
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
      
      // BELANGRIJK: Bereken de juiste coördinaten voor het scanframe, 
      // ongeacht het zoomniveau!
      
      // 1. Bepaal de werkelijke afmetingen van het videoframe
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      
      // 2. Bereken de zichtbare afmetingen na toepassing van de zoom
      // Bedenk dat bij inzoomen een kleinere deel van de werkelijke video zichtbaar is
      const visibleWidth = videoWidth / zoomLevel;
      const visibleHeight = videoHeight / zoomLevel;
      
      // 3. Bereken de coördinaten voor het uitsnijden zodat we het midden blijven scannen
      // Door het verschil tussen originele en zichtbare afmetingen te halveren, blijven we in het midden
      const centerOffsetX = (videoWidth - visibleWidth) / 2;
      const centerOffsetY = (videoHeight - visibleHeight) / 2;
      
      // 4. Bereken nu het scanframe binnen het zichtbare deel
      const frameX = centerOffsetX + (visibleWidth - scanFrame.width) / 2;
      const frameY = centerOffsetY + (visibleHeight - scanFrame.height) / 2;
      
      // Pas canvas grootte aan voor optimale OCR (niet te klein)
      canvas.width = scanFrame.width;
      canvas.height = scanFrame.height;
      
      // Trek alleen het gedeelte binnen het kader op de canvas,
      // gecorrigeerd voor zoomniveau
      context.drawImage(
        video,                  // bron
        frameX, frameY,         // beginpunt uitsnede in bronafbeelding, gecorrigeerd voor zoom
        scanFrame.width, scanFrame.height,   // grootte uitsnede
        0, 0,                   // beginpunt op canvas
        scanFrame.width, scanFrame.height    // grootte op canvas
      );
      
      try {
        // Maak een kopie van originele afbeelding voor debug
        const originalImageData = canvas.toDataURL('image/png');
        
        // Maak een kopie voor debug weergave (voor afbeelding is verwerkt)
        if (showDebug) {
          setDebugImage(originalImageData);
        }
        
        // Pas beeldverbetering toe
        preprocessImage(canvas);
        
        // Maak een kopie van het geoptimaliseerde beeld
        const processedImageData = canvas.toDataURL('image/png');
        
        console.log("Verwerken van geoptimaliseerde afbeelding...");
        
        // DEBUG: Toon beelden in de console (als ontwikkelaar)
        if (showDebug) {
          setDebugImage(useImageProcessing ? processedImageData : originalImageData);
        }
        
        // TESSERACT PARAMETERS AANPASSEN
        // Geoptimaliseerde parameters voor cijferherkenning
        // Aangepast voor het bredere maar lagere scanframe (180px × 70px)
        await updateOcrParameters();
        
        const { data } = await workerRef.current.recognize(
          useImageProcessing ? processedImageData : originalImageData
        );
        const text = data.text.trim();
        
        // Debug info
        console.log("OCR tekst:", text);
        console.log("OCR confidence:", data.confidence);
        
        // Verbeterde nummerextractie
        // Eerst zoeken naar alle getallen in de gedetecteerde tekst
        const numbersFound = text.match(/\d+/g);
        console.log("Gevonden getallen:", numbersFound);
        
        if (numbersFound && numbersFound.length > 0) {
          // Neem de langste gedetecteerde cijferreeks (meestal accurater)
          // Of als er getallen met 4 cijfers zijn, geef die voorrang
          let bestNumber = '';
          let maxLength = 0;
          
          // Eerst zoeken naar 4-cijferige getallen (vaak eendnummers)
          const fourDigitNumbers = numbersFound.filter(num => num.length === 4);
          if (fourDigitNumbers.length > 0) {
            bestNumber = fourDigitNumbers[0];
          } else {
            // Anders het langste getal nemen
            for (const num of numbersFound) {
              if (num.length > maxLength) {
                maxLength = num.length;
                bestNumber = num;
              }
            }
          }
          
          // Als de confidence te laag is, probeer eens een langere tekstreeks te nemen
          const number = bestNumber;
          
          // Als we bezig zijn met verificatie
          if (verificationInProgress && lastDetectedNumber) {
            if (number === lastDetectedNumber) {
              // Nummer is geverifieerd, verwerk het nu
              setDetectedNumber(number);
              
              // Controleer of het nummer in de lijst voorkomt (verbeterde validatie)
              const isValid = validateNumber(number, duckNumbers);
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
  }, [duckNumbers, isProcessing, isStreaming, onNumberDetected, verificationInProgress, lastDetectedNumber, showDebug, useImageProcessing, zoomLevel, ocrQuality]);

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
    }, 2000); // Scan elke seconde
  }, [stopAutoScan, isProcessing, isStreaming, isPaused, captureImage]);

  // Start de camera
  const startCamera = async () => {
    try {
      setScanFeedback('Camera wordt gestart...');
      
      // Probeer eerst de achtercamera (environment)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: { exact: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setIsStreaming(true);
          setScanFeedback('Achtercamera actief, scannen start...');
        }
      } catch (envError) {
        console.log('Kan achtercamera niet gebruiken, probeer andere camera:', envError);
        
        // Als achtercamera mislukt, probeer dan elke beschikbare camera
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: true 
          });
          
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            setIsStreaming(true);
            setScanFeedback('Camera actief, scannen start...');
          }
        } catch (anyError) {
          throw new Error(`Geen camera's beschikbaar: ${anyError.message}`);
        }
      }
      
      setIsManualMode(false);
    } catch (err) {
      console.error('Fout bij het starten van de camera:', err);
      setScanFeedback(`Cameratoegang mislukt: ${err.message}. Handmatige invoer aanbevolen.`);
      // Automatisch overschakelen naar handmatige invoer als de camera niet werkt
      switchToManualMode();
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

  // Helper functie om een gedetecteerd nummer te valideren tegen de lijst
  const validateNumber = (detected, validNumbers) => {
    if (!detected || !validNumbers || !validNumbers.length) return false;
    
    // Converteer het gedetecteerde nummer naar een string en verwijder whitespace
    const cleanDetected = detected.toString().trim();
    
    // Debug logging
    console.log(`Valideren: "${cleanDetected}" (type: ${typeof cleanDetected})`);
    console.log(`Eerste paar geldige nummers: ${validNumbers.slice(0,5)}`);
    
    // Check of het nummer in de lijst voorkomt (string vergelijking)
    const isValid = validNumbers.includes(cleanDetected);
    console.log(`In lijst: ${isValid}`);
    
    return isValid;
  };

  // Voeg cijfer toe aan handmatige invoer
  const addDigit = (digit) => {
    const newInput = manualInput + digit;
    setManualInput(newInput);
    
    // Controleer het nummer direct na elke invoer
    setDetectedNumber(newInput);
    const isValid = validateNumber(newInput, duckNumbers);
    setIsValidNumber(isValid);
    
    // Rapporteer ook aan de parent component
    if (onNumberDetected) {
      onNumberDetected(newInput, isValid);
    }
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

  // Render het numeric keypad voor handmatige invoer - gebruik useMemo voor betere prestaties
  const renderKeypad = useMemo(() => {
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
  }, [manualInput, addDigit, clearInput, removeLastDigit, switchToCameraMode]);

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

  // Wijzig het zoomniveau
  const handleZoomChange = (e) => {
    const newZoom = parseFloat(e.target.value);
    setZoomLevel(newZoom);
    
    // Update feedback om te laten zien wat er gebeurt
    setScanFeedback(`Zoom niveau: ${Math.round(newZoom * 100)}%`);
    
    // Reset na korte tijd
    setTimeout(() => {
      if (isStreaming) {
        setScanFeedback('Camera actief, scannen start...');
      }
    }, 1000);
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
        
        <div className={`relative mb-2 rounded-lg overflow-hidden ${getCameraContainerClass()}`}>
          {/* Camera video met zoom */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full max-w-md h-auto"
            onPlay={() => setIsStreaming(true)}
            style={{ 
              transform: `scaleX(1) scale(${zoomLevel})`, // Zoom level toepassen
              transformOrigin: 'center center',           // Zoom vanuit het midden
              maxHeight: '60vh',                          // Beperk hoogte
              objectFit: 'cover',                         // Vul het kader
              backgroundColor: '#000'                     // Zwarte achtergrond
            }}
          />
          
          {/* Verborgen canvas voor beeldverwerking */}
          <canvas ref={canvasRef} className="hidden" />
          
          {/* Debug weergave als het is ingeschakeld */}
          {showDebug && debugImage && (
            <div className="absolute top-2 right-2 p-1 bg-white rounded shadow-md" style={{ width: '120px', height: '60px' }}>
              <img 
                src={debugImage} 
                alt="Debug" 
                className="w-full h-full object-contain"
              />
            </div>
          )}
          
          {/* Scan-kader overlay met duidelijkere instructies */}
          {isStreaming && (
            <div className="absolute top-0 left-0 right-0 bottom-0 flex items-center justify-center pointer-events-none">
              <div 
                className="border-4 rounded-md bg-transparent relative"
                style={{
                  width: `${scanFrame.width}px`,
                  height: `${scanFrame.height}px`,
                  boxShadow: '0 0 0 2000px rgba(0, 0, 0, 0.3)',
                  borderColor: isProcessing ? 'rgba(239, 68, 68, 0.8)' : 'rgba(59, 130, 246, 0.8)'
                }}
              >
                {/* Hoekmarkeringen voor betere visuele indicatie van scangebied */}
                <div className="absolute top-0 left-0 w-3 h-3 border-t-4 border-l-4 border-white"></div>
                <div className="absolute top-0 right-0 w-3 h-3 border-t-4 border-r-4 border-white"></div>
                <div className="absolute bottom-0 left-0 w-3 h-3 border-b-4 border-l-4 border-white"></div>
                <div className="absolute bottom-0 right-0 w-3 h-3 border-b-4 border-r-4 border-white"></div>
                
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-white drop-shadow-lg text-sm text-center px-2">
                    {isProcessing ? (
                      <>Scanning<span className="animate-pulse">...</span></>
                    ) : (
                      <>
                         <br/> 
                        <small></small>
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}
          
          {/* Status indicator voor scannen */}
          {isStreaming && (
            <div className="absolute bottom-2 left-2 right-2 bg-black bg-opacity-70 text-white p-2 rounded">
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
        
        {/* Zoom schuifbalk */}
        {isStreaming && (
          <div className="w-full max-w-md mb-4 px-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs">Uitzoomen</span>
              <span className="text-xs font-semibold">{Math.round(zoomLevel * 100)}%</span>
              <span className="text-xs">Inzoomen</span>
            </div>
            <div className="flex items-center">
              <input
                type="range"
                min="1.0"
                max="3.0"
                step="0.1"
                value={zoomLevel}
                onChange={handleZoomChange}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                aria-label="Zoom niveau"
              />
            </div>
            {/* Visuele indicator voor optimaal zoomniveau */}
            <div className="w-full h-4 mt-1 relative">
              <div className="absolute top-0 left-1/4 right-1/4 h-1 bg-gray-300 rounded-full"></div>
              <div 
                className="absolute top-0 h-1 bg-green-500 rounded-full transition-all duration-300"
                style={{
                  left: '40%',
                  right: '40%',
                  opacity: zoomLevel >= 1.8 && zoomLevel <= 2.2 ? 1 : 0.3
                }}
              ></div>
              <div 
                className="absolute top-0 left-1/2 w-4 h-4 bg-white border-2 rounded-full -ml-2 -mt-1.5 transition-all duration-300"
                style={{
                  borderColor: zoomLevel >= 1.8 && zoomLevel <= 2.2 ? '#10b981' : '#d1d5db',
                  transform: `translateX(${(zoomLevel - 1) * 100}px)`
                }}
              ></div>
              <div className="flex justify-between px-1 mt-1.5 text-[10px] text-gray-500">
                <span>1.0x</span>
                <span className="text-green-600 font-semibold">1.8-2.2x (optimaal)</span>
                <span>3.0x</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Geavanceerde opties (voor problemen oplossen) */}
        {isStreaming && (
          <div className="w-full max-w-md mb-4 px-3">
            <details className="bg-gray-100 p-2 rounded-lg text-sm">
              <summary className="font-medium cursor-pointer">OCR-hulp opties</summary>
              <div className="mt-2 space-y-2">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="useImageProcessing"
                    checked={useImageProcessing}
                    onChange={() => setUseImageProcessing(!useImageProcessing)}
                    className="mr-2 h-4 w-4"
                  />
                  <label htmlFor="useImageProcessing">
                    Beeldverwerking {useImageProcessing ? 'AAN' : 'UIT'}
                  </label>
                </div>
                
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="showDebug"
                    checked={showDebug}
                    onChange={() => setShowDebug(!showDebug)}
                    className="mr-2 h-4 w-4"
                  />
                  <label htmlFor="showDebug">
                    Debug weergave {showDebug ? 'AAN' : 'UIT'}
                  </label>
                </div>
                
                <div className="mt-3">
                  <label className="block mb-1 font-medium">OCR kwaliteit (snelheid/nauwkeurigheid):</label>
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      className={`px-2 py-1 text-xs rounded ${ocrQuality === 'fast' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                      onClick={() => {
                        setOcrQuality('fast');
                        updateOcrParameters();
                      }}
                    >
                      Snel
                    </button>
                    <button
                      className={`px-2 py-1 text-xs rounded ${ocrQuality === 'balanced' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                      onClick={() => {
                        setOcrQuality('balanced');
                        updateOcrParameters();
                      }}
                    >
                      Gebalanceerd
                    </button>
                    <button
                      className={`px-2 py-1 text-xs rounded ${ocrQuality === 'accurate' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                      onClick={() => {
                        setOcrQuality('accurate'); 
                        updateOcrParameters();
                      }}
                    >
                      Nauwkeurig
                    </button>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    Nauwkeuriger OCR kost meer tijd maar kan beter werken bij lastige nummers
                  </p>
                </div>
              </div>
            </details>
          </div>
        )}
        
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
        renderKeypad
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