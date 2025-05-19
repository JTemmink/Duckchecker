'use client';
import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createWorker } from 'tesseract.js';

export default function CameraScanner({ duckNumbers, onNumberDetected, initialMode = 'camera' }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [detectedNumber, setDetectedNumber] = useState('');
  const [isValidNumber, setIsValidNumber] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isManualMode, setIsManualMode] = useState(initialMode === 'manual');
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
  const [ocrQuality, setOcrQuality] = useState('accurate');
  const [advancedOcrVisible, setAdvancedOcrVisible] = useState(false);
  const [cameraFacing, setCameraFacing] = useState('environment'); // 'environment' (achter) of 'user' (voor)
  const [torchEnabled, setTorchEnabled] = useState(false); // flitser aan/uit
  const [mediaStream, setMediaStream] = useState(null); // Camera mediastream opslaan
  const [hasTorch, setHasTorch] = useState(false); // Of het apparaat een flitser heeft
  const [ocrSettings, setOcrSettings] = useState({
    // Segmentatie mode
    pagesegMode: 6, // 6 = blok tekst, 7 = één regel
    // OCR engine mode 
    engineMode: 2, // 2 = LSTM, 3 = alleen LSTM (sneller)
    // Tekst parameters
    heavyNr: true,
    minLinesize: 2.5,
    numericMode: true,
    preserveSpaces: false,
    // LSTM parameters
    lstmChoiceMode: 2,
    lstmIterations: 15,
    // Kwaliteitsparameters
    oldXheight: false,
    forcePropWords: false,
    doInvert: false, 
    goodQualityRating: 0.98,
    minSlope: 0.414,
    maxSlope: 0.414,
    minXheight: 8,
    maxOutlineChildren: 40,
  });
  
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
    
    // Nieuwe instellingen op basis van de gekozen kwaliteit
    let newSettings = { ...ocrSettings };
    
    switch (ocrQuality) {
      case 'fast':
        newSettings = {
          ...newSettings,
          pagesegMode: 7,           // Eén regel tekst
          engineMode: 3,            // Alleen LSTM (sneller)
          heavyNr: true,
          minLinesize: 2.5,
          numericMode: true,
          preserveSpaces: false,
          lstmChoiceMode: 1,         // Snelle modus
          lstmIterations: 10,
          goodQualityRating: 0.95,
        };
        break;
        
      case 'accurate':
        newSettings = {
          ...newSettings,
          pagesegMode: 6,           // Blok tekst (nauwkeuriger voor getallen)
          engineMode: 2,            // LSTM (nauwkeuriger)
          heavyNr: true,
          minLinesize: 2.5,
          numericMode: true,
          preserveSpaces: false,
          lstmChoiceMode: 2,         // Betere kwaliteit
          lstmIterations: 15,
          oldXheight: false,
          forcePropWords: false,
          doInvert: false,
          goodQualityRating: 0.98,
          minSlope: 0.414,
          maxSlope: 0.414, 
          minXheight: 8,
          maxOutlineChildren: 40,
        };
        break;
        
      default: // 'balanced'
        newSettings = {
          ...newSettings,
          pagesegMode: 7,
          engineMode: 2,
          heavyNr: true,
          minLinesize: 2.5,
          numericMode: true,
          preserveSpaces: false,
          lstmChoiceMode: 1,
          lstmIterations: 12,
          doInvert: false,
          goodQualityRating: 0.96,
        };
    }
    
    // Update state met de nieuwe instellingen
    setOcrSettings(newSettings);
    
    // Pas de nieuwe instellingen toe
    await applyCustomOcrParameters(newSettings);
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
      
      // Pas canvas grootte aan voor optimale OCR
      canvas.width = scanFrame.width;
      canvas.height = scanFrame.height;
      
      // VERBETERDE BEREKENING: Exact wat in het kader zichtbaar is uitsnijden
      // rekening houdend met zoomniveau
      
      // 1. Bepaal de werkelijke afmetingen van het videoframe
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      
      // 2. Bereken het middelpunt van de video
      const centerX = videoWidth / 2;
      const centerY = videoHeight / 2;
      
      // 3. Bereken de schaal voor het uitsnijden, rekening houdend met zoom
      // Dit zorgt dat we precies het juiste gebied uitsnijden dat in het kader zichtbaar is
      const scaledWidth = scanFrame.width * zoomLevel;
      const scaledHeight = scanFrame.height * zoomLevel;
      
      // 4. Bereken de coördinaten voor het uitsnijden vanuit het midden
      // Dit zorgt dat we het juiste gebied pakken, ongeacht het zoomniveau
      const frameX = centerX - (scaledWidth / 2);
      const frameY = centerY - (scaledHeight / 2);
      
      // Trek alleen het gedeelte binnen het kader op de canvas
      context.drawImage(
        video,                // bron
        frameX, frameY,       // beginpunt uitsnede in bronafbeelding, gecorrigeerd voor zoom
        scaledWidth, scaledHeight,  // grootte uitsnede, gecorrigeerd voor zoom
        0, 0,                 // beginpunt op canvas
        scanFrame.width, scanFrame.height // grootte op canvas (vast)
      );
      
      // Maak een kopie van originele afbeelding voor debug
      const originalImageData = canvas.toDataURL('image/png');
      
      // Update debug weergave direct om te tonen wat er wordt gescand
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
        // Filter en pad getallen zodat ze exact 4 cijfers hebben
        const filteredNumbers = numbersFound.map(num => {
          if (num.length > 4) {
            // Als het getal langer is dan 4 cijfers, neem alleen de laatste 4
            return num.slice(-4);
          } else if (num.length < 4) {
            // Als het getal korter is dan 4 cijfers, vul aan met voorloopnullen
            return num.padStart(4, '0');
          }
          return num; // Al 4 cijfers
        });
        
        console.log("Gefilterde getallen (exact 4 cijfers):", filteredNumbers);
        
        let bestNumber = '';
        
        // Zoek naar exacte 4-cijferige getallen (prioriteit)
        const fourDigitNumbers = filteredNumbers.filter(num => num.length === 4);
        if (fourDigitNumbers.length > 0) {
          bestNumber = fourDigitNumbers[0];
        } else {
          // Als er geen 4-cijferige getallen zijn (wat niet zou moeten gebeuren), 
          // neem het langste beschikbare getal
          let maxLength = 0;
          for (const num of filteredNumbers) {
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
        console.log("Nieuwe scan gestart - " + new Date().toLocaleTimeString());
      }
    }, 2000);
  }, [stopAutoScan, isProcessing, isStreaming, isPaused, captureImage]);

  // Start de camera
  const startCamera = async () => {
    try {
      setScanFeedback('Camera wordt gestart...');
      
      // Stop bestaande camera stream als die er is
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }
      
      // Probeer gewenste camera te starten
      try {
        const constraints = {
          video: {
            facingMode: { ideal: cameraFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        };
        
        console.log(`Probeert camera te starten met facing mode: ${cameraFacing}`);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setIsStreaming(true);
          setMediaStream(stream); // Sla stream op voor latere toegang
          
          // Controleer of de camera een flitser/torch heeft
          const videoTrack = stream.getVideoTracks()[0];
          
          // Functionaliteit voor flitser/torch controleren
          if (videoTrack) {
            const capabilities = videoTrack.getCapabilities();
            const hasFlash = capabilities && capabilities.torch;
            
            setHasTorch(hasFlash || false);
            console.log(`Camera heeft flitser: ${hasFlash ? 'JA' : 'NEE'}`);
            setScanFeedback(`${cameraFacing === 'environment' ? 'Achter' : 'Voor'}camera actief${hasFlash ? ' (flitser beschikbaar)' : ''}`);
          } else {
            setHasTorch(false);
          }
        }
      } catch (primaryError) {
        console.log(`Kan camera met facing mode '${cameraFacing}' niet gebruiken:`, primaryError);
        
        // Als de gewenste camera niet werkt, probeer dan de andere
        const alternateFacing = cameraFacing === 'environment' ? 'user' : 'environment';
        
        try {
          const alternateConstraints = {
            video: {
              facingMode: { ideal: alternateFacing },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          };
          
          console.log(`Probeert alternatieve camera (${alternateFacing}) te gebruiken...`);
          const alternateStream = await navigator.mediaDevices.getUserMedia(alternateConstraints);
          
          if (videoRef.current) {
            videoRef.current.srcObject = alternateStream;
            setIsStreaming(true);
            setMediaStream(alternateStream);
            setCameraFacing(alternateFacing); // Update de camera-richting state
            
            // Controleer flitser voor de alternatieve camera
            const videoTrack = alternateStream.getVideoTracks()[0];
            if (videoTrack) {
              const capabilities = videoTrack.getCapabilities();
              const hasFlash = capabilities && capabilities.torch;
              setHasTorch(hasFlash || false);
              setScanFeedback(`${alternateFacing === 'environment' ? 'Achter' : 'Voor'}camera actief${hasFlash ? ' (flitser beschikbaar)' : ''}`);
            }
          }
        } catch (alternateError) {
          // Als beide camera's niet werken, probeer dan gewoon elke beschikbare camera
          console.log('Beide camera\'s mislukten, probeert elke beschikbare camera:', alternateError);
          
          try {
            const anyStream = await navigator.mediaDevices.getUserMedia({ video: true });
            
            if (videoRef.current) {
              videoRef.current.srcObject = anyStream;
              setIsStreaming(true);
              setMediaStream(anyStream);
              
              // Controleer flitser
              const videoTrack = anyStream.getVideoTracks()[0];
              if (videoTrack) {
                const capabilities = videoTrack.getCapabilities();
                const hasFlash = capabilities && capabilities.torch;
                setHasTorch(hasFlash || false);
                setScanFeedback(`Camera actief${hasFlash ? ' (flitser beschikbaar)' : ''}`);
              }
            }
          } catch (anyError) {
            throw new Error(`Geen camera's beschikbaar: ${anyError.message}`);
          }
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
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      setMediaStream(null);
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setIsStreaming(false);
    stopAutoScan();
    setTorchEnabled(false); // Zet de flitser uit wanneer de camera stopt
  };
  
  // Schakel tussen voor- en achtercamera
  const switchCamera = async () => {
    // Toggle tussen 'environment' (achter) en 'user' (voor)
    const newFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(newFacing);
    
    // Stop huidige stream
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
    }
    
    // Reset flitser status omdat we van camera wisselen
    setTorchEnabled(false);
    setHasTorch(false);
    
    // Herstart camera met nieuwe richting
    setScanFeedback(`Wisselen naar ${newFacing === 'environment' ? 'achter' : 'voor'}camera...`);
    
    // Geef tijd om de camera-richting state bij te werken
    setTimeout(() => {
      startCamera();
    }, 100);
  };
  
  // Schakel de flitser/torch aan of uit
  const toggleTorch = async () => {
    if (!mediaStream || !hasTorch) return;
    
    try {
      const videoTrack = mediaStream.getVideoTracks()[0];
      if (!videoTrack) return;
      
      const newTorchValue = !torchEnabled;
      await videoTrack.applyConstraints({
        advanced: [{ torch: newTorchValue }]
      });
      
      setTorchEnabled(newTorchValue);
      setScanFeedback(`Flitser ${newTorchValue ? 'AAN' : 'UIT'}`);
      
      // Reset feedback na korte tijd
      setTimeout(() => {
        if (isStreaming) {
          setScanFeedback('Camera actief, scannen gaat door...');
        }
      }, 1000);
    } catch (error) {
      console.error('Kon flitser niet schakelen:', error);
      setScanFeedback('Kon flitser niet schakelen');
      setHasTorch(false); // Reset hasTorch omdat het waarschijnlijk niet ondersteund wordt
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
    
    // Zorg dat we het exacte pad cijfers hebben - pad met nullen indien nodig
    const paddedDetected = cleanDetected.padStart(4, '0');
    
    // Check of het nummer in de lijst voorkomt (string vergelijking)
    // Probeer zowel met als zonder padding voor het geval dat
    const isValid = validNumbers.includes(paddedDetected) || validNumbers.includes(cleanDetected);
    
    console.log(`Zoeken naar: "${paddedDetected}" of "${cleanDetected}"`);
    console.log(`In lijst: ${isValid}`);
    
    return isValid;
  };

  // Voeg cijfer toe aan handmatige invoer
  const addDigit = (digit) => {
    // Stop als we al 4 cijfers hebben bereikt
    if (manualInput.length >= 4) return;
    
    const newInput = manualInput + digit;
    setManualInput(newInput);
    
    // Controleer het nummer direct na elke invoer
    setDetectedNumber(newInput);
    
    // Valideer pas wanneer we 4 cijfers hebben of als dit een getal is dat met 0 begint
    // (dan valideren we ook onmiddellijk bij 1, 2 of 3 cijfers)
    const isValid = validateNumber(newInput, duckNumbers);
    setIsValidNumber(isValid);
    
    console.log(`Handmatige invoer: "${newInput}", Geldig: ${isValid}`);
    
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
    // Bepaal de juiste achtergrondkleur voor het invoerveld op basis van validatie
    let inputBgClass = "bg-gray-100"; // Standaard grijze achtergrond
    
    // Als er een invoer is en validatie heeft plaatsgevonden
    if (manualInput && isValidNumber !== null) {
      inputBgClass = isValidNumber ? "bg-green-100" : "bg-red-100";
    }
    
    return (
      <div className="flex flex-col items-center w-full max-w-xs mx-auto">
        <div className={`w-full p-4 mb-4 text-center ${inputBgClass} rounded-lg transition-colors duration-300 border`} 
             style={{borderColor: isValidNumber === true ? '#10b981' : isValidNumber === false ? '#ef4444' : '#e5e7eb'}}>
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
  }, [manualInput, isValidNumber, addDigit, clearInput, removeLastDigit, switchToCameraMode]);

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
          
          {/* Camera bedieningsknoppen (schakelaar en flitser) */}
          {isStreaming && (
            <div className="absolute top-2 left-2 right-2 flex justify-between items-center">
              {/* Camera schakelknop */}
              <button
                onClick={switchCamera}
                className="bg-black bg-opacity-50 text-white p-2 rounded-full w-10 h-10 flex items-center justify-center"
                title="Wissel camera"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </button>
              
              {/* Flitser knop (alleen tonen als beschikbaar) */}
              {hasTorch && (
                <button
                  onClick={toggleTorch}
                  className={`p-2 rounded-full w-10 h-10 flex items-center justify-center ${torchEnabled ? 'bg-yellow-500 text-black' : 'bg-black bg-opacity-50 text-white'}`}
                  title={`Flitser ${torchEnabled ? 'uit' : 'aan'} zetten`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </button>
              )}
            </div>
          )}
          
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
                  <p className="text-xs text-gray-600 mt-1 mb-3">
                    Nauwkeuriger OCR kost meer tijd maar kan beter werken bij lastige nummers
                  </p>
                  
                  {/* Toggle voor geavanceerde OCR-instellingen */}
                  <div 
                    className="flex items-center justify-between cursor-pointer px-3 py-2 bg-gray-200 rounded hover:bg-gray-300"
                    onClick={() => setAdvancedOcrVisible(!advancedOcrVisible)}
                  >
                    <span className="font-medium text-sm">Geavanceerde OCR-instellingen</span>
                    <span className="text-xs">{advancedOcrVisible ? '▼' : '▶'}</span>
                  </div>
                  
                  {/* Geavanceerde OCR-instellingen */}
                  {advancedOcrVisible && (
                    <div className="mt-2 bg-gray-100 p-3 rounded-lg space-y-4 text-sm">
                      <div>
                        <h4 className="font-semibold mb-2 text-blue-800">Algemene OCR-instellingen</h4>
                        
                        {/* Paginasegmentatie modus */}
                        <div className="mb-3">
                          <label className="block mb-1 text-sm font-medium">
                            Paginasegmentatie Modus: <span className="text-blue-600">{ocrSettings.pagesegMode}</span>
                          </label>
                          <div className="flex text-xs text-gray-600 mb-1 justify-between">
                            <span>Blok tekst</span>
                            <span>Eén regel</span>
                            <span>Eén woord</span>
                          </div>
                          <input
                            type="range"
                            min="1"
                            max="13"
                            step="1"
                            value={ocrSettings.pagesegMode}
                            onChange={(e) => updateOcrSetting('pagesegMode', parseInt(e.target.value))}
                            className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                          <div className="text-[10px] text-gray-500 mt-1">
                            6 = Blok tekst (nauwkeuriger) / 7 = Eén regel / 8 = Eén woord
                          </div>
                        </div>
                        
                        {/* Engine modus */}
                        <div className="mb-3">
                          <label className="block mb-1 text-sm font-medium">
                            OCR Engine Modus: <span className="text-blue-600">{ocrSettings.engineMode}</span>
                          </label>
                          <div className="flex text-xs text-gray-600 mb-1 justify-between">
                            <span>Legacy + LSTM</span>
                            <span>Alleen LSTM</span>
                          </div>
                          <input
                            type="range"
                            min="2"
                            max="3"
                            step="1"
                            value={ocrSettings.engineMode}
                            onChange={(e) => updateOcrSetting('engineMode', parseInt(e.target.value))}
                            className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                          <div className="text-[10px] text-gray-500 mt-1">
                            2 = Legacy + LSTM (nauwkeuriger) / 3 = Alleen LSTM (sneller)
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="font-semibold mb-2 text-blue-800">Tekstherkenning Parameters</h4>
                        
                        {/* Binary toggles voor tekstherkenning */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              id="heavyNr"
                              checked={ocrSettings.heavyNr}
                              onChange={(e) => updateOcrSetting('heavyNr', e.target.checked)}
                              className="mr-2 h-4 w-4"
                            />
                            <label htmlFor="heavyNr" className="text-xs">
                              Heavy NR
                            </label>
                          </div>
                          
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              id="numericMode"
                              checked={ocrSettings.numericMode}
                              onChange={(e) => updateOcrSetting('numericMode', e.target.checked)}
                              className="mr-2 h-4 w-4"
                            />
                            <label htmlFor="numericMode" className="text-xs">
                              Numeric Mode
                            </label>
                          </div>
                          
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              id="preserveSpaces"
                              checked={ocrSettings.preserveSpaces}
                              onChange={(e) => updateOcrSetting('preserveSpaces', e.target.checked)}
                              className="mr-2 h-4 w-4"
                            />
                            <label htmlFor="preserveSpaces" className="text-xs">
                              Spaties behouden
                            </label>
                          </div>
                          
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              id="doInvert"
                              checked={ocrSettings.doInvert}
                              onChange={(e) => updateOcrSetting('doInvert', e.target.checked)}
                              className="mr-2 h-4 w-4"
                            />
                            <label htmlFor="doInvert" className="text-xs">
                              Inverteer beeld
                            </label>
                          </div>
                        </div>
                        
                        {/* Min Line Size */}
                        <div className="mt-3">
                          <label className="block mb-1 text-sm font-medium">
                            Min Line Size: <span className="text-blue-600">{ocrSettings.minLinesize.toFixed(1)}</span>
                          </label>
                          <input
                            type="range"
                            min="1"
                            max="5"
                            step="0.1"
                            value={ocrSettings.minLinesize}
                            onChange={(e) => updateOcrSetting('minLinesize', parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="font-semibold mb-2 text-blue-800">LSTM Parameters</h4>
                        
                        {/* LSTM Choice Mode */}
                        <div className="mb-3">
                          <label className="block mb-1 text-sm font-medium">
                            LSTM Choice Mode: <span className="text-blue-600">{ocrSettings.lstmChoiceMode}</span>
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="3"
                            step="1"
                            value={ocrSettings.lstmChoiceMode}
                            onChange={(e) => updateOcrSetting('lstmChoiceMode', parseInt(e.target.value))}
                            className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                          <div className="text-[10px] text-gray-500 mt-1">
                            0 = Standaard / 1 = Snel / 2 = Betere kwaliteit
                          </div>
                        </div>
                        
                        {/* LSTM Iterations */}
                        <div className="mb-3">
                          <label className="block mb-1 text-sm font-medium">
                            LSTM Iteraties: <span className="text-blue-600">{ocrSettings.lstmIterations}</span>
                          </label>
                          <input
                            type="range"
                            min="5"
                            max="25"
                            step="1"
                            value={ocrSettings.lstmIterations}
                            onChange={(e) => updateOcrSetting('lstmIterations', parseInt(e.target.value))}
                            className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                          <div className="text-[10px] text-gray-500 mt-1">
                            Hoger = nauwkeuriger maar langzamer (aanbevolen: 10-15)
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="font-semibold mb-2 text-blue-800">Kwaliteit Parameters</h4>
                        
                        {/* Kwaliteitsrating */}
                        <div className="mb-3">
                          <label className="block mb-1 text-sm font-medium">
                            Quality Rating: <span className="text-blue-600">{ocrSettings.goodQualityRating.toFixed(2)}</span>
                          </label>
                          <input
                            type="range"
                            min="0.8"
                            max="1.0"
                            step="0.01"
                            value={ocrSettings.goodQualityRating}
                            onChange={(e) => updateOcrSetting('goodQualityRating', parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                        </div>
                        
                        {/* Min X Height */}
                        <div className="mb-3">
                          <label className="block mb-1 text-sm font-medium">
                            Min X Height: <span className="text-blue-600">{ocrSettings.minXheight}</span>
                          </label>
                          <input
                            type="range"
                            min="5"
                            max="15"
                            step="1"
                            value={ocrSettings.minXheight}
                            onChange={(e) => updateOcrSetting('minXheight', parseInt(e.target.value))}
                            className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                        </div>
                        
                        {/* Reset knop */}
                        <button
                          onClick={() => {
                            // Zet alle instellingen terug naar standaardwaarden
                            const defaultSettings = {
                              pagesegMode: 6,
                              engineMode: 2,
                              heavyNr: true,
                              minLinesize: 2.5,
                              numericMode: true,
                              preserveSpaces: false,
                              lstmChoiceMode: 2,
                              lstmIterations: 15,
                              oldXheight: false,
                              forcePropWords: false,
                              doInvert: false,
                              goodQualityRating: 0.98,
                              minSlope: 0.414,
                              maxSlope: 0.414,
                              minXheight: 8,
                              maxOutlineChildren: 40,
                            };
                            setOcrSettings(defaultSettings);
                            applyCustomOcrParameters(defaultSettings);
                          }}
                          className="w-full px-2 py-1 bg-red-500 text-white rounded-lg text-sm mt-3"
                        >
                          Reset alle OCR-instellingen
                        </button>
                      </div>
                    </div>
                  )}
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

  // Voeg dit effect toe om de camera automatisch te starten als dat de initiële modus is
  useEffect(() => {
    if (initialMode === 'camera' && !isStreaming && !isManualMode) {
      startCamera();
    }
  }, []);

  useEffect(() => {
    // Voeg debug informatie toe wanneer de component laadt
    if (duckNumbers && duckNumbers.length > 0) {
      console.log('Geladen eendnummers (eerste 10):', duckNumbers.slice(0, 10));
      console.log('Totaal aantal eendnummers:', duckNumbers.length);
    }
  }, [duckNumbers]);

  // Update ocrSettings object met nieuwe waarde
  const updateOcrSetting = (key, value) => {
    const newSettings = { ...ocrSettings, [key]: value };
    setOcrSettings(newSettings);
    
    // Update de OCR parameters met de nieuwe instellingen
    applyCustomOcrParameters(newSettings);
  };
  
  // Functie om aangepaste OCR parameters toe te passen
  const applyCustomOcrParameters = async (settings) => {
    if (!workerRef.current) return;
    
    // Basisinstellingen worden altijd toegepast
    const baseParams = {
      tessedit_char_whitelist: '0123456789',
      tessjs_create_hocr: '0',
      tessjs_create_tsv: '0',
      tessjs_create_box: '0',
      tessjs_create_unlv: '0',
      tessjs_create_osd: '0',
      segment_nonalphabetic_script: '1',
      textord_space_size_is_variable: '0'
    };
    
    // Aangepaste parameters op basis van de UI-instellingen
    const customParams = {
      tessedit_pageseg_mode: settings.pagesegMode.toString(),
      tessedit_ocr_engine_mode: settings.engineMode.toString(),
      textord_heavy_nr: settings.heavyNr ? '1' : '0',
      textord_min_linesize: settings.minLinesize.toString(),
      classify_bln_numeric_mode: settings.numericMode ? '1' : '0',
      preserve_interword_spaces: settings.preserveSpaces ? '1' : '0',
      lstm_choice_mode: settings.lstmChoiceMode.toString(),
      lstm_choice_iterations: settings.lstmIterations.toString(),
      textord_really_old_xheight: settings.oldXheight ? '1' : '0',
      textord_force_make_prop_words: settings.forcePropWords ? '1' : '0',
      tessedit_do_invert: settings.doInvert ? '1' : '0',
      tessedit_good_quality_rating: settings.goodQualityRating.toString(),
      classify_min_slope: settings.minSlope.toString(),
      classify_max_slope: settings.maxSlope.toString(),
      textord_min_xheight: settings.minXheight.toString(),
      edges_max_children_per_outline: settings.maxOutlineChildren.toString(),
    };
    
    // Combineer basis en aangepaste parameters
    const combinedParams = { ...baseParams, ...customParams };
    
    // Pas parameters toe op de worker
    try {
      await workerRef.current.setParameters(combinedParams);
      console.log('OCR parameters toegepast:', combinedParams);
      setScanFeedback('OCR instellingen bijgewerkt');
      setTimeout(() => {
        if (isStreaming) {
          setScanFeedback('Camera actief, scannen gaat door...');
        }
      }, 1500);
    } catch (error) {
      console.error('Fout bij het instellen van OCR parameters:', error);
    }
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