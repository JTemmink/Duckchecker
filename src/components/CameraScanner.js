'use client';
import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createWorker } from 'tesseract.js';
import cv from 'opencv-ts';

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
  const processingTimeRef = useRef(null); // Tijdstip waarop de verwerking is gestart
  const [isPaused, setIsPaused] = useState(false);
  const [lastDetectedNumber, setLastDetectedNumber] = useState(null);
  const [verificationInProgress, setVerificationInProgress] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [showDebug, setShowDebug] = useState(false);
  const [debugImage, setDebugImage] = useState(null);
  const [debugProcessedImage, setDebugProcessedImage] = useState(null);
  const [useImageProcessing, setUseImageProcessing] = useState(true);
  const [ocrQuality, setOcrQuality] = useState('accurate');
  const [advancedOcrVisible, setAdvancedOcrVisible] = useState(false);
  const [cameraFacing, setCameraFacing] = useState('environment'); // 'environment' (achter) of 'user' (voor)
  const [torchEnabled, setTorchEnabled] = useState(false); // flitser aan/uit
  const [mediaStream, setMediaStream] = useState(null); // Camera mediastream opslaan
  const [hasTorch, setHasTorch] = useState(false); // Of het apparaat een flitser heeft
  const [openCvLoaded, setOpenCvLoaded] = useState(false); // Toegevoegd om OpenCV status bij te houden
  const [processingTechnique, setProcessingTechnique] = useState('adaptive'); // 'adaptive', 'binary', 'canny'
  const [skipPreprocessing, setSkipPreprocessing] = useState(false); // Optie om voorbewerking over te slaan
  const [extraProcessingOptions, setExtraProcessingOptions] = useState({
    contrastLevel: 1.5,       // Contrastniveau (1.0 = normaal, 2.0 = hoog contrast)
    brightnessAdjust: 10,     // Helderheidsaanpassing (-50 tot 50)
    gammaCorrection: 0.5,     // Gamma correctie (0.5 = standaard per gebruikerswens, <1 donkerder, >1 lichter)
    invertColors: false,      // Kleuren inverteren
    rotationAngle: 0,         // Rotatie in graden
    applySharpening: true,    // Verscherping toepassen
    denoisingStrength: 3,     // Ruisonderdrukking (0-10)
    dilationSize: 2,          // Dikte van de cijfers (1-5)
    autoCorrectSkew: false,   // Automatische scheefstandcorrectie
    edgeEnhancement: false,   // Extra randverbetering
  });
  const [cameraSettings, setCameraSettings] = useState({
    exposureMode: 'auto',     // 'auto', 'manual'
    exposureCompensation: 0,  // -3 tot +3
    focusMode: 'continuous',  // 'continuous', 'manual', 'fixed'
    whiteBalance: 'auto',     // 'auto', 'cloudy', 'sunny', 'fluorescent'
    colorTemperature: 'auto', // 'auto' of specifieke waarde
    iso: 'auto',              // 'auto' of specifieke waarde
    captureMode: 'normal',    // 'normal', 'hdr', 'lowlight'
  });
  const [showAdvancedCamera, setShowAdvancedCamera] = useState(false);
  const [showAdvancedProcessing, setShowAdvancedProcessing] = useState(false);
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
    // Verbeterde parameter voor cijferherkenning
    dignormNormalizeMode: 8, // Speciale normalisatie voor cijfers
    dignormAdjNonSpace: true, // Betere afstandsbepaling tussen cijfers
    dignormQuadMoments: true, // Verbeterde patroonherkenning voor cijfers
  });
  
  // Instellingen voor het scan-kader als constante (niet als state)
  const scanFrame = {
    width: 180,  // Breedte van het kader in pixels (iets breder voor meer context)
    height: 70, // Hoogte van het kader in pixels (iets hoger voor meer ruimte rond cijfers)
    // Pixeldichtheid voor betere kwaliteit (hoger = meer detail in dezelfde afmeting)
    pixelDensity: 2.0, // Verdubbel de pixeldichtheid voor betere kwaliteit
  };

  // Helper functie om een gedetecteerd nummer te valideren tegen de lijst
  const validateNumber = (detected, validNumbers) => {
    if (!detected || !validNumbers) {
      console.log("Validatie gefaald: geen gedetecteerd nummer of validatienummers");
      return false;
    }
    
    if (!validNumbers.length) {
      console.warn("Waarschuwing: validatienummers lijst is leeg");
      return false;
    }
    
    // Converteer het gedetecteerde nummer naar een string en verwijder whitespace
    const cleanDetected = detected.toString().trim();
    
    // Zorg dat we het exacte pad cijfers hebben - pad met nullen indien nodig
    const paddedDetected = cleanDetected.padStart(4, '0');
    
    // Debug informatie over de validatienummers
    console.log(`Valideren: "${cleanDetected}" (type: ${typeof cleanDetected})`);
    console.log(`Gepaddeerd nummer: "${paddedDetected}" (type: ${typeof paddedDetected})`);
    console.log(`Eerste paar geldige nummers:`, validNumbers.slice(0, 5));
    console.log(`Type van validNumbers: ${typeof validNumbers}, Is Array: ${Array.isArray(validNumbers)}`);
    
    // Verschillende formaten proberen voor de vergelijking
    // Dit helpt bij problemen met string vs. number conversies
    let isValid = false;
    
    // 1. Directe vergelijking
    if (validNumbers.includes(cleanDetected) || validNumbers.includes(paddedDetected)) {
      console.log(`Match gevonden door directe vergelijking`);
      isValid = true;
    } 
    // 2. Vergelijken na nummer-conversie (voor als validNumbers getallen bevat)
    else if (paddedDetected.length === 4 && /^\d+$/.test(paddedDetected)) {
      const numericValue = parseInt(paddedDetected, 10);
      // Als validNumbers getallen bevat, controleer op numerieke match
      const hasNumericMatch = validNumbers.some(vn => {
        const vnAsNumber = parseInt(vn, 10);
        return !isNaN(vnAsNumber) && vnAsNumber === numericValue;
      });
      
      if (hasNumericMatch) {
        console.log(`Match gevonden na nummer-conversie`);
        isValid = true;
      }
    }
    
    // 3. Vergelijking na stringconversie (case-sensitive)
    if (!isValid) {
      const stringValidNumbers = validNumbers.map(n => n.toString().trim());
      if (stringValidNumbers.includes(cleanDetected) || stringValidNumbers.includes(paddedDetected)) {
        console.log(`Match gevonden na string-conversie`);
        isValid = true;
      }
    }
    
    // 4. Case-insensitive vergelijking (voor het geval er letters in zitten)
    if (!isValid) {
      const lowerDetected = paddedDetected.toLowerCase();
      const hasLowerMatch = validNumbers.some(vn => 
        vn.toString().toLowerCase().trim() === lowerDetected
      );
      
      if (hasLowerMatch) {
        console.log(`Match gevonden na case-insensitive vergelijking`);
        isValid = true;
      }
    }
    
    console.log(`Zoeken naar: "${paddedDetected}" of "${cleanDetected}"`);
    console.log(`In lijst: ${isValid}`);
    
    return isValid;
  };

  // Bereken achtergrondkleur voor camera container
  const getCameraContainerClass = () => {
    if (!isValidNumber && detectedNumber) {
      return "border-4 border-red-500 bg-red-100 bg-opacity-50"; // Dikkere rand en hogere dekking
    } else if (isValidNumber) {
      return "border-4 border-green-500 bg-green-100 bg-opacity-50"; // Dikkere rand en hogere dekking
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

  // Start de camera
  const startCamera = async () => {
    try {
      setScanFeedback('Camera wordt gestart...');
      
      // Stop bestaande camera stream als die er is
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }
      
      // Detecteer of het apparaat een laptop/desktop is (geen mobiel apparaat)
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      
      // Gebruik standaard de frontcamera voor laptops/desktops en achtercamera voor mobiele apparaten
      let initialFacingMode = isMobileDevice ? cameraFacing : 'user';
      
      // Probeer gewenste camera te starten
      try {
        // Voeg camera-instellingen toe aan constraints op basis van de instellingen in de state
        const constraints = {
          video: {
            facingMode: { ideal: initialFacingMode },
            width: { ideal: 1920 },  // Verhoogd van 1280 naar 1920 voor betere kwaliteit
            height: { ideal: 1080 }, // Verhoogd van 720 naar 1080 voor betere kwaliteit
            aspectRatio: { ideal: 1.777778 }, // 16:9 aspect ratio
            // Probeer hogere framerates indien beschikbaar
            frameRate: { min: 15, ideal: 30, max: 60 }
          }
        };
        
        // Voeg geavanceerde camera-instellingen toe als deze ondersteund worden
        const advancedConstraints = [];
        
        // Focus mode
        if (cameraSettings.focusMode !== 'auto') {
          advancedConstraints.push({ focusMode: cameraSettings.focusMode });
        }
        
        // Exposure compensation
        if (cameraSettings.exposureCompensation !== 0) {
          advancedConstraints.push({ exposureCompensation: cameraSettings.exposureCompensation });
        }
        
        // White balance mode
        if (cameraSettings.whiteBalance !== 'auto') {
          let colorTemp;
          switch (cameraSettings.whiteBalance) {
            case 'cloudy': colorTemp = 6500; break;
            case 'sunny': colorTemp = 5500; break;
            case 'fluorescent': colorTemp = 4000; break;
            default: colorTemp = 5000;
          }
          advancedConstraints.push({ 
            whiteBalanceMode: cameraSettings.whiteBalance === 'auto' ? 'continuous' : 'manual',
            colorTemperature: colorTemp
          });
        }
        
        // Voeg de geavanceerde instellingen toe aan de constraints als ze er zijn
        if (advancedConstraints.length > 0) {
          constraints.video.advanced = advancedConstraints;
        }
        
        console.log(`Probeert camera te starten met facing mode: ${initialFacingMode} en instellingen:`, constraints);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setIsStreaming(true);
          setMediaStream(stream); // Sla stream op voor latere toegang
          setCameraFacing(initialFacingMode); // Update de camera-richting state met wat daadwerkelijk gebruikt wordt
          
          // Controleer of de camera een flitser/torch heeft
          const videoTrack = stream.getVideoTracks()[0];
          
          // Functionaliteit voor flitser/torch controleren
          if (videoTrack) {
            const capabilities = videoTrack.getCapabilities();
            console.log('Camera capabilities:', capabilities);
            const hasFlash = capabilities && capabilities.torch;
            
            setHasTorch(hasFlash || false);
            console.log(`Camera heeft flitser: ${hasFlash ? 'JA' : 'NEE'}`);
            setScanFeedback(`${initialFacingMode === 'environment' ? 'Achter' : 'Voor'}camera actief${hasFlash ? ' (flitser beschikbaar)' : ''}`);
            
            // Pas eventuele geavanceerde instellingen toe die beschikbaar zijn maar niet in constraints konden
            try {
              // Toegang tot camera-instellingen alleen beschikbaar na initialisatie
              if (capabilities) {
                let appliedSettings = [];
                
                // Focus mode
                if (capabilities.focusMode && capabilities.focusMode.includes(cameraSettings.focusMode)) {
                  await videoTrack.applyConstraints({
                    advanced: [{ focusMode: cameraSettings.focusMode }]
                  });
                  appliedSettings.push(`focus: ${cameraSettings.focusMode}`);
                }
                
                // Exposure compensation
                if (capabilities.exposureCompensation && 
                    cameraSettings.exposureCompensation >= capabilities.exposureCompensation.min &&
                    cameraSettings.exposureCompensation <= capabilities.exposureCompensation.max) {
                  await videoTrack.applyConstraints({
                    advanced: [{ exposureCompensation: cameraSettings.exposureCompensation }]
                  });
                  appliedSettings.push(`belichting: ${cameraSettings.exposureCompensation}`);
                }
                
                // White balance mode
                if (capabilities.whiteBalanceMode) {
                  const mode = cameraSettings.whiteBalance === 'auto' ? 'continuous' : 'manual';
                  if (capabilities.whiteBalanceMode.includes(mode)) {
                    await videoTrack.applyConstraints({
                      advanced: [{ whiteBalanceMode: mode }]
                    });
                    appliedSettings.push(`witbalans: ${cameraSettings.whiteBalance}`);
                  }
                }
                
                if (appliedSettings.length > 0) {
                  console.log('Toegepaste camera-instellingen:', appliedSettings.join(', '));
                }
              }
            } catch (settingsError) {
              console.warn('Kon sommige camera-instellingen niet toepassen:', settingsError);
            }
          } else {
            setHasTorch(false);
          }
        }
      } catch (primaryError) {
        console.log(`Kan camera met facing mode '${initialFacingMode}' niet gebruiken:`, primaryError);
        
        // Als de gewenste camera niet werkt, probeer dan de andere
        const alternateFacing = initialFacingMode === 'environment' ? 'user' : 'environment';
        
        try {
          const alternateConstraints = {
            video: {
              facingMode: { ideal: alternateFacing },
              width: { ideal: 1920 },  // Verhoogd van 1280 naar 1920 voor betere kwaliteit
              height: { ideal: 1080 }, // Verhoogd van 720 naar 1080 voor betere kwaliteit
              aspectRatio: { ideal: 1.777778 }, // 16:9 aspect ratio
              frameRate: { min: 15, ideal: 30, max: 60 } // Hogere framerate
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

  // Start automatisch scannen met intervallen
  const startAutoScan = () => {
    // Annuleer bestaand interval indien aanwezig
    stopAutoScan();
    
    // Start een nieuw interval
    setScanFeedback('Automatisch scannen gestart...');
    intervalRef.current = setInterval(() => {
      if (!isProcessing && !isPaused && isStreaming) {
        captureImage();
      }
    }, 1000); // Scan elke seconde
  };
  
  // Stop automatisch scannen
  const stopAutoScan = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // Initialiseer de Tesseract worker en OpenCV
  useEffect(() => {
    const initWorker = async () => {
      // Basisinstellingen worden direct bij initialisatie doorgegeven
      const baseParams = {
        tessedit_char_whitelist: '0123456789',
        tessjs_create_hocr: '0',
        tessjs_create_tsv: '0',
        tessjs_create_box: '0',
        tessjs_create_unlv: '0',
        tessjs_create_osd: '0',
        segment_nonalphabetic_script: '1',
        textord_space_size_is_variable: '0',
        // Engine mode en andere parameters die alleen tijdens initialisatie kunnen worden ingesteld
        tessedit_ocr_engine_mode: ocrQuality === 'fast' ? '3' : '2',
        // Algemene OCR kwaliteitsinstellingen
        tessedit_pageseg_mode: ocrQuality === 'accurate' ? '6' : '7',
      };
      
      console.log('Initialiseren van Tesseract worker met parameters:', baseParams);
      
      // Worker initialiseren met parameters - zonder logger functie
      workerRef.current = await createWorker('eng', {
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        workerOptions: {
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@v2.1.1/dist/worker.min.js',
        },
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v2.2.0/tesseract-core.wasm.js',
        // logger verwijderd omdat functies niet kunnen worden gekloond naar workers
      });
      
      // Parameters instellen
      await workerRef.current.setParameters(baseParams);
      
      // Roep de updateOcrParameters aan voor aanvullende parameters
      await updateOcrParameters();
    };

    // OpenCV initialisatie
    const initOpenCV = async () => {
      if (typeof cv !== 'undefined' && cv.getBuildInformation) {
        // OpenCV is al geladen
        setOpenCvLoaded(true);
        console.log('OpenCV is al geladen');
      } else {
        // Wacht tot OpenCV geladen is
        console.log('Wachten tot OpenCV geladen is...');
        if (cv.onRuntimeInitialized) {
          cv.onRuntimeInitialized = () => {
            setOpenCvLoaded(true);
            console.log('OpenCV is succesvol geïnitialiseerd');
          };
        } else {
          // Als de callback eigenschap niet bestaat, controleer periodiek
          const checkInterval = setInterval(() => {
            if (typeof cv !== 'undefined' && cv.getBuildInformation) {
              clearInterval(checkInterval);
              setOpenCvLoaded(true);
              console.log('OpenCV is succesvol geïnitialiseerd');
            }
          }, 500);
          
          // Stop controle na 10 seconden als het niet lukt
          setTimeout(() => {
            clearInterval(checkInterval);
            if (!openCvLoaded) {
              console.warn('OpenCV kon niet geladen worden binnen 10 seconden');
            }
          }, 10000);
        }
      }
    };

    initWorker();
    initOpenCV();

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, [ocrQuality]);

  // Effect om automatisch scannen te starten/stoppen wanneer camera streaming status verandert
  useEffect(() => {
    if (isStreaming && !isManualMode) {
      console.log('Camera is actief, automatisch scannen wordt gestart...');
      // Debug status tonen
      console.log('Debug modus:', showDebug ? 'AAN' : 'UIT');
      // Start het scannen met een korte vertraging om de camera tijd te geven om op te starten
      setTimeout(() => {
        startAutoScan();
      }, 500);
    } else {
      console.log('Camera is niet actief of in handmatige modus, scannen wordt gestopt...');
      stopAutoScan();
    }
    
    return () => {
      // Altijd stoppen bij unmount of verandering in afhankelijkheden
      stopAutoScan();
    };
  }, [isStreaming, isManualMode]);

  // Functie om OCR parameters te updaten op basis van kwaliteit - ALLEEN voor initiële setup
  const updateOcrParameters = async () => {
    if (!workerRef.current) return;
    
    // Deze functie wordt alleen gebruikt voor de initiële setup
    // Voor latere updates gebruiken we updateOcrSetting en de kwaliteitsknoppen
    
    // Nieuwe instellingen op basis van de gekozen kwaliteit
    let newSettings = { ...ocrSettings };
    
    // We voegen alleen de standaardinstellingen toe voor de gekozen kwaliteit
    // zonder bestaande aangepaste instellingen te overschrijven, behalve bij initialisatie
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

  // Eenvoudige fallback beeldverwerking zonder OpenCV
  const fallbackImageProcessing = (canvas) => {
    try {
      // Haal context van canvas
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Eenvoudige beeldverwerking in JavaScript
      // 1. Contrast en helderheid aanpassen
      const contrastLevel = extraProcessingOptions.contrastLevel || 1.5;
      const brightnessAdjust = extraProcessingOptions.brightnessAdjust || 10;
      
      // Contrast en helderheid berekening
      const factor = (259 * (contrastLevel * 100 + 255)) / (255 * (259 - contrastLevel * 100));
      
      for (let i = 0; i < data.length; i += 4) {
        // Bereken helderheid voor grayscale
        const gray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        
        // Pas contrast en helderheid toe
        let value = factor * (gray - 128) + 128 + brightnessAdjust;
        
        // Begrens waarden tussen 0 en 255
        value = Math.min(255, Math.max(0, value));
        
        // Indien in kleurenmodus, behoud kleuren maar pas contrast toe
        if (processingTechnique === 'kleur') {
          // Pas contrast en helderheid toe op elk kleurkanaal
          data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128 + brightnessAdjust));
          data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128 + brightnessAdjust));
          data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128 + brightnessAdjust));
        } else {
          // Voor andere modi, zet naar grayscale
          data[i] = data[i + 1] = data[i + 2] = value;
        }
      }
      
      // Update het canvas met de bewerkte data
      context.putImageData(imageData, 0, 0);
      
      // Als invert actief is en niet in kleurenmodus
      if (extraProcessingOptions.invertColors && processingTechnique !== 'kleur') {
        const invertedData = context.getImageData(0, 0, canvas.width, canvas.height);
        const invertedD = invertedData.data;
        
        for (let i = 0; i < invertedD.length; i += 4) {
          invertedD[i] = 255 - invertedD[i];
          invertedD[i + 1] = 255 - invertedD[i + 1];
          invertedD[i + 2] = 255 - invertedD[i + 2];
        }
        
        context.putImageData(invertedData, 0, 0);
      }
      
      // Debug weergave bijwerken indien ingeschakeld
      if (showDebug) {
        try {
          const processedUrl = canvas.toDataURL('image/png');
          console.log("Debug: Fallback verwerkte afbeelding URL lengte:", processedUrl.length);
          setDebugProcessedImage("" + processedUrl);
        } catch (e) {
          console.error("Fout bij opslaan fallback debug afbeelding:", e);
        }
      }
      
      console.log("Fallback beeldverwerking toegepast omdat OpenCV niet beschikbaar is");
      return canvas;
    } catch (error) {
      console.error("Fout in fallback beeldverwerking:", error);
      // Als alles faalt, geef ongewijzigd canvas terug
      return canvas;
    }
  };

  // Verbeterde afbeeldingsverwerking met OpenCV
  const preprocessImage = (canvas) => {
    if (!useImageProcessing) return canvas; // Skip als beeldverwerking uit staat
    
    try {
      // Alleen OpenCV gebruiken als het geladen is
      if (openCvLoaded) {
        // Canvas naar OpenCV Mat converteren
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const src = cv.matFromImageData(imageData);
        
        // Doelmat aanmaken met dezelfde grootte en type
        const dst = new cv.Mat();
        
        // Definieer adaptiveOptions hier zodat het beschikbaar is in de hele functie
        const adaptiveOptions = extraProcessingOptions;
        
        // Verschillende verwerkingstechnieken op basis van gebruikersselectie
        switch (processingTechnique) {
          case 'kleur':
            // Behoud kleuren, pas alleen verbeteringen toe
            src.copyTo(dst); // Begin met kopiëren van origineel (in kleur)
            
            // Pas instellingen toe als ze beschikbaar zijn
            const options = extraProcessingOptions;
            
            // 1. VOORBEHANDELING (alleen op het kleurenbeeld)
            
            // Ruisonderdrukking toepassen als waarde > 0
            if (options.denoisingStrength > 0) {
              try {
                // Gebruik bilateralFilter om ruis te verminderen maar randen te behouden
                const d = options.denoisingStrength * 2 + 1; // Diameter van elk pixel omgeving
                const sigmaColor = options.denoisingStrength * 5; // Sigma in de kleurruimte
                const sigmaSpace = options.denoisingStrength; // Sigma in de coördinatenruimte
                cv.bilateralFilter(dst, dst, d, sigmaColor, sigmaSpace);
              } catch (error) {
                console.warn('Geavanceerde ruisonderdrukking mislukt, terugvallen op gaussianBlur:', error);
                // Terugvallen op de standaard Gaussian blur om ruis te verminderen
                const ksize = new cv.Size(5, 5);
                cv.GaussianBlur(dst, dst, ksize, 0);
              }
            }
            
            // Helderheid en contrast aanpassen
            if (options.contrastLevel !== 1.0 || options.brightnessAdjust !== 0) {
              // alpha = contrast, beta = brightness
              dst.convertTo(dst, -1, options.contrastLevel, options.brightnessAdjust);
            }
            
            // Gammacorrectie toepassen als waarde niet 1.0 is
            if (options.gammaCorrection !== 1.0) {
              try {
                // Gamma correctie voor betere details in donkere of lichte gebieden
                // Gebruik LUT (Look-Up Table) voor gamma correctie
                const gamma = options.gammaCorrection;
                
                // Maak lookup table voor gammacorrectie
                const lookUpTable = new Uint8Array(256);
                for (let j = 0; j < 256; j++) {
                  lookUpTable[j] = Math.min(255, Math.max(0, Math.pow(j / 255, 1 / gamma) * 255));
                }
                
                // Controleer of LUT functie bestaat in OpenCV
                if (typeof cv.LUT === 'function') {
                  // We moeten dit voor elk kleurkanaal apart doen in een kleurenafbeelding
                  // Splits de kleurkanalen
                  let bgr = new cv.MatVector();
                  cv.split(dst, bgr);
                  
                  // Pas gamma correctie toe op elk kanaal
                  for (let i = 0; i < 3; i++) {
                    const lookUpTableMat = cv.matFromArray(1, 256, cv.CV_8U, lookUpTable);
                    cv.LUT(bgr.get(i), lookUpTableMat, bgr.get(i));
                    lookUpTableMat.delete();
                  }
                  
                  // Voeg de kanalen weer samen
                  cv.merge(bgr, dst);
                  
                  // Maak geheugen vrij
                  for (let i = 0; i < bgr.size(); ++i) {
                    bgr.get(i).delete();
                  }
                  bgr.delete();
                } else {
                  // Alternatieve implementatie als LUT niet beschikbaar is
                  console.log("LUT functie niet beschikbaar, gebruik alternatieve methode voor gamma correctie in kleurenmodus");
                  
                  // Pas gamma correctie direct toe op de pixels
                  for (let y = 0; y < dst.rows; y++) {
                    for (let x = 0; x < dst.cols; x++) {
                      // Haal pixel op (BGR formaat)
                      const pixel = dst.ucharPtr(y, x);
                      // Pas gamma toe op elke kleurcomponent
                      pixel[0] = lookUpTable[pixel[0]]; // B
                      pixel[1] = lookUpTable[pixel[1]]; // G
                      pixel[2] = lookUpTable[pixel[2]]; // R
                    }
                  }
                }
              } catch (error) {
                console.warn('Gammacorrectie op kleurenbeeld mislukt, terugvallen op alternatieve methode:', error);
                
                try {
                  // Alternatieve methode: Gebruik contrast en helderheid
                  const gamma = options.gammaCorrection;
                  // Bereken contrast en helderheid als benadering van gamma
                  let contrast, brightness;
                  
                  if (gamma < 1.0) {
                    // Donkerder maken (gamma < 1)
                    contrast = gamma * 0.8;
                    brightness = -10;
                  } else {
                    // Lichter maken (gamma > 1)
                    contrast = gamma * 0.5;
                    brightness = 20;
                  }
                  
                  // Pas contrast en helderheid toe als vervanging voor gamma
                  dst.convertTo(dst, -1, contrast, brightness);
                } catch (fallbackError) {
                  console.error('Ook alternatieve gammacorrectie voor kleurenbeeld mislukt:', fallbackError);
                }
              }
            }
            
            // Rotatie toepassen indien nodig
            if (options.rotationAngle !== 0) {
              const center = new cv.Point(dst.cols / 2, dst.rows / 2);
              const rotMat = cv.getRotationMatrix2D(center, options.rotationAngle, 1);
              cv.warpAffine(dst, dst, rotMat, new cv.Size(dst.cols, dst.rows));
              rotMat.delete();
            }
            
            // Automatische scheefstandcorrectie (deskewing)
            if (options.autoCorrectSkew) {
              try {
                // Voor scheefstandcorrectie hebben we een grayscale versie nodig
                const grayMat = new cv.Mat();
                cv.cvtColor(dst, grayMat, cv.COLOR_RGBA2GRAY);
                
                // Zoek randen
                const edges = new cv.Mat();
                cv.Canny(grayMat, edges, 50, 150, 3, false);
                
                // Zoek lijnen met Hough transform
                const lines = new cv.Mat();
                try {
                  cv.HoughLines(edges, lines, 1, Math.PI / 180, 30);
                  
                  // Bereken gemiddelde hoek
                  let totalAngle = 0;
                  let validLines = 0;
                  
                  for (let i = 0; i < lines.rows; i++) {
                    const theta = lines.data32F[i * 2 + 1];
                    
                    // We zoeken alleen naar lijnen die horizontaal of verticaal zijn (binnen een bereik)
                    if (Math.abs(theta) < 0.3 || Math.abs(theta - Math.PI / 2) < 0.3) {
                      // Bereken hoek in graden
                      const angle = theta * (180 / Math.PI);
                      totalAngle += angle;
                      validLines++;
                    }
                  }
                  
                  if (validLines > 0) {
                    // Bereken gemiddelde hoek en roteer tegengesteld
                    const avgAngle = totalAngle / validLines;
                    const rotationAngle = 90 - avgAngle;
                    
                    // Alleen roteren als de hoek significant is (niet te klein)
                    if (Math.abs(rotationAngle) > 1.0) {
                      const center = new cv.Point(dst.cols / 2, dst.rows / 2);
                      const rotMat = cv.getRotationMatrix2D(center, rotationAngle, 1);
                      cv.warpAffine(dst, dst, rotMat, new cv.Size(dst.cols, dst.rows));
                      rotMat.delete();
                    }
                  }
                } catch (houghError) {
                  console.warn('HoughLines niet beschikbaar:', houghError);
                }
                
                // Geheugen vrijgeven
                grayMat.delete();
                edges.delete();
                if (lines) lines.delete();
              } catch (error) {
                console.warn('Scheefstandcorrectie mislukt:', error);
              }
            }
            
            // Verscherping toepassen indien ingeschakeld
            if (options.applySharpening) {
              try {
                // Verscherping voor kleurenbeeld met unsharp masking techniek
                const blurred = new cv.Mat();
                const ksize = new cv.Size(5, 5);
                
                // Blur de afbeelding
                cv.GaussianBlur(dst, blurred, ksize, 0);
                
                // Unsharp masking: origineel - blur = randen
                // Voeg terug toe aan origineel: origineel + randen = scherper origineel
                // Gebruik hogere waarde (1.5 en -0.5) voor sterker effect
                cv.addWeighted(dst, 1.5, blurred, -0.5, 0, dst);
                
                // Geheugen vrijgeven
                blurred.delete();
              } catch (error) {
                console.warn('Verscherping voor kleurenbeeld mislukt:', error);
              }
            }
            
            // Kleuren inverteren indien ingeschakeld
            if (options.invertColors) {
              try {
                cv.bitwise_not(dst, dst);
              } catch (error) {
                console.warn('Kleurinversie niet beschikbaar:', error);
              }
            }
            break;
            
          case 'adaptive':
            // Grayscale conversie
            cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
            
            // Pas instellingen toe als ze beschikbaar zijn
            const adaptiveOptions = extraProcessingOptions;
            
            // 1. VOORBEHANDELING (vóór threshold/canny)
            
            // Ruisonderdrukking toepassen als waarde > 0
            if (adaptiveOptions.denoisingStrength > 0) {
              // Voor sterke ruis: fastNlMeansDenoising is effectiever dan gaussianBlur
              // Maar deze functie is niet beschikbaar in opencv-ts, dus we gebruiken een alternatief
              try {
                // Probeer eerst medianBlur (goed voor salt-and-pepper ruis)
                const ksize = adaptiveOptions.denoisingStrength * 2 + 1; // Oneven getal maken (3, 5, 7, ...)
                // Beperk ksize tot maximaal 9 om te voorkomen dat de cijfers te veel vervagen
                const limitedKsize = Math.min(9, ksize);
                // Medianblur werkt alleen met oneven kernel-groottes
                cv.medianBlur(dst, dst, limitedKsize);
                
                // Voeg daarna wat gaussianBlur toe voor gladde randen (als denoisingStrength > 5)
                if (adaptiveOptions.denoisingStrength > 5) {
                  const gaussSize = new cv.Size(3, 3);
                  cv.GaussianBlur(dst, dst, gaussSize, 0);
                }
              } catch (error) {
                console.warn('Geavanceerde ruisonderdrukking mislukt, terugvallen op gaussianBlur:', error);
                // Terugvallen op de standaard Gaussian blur om ruis te verminderen
                const ksize = new cv.Size(5, 5);
                cv.GaussianBlur(dst, dst, ksize, 0);
              }
            } else {
              // Standaard Gaussian blur om ruis te verminderen
              const ksize = new cv.Size(5, 5);
              cv.GaussianBlur(dst, dst, ksize, 0);
            }
            
            // Helderheid en contrast aanpassen
            if (adaptiveOptions.contrastLevel !== 1.0 || adaptiveOptions.brightnessAdjust !== 0) {
              // alpha = contrast, beta = brightness
              dst.convertTo(dst, -1, adaptiveOptions.contrastLevel, adaptiveOptions.brightnessAdjust);
            }
            
            // Gammacorrectie toepassen als waarde niet 1.0 is
            if (adaptiveOptions.gammaCorrection !== 1.0) {
              try {
                // Probeer eerst met LUT functie als deze beschikbaar is
                const gamma = adaptiveOptions.gammaCorrection;
                const lookUpTable = new Uint8Array(256);
                for (let i = 0; i < 256; i++) {
                  lookUpTable[i] = Math.min(255, Math.max(0, Math.pow(i / 255, 1 / gamma) * 255));
                }
                
                // Controleer of LUT functie bestaat, anders alternatieve implementatie gebruiken
                if (typeof cv.LUT === 'function') {
                  // Standaard implementatie met LUT functie
                  const lookUpTableMat = cv.matFromArray(1, 256, cv.CV_8U, lookUpTable);
                  cv.LUT(dst, lookUpTableMat, dst);
                  lookUpTableMat.delete();
                } else {
                  // Alternatieve implementatie zonder LUT functie
                  console.log("LUT functie niet beschikbaar, gebruik alternatieve methode voor gamma correctie");
                  
                  // Maak een tijdelijke kopie
                  const tempMat = new cv.Mat();
                  dst.copyTo(tempMat);
                  
                  // Pas gamma correctie direct toe op de pixels
                  for (let y = 0; y < dst.rows; y++) {
                    for (let x = 0; x < dst.cols; x++) {
                      // Haal pixelwaarde op 
                      const pixel = dst.ucharPtr(y, x);
                      // Pas gamma toe op de pixel
                      pixel[0] = lookUpTable[pixel[0]];
                    }
                  }
                  
                  // Maak geheugen vrij
                  tempMat.delete();
                }
              } catch (error) {
                console.warn('Gammacorrectie mislukt, terugvallen op alternatieve methode:', error);
                
                try {
                  // Alternatieve methode: Gebruik contrast en helderheid om gamma te simuleren
                  const gamma = adaptiveOptions.gammaCorrection;
                  // Bereken contrast en helderheid als benadering van gamma
                  let contrast, brightness;
                  
                  if (gamma < 1.0) {
                    // Donkerder maken (gamma < 1)
                    contrast = gamma * 0.8;
                    brightness = -10;
                  } else {
                    // Lichter maken (gamma > 1)
                    contrast = gamma * 0.5;
                    brightness = 20;
                  }
                  
                  // Pas contrast en helderheid toe als vervanging voor gamma
                  dst.convertTo(dst, -1, contrast, brightness);
                } catch (fallbackError) {
                  console.error('Ook alternatieve gammacorrectie mislukt:', fallbackError);
                  // Als alles mislukt, laat de afbeelding ongewijzigd
                }
              }
            }
            
            // Automatische scheefstandcorrectie (deskewing)
            if (adaptiveOptions.autoCorrectSkew) {
              try {
                // Zoek randen
                const edges = new cv.Mat();
                cv.Canny(dst, edges, 50, 150, 3, false);
                
                // Zoek lijnen met Hough transform
                const lines = new cv.Mat();
                try {
                  cv.HoughLines(edges, lines, 1, Math.PI / 180, 30);
                  
                  // Bereken gemiddelde hoek
                  let totalAngle = 0;
                  let validLines = 0;
                  
                  for (let i = 0; i < lines.rows; i++) {
                    const theta = lines.data32F[i * 2 + 1];
                    
                    // We zoeken alleen naar lijnen die horizontaal of verticaal zijn (binnen een bereik)
                    if (Math.abs(theta) < 0.3 || Math.abs(theta - Math.PI / 2) < 0.3) {
                      // Bereken hoek in graden
                      const angle = theta * (180 / Math.PI);
                      totalAngle += angle;
                      validLines++;
                    }
                  }
                  
                  if (validLines > 0) {
                    // Bereken gemiddelde hoek en roteer tegengesteld
                    const avgAngle = totalAngle / validLines;
                    const rotationAngle = 90 - avgAngle;
                    
                    // Alleen roteren als de hoek significant is (niet te klein)
                    if (Math.abs(rotationAngle) > 1.0) {
                      const center = new cv.Point(dst.cols / 2, dst.rows / 2);
                      const rotMat = cv.getRotationMatrix2D(center, rotationAngle, 1);
                      cv.warpAffine(dst, dst, rotMat, new cv.Size(dst.cols, dst.rows));
                      rotMat.delete();
                    }
                  }
                } catch (houghError) {
                  console.warn('HoughLines niet beschikbaar, alternatieve scheefstandcorrectie wordt gebruikt:', houghError);
                  
                  // Alternatieve methode: Gebruik standaard rotatie op basis van gebruikersinvoer
                  if (adaptiveOptions.rotationAngle !== 0) {
                    const center = new cv.Point(dst.cols / 2, dst.rows / 2);
                    const rotMat = cv.getRotationMatrix2D(center, adaptiveOptions.rotationAngle, 1);
                    cv.warpAffine(dst, dst, rotMat, new cv.Size(dst.cols, dst.rows));
                    rotMat.delete();
                  }
                }
                
                edges.delete();
                if (lines) lines.delete();
              } catch (error) {
                console.warn('Scheefstandcorrectie mislukt:', error);
              }
            }
            
            // 2. HOOFDVERWERKING (threshold/canny)
            
            // Adaptieve threshold voor betere tekst-extractie
            // Gebruik THRESH_BINARY in plaats van THRESH_BINARY_INV om kleuren om te draaien
            // (zwarte tekst op witte achtergrond in plaats van witte tekst op zwarte achtergrond)
            cv.adaptiveThreshold(dst, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);
            
            // VERBETERDE VOORBEWERKING VOOR CIJFERHERKENNING
            
            // 1. Maak een kopie van het threshold resultaat
            const thresholded = new cv.Mat();
            dst.copyTo(thresholded);
            
            // 2. Verdik de cijfers om kleine onderbrekingen te dichten (dilate)
            const dilateM = cv.Mat.ones(adaptiveOptions.dilationSize, adaptiveOptions.dilationSize, cv.CV_8U);
            const dilateAnchor = new cv.Point(-1, -1);
            cv.dilate(dst, dst, dilateM, dilateAnchor, 1);
            
            // 3. Verwijder ruis via morphologische operaties (opening)
            const openM = cv.Mat.ones(2, 2, cv.CV_8U);
            const openAnchor = new cv.Point(-1, -1);
            cv.morphologyEx(dst, dst, cv.MORPH_OPEN, openM, openAnchor, 1);
            
            // 4. Verbeter contrast voor duidelijkere cijfers
            const contrastFactor = adaptiveOptions.contrastLevel;
            dst.convertTo(dst, -1, contrastFactor, adaptiveOptions.brightnessAdjust);
            
            // 5. Geheugen vrijgeven
            thresholded.delete();
            dilateM.delete();
            openM.delete();
            break;
          case 'binary':
            // Grayscale conversie
            cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
            
            // Eenvoudige binaire threshold
            cv.threshold(dst, dst, 127, 255, cv.THRESH_BINARY);
            
            // TOEGEVOEGD: STERKE CONTRASTVERBETERING VOOR CIJFERS
            
            // 1. Maak een kopie van het threshold resultaat
            const binaryThresholded = new cv.Mat();
            dst.copyTo(binaryThresholded);
            
            // 2. Verdik de cijfers voor betere leesbaarheid (dilate)
            const binaryDilateM = cv.Mat.ones(adaptiveOptions.dilationSize + 1, adaptiveOptions.dilationSize + 1, cv.CV_8U);
            const binaryDilateAnchor = new cv.Point(-1, -1);
            cv.dilate(dst, dst, binaryDilateM, binaryDilateAnchor, 1);
            
            // 3. Medianfilter om ruis te verwijderen maar randen te behouden
            const ksize = 3; // Kernelgrootte voor medianfilter
            cv.medianBlur(dst, dst, ksize);
            
            // 4. Geheugen vrijgeven
            binaryThresholded.delete();
            binaryDilateM.delete();
            break;
          case 'canny':
            // Grayscale conversie
            cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
            
            // Canny edge detection voor contouren
            cv.Canny(dst, dst, 50, 150);
            
            // VERBETERDE CANNY VOOR CIJFERHERKENNING
            
            // 1. Dilate om randen te verbinden (dikker maken)
            const cannyDilateM = cv.Mat.ones(adaptiveOptions.dilationSize, adaptiveOptions.dilationSize, cv.CV_8U);
            const cannyDilateAnchor = new cv.Point(-1, -1);
            cv.dilate(dst, dst, cannyDilateM, cannyDilateAnchor, 1);
            
            // 2. Converteer naar binair beeld (255 voor alle niet-nul pixels)
            const cannyThresh = new cv.Mat();
            cv.threshold(dst, cannyThresh, 1, 255, cv.THRESH_BINARY);
            cannyThresh.copyTo(dst);
            
            try {
              // 3. Zoek naar contouren in het beeld
              const contours = new cv.MatVector();
              const hierarchy = new cv.Mat();
              
              try {
                // Probeer contouren te vinden
                cv.findContours(dst, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
                
                // 4. Maak een leeg wit beeld
                dst.setTo(new cv.Scalar(255, 255, 255, 255));
                
                // 5. Teken alleen de grote contouren (filtert ruis)
                for (let i = 0; i < contours.size(); ++i) {
                  const contour = contours.get(i);
                  const area = cv.contourArea(contour);
                  // Teken alleen contouren groter dan een bepaalde drempelwaarde
                  if (area > 50) {
                    cv.drawContours(dst, contours, i, new cv.Scalar(0, 0, 0, 255), cv.FILLED);
                  }
                  contour.delete();
                }
              } catch (contourError) {
                console.warn('Contourverwerking mislukt, terugvallen op alternatieve methode:', contourError);
                
                // Alternatieve methode als contourverwerking niet beschikbaar is:
                // Eenvoudigweg het binary beeld gebruiken na dilatie
                cannyThresh.copyTo(dst);
                
                // Extra morfologische operaties om ruis te verwijderen
                const morphKernel = cv.Mat.ones(3, 3, cv.CV_8U);
                cv.morphologyEx(dst, dst, cv.MORPH_OPEN, morphKernel, new cv.Point(-1, -1), 1);
                morphKernel.delete();
              }
              
              // 6. Geheugen vrijgeven
              if (contours) contours.delete();
              if (hierarchy) hierarchy.delete();
            } catch (error) {
              console.warn('Geavanceerde canny-verwerking mislukt, terugvallen op eenvoudige binaire drempel:', error);
              
              // Als alles mislukt, val terug op eenvoudige binaire threshold
              cv.threshold(dst, dst, 127, 255, cv.THRESH_BINARY);
            }
            
            cannyThresh.delete();
            cannyDilateM.delete();
            break;
          default:
            // Standaard adaptieve threshold
            cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
            cv.adaptiveThreshold(dst, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);
        }
        
        // 3. NABEHANDELING (na threshold/canny)
        
        // Extra randverbetering indien ingeschakeld
        if (adaptiveOptions && adaptiveOptions.edgeEnhancement) {
          try {
            const edgesEnhanced = new cv.Mat();
            const kernelSize = new cv.Size(3, 3);
            
            // Laplacian filter voor randdetectie
            cv.Laplacian(dst, edgesEnhanced, cv.CV_8U, 1, 1, 0);
            
            // Combineer het origineel met de randen
            cv.addWeighted(dst, 0.7, edgesEnhanced, 0.3, 0, dst);
            
            edgesEnhanced.delete();
          } catch (error) {
            console.warn('Randverbetering niet beschikbaar:', error);
            // Als randverbetering niet beschikbaar is, doen we niks (overslaan)
          }
        }
        
        // Verscherping toepassen indien ingeschakeld
        if (adaptiveOptions && adaptiveOptions.applySharpening && processingTechnique !== 'kleur') {
          try {
            // Probeer eerst met een aangepast filter
            const kernel = new cv.Mat(3, 3, cv.CV_32F);
            // Handmatig het kernel vullen in plaats van via Float32Array
            kernel.setTo(new cv.Scalar(0, 0, 0, 0)); // Reset alle waarden naar 0
            
            // 3x3 sharpening kernel
            // [0, -1, 0, -1, 5, -1, 0, -1, 0]
            // Handmatig de waarden instellen
            kernel.data32F[0] = 0;  kernel.data32F[1] = -1; kernel.data32F[2] = 0;
            kernel.data32F[3] = -1; kernel.data32F[4] = 5;  kernel.data32F[5] = -1;
            kernel.data32F[6] = 0;  kernel.data32F[7] = -1; kernel.data32F[8] = 0;
            
            cv.filter2D(dst, dst, -1, kernel);
            kernel.delete();
          } catch (filterError) {
            console.warn('Filter2D niet beschikbaar voor verscherping:', filterError);
            
            try {
              // Alternatieve methode: Blur en dan subtract
              const blurred = new cv.Mat();
              const ksize = new cv.Size(3, 3);
              
              // Blur de afbeelding
              cv.GaussianBlur(dst, blurred, ksize, 0);
              
              // Unsharp masking: origineel - blur = randen
              // Voeg terug toe aan origineel: origineel + randen = scherper origineel
              cv.addWeighted(dst, 1.5, blurred, -0.5, 0, dst);
              
              blurred.delete();
            } catch (altError) {
              console.warn('Alternatieve verscherping mislukt:', altError);
              // Als het nog steeds niet lukt, doen we niks
            }
          }
        }
        
        // Kleuren inverteren indien ingeschakeld
        if (adaptiveOptions && adaptiveOptions.invertColors && processingTechnique !== 'kleur') {
          try {
            cv.bitwise_not(dst, dst);
          } catch (error) {
            console.warn('Kleurinversie niet beschikbaar:', error);
            // Als kleurinversie niet beschikbaar is, probeer het handmatig
            try {
              // Handmatige inversie door pixels te manipuleren
              for (let i = 0; i < dst.rows; i++) {
                for (let j = 0; j < dst.cols; j++) {
                  const pixel = dst.ucharPtr(i, j);
                  pixel[0] = 255 - pixel[0];
                }
              }
            } catch (manualError) {
              console.warn('Handmatige kleurinversie mislukt:', manualError);
            }
          }
        }
        
        // Terug converteren naar canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        cv.imshow(tempCanvas, dst);
        
        // Terug naar originele canvas kopiëren
        ctx.drawImage(tempCanvas, 0, 0);
        
        // Debug afbeelding weergeven indien nodig
        if (showDebug) {
          try {
            const debugUrl = tempCanvas.toDataURL('image/png');
            console.log("Debug: preprocessed OpenCV afbeelding URL lengte:", debugUrl.length);
            // Force een nieuwe string om zeker te zijn dat het een nieuwe referentie is
            setDebugProcessedImage(debugUrl + "");
          } catch (e) {
            console.error("Fout bij opslaan OpenCV debug afbeelding:", e);
          }
        }
        
        // Geheugen vrijgeven
        src.delete();
        dst.delete();
        
        if (debugImage && showDebug) {
          // Voor debug doeleinden laten we de originele canvas ongewijzigd
    return canvas;
        }
        
        return canvas;
      } else {
        // Terugvallen op de originele beeldverwerking als OpenCV niet geladen is
        console.log('OpenCV niet geladen, terugvallen op standaard beeldverwerking');
        return fallbackImageProcessing(canvas);
      }
    } catch (error) {
      console.error('OpenCV verwerking mislukt:', error);
      // Terugvallen op de originele beeldverwerking als OpenCV faalt
      return fallbackImageProcessing(canvas);
    }
  };

  // Neem een snapshot en verwerk het met OCR
  const captureImage = useCallback(async () => {
    // Indien in debug-modus, altijd afbeeldingen bijwerken zelfs als al verwerking bezig is
    const isDebugCapture = showDebug && isProcessing;
    
    // Controleer of we al bezig zijn met verwerken, behalve bij een debug-capture
    if (!isStreaming || (isProcessing && !isDebugCapture) || !workerRef.current) return;
    
    // Als dit alleen een debug-capture is, sla dan de rest van de OCR-verwerking over
    if (!isDebugCapture) {
    setIsProcessing(true);
      processingTimeRef.current = new Date().getTime(); // Sla het tijdstip op waarop de verwerking start
    setScanFeedback(verificationInProgress ? 'Nummer verifiëren...' : 'Verwerken...');
    }
    
    // Veiligheidstimer om isProcessing te resetten als verwerking vastloopt
    // Alleen instellen als dit geen debug-capture is
    let processingTimeout;
    if (!isDebugCapture) {
      processingTimeout = setTimeout(() => {
        console.log('OCR-verwerking duurde te lang, resetten...');
        setIsProcessing(false);
        processingTimeRef.current = null; // Reset processing time reference
        setScanFeedback('Scannen hervat na timeout...');
      }, 8000); // 8 seconden timeout
    }
    
    try {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video && canvas) {
        const context = canvas.getContext('2d', { willReadFrequently: true });
        
        // Pas canvas grootte aan voor optimale OCR met hogere pixeldichtheid
        // De fysieke grootte van de uitsnede blijft hetzelfde, maar we verhogen de pixeldichtheid
        canvas.width = scanFrame.width * scanFrame.pixelDensity;
        canvas.height = scanFrame.height * scanFrame.pixelDensity;
      
      // VERBETERDE BEREKENING: Exact wat in het kader zichtbaar is uitsnijden
      // Perfect rekening houdend met zoomniveau
      
      // 1. Bepaal de werkelijke afmetingen van het videoframe
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      
      // 2. Bereken het middelpunt van de video
      const centerX = videoWidth / 2;
      const centerY = videoHeight / 2;
      
      // 3. Bij inzoomen willen we juist een kleiner gebied uitsnijden (meer detail)
      // Het visuele kader wordt kleiner bij inzoomen, dus dat gebied moeten we uit de video halen
      const cropWidth = scanFrame.width / zoomLevel;
      const cropHeight = scanFrame.height / zoomLevel;
      
      // Debug info
      console.log(`Zoom: ${zoomLevel}, Crop area: ${cropWidth}x${cropHeight}`);
      
      // 4. Bereken de coördinaten voor het uitsnijden vanuit het midden
      const frameX = centerX - (cropWidth / 2);
      const frameY = centerY - (cropHeight / 2);
      
      // Trek alleen het gedeelte binnen het kader op de canvas
      // We maken gebruik van hogere resolutie door de pixeldichtheid te verdubbelen
      context.drawImage(
        video,                // bron
        frameX, frameY,       // beginpunt uitsnede in bronafbeelding
        cropWidth, cropHeight,  // grootte uitsnede, schaalt mee met zoomniveau
        0, 0,                 // beginpunt op canvas
        canvas.width, canvas.height // grootte op canvas (verhoogd met pixelDensity)
      );
      
      // Maak een kopie van originele afbeelding voor debug
      if (showDebug) {
          try {
            // Direct het originele canvas opslaan als data URL
            const originalUrl = canvas.toDataURL('image/png');
            console.log("Debug: Originele afbeelding capture lengte:", originalUrl.length);
            
            // Forceer state update met een nieuwe string
            setDebugImage("" + originalUrl);
          } catch (e) {
            console.error("Fout bij opslaan originele debug afbeelding:", e);
          }
      }
      
      // Pas beeldverbetering toe, tenzij deze is uitgeschakeld
      if (!skipPreprocessing) {
        preprocessImage(canvas);
      } else {
        console.log("Voorbewerking overgeslagen, direct naar OCR");
        // Als we debug aan hebben, toon dan de onbewerkte afbeelding als processingresultaat
        if (showDebug) {
          try {
            const originalUrl = canvas.toDataURL('image/png');
            setDebugProcessedImage("" + originalUrl);
          } catch (e) {
            console.error("Fout bij opslaan van onbewerkte afbeelding voor debug:", e);
          }
        }
      }
      
      // Maak een kopie van het geoptimaliseerde beeld
        if (showDebug) {
          try {
            // Direct het verwerkte canvas opslaan als data URL
            const processedUrl = canvas.toDataURL('image/png');
            console.log("Debug: Verwerkte afbeelding capture lengte:", processedUrl.length);
            
            // Forceer state update met een nieuwe string
            setDebugProcessedImage("" + processedUrl);
          } catch (e) {
            console.error("Fout bij opslaan verwerkte debug afbeelding:", e);
          }
        }
        
        // Als dit alleen voor debug is, sla dan OCR over
        if (isDebugCapture) {
          console.log("Debug-capture voltooid, OCR overgeslagen");
          return;
        }
        
        try {
      // Verbeterde invoer naar OCR met onderscheid tussen preprocessed en direct
      let imageSource;
      if (skipPreprocessing) {
        // Direct de canvas naar OCR sturen zonder enige voorbewerking
        imageSource = canvas.toDataURL('image/png');
        console.log("OCR krijgt de onbewerkte afbeelding (voorbewerking overgeslagen)");
      } else {
        // Normale verwerking (met of zonder OpenCV)
        imageSource = canvas.toDataURL('image/png');
        console.log("OCR krijgt de voorbewerkte afbeelding");
      }
      
      const { data } = await workerRef.current.recognize(imageSource);
          
          // Verdere OCR verwerking - rest van de originele functie
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
            
                // Pauzeer het scannen voor 5 seconden, maar zorg dat debug beelden nog werken
            setIsPaused(true);
                console.log("Scannen gepauzeerd voor 5 seconden na succesvolle detectie van " + number);
                
                // Verbeterde feedback met validatie informatie
                const validatieBericht = isValid 
                  ? `✓ GELDIG: ${number} komt voor in de lijst!` 
                  : `✗ ONGELDIG: ${number} komt NIET voor in de lijst!`;
                
                setScanFeedback(validatieBericht);
                
                // In debug modus blijven scannen voor afbeeldingen, maar niet verwerken
                if (showDebug) {
                  setScanFeedback(`${validatieBericht} Debug modus actief, scannen gaat door voor debug-beelden.`);
                }
                
            // Verlengde pauze (5 seconden) na detectie zodat gebruiker het resultaat kan zien
            setTimeout(() => {
              setIsPaused(false);
                  setIsProcessing(false); // Zorg dat de processing flag wordt gereset zodat scannen opnieuw start
                  processingTimeRef.current = null; // Reset processing time reference
                  setScanFeedback('Scannen hervat...');
                  console.log("Scannen hervat na pauze");
                  
                  // Na 2 seconden de scan feedback updaten
                  setTimeout(() => {
                    if (isStreaming) {
                      setScanFeedback('Camera scant nu...');
                    }
            }, 2000);
            }, 5000);
          } else {
            // Getallen komen niet overeen, reset en probeer opnieuw
            setScanFeedback(`Verificatie mislukt, getallen komen niet overeen. Probeer opnieuw...`);
            setVerificationInProgress(false);
            setLastDetectedNumber(null);
                setIsProcessing(false); // Reset processing flag om verder te kunnen scannen
                processingTimeRef.current = null; // Reset processing time reference
          }
        } else {
          // Start verificatieproces
          setScanFeedback(`Mogelijk nummer gevonden: ${number}. Verifiëren...`);
          setLastDetectedNumber(number);
          setVerificationInProgress(true);
          
          // Onmiddellijk nog een keer scannen voor verificatie
          setTimeout(() => {
            setIsProcessing(false); // Reset processing flag voor de tweede scan
                processingTimeRef.current = null; // Reset processing time reference
            captureImage(); // Roep zichzelf opnieuw aan voor verificatie
          }, 300); // Kleine vertraging om een andere frame te krijgen
        }
      } else {
        // Geen getallen gedetecteerd
        if (verificationInProgress) {
          setScanFeedback('Verificatie mislukt, geen nummers gevonden. Probeer opnieuw...');
          setVerificationInProgress(false);
          setLastDetectedNumber(null);
              setIsProcessing(false); // Reset processing flag om verder te kunnen scannen
              processingTimeRef.current = null; // Reset processing time reference
        } else {
          setDetectedNumber('');
          setIsValidNumber(null);
          setScanFeedback('Geen nummers gedetecteerd. Scannen gaat door...');
              setIsProcessing(false); // Reset processing flag om verder te kunnen scannen
              processingTimeRef.current = null; // Reset processing time reference
            }
          }
        } catch (ocrError) {
          console.error('OCR-fout:', ocrError);
          setScanFeedback('OCR-fout opgetreden. Probeer opnieuw...');
          setIsProcessing(false);
          processingTimeRef.current = null; // Reset processing time reference
      }
    } else {
      setIsProcessing(false);
        processingTimeRef.current = null; // Reset processing time reference
      setScanFeedback('Camera niet beschikbaar');
    }
    } catch (error) {
      console.error('Fout tijdens scannen:', error);
      setScanFeedback('Fout tijdens scannen. Probeer opnieuw...');
      setIsProcessing(false);
      processingTimeRef.current = null; // Reset processing time reference
    } finally {
      // Annuleer de veiligheidstimer omdat we klaar zijn (succesvol of met fout)
      if (processingTimeout) {
        clearTimeout(processingTimeout);
      }
    }
  }, [duckNumbers, isProcessing, isStreaming, onNumberDetected, verificationInProgress, lastDetectedNumber, showDebug, useImageProcessing, zoomLevel, preprocessImage, scanFrame.width, scanFrame.height, scanFrame.pixelDensity, validateNumber]);

  // Render de UI voor camera-modus met scan-kader
  const renderCamera = () => {
    return (
      <div className="camera-container relative w-full h-full">
        {/* Gedetecteerd nummer boven camerabeeld met duidelijke validatie-indicatie */}
        {detectedNumber && (
          <div className={`mb-4 text-center p-3 rounded-lg shadow-md w-full max-w-md ${
            isValidNumber === true ? 'bg-green-100 border-2 border-green-500' : 
            isValidNumber === false ? 'bg-red-100 border-2 border-red-500' : 
            'bg-gray-100'
          }`}>
            <div className="text-4xl font-bold font-mono">{detectedNumber}</div>
            {isValidNumber !== null && (
              <div className={`mt-2 font-bold ${isValidNumber ? 'text-green-700' : 'text-red-700'}`}>
                {isValidNumber ? '✓ GELDIG NUMMER' : '✗ ONGELDIG NUMMER'}
              </div>
            )}
          </div>
        )}
        
        {/* Altijd het camerabeeld tonen */}
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
              
              {/* Debug knop */}
              <button
                onClick={() => setShowDebug(!showDebug)}
                className={`p-2 rounded-full w-10 h-10 flex items-center justify-center ${showDebug ? 'bg-blue-500 text-white' : 'bg-black bg-opacity-50 text-white'}`}
                title={`Debug modus ${showDebug ? 'uit' : 'aan'} zetten`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              </button>
            </div>
          )}
          
          {/* Verborgen canvas voor beeldverwerking */}
          <canvas ref={canvasRef} className="hidden" />
          
          {/* Scan-kader overlay met duidelijkere instructies - aangepast aan zoomniveau */}
          {isStreaming && (
            <div className="absolute top-0 left-0 right-0 bottom-0 flex items-center justify-center pointer-events-none">
              <div 
                className="border-4 rounded-md bg-transparent relative"
                style={{
                  // Pas de grootte van het kader aan aan het zoomniveau
                  // Bij inzoomen (zoomLevel > 1) wordt het kader kleiner om het exacte uitsnijdgebied te tonen
                  width: `${scanFrame.width / zoomLevel}px`,
                  height: `${scanFrame.height / zoomLevel}px`,
                  borderColor: 'rgba(59, 130, 246, 0.8)'
                }}
              >
                {/* Horizontale scanline animatie */}
                <div 
                  className="absolute left-0 right-0 h-0.5 bg-blue-500 z-10"
                  style={{
                    top: `${(isPaused ? 50 : (Math.sin(Date.now() / 600) * 0.5 + 0.5) * 100)}%`,
                    boxShadow: '0 0 8px rgba(59, 130, 246, 0.8)',
                    transition: isPaused ? 'none' : 'top 0.3s ease-out'
                  }}
                ></div>
              </div>
            </div>
          )}
          
          {/* Feedback voor gebruiker met opvallendere kleuren voor validatie */}
          {scanFeedback && (
            <div className={`absolute bottom-2 left-2 right-2 p-2 rounded-md text-sm text-center font-bold ${
              scanFeedback.includes('GELDIG:') ? 'bg-green-600 text-white' : 
              scanFeedback.includes('ONGELDIG:') ? 'bg-red-600 text-white' : 
              'bg-black bg-opacity-70 text-white'
            }`} style={{ fontSize: scanFeedback.includes('GELDIG:') || scanFeedback.includes('ONGELDIG:') ? '1.1rem' : '0.875rem' }}>
              {skipPreprocessing && !scanFeedback.includes('GELDIG:') && !scanFeedback.includes('ONGELDIG:') ? 
                '⚠️ DIRECT NAAR OCR: ' + scanFeedback : 
                scanFeedback}
            </div>
          )}
          
          {/* Indicator voor direct-naar-OCR modus */}
          {skipPreprocessing && isStreaming && (
            <div className="absolute top-2 right-2 bg-yellow-500 text-black px-2 py-1 rounded-md text-xs font-bold animate-pulse">
              DIRECT NAAR OCR
            </div>
          )}
        </div>
        
        {/* Debug weergave (alleen getoond wanneer ingeschakeld) */}
        {showDebug && (
          <div className="debug-container border-2 border-blue-500 rounded-lg mb-4 p-2 bg-white">
            <div className="flex flex-col">
              <div className="mb-2">
                <div className="text-center text-sm font-bold mb-1">Originele afbeelding</div>
                <div className="h-[150px] border border-gray-300 flex items-center justify-center bg-gray-100">
                  {debugImage ? (
                    <img 
                      src={debugImage} 
                      alt="Origineel beeld" 
                      style={{maxHeight: '140px'}}
                    />
                  ) : (
                    <div className="text-gray-500">Geen beeld beschikbaar</div>
              )}
            </div>
        </div>
        
              <div>
                <div className="text-center text-sm font-bold mb-1">Verwerkte afbeelding</div>
                <div className="h-[150px] border border-gray-300 flex items-center justify-center bg-gray-100">
                  {debugProcessedImage ? (
                    <img 
                      src={debugProcessedImage} 
                      alt="Verwerkt beeld" 
                      style={{maxHeight: '140px'}}
                    />
                  ) : (
                    <div className="text-gray-500">Geen beeld beschikbaar</div>
                  )}
            </div>
              </div>
            </div>
            
            <div className="mt-2 flex justify-between">
              <div>
                <button
                  onClick={() => {
                    console.log("Test-afbeelding maken...");
                    const canvas = document.createElement('canvas');
                    canvas.width = 200;
                    canvas.height = 100;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = 'lightblue';
                    ctx.fillRect(0, 0, 200, 100);
                    ctx.fillStyle = 'black';
                    ctx.font = '20px Arial';
                    ctx.fillText('Test afbeelding', 40, 50);
                    const testImage = canvas.toDataURL('image/png');
                    console.log("Test afbeelding gemaakt:", testImage.substring(0, 30) + "...");
                    setDebugImage(testImage);
                    
                    // Maak ook een verwerkte test afbeelding
                    const processedCanvas = document.createElement('canvas');
                    processedCanvas.width = 200;
                    processedCanvas.height = 100;
                    const processedCtx = processedCanvas.getContext('2d');
                    processedCtx.fillStyle = 'lightgreen';
                    processedCtx.fillRect(0, 0, 200, 100);
                    processedCtx.fillStyle = 'black';
                    processedCtx.font = '20px Arial';
                    processedCtx.fillText('Verwerkt beeld', 40, 50);
                    const processedImage = processedCanvas.toDataURL('image/png');
                    setDebugProcessedImage(processedImage);
                  }}
                  className="px-2 py-1 bg-blue-500 text-white rounded mr-2"
                >
                  Genereer test-beeld
                </button>
                
                {/* Knop om automatisch scannen te pauzeren/hervatten */}
                {intervalRef.current ? (
                  <button 
                    onClick={() => {
                      stopAutoScan();
                      setScanFeedback('Automatisch scannen gepauzeerd in debug modus');
                    }} 
                    className="px-2 py-1 bg-orange-500 text-white rounded"
                  >
                    Pauzeer auto-scan
                  </button>
                ) : (
                  <button 
                    onClick={() => {
                      startAutoScan();
                      setScanFeedback('Automatisch scannen gestart in debug modus');
                    }} 
                    className="px-2 py-1 bg-green-500 text-white rounded"
                  >
                    Start auto-scan
                  </button>
                )}
              </div>
              <div>
                <button
                  onClick={() => {
                    // Force een camera capture, zelfs als we in verwerking zijn
                    // Dit is speciaal voor debug modus
                    setIsProcessing(false);
                    processingTimeRef.current = null;
                    setTimeout(() => {
                      captureImage();
                    }, 50);
                  }}
                  className="px-2 py-1 bg-green-500 text-white rounded"
                >
                  Handmatig scannen
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* UI voor geavanceerde instellingen */}
        {advancedOcrVisible && (
          <div className="advanced-settings bg-gray-800 text-white p-3 rounded-lg mb-4 shadow-lg">
            <h3 className="text-center font-semibold mb-2">Geavanceerde instellingen</h3>
            
            <div className="flex flex-col space-y-2">
              {/* OCR kwaliteit selector */}
              <div className="setting-group">
                <label className="text-sm">OCR kwaliteit:</label>
                <div className="flex justify-between space-x-2">
                  <button 
                    onClick={() => setOcrQuality('fast')}
                    className={`px-2 py-1 text-xs rounded ${ocrQuality === 'fast' ? 'bg-blue-600' : 'bg-gray-600'}`}
                  >
                    Snel
                  </button>
                  <button 
                    onClick={() => setOcrQuality('balanced')}
                    className={`px-2 py-1 text-xs rounded ${ocrQuality === 'balanced' ? 'bg-blue-600' : 'bg-gray-600'}`}
                  >
                    Gebalanceerd
                  </button>
                  <button 
                    onClick={() => setOcrQuality('accurate')}
                    className={`px-2 py-1 text-xs rounded ${ocrQuality === 'accurate' ? 'bg-blue-600' : 'bg-gray-600'}`}
                  >
                    Nauwkeurig
                  </button>
            </div>
            </div>
              
              {/* OpenCV voorverwerking selector */}
              <div className="setting-group">
                <div className="flex items-center justify-between">
                  <label className="text-sm">Beeldverwerking:</label>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                      id="imageProcessingToggle"
                    checked={useImageProcessing}
                    onChange={() => setUseImageProcessing(!useImageProcessing)}
                      className="mr-1"
                  />
                    <label htmlFor="imageProcessingToggle" className="text-xs">Actief</label>
                </div>
                </div>
                
                {/* Optie om voorbewerking helemaal over te slaan */}
                <div className="flex items-center justify-between mt-1 border-t border-gray-600 pt-1">
                  <label className="text-sm text-yellow-300">Direct naar OCR:</label>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="skipPreprocessingToggle"
                      checked={skipPreprocessing}
                      onChange={() => setSkipPreprocessing(!skipPreprocessing)}
                      className="mr-1"
                    />
                    <label htmlFor="skipPreprocessingToggle" className="text-xs">
                      {skipPreprocessing ? "Ja (geen voorbewerking)" : "Nee (met voorbewerking)"}
                    </label>
                  </div>
                </div>
                
                {useImageProcessing && (
                  <div className="mt-1">
                    <div className="text-xs text-gray-300 mb-1">
                      Voorverwerkingstechniek:
                      {!openCvLoaded && <span className="ml-1 text-yellow-400">(OpenCV wordt geladen...)</span>}
                    </div>
                    <div className="flex justify-between space-x-1">
                    <button
                        onClick={() => setProcessingTechnique('kleur')}
                        className={`px-2 py-1 text-xs rounded ${processingTechnique === 'kleur' ? 'bg-blue-600' : 'bg-gray-600'}`}
                        disabled={!openCvLoaded}
                      >
                        Kleur
                    </button>
                    <button
                        onClick={() => setProcessingTechnique('adaptive')}
                        className={`px-2 py-1 text-xs rounded ${processingTechnique === 'adaptive' ? 'bg-blue-600' : 'bg-gray-600'}`}
                        disabled={!openCvLoaded}
                      >
                        Adaptief
                    </button>
                    <button
                        onClick={() => setProcessingTechnique('binary')}
                        className={`px-2 py-1 text-xs rounded ${processingTechnique === 'binary' ? 'bg-blue-600' : 'bg-gray-600'}`}
                        disabled={!openCvLoaded}
                      >
                        Binair
                    </button>
                    <button
                        onClick={() => setProcessingTechnique('canny')}
                        className={`px-2 py-1 text-xs rounded ${processingTechnique === 'canny' ? 'bg-blue-600' : 'bg-gray-600'}`}
                        disabled={!openCvLoaded}
                      >
                        Contouren
                    </button>
                  </div>
                    
                    {/* Geavanceerde beeldverwerkingsinstellingen */}
                    <div className="mt-2">
                      <button
                        onClick={() => setShowAdvancedProcessing(!showAdvancedProcessing)}
                        className="text-xs bg-gray-600 w-full rounded py-1 px-2"
                      >
                        {showAdvancedProcessing ? "Verberg extra beeldopties" : "Toon extra beeldopties"}
                      </button>
                      
                      {showAdvancedProcessing && (
                        <div className="mt-2 space-y-2 bg-gray-700 p-2 rounded-md">
                          {/* Contrast instelling */}
                          <div>
                            <div className="flex justify-between">
                              <label className="text-xs">Contrast: {extraProcessingOptions.contrastLevel.toFixed(1)}</label>
                              <button 
                                onClick={() => setExtraProcessingOptions(prev => ({...prev, contrastLevel: 1.5}))}
                                className="text-xs bg-gray-500 px-1 rounded"
                              >
                                Reset
                              </button>
                            </div>
                            <input
                              type="range"
                              min="0.5"
                              max="3.0"
                              step="0.1"
                              value={extraProcessingOptions.contrastLevel}
                              onChange={e => setExtraProcessingOptions(prev => ({...prev, contrastLevel: parseFloat(e.target.value)}))}
                              className="w-full h-1 mt-1"
                            />
                  </div>
                  
                          {/* Helderheid instelling */}
                      <div>
                            <div className="flex justify-between">
                              <label className="text-xs">Helderheid: {extraProcessingOptions.brightnessAdjust}</label>
                              <button 
                                onClick={() => setExtraProcessingOptions(prev => ({...prev, brightnessAdjust: 10}))}
                                className="text-xs bg-gray-500 px-1 rounded"
                              >
                                Reset
                              </button>
                            </div>
                            <input
                              type="range"
                              min="-50"
                              max="50"
                              step="5"
                              value={extraProcessingOptions.brightnessAdjust}
                              onChange={e => setExtraProcessingOptions(prev => ({...prev, brightnessAdjust: parseInt(e.target.value)}))}
                              className="w-full h-1 mt-1"
                            />
                          </div>
                          
                          {/* Cijferdikte instelling */}
                          <div>
                            <div className="flex justify-between">
                              <label className="text-xs">Cijferdikte: {extraProcessingOptions.dilationSize}</label>
                              <button 
                                onClick={() => setExtraProcessingOptions(prev => ({...prev, dilationSize: 2}))}
                                className="text-xs bg-gray-500 px-1 rounded"
                              >
                                Reset
                              </button>
                          </div>
                          <input
                            type="range"
                            min="1"
                              max="5"
                            step="1"
                              value={extraProcessingOptions.dilationSize}
                              onChange={e => setExtraProcessingOptions(prev => ({...prev, dilationSize: parseInt(e.target.value)}))}
                              className="w-full h-1 mt-1"
                            />
                        </div>
                        
                          {/* Ruisonderdrukking instelling */}
                          <div>
                            <div className="flex justify-between">
                              <label className="text-xs">Ruisonderdrukking: {extraProcessingOptions.denoisingStrength}</label>
                              <button 
                                onClick={() => setExtraProcessingOptions(prev => ({...prev, denoisingStrength: 3}))}
                                className="text-xs bg-gray-500 px-1 rounded"
                              >
                                Reset
                              </button>
                          </div>
                          <input
                            type="range"
                              min="0"
                              max="10"
                            step="1"
                              value={extraProcessingOptions.denoisingStrength}
                              onChange={e => setExtraProcessingOptions(prev => ({...prev, denoisingStrength: parseInt(e.target.value)}))}
                              className="w-full h-1 mt-1"
                            />
                          </div>
                          
                          {/* Gamma correctie */}
                          <div>
                            <div className="flex justify-between">
                              <label className="text-xs">Gamma: {extraProcessingOptions.gammaCorrection.toFixed(1)}</label>
                              <button 
                                onClick={() => setExtraProcessingOptions(prev => ({...prev, gammaCorrection: 0.5}))}
                                className="text-xs bg-gray-500 px-1 rounded"
                              >
                                Reset
                              </button>
                        </div>
                            <input
                              type="range"
                              min="0.5"
                              max="2.0"
                              step="0.1"
                              value={extraProcessingOptions.gammaCorrection}
                              onChange={e => setExtraProcessingOptions(prev => ({...prev, gammaCorrection: parseFloat(e.target.value)}))}
                              className="w-full h-1 mt-1"
                            />
                      </div>
                      
                          {/* Rotatie instelling */}
                      <div>
                            <div className="flex justify-between">
                              <label className="text-xs">Rotatie: {extraProcessingOptions.rotationAngle}°</label>
                              <button 
                                onClick={() => setExtraProcessingOptions(prev => ({...prev, rotationAngle: 0}))}
                                className="text-xs bg-gray-500 px-1 rounded"
                              >
                                Reset
                              </button>
                            </div>
                            <input
                              type="range"
                              min="-45"
                              max="45"
                              step="1"
                              value={extraProcessingOptions.rotationAngle}
                              onChange={e => setExtraProcessingOptions(prev => ({...prev, rotationAngle: parseInt(e.target.value)}))}
                              className="w-full h-1 mt-1"
                            />
                          </div>
                          
                          {/* Extra opties als checkboxes */}
                          <div className="flex flex-wrap gap-2 text-xs">
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                                id="invertColors"
                                checked={extraProcessingOptions.invertColors}
                                onChange={e => setExtraProcessingOptions(prev => ({...prev, invertColors: e.target.checked}))}
                                className="mr-1"
                              />
                              <label htmlFor="invertColors">Kleuren inverteren</label>
                          </div>
                          
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                                id="applySharpening"
                                checked={extraProcessingOptions.applySharpening}
                                onChange={e => setExtraProcessingOptions(prev => ({...prev, applySharpening: e.target.checked}))}
                                className="mr-1"
                              />
                              <label htmlFor="applySharpening">Verscherping</label>
                          </div>
                          
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                                id="autoCorrectSkew"
                                checked={extraProcessingOptions.autoCorrectSkew}
                                onChange={e => setExtraProcessingOptions(prev => ({...prev, autoCorrectSkew: e.target.checked}))}
                                className="mr-1"
                              />
                              <label htmlFor="autoCorrectSkew">Auto-rechtzetten</label>
                        </div>
                        
                            <div className="flex items-center">
                          <input
                                type="checkbox"
                                id="edgeEnhancement"
                                checked={extraProcessingOptions.edgeEnhancement}
                                onChange={e => setExtraProcessingOptions(prev => ({...prev, edgeEnhancement: e.target.checked}))}
                                className="mr-1"
                              />
                              <label htmlFor="edgeEnhancement">Randverbetering</label>
                        </div>
                      </div>
                          </div>
                      )}
                        </div>
                          </div>
                )}
                      </div>
                      
              {/* Camera instellingen */}
              <div className="setting-group mt-2">
                <button
                  onClick={() => setShowAdvancedCamera(!showAdvancedCamera)}
                  className="text-xs bg-gray-600 w-full rounded py-1 px-2"
                >
                  {showAdvancedCamera ? "Verberg camera-instellingen" : "Toon camera-instellingen"}
                </button>
                
                {showAdvancedCamera && (
                  <div className="mt-2 space-y-2 bg-gray-700 p-2 rounded-md">
                    {/* Camera exposureCompensation */}
                    <div>
                      <div className="flex justify-between">
                        <label className="text-xs">Belichting: {cameraSettings.exposureCompensation}</label>
                        <button 
                          onClick={() => {
                            setCameraSettings(prev => ({...prev, exposureCompensation: 0}));
                            if (mediaStream) {
                              const videoTrack = mediaStream.getVideoTracks()[0];
                              if (videoTrack && videoTrack.getCapabilities().exposureCompensation) {
                                videoTrack.applyConstraints({
                                  advanced: [{ exposureCompensation: 0 }]
                                }).catch(e => console.warn('Kan belichting niet aanpassen:', e));
                              }
                            }
                          }}
                          className="text-xs bg-gray-500 px-1 rounded"
                        >
                          Reset
                        </button>
                      </div>
                          <input
                            type="range"
                        min="-3"
                        max="3"
                        step="0.5"
                        value={cameraSettings.exposureCompensation}
                        onChange={e => {
                          const value = parseFloat(e.target.value);
                          setCameraSettings(prev => ({...prev, exposureCompensation: value}));
                          
                          // Pas direct toe op camera indien mogelijk
                          if (mediaStream) {
                            const videoTrack = mediaStream.getVideoTracks()[0];
                            if (videoTrack && videoTrack.getCapabilities().exposureCompensation) {
                              videoTrack.applyConstraints({
                                advanced: [{ exposureCompensation: value }]
                              }).catch(e => console.warn('Kan belichting niet aanpassen:', e));
                            }
                          }
                        }}
                        className="w-full h-1 mt-1"
                          />
                        </div>
                        
                    {/* Focus modus */}
                    <div className="mt-2">
                      <label className="text-xs block mb-1">Focus modus:</label>
                      <div className="flex justify-between space-x-1">
                        <button 
                          onClick={() => {
                            setCameraSettings(prev => ({...prev, focusMode: 'continuous'}));
                            if (mediaStream) {
                              const videoTrack = mediaStream.getVideoTracks()[0];
                              if (videoTrack) {
                                videoTrack.applyConstraints({
                                  advanced: [{ focusMode: 'continuous' }]
                                }).catch(e => console.warn('Kan focus niet aanpassen:', e));
                              }
                            }
                          }}
                          className={`px-2 py-1 text-xs rounded flex-1 ${cameraSettings.focusMode === 'continuous' ? 'bg-blue-600' : 'bg-gray-600'}`}
                        >
                          Continu
                        </button>
                        <button 
                          onClick={() => {
                            setCameraSettings(prev => ({...prev, focusMode: 'manual'}));
                            if (mediaStream) {
                              const videoTrack = mediaStream.getVideoTracks()[0];
                              if (videoTrack) {
                                videoTrack.applyConstraints({
                                  advanced: [{ focusMode: 'manual' }]
                                }).catch(e => console.warn('Kan focus niet aanpassen:', e));
                              }
                            }
                          }}
                          className={`px-2 py-1 text-xs rounded flex-1 ${cameraSettings.focusMode === 'manual' ? 'bg-blue-600' : 'bg-gray-600'}`}
                        >
                          Handmatig
                        </button>
                        <button 
                          onClick={() => {
                            setCameraSettings(prev => ({...prev, focusMode: 'fixed'}));
                            if (mediaStream) {
                              const videoTrack = mediaStream.getVideoTracks()[0];
                              if (videoTrack) {
                                videoTrack.applyConstraints({
                                  advanced: [{ focusMode: 'fixed' }]
                                }).catch(e => console.warn('Kan focus niet aanpassen:', e));
                              }
                            }
                          }}
                          className={`px-2 py-1 text-xs rounded flex-1 ${cameraSettings.focusMode === 'fixed' ? 'bg-blue-600' : 'bg-gray-600'}`}
                        >
                          Vast
                        </button>
                      </div>
                        </div>
                        
                    {/* Witbalans */}
                    <div className="mt-2">
                      <label className="text-xs block mb-1">Witbalans:</label>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          onClick={() => {
                            setCameraSettings(prev => ({...prev, whiteBalance: 'auto'}));
                            if (mediaStream) {
                              const videoTrack = mediaStream.getVideoTracks()[0];
                              if (videoTrack) {
                                videoTrack.applyConstraints({
                                  advanced: [{ whiteBalanceMode: 'continuous' }]
                                }).catch(e => console.warn('Kan witbalans niet aanpassen:', e));
                              }
                            }
                          }}
                          className={`px-2 py-1 text-xs rounded ${cameraSettings.whiteBalance === 'auto' ? 'bg-blue-600' : 'bg-gray-600'}`}
                        >
                          Auto
                        </button>
                        <button 
                          onClick={() => {
                            setCameraSettings(prev => ({...prev, whiteBalance: 'cloudy'}));
                            if (mediaStream) {
                              const videoTrack = mediaStream.getVideoTracks()[0];
                              if (videoTrack && videoTrack.getCapabilities().whiteBalanceMode) {
                                videoTrack.applyConstraints({
                                  advanced: [{ whiteBalanceMode: 'manual', colorTemperature: 6500 }]
                                }).catch(e => console.warn('Kan witbalans niet aanpassen:', e));
                              }
                            }
                          }}
                          className={`px-2 py-1 text-xs rounded ${cameraSettings.whiteBalance === 'cloudy' ? 'bg-blue-600' : 'bg-gray-600'}`}
                        >
                          Bewolkt
                        </button>
                        <button 
                          onClick={() => {
                            setCameraSettings(prev => ({...prev, whiteBalance: 'sunny'}));
                            if (mediaStream) {
                              const videoTrack = mediaStream.getVideoTracks()[0];
                              if (videoTrack && videoTrack.getCapabilities().whiteBalanceMode) {
                                videoTrack.applyConstraints({
                                  advanced: [{ whiteBalanceMode: 'manual', colorTemperature: 5500 }]
                                }).catch(e => console.warn('Kan witbalans niet aanpassen:', e));
                              }
                            }
                          }}
                          className={`px-2 py-1 text-xs rounded ${cameraSettings.whiteBalance === 'sunny' ? 'bg-blue-600' : 'bg-gray-600'}`}
                        >
                          Zonnig
                        </button>
                        <button 
                          onClick={() => {
                            setCameraSettings(prev => ({...prev, whiteBalance: 'fluorescent'}));
                            if (mediaStream) {
                              const videoTrack = mediaStream.getVideoTracks()[0];
                              if (videoTrack && videoTrack.getCapabilities().whiteBalanceMode) {
                                videoTrack.applyConstraints({
                                  advanced: [{ whiteBalanceMode: 'manual', colorTemperature: 4000 }]
                                }).catch(e => console.warn('Kan witbalans niet aanpassen:', e));
                              }
                            }
                          }}
                          className={`px-2 py-1 text-xs rounded ${cameraSettings.whiteBalance === 'fluorescent' ? 'bg-blue-600' : 'bg-gray-600'}`}
                        >
                          TL-licht
                        </button>
                      </div>
                      </div>
                    </div>
                  )}
                </div>
              
              {/* Debug optie */}
              <div className="flex items-center justify-between">
                <label className="text-sm">Debug modus:</label>
                <div className="flex items-center">
                  <input 
                    type="checkbox"
                    id="debugToggle"
                    checked={showDebug}
                    onChange={() => setShowDebug(!showDebug)}
                    className="mr-1"
                  />
                  <label htmlFor="debugToggle" className="text-xs">Tonen</label>
              </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Zoom control */}
        <div className="mb-4">
          <label htmlFor="zoomSlider" className="block text-sm font-medium text-gray-700 mb-1">
            Zoom: {Math.round(zoomLevel * 100)}%
          </label>
          <input
            id="zoomSlider"
            type="range"
            min="1.0"
            max="3.0"
            step="0.1"
            value={zoomLevel}
            onChange={handleZoomChange}
            className="w-full"
          />
        </div>
        
        {/* Cameraknoppen en bestaande UI */}
        <div className="flex justify-between mb-4">
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
            onClick={() => setAdvancedOcrVisible(!advancedOcrVisible)}
            className={`px-4 py-2 ${advancedOcrVisible ? 'bg-blue-600' : 'bg-gray-500'} text-white rounded-lg`}
          >
            {advancedOcrVisible ? 'Verberg instellingen' : 'Toon instellingen'}
          </button>
          
          <button
            onClick={switchToManualMode}
            className="px-4 py-2 bg-green-500 text-white rounded-lg"
          >
            Handmatig invoeren
          </button>
        </div>
        
        {/* Weergave van de scanknop tijdens streamen */}
        {isStreaming && (
          <div className="flex justify-center">
            <button
              className="p-3 bg-blue-600 rounded-full shadow-lg mb-4"
              onClick={captureImage}
              disabled={isProcessing}
            >
              <div className="w-12 h-12 rounded-full border-4 border-white"></div>
            </button>
          </div>
        )}
      </div>
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
      // Nieuwe verbeterde cijferherkenningsparameters
      textord_space_size_is_variable: '0', // Vast formaat voor cijferruimtes
      textord_tabfind_vertical_text: '0', // Geen verticale tekst verwachten
      language_model_ngram_on: '0', // Ngram uitschakelen (deze is ontworpen voor normale taalherkenning)
      textord_force_make_prop_words: '0', // Geen proportionele tekst forceren
      textord_noise_rejwords: '1', // Woorden met veel ruis afwijzen
      // Cijferspecifieke instellingen (als deze aanwezig zijn)
      textord_noise_sizelimit: '0.5', // Kleinere ruislimiet voor cijfers
      textord_noise_normratio: '8', // Hogere ruisverhouding voor beter filter
      tessedit_single_match: '0', // Sta meerdere matches toe voor één karakter
      dignorm_normalize_mode: settings.dignormNormalizeMode?.toString() || '8',
      dignorm_adjust_non_space: settings.dignormAdjNonSpace ? '1' : '0',
      dignorm_use_normalized_quad_moments: settings.dignormQuadMoments ? '1' : '0',
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

  // Render de UI voor het handmatige invoerpaneel
  const renderKeypad = () => {
    return (
      <div className="manual-input-container w-full max-w-md">
        <div className="mb-4 text-center">
          <h2 className="text-xl font-bold mb-2">Voer eendnummer handmatig in</h2>
          <div className="input-display border-2 p-3 rounded-lg text-center bg-gray-50 mb-4">
            <span className="text-3xl font-mono font-bold">{manualInput || '____'}</span>
          </div>
          
          {/* Feedback over geldigheid */}
          {isValidNumber !== null && (
            <div className={`mt-2 p-2 rounded ${isValidNumber ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {isValidNumber 
                ? "✓ Dit nummer komt voor in de lijst!" 
                : "✗ Dit nummer komt niet voor in de lijst."}
            </div>
          )}
        </div>
        
        {/* Numeriek toetsenbord */}
        <div className="keypad grid grid-cols-3 gap-2 mb-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((digit, index) => (
            <button
              key={digit}
              onClick={() => addDigit(digit.toString())}
              className={`py-4 text-xl font-bold rounded-lg bg-blue-500 text-white hover:bg-blue-600 ${digit === 0 ? 'col-span-3' : ''}`}
              style={{ gridColumn: digit === 0 ? 'span 3' : 'auto' }}
            >
              {digit}
            </button>
          ))}
        </div>
        
        {/* Bewerkingsknoppen */}
        <div className="control-buttons grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={removeLastDigit}
            className="py-3 rounded-lg bg-yellow-500 text-white font-bold"
            disabled={manualInput.length === 0}
          >
            Backspace
          </button>
          <button
            onClick={clearInput}
            className="py-3 rounded-lg bg-red-500 text-white font-bold"
            disabled={manualInput.length === 0}
          >
            Wissen
          </button>
        </div>
        
        {/* Terugknop naar camera-modus */}
        <div className="text-center">
          <button
            onClick={switchToCameraMode}
            className="px-4 py-2 bg-green-500 text-white rounded-lg"
          >
            Terug naar camera
          </button>
        </div>
      </div>
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