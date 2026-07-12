import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Truck, LogIn, ShieldCheck, Mail, Lock, Loader2, 
  AlertCircle, LogOut, MapPin, User, Phone, 
  FileText, ChevronLeft, Camera, CreditCard,
  Sun, Moon, Package, Clock, ChevronRight, CheckCircle2, Zap, Calendar, Navigation, MoreVertical, Play, Save,
  Heart, ShieldAlert, Hash, CheckCircle, LocateFixed, Navigation2, BellRing, MessageSquare, Send, Power, PowerOff, X, Volume2, VolumeX
} from 'lucide-react';
import { db, requestForToken } from './firebase';
import { collection, query, where, getDocs, addDoc, onSnapshot, updateDoc, doc, arrayUnion, increment } from 'firebase/firestore';

// --- GOOGLE MAPS ---
import { GoogleMap, useJsApiLoader, Marker, Polyline } from '@react-google-maps/api';
const GOOGLE_MAPS_API_KEY = "AIzaSyA-t6YcuPK1PdOoHZJOyOsw6PK0tCDJrn0"; 
const containerStyle = { width: '100%', height: '100%' };
const centerMX = { lat: 19.4326, lng: -99.1332 }; 
const libraries = ['places', 'geometry']; 

const ICON_START = "http://maps.google.com/mapfiles/ms/icons/green-dot.png";
const ICON_WAYPOINT = "http://maps.google.com/mapfiles/ms/icons/blue-dot.png";
const ICON_END = "http://maps.google.com/mapfiles/ms/icons/red-dot.png";


const buildDriverIconSvg = (heading = 0) => {
    const h = Number.isFinite(Number(heading)) ? Number(heading) : 0;
    return `
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
            <defs>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.35"/>
                </filter>
            </defs>
            <circle cx="32" cy="32" r="26" fill="#ffffff" filter="url(#shadow)"/>
            <circle cx="32" cy="32" r="21" fill="#f97316"/>
            <g transform="rotate(${h} 32 32)">
                <path d="M32 11 L46 42 L32 36 L18 42 Z" fill="#ffffff"/>
                <path d="M32 17 L40 36 L32 32 L24 36 Z" fill="#0f172a" opacity="0.18"/>
            </g>
        </svg>
    `;
};

const getDriverMarkerIcon = (heading = 0) => {
    try {
        if (!window.google?.maps) return ICON_START;
        const svg = buildDriverIconSvg(heading);
        return {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new window.google.maps.Size(46, 46),
            anchor: new window.google.maps.Point(23, 23)
        };
    } catch (e) {
        return ICON_START;
    }
};

// HELPER: Cálculo de distancia para la GEOCERCA
const getDistanceMeters = (p1, p2) => {
    if (!p1 || !p2 || !p1.lat || !p2.lat) return 0;
    const R = 6371e3; // Metros
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLon = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// HELPER: ETA estable sin DirectionsService.
// En Android WebView, recalcular DirectionsService cada pocos segundos puede volver inestable el canvas de Google Maps.
// Usamos distancia directa para mantener la navegación estable y el trazo oficial del despachador como referencia visual.
const estimateMinutesFromMeters = (meters, avgKmh = 28) => {
    const n = Number(meters);
    if (!Number.isFinite(n) || n <= 0) return 0;
    const minutes = (n / 1000) / avgKmh * 60;
    return Math.max(1, Math.round(minutes));
};

const getRemainingStraightDistanceMeters = (origin, targets, startIndex) => {
    const validOrigin = origin && Number.isFinite(Number(origin.lat)) && Number.isFinite(Number(origin.lng))
        ? { lat: Number(origin.lat), lng: Number(origin.lng) }
        : null;

    if (!validOrigin || !Array.isArray(targets) || targets.length === 0) return 0;

    let total = 0;
    let cursor = validOrigin;

    for (let i = startIndex; i < targets.length; i++) {
        const target = targets[i];
        if (!target || !Number.isFinite(Number(target.lat)) || !Number.isFinite(Number(target.lng))) continue;
        const next = { lat: Number(target.lat), lng: Number(target.lng) };
        total += getDistanceMeters(cursor, next);
        cursor = next;
    }

    return total;
};


const getDistanceAlongPathMeters = (path, fromIndex, toIndex) => {
    const validPath = normalizePath(path);
    if (validPath.length < 2) return 0;

    const start = Math.max(0, Math.min(validPath.length - 1, fromIndex || 0));
    const end = Math.max(0, Math.min(validPath.length - 1, toIndex ?? validPath.length - 1));
    if (end <= start) return 0;

    let total = 0;
    for (let i = start; i < end; i++) {
        total += getDistanceMeters(validPath[i], validPath[i + 1]);
    }
    return total;
};

const findClosestPathIndex = (point, path) => {
    const validPoint = normalizePoint(point);
    const validPath = normalizePath(path);
    if (!validPoint || validPath.length === 0) return -1;

    let bestIndex = 0;
    let bestDistance = Infinity;

    validPath.forEach((candidate, index) => {
        const d = getDistanceMeters(validPoint, candidate);
        if (d < bestDistance) {
            bestDistance = d;
            bestIndex = index;
        }
    });

    return bestIndex;
};

const getFallbackRouteMetrics = (origin, targets, nextIndex, plannedGeometry) => {
    const loc = normalizePoint(origin);
    const currentTarget = normalizePoint(targets?.[nextIndex]);
    const geometry = normalizePath(plannedGeometry);

    if (!loc || !currentTarget) {
        return {
            nextDistMeters: 0,
            remainingDistMeters: 0,
            nextDurMins: 0,
            totalDurMins: 0
        };
    }

    let nextDistMeters = getDistanceMeters(loc, currentTarget);
    let remainingDistMeters = getRemainingStraightDistanceMeters(loc, targets, nextIndex);

    if (geometry.length > 2) {
        const locIdx = findClosestPathIndex(loc, geometry);
        const targetIdx = findClosestPathIndex(currentTarget, geometry);
        const finalTarget = normalizePoint(targets?.[targets.length - 1]);
        const finalIdx = finalTarget ? findClosestPathIndex(finalTarget, geometry) : geometry.length - 1;

        if (locIdx >= 0 && targetIdx >= 0 && targetIdx >= locIdx) {
            nextDistMeters = Math.max(0, getDistanceAlongPathMeters(geometry, locIdx, targetIdx));
        }

        if (locIdx >= 0 && finalIdx >= locIdx) {
            remainingDistMeters = Math.max(0, getDistanceAlongPathMeters(geometry, locIdx, finalIdx));
        }
    }

    return {
        nextDistMeters,
        remainingDistMeters,
        nextDurMins: estimateMinutesFromMeters(nextDistMeters),
        totalDurMins: estimateMinutesFromMeters(remainingDistMeters)
    };
};

// === NUEVOS HELPERS: FORZAR HORA MÉXICO CENTRAL ===
const getMexicoTime = () => new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute:'2-digit' });
const getMexicoDate = () => new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });


// === HELPERS: HORARIOS PROGRAMADOS DEL DESPACHADOR ===
// La app del conductor debe respetar las horas calculadas por el despachador:
// - startTime / startCoords.pickupTime = hora real para iniciar o recoger.
// - scheduledTime / officialScheduledTime = hora oficial del corporativo.
// - targetArrivalTime / endCoords.targetArrivalTime = hora objetivo de llegada final.

const getPickupDateValue = (route) => {
    return route?.pickupDate || route?.scheduledDate || route?.fechaServicio || route?.fechaRecogida || route?.date || '';
};

const normalizeTimeString = (value) => {
    if (!value) return '';
    if (value?.toDate) {
        return value.toDate().toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Mexico_City'
        });
    }

    const raw = String(value).trim();
    if (!raw) return '';

    // HH:mm o H:mm
    if (/^\d{1,2}:\d{2}$/.test(raw)) {
        const [hour, minute] = raw.split(':').map(Number);
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }

    return raw;
};

const getRouteOfficialTimeValue = (route) => {
    return normalizeTimeString(
        route?.officialScheduledTime ||
        route?.technicalData?.carpool?.officialScheduledTime ||
        route?.scheduledTime ||
        route?.horaProgramada ||
        route?.time ||
        ''
    );
};

const getPickupTimeValue = (route) => {
    return normalizeTimeString(
        route?.startCoords?.pickupTime ||
        route?.pickupTime ||
        route?.horaRecogida ||
        route?.horaPickup ||
        route?.technicalData?.carpool?.startTime ||
        route?.startTime ||
        route?.scheduledStartTime ||
        route?.scheduledTime ||
        route?.time ||
        ''
    );
};

const getTargetArrivalTimeValue = (route) => {
    return normalizeTimeString(
        route?.endCoords?.targetArrivalTime ||
        route?.targetArrivalTime ||
        route?.technicalData?.carpool?.targetArrivalTime ||
        route?.technicalData?.carpool?.estimatedFinalArrivalTime ||
        route?.estimatedFinalArrivalTime ||
        route?.scheduledTime ||
        ''
    );
};

const getStopPlannedTimeValue = (route, stopIndex) => {
    if (!route) return '';

    const waypointsCount = route?.waypointsData?.length || 0;
    const finalIndex = waypointsCount + 1;

    if (stopIndex === 0) {
        return getPickupTimeValue(route);
    }

    if (stopIndex > 0 && stopIndex < finalIndex) {
        const waypoint = route?.waypointsData?.[stopIndex - 1];
        return normalizeTimeString(
            waypoint?.pickupTime ||
            waypoint?.plannedPickupTime ||
            waypoint?.horaRecogida ||
            waypoint?.horaPickup ||
            ''
        );
    }

    return getTargetArrivalTimeValue(route);
};

const getStopScheduleLabel = (route, stopIndex) => {
    const waypointsCount = route?.waypointsData?.length || 0;
    const finalIndex = waypointsCount + 1;

    if (stopIndex >= finalIndex) return 'Llegada final objetivo';
    if (stopIndex === 0) return 'Primer punto programado';
    return 'Recolección programada';
};

const formatPickupDate = (dateValue) => {
    if (!dateValue) return 'Fecha pendiente';

    try {
        if (dateValue?.toDate) {
            return dateValue.toDate().toLocaleDateString('es-MX', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
                timeZone: 'America/Mexico_City'
            });
        }

        const raw = String(dateValue).trim();

        // Formato recomendado: YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            const [year, month, day] = raw.split('-').map(Number);
            const date = new Date(year, month - 1, day);

            return date.toLocaleDateString('es-MX', {
                weekday: 'short',
                day: '2-digit',
                month: 'short'
            });
        }

        return raw;
    } catch (e) {
        return String(dateValue);
    }
};

const formatPickupTime = (timeValue) => {
    const normalized = normalizeTimeString(timeValue);
    if (!normalized) return 'Hora pendiente';

    try {
        // Formato recomendado: HH:mm
        if (/^\d{1,2}:\d{2}$/.test(normalized)) {
            const [hour, minute] = normalized.split(':').map(Number);
            const date = new Date(2000, 0, 1, hour, minute);

            return date.toLocaleTimeString('es-MX', {
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        return normalized;
    } catch (e) {
        return String(timeValue);
    }
};

const getPickupScheduleText = (route) => {
    const dateText = formatPickupDate(getPickupDateValue(route));
    const timeText = formatPickupTime(getPickupTimeValue(route));
    return `${dateText} • ${timeText}`;
};

const getOfficialScheduleText = (route) => {
    const dateText = formatPickupDate(getPickupDateValue(route));
    const timeText = formatPickupTime(getRouteOfficialTimeValue(route));
    return `${dateText} • ${timeText}`;
};

const getFirstPointArrivalText = (route) => {
    return formatPickupTime(getStopPlannedTimeValue(route, 0));
};

const getPickupDateForFilter = (route) => {
    const value = getPickupDateValue(route);
    if (!value) return '';

    try {
        if (value?.toDate) {
            return value.toDate().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
        }

        const raw = String(value).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        return raw;
    } catch (e) {
        return String(value);
    }
};

const getPickupSortableDateTime = (route) => {
    const dateValue = getPickupDateForFilter(route) || '2099-12-31';
    const timeValue = getPickupTimeValue(route) || '00:00';
    const normalizedTime = normalizeTimeString(timeValue) || '00:00';
    const parsed = new Date(`${dateValue}T${normalizedTime}`);
    return isNaN(parsed.getTime()) ? new Date('2099-12-31T00:00') : parsed;
};

const getPlannedStartDateTime = (route) => {
    const dateValue = getPickupDateForFilter(route);
    const timeValue = getPickupTimeValue(route);
    if (!dateValue || !timeValue) return null;

    const parsed = new Date(`${dateValue}T${normalizeTimeString(timeValue)}`);
    return isNaN(parsed.getTime()) ? null : parsed;
};

// === HELPER: HORA ESTIMADA DE LLEGADA AL PUNTO ACTUAL ===
const getEstimatedArrivalTimeFromMinutes = (minutesToAdd) => {
    const minutes = Number(minutesToAdd);

    if (!Number.isFinite(minutes) || minutes < 0) {
        return 'Calculando...';
    }

    try {
        const etaDate = new Date(Date.now() + minutes * 60000);

        return etaDate.toLocaleTimeString('es-MX', {
            timeZone: 'America/Mexico_City',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return 'Calculando...';
    }
};


// === HELPERS: MAPA SEGURO Y SNAP TO ROUTE ===
const toFiniteNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const normalizePoint = (point) => {
    if (!point) return null;
    const lat = toFiniteNumber(point.lat);
    const lng = toFiniteNumber(point.lng ?? point.lon);
    if (lat === null || lng === null) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { ...point, lat, lng };
};

const normalizePath = (path) => {
    if (!Array.isArray(path)) return [];
    return path.map(normalizePoint).filter(Boolean);
};

const safeSetMapCamera = (map, loc, heading = 0, zoom = 18) => {
    if (!map || !loc) return;
    try {
        map.panTo(loc);
        map.setZoom(zoom);

        // Importante: se evita forzar tilt/heading 3D.
        // En algunos dispositivos Android/PWA el mapa vectorial con tilt al regresar de segundo plano
        // puede quedarse negro. La flecha conserva la orientación del conductor.
        if (typeof map.setTilt === 'function') map.setTilt(0);
        if (typeof map.setHeading === 'function') map.setHeading(0);
    } catch (e) {
        console.error('No se pudo ajustar la cámara del mapa:', e);
    }
};

// === HELPER: SNAP TO ROUTE (Pegar flecha a la línea azul) ===
const getSnappedLocation = (loc, path) => {
    const validLoc = normalizePoint(loc);
    const validPath = normalizePath(path);

    if (!validLoc || validPath.length < 2) return validLoc;

    let minDist = Infinity;
    let closestLoc = validLoc;

    for (let i = 0; i < validPath.length - 1; i++) {
        const a = validPath[i];
        const b = validPath[i + 1];

        const l2 = Math.pow(b.lat - a.lat, 2) + Math.pow(b.lng - a.lng, 2);
        if (l2 === 0) continue;

        let t = ((validLoc.lat - a.lat) * (b.lat - a.lat) + (validLoc.lng - a.lng) * (b.lng - a.lng)) / l2;
        t = Math.max(0, Math.min(1, t));

        const proj = {
            lat: a.lat + t * (b.lat - a.lat),
            lng: a.lng + t * (b.lng - a.lng)
        };

        const distSq = Math.pow(validLoc.lat - proj.lat, 2) + Math.pow(validLoc.lng - proj.lng, 2);

        if (distSq < minDist) {
            minDist = distSq;
            closestLoc = proj;
        }
    }

    // Si el GPS está claramente fuera de la ruta, usamos ubicación real y no forzamos snap.
    if (minDist > 0.00000009) return validLoc;
    return closestLoc;
};

// --- NUEVO: REPRODUCTOR DE SONIDO DE ALERTA ---
const playAlertSound = () => {
    try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.play().catch(e => console.log("Navegador bloqueó el audio automático"));
    } catch(e) {}
};

function App() {
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentDriver, setCurrentDriver] = useState(null);
  const [isReady, setIsReady] = useState(false);
  
  const [misRutas, setMisRutas] = useState([]);
  const [prevRutasCount, setPrevRutasCount] = useState(0); // Para detectar si el despachador asignó algo manual

  const [darkMode, setDarkMode] = useState(false);
  const [filterType, setFilterType] = useState('Próximo');
  const [mainTab, setMainTab] = useState('Pendientes'); 
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);

  const [isWaiting, setIsWaiting] = useState(false);
  const [chatText, setChatText] = useState('');
  const [evidence, setEvidence] = useState(null);
  const [incomingOffer, setIncomingOffer] = useState(null);

  const [showJustification, setShowJustification] = useState(false);
  const [justificationText, setJustificationText] = useState('');
  const [distanceOff, setDistanceOff] = useState(0);

  const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: GOOGLE_MAPS_API_KEY, libraries });
  const mapRef = useRef(null);
  const [mapRenderKey] = useState(0); // Se conserva para compatibilidad, pero ya no forzamos remounts del mapa.
  const lastCameraMoveRef = useRef(0);
  const lastDriverLocationWriteRef = useRef(0);
  const lastDirectionsRequestRef = useRef(0);
  const directionsBusyRef = useRef(false);
  const lastDirectionsStopRef = useRef(null);
  
  const [userLocation, setUserLocation] = useState(null);
  const [userHeading, setUserHeading] = useState(0); 
  const [isTracking, setIsTracking] = useState(true);
  
  const isTrackingRef = useRef(true); 
  const latestLocRef = useRef(null);
  const prevLocRef = useRef(null); 
  const odometerLocRef = useRef(null); 
  
  const [nextStopIdx, setNextStopIdx] = useState(0); 
  const [routeUpdateTick, setRouteUpdateTick] = useState(0); 
  
  const [alertedStops, setAlertedStops] = useState([]); 
  const [isApproaching, setIsApproaching] = useState(false); 

  const [liveRouteData, setLiveRouteData] = useState({ geometry: [], totalDuration: 0, totalDistance: 0, nextStopDuration: 0, nextStopDistance: 0 });

  // === ESTADOS PARA EL ASISTENTE DE NAVEGACIÓN Y VOZ ===
  const [nextManeuver, setNextManeuver] = useState({ instruction: '', distance: '' });
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const lastSpokenRef = useRef('');

  const wakeLockRef = useRef(null);
  const chatScrollRef = useRef(null);

  const handleMapLoad = useCallback((map) => {
      mapRef.current = map;
      try {
          if (typeof map.setTilt === 'function') map.setTilt(0);
          if (typeof map.setHeading === 'function') map.setHeading(0);
      } catch (e) {
          console.error('Error inicializando mapa:', e);
      }
  }, []);

  // Recuperación segura al volver de segundo plano.
  // Importante: NO desmontamos ni remontamos el componente GoogleMap.
  // En Android WebView, remount + GPS + Firestore puede provocar pantalla negra.
  useEffect(() => {
      const resumeMapSafely = () => {
          setRouteUpdateTick(t => t + 1);

          setTimeout(() => {
              const loc = latestLocRef.current;
              if (mapRef.current && loc) {
                  safeSetMapCamera(mapRef.current, loc, 0, 17);
              }
          }, 350);
      };

      const onVisibilityChange = () => {
          if (document.visibilityState === 'visible') resumeMapSafely();
      };

      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('pageshow', resumeMapSafely);

      return () => {
          document.removeEventListener('visibilitychange', onVisibilityChange);
          window.removeEventListener('pageshow', resumeMapSafely);
      };
  }, []);

  useEffect(() => { latestLocRef.current = userLocation; }, [userLocation]);
  useEffect(() => { isTrackingRef.current = isTracking; }, [isTracking]);
  useEffect(() => { if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight; }, [selectedRoute?.chat, isWaiting]);

  // === LÓGICA DEL NARRADOR (TEXT-TO-SPEECH) ===
  useEffect(() => {
      if (voiceEnabled && nextManeuver.instruction) {
          const cleanText = nextManeuver.instruction.replace(/<[^>]*>?/gm, '');
          const textToSpeak = `${nextManeuver.distance}. ${cleanText}`;

          if (lastSpokenRef.current !== textToSpeak) {
              window.speechSynthesis.cancel(); 
              const utterance = new SpeechSynthesisUtterance(textToSpeak);
              utterance.lang = 'es-MX'; 
              utterance.rate = 0.95; 
              
              window.speechSynthesis.speak(utterance);
              lastSpokenRef.current = textToSpeak;
          }
      }
  }, [nextManeuver, voiceEnabled]);

  useEffect(() => {
    const savedActiveId = localStorage.getItem('active_trip_id');
    if (savedActiveId && !selectedRoute && misRutas.length > 0) {
        const tripToResume = misRutas.find(r => r.id === savedActiveId);
        if (tripToResume && tripToResume.status === 'En Ruta') {
            setSelectedRoute(tripToResume);
            const savedIdx = localStorage.getItem(`trip_idx_${savedActiveId}`);
            if (savedIdx) setNextStopIdx(parseInt(savedIdx, 10));
        }
    }
  }, [misRutas, selectedRoute]);

  // --- DETECCIÓN DE VIAJES ASIGNADOS MANUALMENTE DESDE EL DESPACHO ---
  useEffect(() => {
      if (misRutas.length > prevRutasCount && prevRutasCount !== 0) {
          playAlertSound();
          if ("vibrate" in navigator) navigator.vibrate([300, 100, 300, 100, 300]);
      }
      setPrevRutasCount(misRutas.length);
  }, [misRutas.length, prevRutasCount]);

  useEffect(() => {
    const requestWakeLock = async () => { if ('wakeLock' in navigator && selectedRoute?.status === 'En Ruta') { try { wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch (err) {} } };
    const handleVisibilityChange = () => { if (document.visibilityState === 'visible') requestWakeLock(); };
    if (selectedRoute?.status === 'En Ruta') { requestWakeLock(); document.addEventListener('visibilitychange', handleVisibilityChange); }
    return () => { document.removeEventListener('visibilitychange', handleVisibilityChange); if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; } };
  }, [selectedRoute?.status]);

  // INYECTAMOS LOS NOMBRES REALES DEL PASAJERO A LA UI
  const allTargets = useMemo(() => {
      if (!selectedRoute) return [];

      const targets = [];

      const addTarget = (point, extraData = {}) => {
          const normalized = normalizePoint(point);
          if (!normalized) return;

          targets.push({
              ...normalized,
              ...extraData,
              contact: extraData.contact || normalized.passengerName || normalized.contact || ''
          });
      };

      if (selectedRoute.startCoords) {
          addTarget(selectedRoute.startCoords, {
              label: 'Origen',
              address: selectedRoute.start,
              icon: ICON_START,
              contact: selectedRoute.startCoords.passengerName || selectedRoute.startCoords.contact,
              plannedTime: getStopPlannedTimeValue(selectedRoute, 0)
          });
      }

      if (selectedRoute.waypointsData) {
          selectedRoute.waypointsData.forEach((wp, idx) => {
              addTarget(wp, {
                  label: `Parada ${String.fromCharCode(66 + idx)}`,
                  address: selectedRoute.waypoints?.[idx] || wp.address,
                  icon: ICON_WAYPOINT,
                  contact: wp.passengerName || wp.contact,
                  plannedTime: getStopPlannedTimeValue(selectedRoute, idx + 1)
              });
          });
      }

      if (selectedRoute.endCoords) {
          const finalIndex = (selectedRoute.waypointsData?.length || 0) + 1;
          addTarget(selectedRoute.endCoords, {
              label: 'Destino Final',
              address: selectedRoute.end,
              icon: ICON_END,
              contact: selectedRoute.endCoords.passengerName || selectedRoute.endCoords.contact,
              plannedTime: getStopPlannedTimeValue(selectedRoute, finalIndex)
          });
      }

      return targets;
  }, [selectedRoute]);

  useEffect(() => {
      const geometry = normalizePath(selectedRoute?.technicalData?.geometry);
      if (isLoaded && mapRef.current && geometry.length > 0) {
          if (!userLocation || selectedRoute.status !== 'En Ruta') {
              try {
                  const bounds = new window.google.maps.LatLngBounds();
                  geometry.forEach(coord => bounds.extend(coord));
                  mapRef.current.fitBounds(bounds);
              } catch (e) {
                  console.error('No se pudo ajustar ruta en mapa:', e);
              }
          }
      }
  }, [isLoaded, selectedRoute?.id, selectedRoute?.status]); 

  // GPS EN SEGUNDO PLANO Y MODO EN LÍNEA
  useEffect(() => {
    let watchId;

    if (currentDriver && (currentDriver.isOnline || (selectedRoute && selectedRoute.status === 'En Ruta'))) {
      if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition(
          async (position) => {
            const loc = normalizePoint({
                lat: position.coords.latitude,
                lng: position.coords.longitude
            });
            const accuracy = Number(position.coords.accuracy) || 9999;

            // Prevención: nunca mandamos coordenadas inválidas al mapa.
            if (!loc) return;

            setUserLocation(loc);

            // 1. Odómetro y Ruta Real con Filtros de Estabilización Anticlono
            if (selectedRoute?.status === 'En Ruta' && window.google?.maps?.geometry) {
                if (accuracy > 35) return;

                if (nextStopIdx > 0) {
                    if (!odometerLocRef.current) {
                        odometerLocRef.current = loc;
                    } else {
                        const p1 = new window.google.maps.LatLng(odometerLocRef.current.lat, odometerLocRef.current.lng);
                        const p2 = new window.google.maps.LatLng(loc.lat, loc.lng);
                        const distMeters = window.google.maps.geometry.spherical.computeDistanceBetween(p1, p2);

                        if (distMeters > 20 && distMeters < 350) {
                            const distKm = distMeters / 1000;
                            try {
                                await updateDoc(doc(db, "rutas", selectedRoute.id), {
                                    realDistanceDriven: increment(distKm),
                                    rutaReal: arrayUnion(loc)
                                });
                            } catch(e) {
                                console.error("Error telemétrico:", e);
                            }
                            odometerLocRef.current = loc;
                        }
                    }
                }
            }

            // 2. Filtro estabilizador para brújula y rotación de flecha.
            // Importante: ya no reiniciamos el watcher en cada cambio de heading.
            if (prevLocRef.current && window.google?.maps?.geometry) {
                const p1 = new window.google.maps.LatLng(prevLocRef.current.lat, prevLocRef.current.lng);
                const p2 = new window.google.maps.LatLng(loc.lat, loc.lng);
                const distForHeading = window.google.maps.geometry.spherical.computeDistanceBetween(p1, p2);

                if (distForHeading > 3) {
                    let newHeading = position.coords.heading;

                    if (newHeading === null || isNaN(newHeading) || (position.coords.speed !== null && position.coords.speed < 1)) {
                        newHeading = window.google.maps.geometry.spherical.computeHeading(p1, p2);
                    }

                    if (newHeading !== null && !isNaN(newHeading)) {
                        setUserHeading(newHeading);
                    }

                    prevLocRef.current = loc;
                }
            } else {
                const initialHeading = Number(position.coords.heading);
                setUserHeading(Number.isFinite(initialHeading) ? initialHeading : 0);
                prevLocRef.current = loc;
            }

            // 3. Enviar ubicación de respaldo a Firebase
            if (currentDriver.isOnline && (!selectedRoute || selectedRoute.status !== 'En Ruta')) {
                try {
                    await updateDoc(doc(db, "conductores", currentDriver.id), { currentLocation: loc });
                } catch(e){}
            }
          },
          (error) => {
              console.error("Error crítico de hardware GPS:", error);
              setRouteUpdateTick(t => t + 1);
          },
          { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
        );
      }
    }

    return () => {
        if (watchId) navigator.geolocation.clearWatch(watchId);
    };
  }, [currentDriver, selectedRoute?.id, selectedRoute?.status, nextStopIdx]);

  const driverLocationForMap = useMemo(() => {
      return (
          normalizePoint(userLocation) ||
          normalizePoint(selectedRoute?.currentLocation) ||
          normalizePoint(currentDriver?.currentLocation)
      );
  }, [userLocation, selectedRoute?.currentLocation, currentDriver?.currentLocation]);

  const snappedLocation = useMemo(() => {
      const liveGeometry = normalizePath(liveRouteData.geometry);
      const savedGeometry = normalizePath(selectedRoute?.technicalData?.geometry);
      const geo = liveGeometry.length > 0 ? liveGeometry : savedGeometry;
      return getSnappedLocation(driverLocationForMap, geo);
  }, [driverLocationForMap, liveRouteData.geometry, selectedRoute?.technicalData?.geometry]);

  useEffect(() => {
      if (isTrackingRef.current && mapRef.current && selectedRoute?.status === 'En Ruta' && snappedLocation) {
          const now = Date.now();

          // Throttle de cámara: mover el mapa en cada pulso de GPS puede colgar Android WebView.
          if (now - lastCameraMoveRef.current > 2000) {
              safeSetMapCamera(mapRef.current, snappedLocation, userHeading, 17);
              lastCameraMoveRef.current = now;
          }
      }
  }, [snappedLocation, selectedRoute?.status, userHeading]);

  useEffect(() => {
      if (!currentDriver || !currentDriver.isOnline || selectedRoute?.status === 'En Ruta') return;
      const q = query(collection(db, "rutas"), where("ofertaPara", "==", currentDriver.id), where("ofertaEstado", "==", "Pendiente"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
          if (!snapshot.empty) {
              setIncomingOffer({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() });
              playAlertSound(); // SONIDO AL RECIBIR VIAJE
              if ("vibrate" in navigator) navigator.vibrate([500, 200, 500, 200, 1000]); 
          } else { setIncomingOffer(null); }
      });
      return () => unsubscribe();
  }, [currentDriver, selectedRoute]);

  const aceptarViaje = async () => {
      if (!incomingOffer || !currentDriver) return;
      try { await updateDoc(doc(db, "rutas", incomingOffer.id), { driver: currentDriver.name, driverId: currentDriver.id, ofertaEstado: 'Aceptada', status: 'Aceptada' }); setIncomingOffer(null); setMainTab('Pendientes'); } catch (e) { alert("Error al aceptar viaje"); }
  };
  const rechazarViaje = async () => {
      if (!incomingOffer || !currentDriver) return;
      try { await updateDoc(doc(db, "rutas", incomingOffer.id), { ofertaEstado: 'Rechazada', rechazadoPor: arrayUnion(currentDriver.id), ofertaPara: '' }); setIncomingOffer(null); } catch (e) {}
  };

  useEffect(() => {
      if (selectedRoute?.status !== 'En Ruta') return;
      const interval = setInterval(() => setRouteUpdateTick(t => t + 1), 15000);
      return () => clearInterval(interval);
  }, [selectedRoute?.status]);

  useEffect(() => {
      if (selectedRoute?.status !== 'En Ruta' || allTargets.length === 0) return;

      const loc = normalizePoint(latestLocRef.current || driverLocationForMap);
      if (!loc) return;

      const plannedGeometry = normalizePath(selectedRoute?.technicalData?.geometry);
      const fallbackMetrics = getFallbackRouteMetrics(loc, allTargets, nextStopIdx, plannedGeometry);

      const applyMetricsAndProximity = (metrics) => {
          const nextDistMeters = Number(metrics.nextDistMeters) || 0;
          const remainingDistMeters = Number(metrics.remainingDistMeters) || 0;
          const nextDurMins = Number(metrics.nextDurMins) || 0;
          const totalDurMins = Number(metrics.totalDurMins) || 0;

          setLiveRouteData({
              // Mantenemos geometry vacío para no redibujar rutas dinámicas pesadas en Android.
              // El mapa sigue mostrando la ruta oficial enviada por el despachador.
              geometry: [],
              totalDuration: totalDurMins,
              totalDistance: (remainingDistMeters / 1000).toFixed(1),
              nextStopDuration: nextDurMins,
              nextStopDistance: (nextDistMeters / 1000).toFixed(1)
          });

          let proximityUpdate = {};
          if ((nextDistMeters <= 500 || nextDurMins <= 2) && !alertedStops.includes(nextStopIdx)) {
              setAlertedStops(prev => [...prev, nextStopIdx]);
              setIsApproaching(true);
              proximityUpdate = {
                  proximityAlert: {
                      active: true,
                      stopIndex: nextStopIdx,
                      passenger: allTargets[nextStopIdx]?.contact || 'Pasajero',
                      etaMins: nextDurMins,
                      timestamp: new Date().toISOString()
                  }
              };
          }

          const now = Date.now();
          if (now - lastDriverLocationWriteRef.current > 10000 || Object.keys(proximityUpdate).length > 0) {
              lastDriverLocationWriteRef.current = now;
              updateDoc(doc(db, "rutas", selectedRoute.id), {
                  currentLocation: loc,
                  lastUpdate: new Date().toISOString(),
                  ...proximityUpdate
              }).catch(e => console.error('Error actualizando ubicación en vivo:', e));
          }
      };

      // Fallback inmediato para que la UI siempre tenga km/min aunque Google tarde o falle.
      applyMetricsAndProximity(fallbackMetrics);

      if (!isLoaded || !window.google?.maps?.DirectionsService || directionsBusyRef.current) return;

      const now = Date.now();
      const shouldRequestDirections =
          lastDirectionsStopRef.current !== nextStopIdx ||
          now - lastDirectionsRequestRef.current > 25000;

      if (!shouldRequestDirections) return;

      lastDirectionsStopRef.current = nextStopIdx;
      lastDirectionsRequestRef.current = now;
      directionsBusyRef.current = true;

      try {
          const destinationPoint = normalizePoint(allTargets[allTargets.length - 1]);
          if (!destinationPoint) {
              directionsBusyRef.current = false;
              return;
          }

          const waypoints = [];
          for (let i = nextStopIdx; i < allTargets.length - 1; i++) {
              const p = normalizePoint(allTargets[i]);
              if (p) {
                  waypoints.push({
                      location: { lat: p.lat, lng: p.lng },
                      stopover: true
                  });
              }
          }

          const directionsService = new window.google.maps.DirectionsService();
          directionsService.route({
              origin: { lat: loc.lat, lng: loc.lng },
              destination: { lat: destinationPoint.lat, lng: destinationPoint.lng },
              waypoints,
              optimizeWaypoints: false,
              travelMode: window.google.maps.TravelMode.DRIVING
          }, (result, status) => {
              directionsBusyRef.current = false;

              if (status !== window.google.maps.DirectionsStatus.OK || !result?.routes?.[0]) {
                  console.warn('DirectionsService no disponible:', status);
                  return;
              }

              const route = result.routes[0];
              const legs = route.legs || [];
              let remainingMeters = 0;
              let remainingSeconds = 0;

              legs.forEach(leg => {
                  remainingMeters += leg.distance?.value || 0;
                  remainingSeconds += leg.duration?.value || 0;
              });

              const firstLeg = legs[0];
              const nextDistMeters = firstLeg?.distance?.value || fallbackMetrics.nextDistMeters;
              const nextDurMins = Math.max(1, Math.round((firstLeg?.duration?.value || 0) / 60)) || fallbackMetrics.nextDurMins;
              const totalDurMins = Math.max(1, Math.round(remainingSeconds / 60)) || fallbackMetrics.totalDurMins;

              applyMetricsAndProximity({
                  nextDistMeters,
                  remainingDistMeters: remainingMeters || fallbackMetrics.remainingDistMeters,
                  nextDurMins,
                  totalDurMins
              });

              const firstStep = firstLeg?.steps?.[0];
              if (firstStep) {
                  setNextManeuver({
                      instruction: firstStep.instructions || '',
                      distance: firstStep.distance?.text || ''
                  });
              } else {
                  setNextManeuver({
                      instruction: 'Continúa hacia el siguiente punto',
                      distance: firstLeg?.distance?.text || ''
                  });
              }
          });
      } catch (e) {
          directionsBusyRef.current = false;
          console.error('Error consultando indicaciones:', e);
      }
  }, [routeUpdateTick, driverLocationForMap, nextStopIdx, selectedRoute?.id, selectedRoute?.status, selectedRoute?.technicalData?.geometry, allTargets, alertedStops, isLoaded]);

  const centerOnUser = () => {
      setIsTracking(true);
      if (mapRef.current && snappedLocation) {
          safeSetMapCamera(mapRef.current, snappedLocation, userHeading, 18);
      }
  };

  const handleMapDrag = () => { setIsTracking(false); };

  const cerrarRuta = () => {
      localStorage.removeItem('active_trip_id');
      setSelectedRoute(null);
      setNextStopIdx(0);
      setAlertedStops([]);
      setIsApproaching(false);
      setIsWaiting(false);
      setLiveRouteData({ geometry: [], totalDuration: 0, totalDistance: 0, nextStopDuration: 0, nextStopDistance: 0 });
      setNextManeuver({ instruction: '', distance: '' });
      setIsPanelExpanded(true);
      setIsTracking(true);
      odometerLocRef.current = null;
      prevLocRef.current = null;
      mapRef.current = null;
      window.speechSynthesis.cancel();
  };

  const toggleOnlineStatus = async () => {
      if (!currentDriver) return;
      const newStatus = !currentDriver.isOnline;
      try {
          await updateDoc(doc(db, "conductores", currentDriver.id), { isOnline: newStatus });
          const updatedDriver = { ...currentDriver, isOnline: newStatus };
          setCurrentDriver(updatedDriver); localStorage.setItem('driver_session', JSON.stringify(updatedDriver));

          if (newStatus) {
               const fcmToken = await requestForToken();
               if (fcmToken) { await updateDoc(doc(db, "conductores", currentDriver.id), { pushToken: fcmToken }); }

               if ("geolocation" in navigator) {
                   navigator.geolocation.getCurrentPosition(
                      async (pos) => { const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; setUserLocation(loc); await updateDoc(doc(db, "conductores", currentDriver.id), { currentLocation: loc }); },
                      async (err) => { const fallbackLoc = { lat: 19.5432, lng: -96.9273 }; setUserLocation(fallbackLoc); await updateDoc(doc(db, "conductores", currentDriver.id), { currentLocation: fallbackLoc }); },
                      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
                   );
               }
          } else { await updateDoc(doc(db, "conductores", currentDriver.id), { pushToken: '' }); }
      } catch (e) {}
  };

  const marcarLlegada = async () => { 
      const currentTarget = allTargets[nextStopIdx] || allTargets[allTargets.length - 1];
      if (userLocation && currentTarget) {
          const dist = getDistanceMeters(userLocation, currentTarget);
          if (dist > 200) {
              setDistanceOff(Math.round(dist));
              setShowJustification(true);
              return; 
          }
      }
      proceedToLlegada();
  };

  const proceedToLlegada = async () => {
      setIsWaiting(true); setEvidence(null); setIsApproaching(false); 
      try { await updateDoc(doc(db, "rutas", selectedRoute.id), { "proximityAlert.active": false }); } catch(e){} 
  };

  const submitJustification = async () => {
      if (justificationText.trim().length < 5) return alert("Por favor ingresa un motivo válido detallado.");
      const currentTarget = allTargets[nextStopIdx] || allTargets[allTargets.length - 1];
      const logEntry = {
          evento: 'Llegada Fuera de Rango (Geocerca)',
          motivo: justificationText.trim(),
          distanciaMts: distanceOff,
          punto: currentTarget?.label || 'Destino',
          timestamp: new Date().toISOString(),
          time: getMexicoTime() 
      };

      try {
          await updateDoc(doc(db, "rutas", selectedRoute.id), {
              bitacora: arrayUnion(logEntry),
              chat: arrayUnion({ sender: 'Sistema', text: `📍 Chofer reportó llegada a ${distanceOff}m del punto. Motivo: ${justificationText.trim()}`, time: logEntry.time, timestamp: logEntry.timestamp })
          });
          setShowJustification(false);
          setJustificationText('');
          proceedToLlegada();
      } catch(e) { alert("Error al guardar la justificación."); }
  };

  const enviarMensaje = async () => {
      if(!chatText.trim()) return;
      const msg = { sender: 'Conductor', text: chatText.trim(), time: getMexicoTime(), timestamp: new Date().toISOString() };
      try { await updateDoc(doc(db, "rutas", selectedRoute.id), { chat: arrayUnion(msg) }); setChatText(''); } catch(e) {}
  };

  const handlePhoto = (e) => {
      const file = e.target.files[0];
      if(file) {
          const reader = new FileReader();
          reader.onload = (event) => {
              const img = new Image();
              img.onload = () => {
                  const canvas = document.createElement('canvas'); 
                  const scaleSize = 800 / img.width; 
                  canvas.width = 800; 
                  canvas.height = img.height * scaleSize; 
                  const ctx = canvas.getContext('2d'); 
                  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                  const dateStr = getMexicoDate(); 
                  const timeStr = getMexicoTime(); 
                  const latLngStr = userLocation ? `GPS: ${userLocation.lat.toFixed(6)}, ${userLocation.lng.toFixed(6)}` : 'GPS: No disponible';

                  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
                  ctx.fillRect(0, canvas.height - 70, canvas.width, 70);

                  ctx.font = "bold 18px sans-serif";
                  ctx.fillStyle = "#ef4444"; 
                  ctx.fillText(`FECHA: ${dateStr}  HORA: ${timeStr}`, 20, canvas.height - 40);
                  
                  ctx.font = "bold 16px sans-serif";
                  ctx.fillStyle = "#ffffff";
                  ctx.fillText(latLngStr, 20, canvas.height - 15);

                  setEvidence(canvas.toDataURL('image/jpeg', 0.8));
              }
              img.src = event.target.result;
          };
          reader.readAsDataURL(file);
      }
  };

  const confirmarAbordaje = async (isFinalDestination) => {
      if (evidence) {
          const target = allTargets[nextStopIdx];
          const llegadaData = { stopIndex: nextStopIdx, label: target?.label || (isFinalDestination ? 'Destino Final' : 'Parada'), passenger: target?.contact || 'Pasajero', address: target?.address || '', photo: evidence, time: getMexicoTime(), timestamp: new Date().toISOString() };
          try { await updateDoc(doc(db, "rutas", selectedRoute.id), { evidenciasLlegada: arrayUnion(llegadaData) }); } catch (e) {}
      }
      if(isFinalDestination) { handleEndTrip(selectedRoute.id); setIsWaiting(false); } 
      else { const newIdx = nextStopIdx + 1; setNextStopIdx(newIdx); localStorage.setItem(`trip_idx_${selectedRoute.id}`, newIdx); setIsWaiting(false); setRouteUpdateTick(t => t + 1); }
  };

  const reportarAusencia = async (isFinalDestination) => {
      if(!evidence) return alert("⚠️ Por favor, toma una foto de evidencia del lugar antes de reportar la ausencia.");
      const target = allTargets[nextStopIdx];
      const noShowData = { stopIndex: nextStopIdx, passenger: target?.contact || 'Pasajero', address: target?.address || '', photo: evidence, time: getMexicoTime(), timestamp: new Date().toISOString() };
      try {
          await updateDoc(doc(db, "rutas", selectedRoute.id), { evidencias: arrayUnion(noShowData), chat: arrayUnion({ sender: 'Sistema', text: `Conductor reportó AUSENCIA en ${target?.label}. Evidencia guardada.`, time: noShowData.time, timestamp: noShowData.timestamp }) });
          alert("✅ Evidencia guardada correctamente en el sistema."); confirmarAbordaje(isFinalDestination); 
      } catch (e) { alert("Error al subir evidencia. Revisa tu conexión."); }
  };

  const handleSelectRoute = (ruta) => {
      setSelectedRoute(ruta); setAlertedStops([]); setIsApproaching(false); setIsWaiting(false);
      if (ruta.status === 'En Ruta') { localStorage.setItem('active_trip_id', ruta.id); const savedIdx = localStorage.getItem(`trip_idx_${ruta.id}`); if (savedIdx) setNextStopIdx(parseInt(savedIdx, 10)); } else { setNextStopIdx(0); }
  };

  const [password, setPassword] = useState('');
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [address, setAddress] = useState(''); const [rfc, setRfc] = useState('');
  const [bloodType, setBloodType] = useState(''); const [emergencyContact, setEmergencyContact] = useState('');
  const [licenseNumber, setLicenseNumber] = useState(''); const [licenseType, setLicenseType] = useState('');
  const [licenseExp, setLicenseExp] = useState(''); const [vehicleModel, setVehicleModel] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState(''); const [vehicleType, setVehicleType] = useState('');

  useEffect(() => {
    const savedDriver = localStorage.getItem('driver_session');
    if (savedDriver) { const driverData = JSON.parse(savedDriver); setCurrentDriver(driverData); cargarDatosEnFormulario(driverData); escucharRutas(driverData.id); }
    setIsReady(true);
  }, []);

  const cargarDatosEnFormulario = (data) => {
    setName(data.name || ''); setPhone(data.phone || ''); setAddress(data.address || ''); setRfc(data.rfc || ''); setBloodType(data.bloodType || ''); setEmergencyContact(data.emergencyContact || ''); setLicenseNumber(data.licenseNumber || ''); setLicenseType(data.licenseType || ''); setLicenseExp(data.licenseExp || ''); setVehicleModel(data.vehicleModel || ''); setVehiclePlate(data.vehiclePlate || ''); setVehicleType(data.vehicleType || ''); setPassword(data.password || '');
  };

  const escucharRutas = (driverId) => {
    const q = query(collection(db, "rutas"), where("driverId", "==", driverId));
    return onSnapshot(q, (snapshot) => setMisRutas(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
  };

  const handleStartTrip = async (routeId) => {
    const routeToStart = selectedRoute?.id === routeId
        ? selectedRoute
        : misRutas.find(r => r.id === routeId);

    const plannedStartDateTime = getPlannedStartDateTime(routeToStart);
    const plannedStartLabel = getPickupScheduleText(routeToStart);

    if (plannedStartDateTime) {
        const now = new Date();
        const diffMins = Math.round((plannedStartDateTime.getTime() - now.getTime()) / 60000);

        if (diffMins > 15) {
            const confirmar = confirm(`Este viaje está planificado para iniciar/recoger en ${plannedStartLabel}. Todavía faltan aproximadamente ${diffMins} minutos. ¿Deseas iniciarlo de todas formas?`);
            if (!confirmar) return;
        } else if (!confirm(`¿Deseas iniciar este viaje ahora?\nHorario planificado: ${plannedStartLabel}`)) {
            return;
        }
    } else if (!confirm("¿Deseas iniciar este viaje ahora?")) {
        return;
    }

    try {
      const actualStartTime = getMexicoTime();
      const updateData = {
          status: 'En Ruta',
          actualStartTime,
          actualStartTimestamp: new Date().toISOString(),
          navigationStartedAt: new Date().toISOString(),
          "proximityAlert.active": false
      };

      // NO sobreescribimos startTime si ya viene del despachador.
      // startTime es la hora planificada; actualStartTime es la hora real.
      if (!routeToStart?.startTime && getPickupTimeValue(routeToStart)) {
          updateData.startTime = getPickupTimeValue(routeToStart);
      }

      await updateDoc(doc(db, "rutas", routeId), updateData);

      setSelectedRoute(prev => ({
          ...prev,
          ...updateData,
          status: 'En Ruta'
      }));

      localStorage.setItem('active_trip_id', routeId);
      localStorage.setItem(`trip_idx_${routeId}`, 0);

      setNextStopIdx(0);
      setAlertedStops([]);
      setIsApproaching(false);
      setIsWaiting(false);
      setLiveRouteData({ geometry: [], totalDuration: 0, totalDistance: 0, nextStopDuration: 0, nextStopDistance: 0 });
      setNextManeuver({ instruction: '', distance: '' });

      // Saludo inicial de voz
      if (voiceEnabled) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(`Viaje iniciado. Respeta el horario planificado. Primer punto programado: ${formatPickupTime(getStopPlannedTimeValue(routeToStart, 0))}.`);
          utterance.lang = 'es-MX';
          window.speechSynthesis.speak(utterance);
      }
    } catch (e) {
        console.error(e);
        alert("Error al iniciar");
    }
  };

  const handleEndTrip = async (routeId) => {
    if (!confirm("¿Has completado el viaje por completo?")) return;
    try {
      await updateDoc(doc(db, "rutas", routeId), { status: 'Finalizado', endTime: getMexicoTime(), finalDate: getMexicoDate(), "proximityAlert.active": false });
      setSelectedRoute(prev => ({ ...prev, status: 'Finalizado' })); localStorage.removeItem('active_trip_id'); localStorage.removeItem(`trip_idx_${routeId}`);
      alert("¡Ruta finalizada con éxito!"); odometerLocRef.current = null; window.speechSynthesis.cancel();
    } catch (e) {}
  };

  const handleRegister = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const q = query(collection(db, "conductores"), where("phone", "==", phone.trim()));
      const snap = await getDocs(q);
      if (!snap.empty) throw new Error('Este número de teléfono ya está registrado.');

      const nuevoConductor = { name: name.trim(), password, phone: phone.trim(), address: address.trim(), rfc: rfc.trim().toUpperCase(), bloodType: bloodType.trim().toUpperCase(), emergencyContact: emergencyContact.trim(), licenseNumber: licenseNumber.trim(), licenseType: licenseType.trim(), licenseExp: licenseExp, vehicleModel: vehicleModel.trim(), vehiclePlate: vehiclePlate.trim().toUpperCase(), vehicleType: vehicleType.trim(), vehicle: `${vehicleModel} (${vehiclePlate.toUpperCase()})`, status: 'Pendiente', initials: name.substring(0, 2).toUpperCase(), isOnline: false, created: new Date().toISOString(), joined: getMexicoDate(), trips: 0, rating: 5, fotoPerfil: '', identificacion: '' };
      await addDoc(collection(db, "conductores"), nuevoConductor);
      alert("¡Registro enviado! Tu expediente está en revisión."); setIsRegistering(false);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const updatedData = { name: name.trim(), phone: phone.trim(), address: address.trim(), rfc: rfc.trim().toUpperCase(), bloodType: bloodType.trim().toUpperCase(), emergencyContact: emergencyContact.trim(), licenseNumber: licenseNumber.trim(), licenseType: licenseType.trim(), licenseExp: licenseExp, vehicleModel: vehicleModel.trim(), vehiclePlate: vehiclePlate.trim().toUpperCase(), vehicleType: vehicleType.trim(), vehicle: `${vehicleModel} (${vehiclePlate.toUpperCase()})`, initials: name.substring(0, 2).toUpperCase() };
      await updateDoc(doc(db, "conductores", currentDriver.id), updatedData);
      const newState = { ...currentDriver, ...updatedData }; setCurrentDriver(newState); localStorage.setItem('driver_session', JSON.stringify(newState)); alert("¡Expediente actualizado!"); setIsEditingProfile(false);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault(); setLoading(true);
    const q = query(collection(db, "conductores"), where("phone", "==", phone.trim()));
    const snap = await getDocs(q);
    if (snap.empty) { setError('Número de teléfono no encontrado'); setLoading(false); return; }
    const data = { id: snap.docs[0].id, ...snap.docs[0].data() };
    if (data.password === password && data.status === 'Aprobado') { setCurrentDriver(data); localStorage.setItem('driver_session', JSON.stringify(data)); cargarDatosEnFormulario(data); escucharRutas(data.id); } else { setError('Contraseña inválida o cuenta no aprobada'); }
    setLoading(false);
  };

  const driverMarkerIcon = useMemo(() => {
      if (!isLoaded || !window.google?.maps) return ICON_START;
      return getDriverMarkerIcon(userHeading);
  }, [isLoaded, userHeading]);

  if (!isReady) return null;

  const theme = { bg: darkMode ? 'bg-slate-950' : 'bg-slate-50', text: darkMode ? 'text-white' : 'text-slate-900', card: darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200', input: darkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-900', activeTab: darkMode ? 'bg-slate-800 text-white' : 'bg-white text-orange-500 shadow-sm' };

  // ==============================================================
  // VISTA 1: NAVEGACIÓN EN VIVO (ESTATUS: EN RUTA)
  // ==============================================================
  if (currentDriver && selectedRoute && selectedRoute.status === 'En Ruta') {
      const currentGeometry = normalizePath(liveRouteData.geometry).length > 0
          ? normalizePath(liveRouteData.geometry)
          : normalizePath(selectedRoute.technicalData?.geometry);
      const isHeadingToDestination = nextStopIdx >= allTargets.length - 1;
      const currentTarget = allTargets[nextStopIdx] || allTargets[allTargets.length - 1];
      const safeMapCenter = snappedLocation || currentGeometry[0] || normalizePoint(currentTarget) || centerMX;
      const nextStopName = currentTarget?.label || 'Destino';
      const nextStopAddress = currentTarget?.address || '';
      const plannedCurrentStopTimeRaw = getStopPlannedTimeValue(selectedRoute, nextStopIdx);
      const plannedCurrentStopTime = formatPickupTime(plannedCurrentStopTimeRaw);
      const plannedCurrentStopLabel = getStopScheduleLabel(selectedRoute, nextStopIdx);
      const firstPointArrivalTime = getFirstPointArrivalText(selectedRoute);
      const currentEstimatedArrivalTime = getEstimatedArrivalTimeFromMinutes(liveRouteData.nextStopDuration);
      const isHeadingToFirstPoint = nextStopIdx === 0;

      return (
          <div className={`h-screen w-full flex flex-col font-sans transition-colors ${theme.bg} ${theme.text} overflow-hidden relative`}>
              
              {/* --- MODAL GEOCERCA (FUERA DE RANGO) --- */}
              {showJustification && (
                  <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-md animate-in fade-in zoom-in duration-300">
                      <div className="bg-white rounded-[2rem] p-6 max-w-sm w-full shadow-2xl border-4 border-red-500 relative">
                          <div className="flex items-center gap-3 mb-4 text-red-600">
                              <AlertCircle className="w-8 h-8" />
                              <h3 className="text-lg font-black uppercase leading-tight">Llegada Fuera de Rango</h3>
                          </div>
                          <p className="text-sm font-bold text-slate-600 mb-4">
                              El GPS indica que estás a <span className="text-red-600 text-lg">{distanceOff}</span> metros del destino.
                          </p>
                          <p className="text-xs text-slate-500 mb-2 font-medium">Justifica el cambio de ruta o punto de encuentro para la bitácora corporativa:</p>
                          <textarea
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none focus:border-red-500 min-h-[100px] mb-4 text-slate-700"
                              placeholder="Ej: Calle cerrada, el cliente pidió caminar 2 cuadras, etc."
                              value={justificationText}
                              onChange={(e) => setJustificationText(e.target.value)}
                          ></textarea>
                          <div className="flex gap-2">
                              <button onClick={() => setShowJustification(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl active:scale-95 transition-transform text-sm">Cancelar</button>
                              <button onClick={submitJustification} className="flex-1 py-3 bg-red-600 text-white font-black rounded-xl active:scale-95 transition-transform shadow-lg shadow-red-500/30 text-sm">Registrar</button>
                          </div>
                      </div>
                  </div>
              )}

              {/* --- PANTALLA CÁMARA (LLEGUÉ AL PUNTO) --- */}
              {isWaiting && (
                  <div className="absolute inset-0 z-50 bg-slate-50 flex flex-col animate-[fadeIn_0.3s_ease-out]">
                      <div className="bg-slate-800 text-white p-4 pt-8 pb-4 flex justify-between items-center shadow-md shrink-0">
                          <div><p className="text-[10px] font-bold text-orange-300 uppercase tracking-widest">En el punto de encuentro</p><h2 className="text-lg font-black">{currentTarget?.contact || 'Pasajero'}</h2></div>
                          <button onClick={() => setIsWaiting(false)} className="p-2 bg-slate-700 rounded-full hover:bg-slate-600 transition"><X className="w-5 h-5"/></button>
                      </div>

                      <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-100 flex flex-col">
                          <div className="text-center text-[10px] text-slate-400 font-bold mb-4 uppercase">Inicio de Conversación Segura</div>
                          {(selectedRoute.chat || []).map((msg, i) => {
                              if (msg.sender === 'Sistema') return <div key={i} className="text-center"><span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-[10px] font-bold shadow-sm">{msg.text}</span></div>
                              const isDriver = msg.sender === 'Conductor';
                              return (
                                  <div key={i} className={`flex w-full ${isDriver ? 'justify-end' : 'justify-start'}`}>
                                      <div className={`max-w-[80%] p-3 rounded-2xl shadow-sm relative ${isDriver ? 'bg-orange-500 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'}`}>
                                          <p className="text-sm font-medium leading-snug">{msg.text}</p><p className={`text-[9px] mt-1 text-right font-bold ${isDriver ? 'text-orange-200' : 'text-slate-400'}`}>{msg.time}</p>
                                      </div>
                                  </div>
                              );
                          })}
                      </div>

                      <div className="bg-white p-3 border-t border-slate-200 flex items-center gap-2 shrink-0">
                          <input type="text" value={chatText} onChange={e=>setChatText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enviarMensaje()} placeholder="Envía un mensaje al cliente o despacho..." className="flex-1 bg-slate-100 border border-slate-200 rounded-full px-4 py-3 text-sm outline-none focus:border-orange-500 focus:bg-white transition-colors text-slate-700" />
                          <button onClick={enviarMensaje} className="p-3 bg-orange-500 text-white rounded-full shadow-md hover:bg-orange-600 active:scale-95 transition-transform"><Send className="w-5 h-5 ml-1"/></button>
                      </div>

                      <div className="bg-white p-4 border-t border-slate-200 shadow-[0_-10px_20px_rgba(0,0,0,0.05)] shrink-0 space-y-3">
                          <div className="flex gap-2">
                              <a href={`https://wa.me/52${selectedRoute.clientPhone || '1234567890'}?text=Hola,%20soy%20tu%20conductor.%20Ya%20me%20encuentro%20afuera.`} target="_blank" rel="noreferrer" className="flex-1 bg-green-500 hover:bg-green-600 text-white p-3 rounded-xl flex flex-col items-center justify-center gap-1 font-black text-xs transition-colors shadow-sm"><Phone className="w-5 h-5"/> WHATSAPP</a>
                              <label className={`flex-1 p-3 rounded-xl flex flex-col items-center justify-center gap-1 font-black text-xs cursor-pointer transition-colors shadow-sm ${evidence ? 'bg-green-100 text-green-700 border-2 border-green-500' : 'bg-slate-800 text-white hover:bg-slate-900'}`}>
                                  {evidence ? <CheckCircle2 className="w-5 h-5"/> : <Camera className="w-5 h-5"/>} {evidence ? 'FOTO LISTA' : 'TOMAR FOTO'}
                                  <input type="file" accept="image/*" capture="environment" hidden onChange={handlePhoto} />
                              </label>
                          </div>
                          <div className="flex gap-2">
                              <button onClick={() => reportarAusencia(isHeadingToDestination)} className="w-1/3 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 p-3 rounded-xl font-bold text-[10px] leading-tight active:scale-95 transition-transform">NO SE PRESENTÓ</button>
                              <button onClick={() => confirmarAbordaje(isHeadingToDestination)} className="w-2/3 bg-orange-500 hover:bg-orange-600 text-white p-3 rounded-xl font-black text-sm active:scale-95 transition-transform flex items-center justify-center gap-2">
                                  {isHeadingToDestination ? <><CheckCircle className="w-5 h-5"/> FINALIZAR VIAJE</> : <><User className="w-5 h-5"/> PASAJERO A BORDO</>}
                              </button>
                          </div>
                      </div>
                  </div>
              )}

              {/* --- HEADER --- */}
              <div className={`p-4 flex items-center gap-4 shadow-lg z-20 shrink-0 ${darkMode ? 'bg-slate-900 border-b border-slate-800' : 'bg-white'} ${isApproaching ? 'border-b-4 border-orange-500 bg-orange-50' : ''}`}>
                  <button onClick={cerrarRuta} className={`p-2 rounded-full border ${darkMode ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-100'} transition`}><ChevronLeft className="w-5 h-5" /></button>
                  <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                          {isApproaching ? <BellRing className="w-4 h-4 text-orange-500 animate-bounce" /> : <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]"></div>}
                          <h2 className={`text-sm font-black tracking-tight uppercase ${isApproaching ? 'text-orange-600' : 'text-green-500'}`}>{isApproaching ? 'Notificando al Pasajero...' : 'Navegación Activa'}</h2>
                      </div>
                      <p className={`text-[10px] uppercase font-bold text-slate-400 line-clamp-1`}>{selectedRoute.client} • {nextStopName}</p>
                      <p className="text-[10px] uppercase font-black text-orange-500 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" /> {plannedCurrentStopTimeRaw ? `${plannedCurrentStopLabel}: ${plannedCurrentStopTime}` : `Llegada estimada: ${currentEstimatedArrivalTime}`}
                      </p>
                  </div>
              </div>

              {/* --- INSTRUCCIONES WAZE (TURN BY TURN) CON CONTROL DE VOZ --- */}
              {nextManeuver.instruction && (
                  <div className="absolute top-[85px] left-4 right-4 bg-slate-900/90 backdrop-blur-md rounded-2xl p-4 shadow-2xl z-30 border border-slate-700 flex items-center gap-4 animate-[fadeIn_0.3s_ease-out]">
                      <div className="bg-orange-500 w-12 h-12 rounded-full flex items-center justify-center shrink-0 shadow-inner">
                          <Navigation className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1 text-white">
                          <p className="text-xl font-black">{nextManeuver.distance}</p>
                          <p className="text-sm font-medium text-slate-300 leading-tight" dangerouslySetInnerHTML={{ __html: nextManeuver.instruction }}></p>
                      </div>
                      <button 
                          onClick={() => {
                              setVoiceEnabled(!voiceEnabled);
                              if(voiceEnabled) window.speechSynthesis.cancel();
                          }} 
                          className="p-2 rounded-full bg-slate-800 text-slate-300 hover:text-white transition shrink-0"
                      >
                          {voiceEnabled ? <Volume2 className="w-5 h-5"/> : <VolumeX className="w-5 h-5 text-red-400"/>}
                      </button>
                  </div>
              )}

              {/* --- MAPA 3D --- */}
              <div className="flex-1 relative bg-slate-200 w-full h-full">
                  {!isLoaded ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 gap-3 z-10"><Loader2 className="animate-spin text-orange-500 w-8 h-8"/><p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Cargando GPS...</p></div>
                  ) : (
                      <>
                        <GoogleMap
                            key={`nav-map-${selectedRoute.id}`}
                            mapContainerStyle={containerStyle}
                            center={safeMapCenter}
                            zoom={isTracking ? 18 : 16}
                            onLoad={handleMapLoad}
                            onDragStart={handleMapDrag}
                            options={{ disableDefaultUI: true, gestureHandling: "greedy", backgroundColor: "#e2e8f0" }}
                        >
                            {currentGeometry.length > 0 && <Polyline path={currentGeometry} options={{ strokeColor: "#f97316", strokeOpacity: 0.9, strokeWeight: 6 }} />}
                            {allTargets.map((target, idx) => {
                                if (idx < nextStopIdx) return null;
                                const safeTarget = normalizePoint(target);
                                if (!safeTarget) return null;
                                return <Marker key={idx} position={{lat: safeTarget.lat, lng: safeTarget.lng}} icon={target.icon} />;
                            })}
                            {snappedLocation && (
                                <Marker
                                    position={snappedLocation}
                                    icon={driverMarkerIcon}
                                    title="Tu ubicación actual"
                                    label={{ text: ' ', fontSize: '1px' }}
                                    zIndex={9999}
                                />
                            )}
                        </GoogleMap>

                        {!snappedLocation && (
                            <div className="absolute top-4 left-4 right-4 z-20 bg-white/95 border border-orange-200 rounded-2xl px-4 py-3 shadow-lg text-center">
                                <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Esperando GPS del conductor</p>
                                <p className="text-xs font-bold text-slate-600 mt-1">Activa ubicación precisa y permisos de localización para ver el carrito en el mapa.</p>
                            </div>
                        )}
                        
                        {snappedLocation && (
                            <button onClick={centerOnUser} style={{ bottom: isPanelExpanded ? '340px' : '100px' }} className={`absolute left-4 p-3 rounded-full shadow-[0_4px_15px_rgba(0,0,0,0.2)] border transition-all duration-300 z-10 ${isTracking ? 'bg-orange-500 text-white border-orange-600' : 'bg-white text-orange-500 border-slate-200 active:bg-orange-50'}`}>
                                {isTracking ? <Navigation2 className="w-6 h-6" /> : <LocateFixed className="w-6 h-6" />}
                            </button>
                        )}
                      </>
                  )}
              </div>

              {/* --- PANEL DETALLES --- */}
              <div className={`z-20 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] rounded-t-[2rem] -mt-6 shrink-0 relative flex flex-col transition-all duration-300 ${darkMode ? 'bg-slate-900 border-t border-slate-800' : 'bg-white border-t border-slate-200'} ${isPanelExpanded ? 'max-h-[70vh] p-6' : 'h-[90px] px-6 py-4 cursor-pointer'}`}>
                  <div className="w-full flex justify-center pb-3" onClick={() => setIsPanelExpanded(!isPanelExpanded)}>
                      <div className="w-12 h-1.5 bg-slate-300 hover:bg-slate-400 rounded-full transition-colors cursor-pointer"></div>
                  </div>

                  {isPanelExpanded ? (
                      <>
                        <div className="flex justify-between items-center mb-4 px-2">
                            <div className="text-center"><p className="text-[10px] font-black uppercase text-slate-400 mb-0.5 tracking-widest">Restante Total</p><p className="text-2xl font-black text-slate-800 dark:text-white">{liveRouteData.totalDistance || selectedRoute.technicalData?.totalDistance} <span className="text-sm text-slate-400">km</span></p></div>
                            <div className="w-px h-8 bg-slate-200 dark:bg-slate-800"></div>
                            <div className="text-center"><p className="text-[10px] font-black uppercase text-slate-400 mb-0.5 tracking-widest">Tiempo Total</p><p className="text-2xl font-black text-slate-800 dark:text-white">{liveRouteData.totalDuration || selectedRoute.technicalData?.totalDuration} <span className="text-sm text-slate-400">min</span></p></div>
                        </div>
                        <div className={`mb-6 rounded-xl p-4 border shadow-sm ${isApproaching ? 'bg-orange-100 border-orange-300' : darkMode ? 'bg-slate-800 border-slate-700' : 'bg-orange-50/50 border-orange-100'}`}>
                            <p className={`text-[10px] font-black uppercase mb-1 tracking-widest ${isApproaching ? 'text-orange-600 animate-pulse' : 'text-orange-500'}`}>{isApproaching ? 'Llegando al punto...' : 'Siguiente Objetivo'}</p>
                            <p className="font-bold text-sm text-slate-800 dark:text-white truncate mb-3">{nextStopName}: <span className="font-medium text-slate-500 dark:text-slate-400">{nextStopAddress}</span></p>

                            {plannedCurrentStopTimeRaw && (
                                <div className="mb-3 grid grid-cols-2 gap-2">
                                    <div className="bg-white dark:bg-slate-900 rounded-lg p-3 border border-orange-100 dark:border-slate-800 shadow-sm">
                                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{plannedCurrentStopLabel}</span>
                                        <p className="font-black text-orange-500 text-lg flex items-center gap-1 mt-1">
                                            <Clock className="w-4 h-4" /> {plannedCurrentStopTime}
                                        </p>
                                    </div>
                                    <div className="bg-white dark:bg-slate-900 rounded-lg p-3 border border-green-100 dark:border-slate-800 shadow-sm text-right">
                                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Llegas aprox.</span>
                                        <p className="font-black text-green-500 text-lg mt-1">
                                            {currentEstimatedArrivalTime}
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-between items-center bg-white dark:bg-slate-900 rounded-lg p-3 border border-slate-100 dark:border-slate-800 shadow-sm">
                                <div className="flex flex-col"><span className="text-[10px] font-bold text-slate-400 uppercase">Faltan</span><span className="font-black text-orange-500 text-xl">{liveRouteData.nextStopDistance || '--'} <span className="text-sm">km</span></span></div>
                                <div className="w-px h-8 bg-slate-100 dark:bg-slate-800"></div>
                                <div className="flex flex-col text-right"><span className="text-[10px] font-bold text-slate-400 uppercase">Llegada en</span><span className="font-black text-green-500 text-xl">{liveRouteData.nextStopDuration || '--'} <span className="text-sm">min</span></span></div>
                            </div>
                        </div>
                        <div className="space-y-3 shrink-0 mt-auto pb-4">
                            {!isHeadingToDestination ? (
                                <button onClick={marcarLlegada} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-black p-4 rounded-2xl shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all tracking-widest"><MessageSquare className="w-5 h-5"/> LLEGUÉ AL PUNTO (VER OPCIONES)</button>
                            ) : (
                                <button onClick={marcarLlegada} className="w-full text-white font-black p-4 rounded-2xl shadow-xl shadow-red-500/40 bg-red-600 hover:bg-red-700 flex items-center justify-center gap-2 active:scale-95 transition-all tracking-widest animate-pulse"><CheckCircle className="w-5 h-5"/> LLEGUÉ AL DESTINO (VER OPCIONES)</button>
                            )}
                        </div>
                      </>
                  ) : (
                      <div className="flex justify-between items-center px-2" onClick={() => setIsPanelExpanded(true)}>
                          <div>
                              <p className="text-[10px] font-black uppercase text-orange-500 tracking-widest line-clamp-1">{nextStopName}</p>
                              <p className="text-xl font-black text-slate-800 dark:text-white leading-none mt-1">{liveRouteData.nextStopDistance || '--'} <span className="text-sm font-medium text-slate-500">km</span></p>
                              {plannedCurrentStopTimeRaw && <p className="text-[9px] font-black text-orange-500 uppercase mt-1">{plannedCurrentStopLabel}: {plannedCurrentStopTime}</p>}
                          </div>
                          <div className="text-right">
                              <p className="text-[10px] font-black uppercase text-green-500 tracking-widest">Llegada en</p>
                              <p className="text-xl font-black text-green-500 leading-none mt-1">{liveRouteData.nextStopDuration || '--'} <span className="text-sm font-medium text-green-400">min</span></p>
                              {plannedCurrentStopTimeRaw && <p className="text-[9px] font-black text-green-500 uppercase mt-1">Aprox: {currentEstimatedArrivalTime}</p>}
                          </div>
                      </div>
                  )}
              </div>
          </div>
      );
  }

  // ==============================================================
  // VISTA 2: VISTA PREVIA (ESTATUS: ACEPTADA O PENDIENTE)
  // ==============================================================
  if (currentDriver && selectedRoute && selectedRoute.status !== 'En Ruta') {
    const routeToDisplay = normalizePath(selectedRoute.technicalData?.geometry || []);
    let mapCenter = centerMX;
    if (routeToDisplay.length > 0) mapCenter = routeToDisplay[0];

    const previewStartTime = getPickupScheduleText(selectedRoute);
    const previewOfficialTime = getOfficialScheduleText(selectedRoute);
    const previewTargetArrival = formatPickupTime(getTargetArrivalTimeValue(selectedRoute));

    return (
      <div className={`h-screen w-full flex flex-col font-sans transition-colors ${theme.bg} ${theme.text} overflow-hidden relative`}>
        
        {/* Header */}
        <div className={`p-4 flex items-center gap-4 shadow-lg z-20 shrink-0 ${darkMode ? 'bg-slate-900 border-b border-slate-800' : 'bg-white'}`}>
          <button onClick={cerrarRuta} className={`p-2 rounded-full border ${darkMode ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-100'} transition`}><ChevronLeft className="w-5 h-5" /></button>
          <div>
              <h2 className="text-sm font-bold">Vista Previa de Ruta</h2>
              <p className={`text-[10px] uppercase font-bold text-orange-500`}>{selectedRoute.client}</p>
          </div>
        </div>

        {/* MAPA ESTÁTICO DE VISTA PREVIA */}
        <div className="flex-1 relative bg-slate-200 w-full h-full">
          {!isLoaded ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-100 z-10"><Loader2 className="animate-spin text-orange-500 w-8 h-8"/></div>
          ) : (
              <GoogleMap
                  key={`preview-map-${selectedRoute.id}-${mapRenderKey}`}
                  mapContainerStyle={containerStyle}
                  center={mapCenter}
                  zoom={13}
                  onLoad={handleMapLoad}
                  options={{ disableDefaultUI: true, gestureHandling: "greedy", backgroundColor: "#e2e8f0" }}
              >
                  {routeToDisplay.length > 0 && <Polyline path={routeToDisplay} options={{ strokeColor: "#f97316", strokeOpacity: 0.9, strokeWeight: 5 }} />}
                  {normalizePoint(selectedRoute.startCoords) && <Marker position={normalizePoint(selectedRoute.startCoords)} label="A" />}
                  {selectedRoute.waypointsData && selectedRoute.waypointsData.map((wp, idx) => {
                      const safeWp = normalizePoint(wp);
                      return safeWp ? <Marker key={idx} position={safeWp} label={String.fromCharCode(66 + idx)} /> : null;
                  })}
                  {normalizePoint(selectedRoute.endCoords) && <Marker position={normalizePoint(selectedRoute.endCoords)} label={String.fromCharCode(66 + (selectedRoute.waypointsData?.length || 0))} />}
              </GoogleMap>
          )}
        </div>

        {/* PANEL INFERIOR CON BOTÓN DE INICIAR */}
        <div className={`z-20 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] rounded-t-[2rem] -mt-6 shrink-0 relative flex flex-col transition-all duration-300 ${darkMode ? 'bg-slate-900' : 'bg-white'} max-h-[60vh] p-6 overflow-y-auto`}>
            <div className="flex justify-between items-center mb-4">
                <div>
                    <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Estatus</p>
                    <div className="px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-2 bg-orange-100 text-orange-700">
                       <CheckCircle2 className="w-3 h-3"/> {selectedRoute.status}
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Distancia</p>
                    <p className="text-xl font-black">{selectedRoute.technicalData?.totalDistance || '--'} <span className="text-xs text-slate-400">km</span></p>
                </div>
            </div>

            <div className="mb-5 rounded-2xl p-4 bg-orange-500 text-white shadow-xl shadow-orange-500/30 flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                    <Clock className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-orange-100">
                        Hora planificada para iniciar / recoger
                    </p>
                    <p className="text-xl font-black leading-tight">
                        {previewStartTime}
                    </p>
                    {getRouteOfficialTimeValue(selectedRoute) && (
                        <p className="text-[10px] font-bold text-orange-100 mt-1">
                            Hora oficial corporativa: {previewOfficialTime}
                            {getTargetArrivalTimeValue(selectedRoute) ? ` · Llegada objetivo: ${previewTargetArrival}` : ''}
                        </p>
                    )}
                </div>
            </div>

            <div className="space-y-4 mb-4">
                <div className="flex items-start gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-500 mt-1"></div>
                    <div><p className="text-[10px] font-black uppercase text-slate-400">Origen • {selectedRoute.startCoords?.passengerName || 'Pasajero'} • {formatPickupTime(getStopPlannedTimeValue(selectedRoute, 0))}</p><p className="text-xs font-medium">{selectedRoute.start}</p></div>
                </div>
                {selectedRoute.waypointsData && selectedRoute.waypointsData.map((wp, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                        <div className="w-3 h-3 rounded-full bg-orange-500 mt-1"></div>
                        <div><p className="text-[10px] font-black uppercase text-slate-400">Parada {String.fromCharCode(66 + idx)} • {wp.passengerName || 'Pasajero'} • {formatPickupTime(getStopPlannedTimeValue(selectedRoute, idx + 1))}</p><p className="text-xs font-medium">{wp.address}</p></div>
                    </div>
                ))}
                <div className="flex items-start gap-3">
                    <div className="w-3 h-3 rounded-full bg-red-500 mt-1"></div>
                    <div><p className="text-[10px] font-black uppercase text-slate-400">Destino • {selectedRoute.endCoords?.passengerName || 'Pasajero'} • {previewTargetArrival}</p><p className="text-xs font-medium">{selectedRoute.end}</p></div>
                </div>
            </div>

            {selectedRoute.status === 'Pendiente' || selectedRoute.status === 'Aceptada' ? (
                <button onClick={() => handleStartTrip(selectedRoute.id)} className="w-full mt-2 bg-green-600 text-white font-black p-4 rounded-2xl shadow-xl shadow-green-500/30 flex items-center justify-center gap-2 active:scale-95 transition-all">
                    <Play className="w-5 h-5 fill-white"/> INICIAR VIAJE AHORA
                </button>
            ) : (
                <div className="w-full mt-2 bg-slate-100 text-slate-400 font-black p-4 rounded-2xl flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-5 h-5"/> VIAJE FINALIZADO
                </div>
            )}
        </div>
      </div>
    );
  }

  // ==============================================================
  // VISTA 3: PANTALLA PRINCIPAL (ALGORITMO FILTROS MEJORADOS)
  // ==============================================================
  if (currentDriver && !isEditingProfile) {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }); // YYYY-MM-DD
    
    let rFiltradas = misRutas
        .filter(x => {
            if (mainTab === 'Finalizados') return x.status === 'Finalizado';
            if (x.status === 'Finalizado') return false;
            
            // --- NUEVOS FILTROS LÓGICOS ---
            if (filterType === 'Hoy') {
                return getPickupDateForFilter(x) === todayStr || x.serviceType === 'Prioritario';
            }
            return true; // 'Todos' y 'Próximo' pasan este primer filtro
        })
        .sort((a,b) => {
            if (a.status === 'En Ruta' && b.status !== 'En Ruta') return -1;
            if (b.status === 'En Ruta' && a.status !== 'En Ruta') return 1;
            
            const dateA = getPickupSortableDateTime(a);
            const dateB = getPickupSortableDateTime(b);
            return dateA - dateB;
        });

    // Si seleccionó "Próximo", solo le mostramos LA PRIMERA carta de la lista ordenada
    if (filterType === 'Próximo' && mainTab === 'Pendientes') {
        rFiltradas = rFiltradas.slice(0, 1);
    }

    return (
      <div className={`min-h-screen transition-colors duration-300 flex flex-col font-sans relative ${theme.bg} ${theme.text}`}>
        {incomingOffer && (
            <div className="absolute inset-0 z-[9999] flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-md animate-in fade-in zoom-in duration-300">
                <div className="bg-white rounded-[2.5rem] w-full max-w-sm overflow-hidden shadow-2xl border-4 border-yellow-400 flex flex-col">
                    <div className="bg-yellow-400 p-6 text-center shrink-0 relative overflow-hidden"><div className="absolute inset-0 bg-yellow-500/20 animate-pulse"></div><div className="relative z-10 flex flex-col items-center"><div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-lg mb-3"><Zap className="w-8 h-8 text-yellow-500" /></div><h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase">¡NUEVO VIAJE!</h2><p className="text-xs font-bold text-yellow-900 mt-1 uppercase tracking-widest">A unos kilómetros de ti</p></div></div>
                    <div className="p-6 bg-slate-50 space-y-4">
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm text-center"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Cliente Solicitante</p><p className="text-lg font-black text-slate-800">{incomingOffer.client}</p></div>
                        <div className="bg-slate-900 p-4 rounded-2xl shadow-sm text-center border border-slate-800">
                            <p className="text-[10px] font-black text-orange-300 uppercase tracking-widest mb-1">Hora de recogida</p>
                            <p className="text-xl font-black text-white flex items-center justify-center gap-2">
                                <Clock className="w-5 h-5 text-orange-400" />
                                {getPickupScheduleText(incomingOffer)}
                            </p>
                        </div>
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden"><div className="absolute left-0 top-0 bottom-0 w-1.5 bg-orange-500"></div><p className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-1 pl-2">Recoger en:</p><p className="text-sm font-medium text-slate-700 line-clamp-2 pl-2">{incomingOffer.start}</p></div>
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden"><div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-500"></div><p className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1 pl-2">Llevar a:</p><p className="text-sm font-medium text-slate-700 line-clamp-2 pl-2">{incomingOffer.end}</p></div>
                    </div>
                    <div className="p-6 bg-white border-t border-slate-100 flex gap-3 shrink-0"><button onClick={rechazarViaje} className="w-1/3 py-4 rounded-2xl bg-red-50 text-red-600 font-bold text-xs uppercase tracking-widest border border-red-200 hover:bg-red-100 transition active:scale-95">Rechazar</button><button onClick={aceptarViaje} className="w-2/3 py-4 rounded-2xl bg-green-500 text-white font-black text-sm uppercase tracking-widest shadow-xl shadow-green-500/30 hover:bg-green-600 transition active:scale-95 flex items-center justify-center gap-2"><CheckCircle className="w-5 h-5"/> Aceptar Viaje</button></div>
                </div>
            </div>
        )}
        <div className={`p-5 flex flex-col gap-4 shadow-sm border-b ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex justify-between items-center"><button onClick={() => setIsEditingProfile(true)} className="flex items-center gap-3"><div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center text-white font-black shadow-lg">{currentDriver.initials}</div><div className="text-left"><h2 className="text-xs font-bold leading-tight">{currentDriver.name}</h2><p className="text-[8px] uppercase tracking-tighter text-slate-400">Mi Expediente</p></div></button><div className="flex items-center gap-2"><button onClick={() => setDarkMode(!darkMode)} className="p-2">{darkMode ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-slate-500" />}</button><button onClick={() => { localStorage.removeItem('driver_session'); setCurrentDriver(null); }} className="p-2 text-slate-400"><LogOut className="w-5 h-5" /></button></div></div>
          <div className="flex justify-between items-center bg-slate-100 dark:bg-slate-800 p-2 rounded-2xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 pl-2">{currentDriver.isOnline ? <Power className="w-4 h-4 text-green-500" /> : <PowerOff className="w-4 h-4 text-slate-400" />}<div><p className="text-[9px] font-black uppercase text-slate-400">Estado de Operador</p><p className={`text-xs font-bold ${currentDriver.isOnline ? 'text-green-600' : 'text-slate-500'}`}>{currentDriver.isOnline ? 'Conectado (Recibiendo Viajes)' : 'Desconectado'}</p></div></div>
              <button onClick={toggleOnlineStatus} className={`w-14 h-8 rounded-full transition-colors relative shadow-inner ${currentDriver.isOnline ? 'bg-green-500' : 'bg-slate-300'}`}><div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${currentDriver.isOnline ? 'left-7' : 'left-1'}`}></div></button>
          </div>
        </div>
        <div className="px-6 pt-6 pb-2">
            <div className="flex gap-4 mb-4 border-b border-slate-200 dark:border-slate-800 pb-2">
                <button onClick={() => setMainTab('Pendientes')} className={`text-sm font-black uppercase tracking-wider pb-2 border-b-2 transition-all ${mainTab === 'Pendientes' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-400'}`}>En Curso</button>
                <button onClick={() => setMainTab('Finalizados')} className={`text-sm font-black uppercase tracking-wider pb-2 border-b-2 transition-all ${mainTab === 'Finalizados' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-400'}`}>Finalizados</button>
            </div>
            
            {/* CAMBIO: Nuevos Botones de Filtro Intuitivos */}
            {mainTab === 'Pendientes' && (
                <div className={`flex p-1 rounded-xl ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100'}`}>
                    {['Próximo', 'Hoy', 'Todos'].map((tipo) => (
                        <button key={tipo} onClick={() => setFilterType(tipo)} className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${filterType === tipo ? theme.activeTab : 'text-slate-400'}`}>{tipo}</button>
                    ))}
                </div>
            )}
        </div>

        <div className="flex-1 p-6 space-y-4 overflow-y-auto">
            {rFiltradas.length === 0 ? <div className="text-center py-20 text-slate-400 text-sm">Sin servicios {mainTab === 'Finalizados' ? 'completados' : 'asignados para este filtro'}</div> : rFiltradas.map(ruta => (
                <div key={ruta.id} onClick={() => handleSelectRoute(ruta)} className={`p-5 rounded-[2rem] border transition-all flex items-center justify-between active:scale-95 shadow-sm cursor-pointer ${theme.card} ${ruta.serviceType === 'Prioritario' ? 'border-l-4 border-l-yellow-400' : ''}`}>
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${ruta.status === 'Finalizado' ? 'bg-slate-100 text-slate-600' : ruta.status === 'En Ruta' ? 'bg-green-100 text-green-600 animate-pulse' : ruta.serviceType === 'Prioritario' ? 'bg-yellow-100 text-yellow-600' : 'bg-orange-50 text-orange-500'}`}>
                            {ruta.status === 'Finalizado' ? <CheckCircle2 className="w-6 h-6"/> : ruta.status === 'En Ruta' ? <Play className="w-6 h-6 fill-current"/> : ruta.serviceType === 'Prioritario' ? <Zap className="w-6 h-6" /> : <MapPin className="w-6 h-6" />}
                        </div>
                        <div>
                            <h4 className="font-bold text-sm tracking-tight line-clamp-1">{ruta.end || ruta.destino}</h4>
                            <div className="mt-1 flex items-center gap-1 text-[10px] font-black text-orange-500 uppercase">
                                <Clock className="w-3 h-3" />
                                <span>Recoger: {getPickupScheduleText(ruta)}</span>
                            </div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">Cliente: {ruta.client}</p>
                        </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-orange-500" />
                </div>
            ))}
        </div>
      </div>
    );
  }

  if (isRegistering || isEditingProfile) {
    const isEditing = isEditingProfile; const handleSubmit = isEditing ? handleUpdateProfile : handleRegister;
    return (
      <div className={`min-h-screen p-8 font-sans overflow-y-auto transition-colors pb-32 ${theme.bg} ${theme.text}`}>
        <button onClick={() => isEditing ? setIsEditingProfile(false) : setIsRegistering(false)} className="mb-6 flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-widest"><ChevronLeft className="w-4 h-4"/> Volver</button>
        <h1 className="text-3xl font-black tracking-tight mb-2">{isEditing ? 'Mi Expediente' : 'Nuevo Operador'}</h1>
        <form onSubmit={handleSubmit} className="space-y-8 mt-6">
          <div className="space-y-4"><p className="text-[10px] font-black uppercase text-orange-500 tracking-widest flex items-center gap-2"><User className="w-3 h-3"/> Identidad</p><input type="text" placeholder="Nombre completo *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input} focus:border-orange-500 outline-none`} value={name} onChange={e => setName(e.target.value)} required={!isEditing} />{!isEditing && (<><input type="password" placeholder="Contraseña *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input} focus:border-orange-500 outline-none`} value={password} onChange={e => setPassword(e.target.value)} required /></>)}<div className="grid grid-cols-2 gap-4"><input type="text" placeholder="RFC *" className={`w-full p-4 rounded-2xl text-sm border uppercase ${theme.input} focus:border-orange-500 outline-none`} value={rfc} onChange={e => setRfc(e.target.value)} required={!isEditing} /><input type="tel" placeholder="WhatsApp / Teléfono *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input} focus:border-orange-500 outline-none`} value={phone} onChange={e => setPhone(e.target.value)} required={!isEditing} /></div><input type="text" placeholder="Dirección completa" className={`w-full p-4 rounded-2xl text-sm border ${theme.input} focus:border-orange-500 outline-none`} value={address} onChange={e => setAddress(e.target.value)} /></div>
          <div className="space-y-4"><p className="text-[10px] font-black uppercase text-orange-500 tracking-widest flex items-center gap-2"><Truck className="w-3 h-3"/> Vehículo</p><input type="text" placeholder="Modelo (Ej. Ford) *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input} focus:border-orange-500 outline-none`} value={vehicleModel} onChange={e => setVehicleModel(e.target.value)} required={!isEditing} /><div className="grid grid-cols-2 gap-4"><input type="text" placeholder="Placas *" className={`w-full p-4 rounded-2xl text-sm border uppercase ${theme.input} focus:border-orange-500 outline-none`} value={vehiclePlate} onChange={e => setVehiclePlate(e.target.value)} required={!isEditing} /><input type="text" placeholder="Tipo (Caja, etc)" className={`w-full p-4 rounded-2xl text-sm border ${theme.input} focus:border-orange-500 outline-none`} value={vehicleType} onChange={e => setVehicleType(e.target.value)} /></div></div>
          <div className="space-y-4"><p className="text-[10px] font-black uppercase text-slate-500 tracking-widest flex items-center gap-2"><FileText className="w-3 h-3"/> Licencia</p><input type="text" placeholder="Número *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input} focus:border-orange-500 outline-none`} value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} required={!isEditing} /><div className="grid grid-cols-2 gap-4"><input type="text" placeholder="Tipo (Federal, B)" className={`w-full p-4 rounded-2xl text-sm border ${theme.input} focus:border-orange-500 outline-none`} value={licenseType} onChange={e => setLicenseType(e.target.value)} /><input type="text" placeholder="Vigencia" className={`w-full p-4 rounded-2xl text-sm border ${theme.input} focus:border-orange-500 outline-none`} value={licenseExp} onChange={e => setLicenseExp(e.target.value)} /></div></div>
          <div className="space-y-4"><p className="text-[10px] font-black uppercase text-red-500 tracking-widest flex items-center gap-2"><ShieldAlert className="w-3 h-3"/> Salud</p><div className="grid grid-cols-2 gap-4"><input type="text" placeholder="Tipo Sangre" className={`w-full p-4 rounded-2xl text-sm border uppercase ${theme.input} focus:border-orange-500 outline-none`} value={bloodType} onChange={e => setBloodType(e.target.value)} /><input type="text" placeholder="Tel. Emergencia" className={`w-full p-4 rounded-2xl text-sm border ${theme.input} focus:border-orange-500 outline-none`} value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} /></div></div>
          {error && <p className="text-red-500 text-xs text-center">{error}</p>}
          <div className={`p-5 border-t fixed bottom-0 left-0 right-0 z-30 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}><button type="submit" disabled={loading} className="w-full bg-slate-800 text-white font-black p-4 rounded-2xl shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all">{loading ? <Loader2 className="animate-spin w-5 h-5"/> : (isEditing ? <><Save className="w-5 h-5"/> GUARDAR CAMBIOS</> : 'Enviar Registro')}</button></div>
        </form>
      </div>
    );
  }

  // --- VISTA DE LOGIN ACTUALIZADA A TRIPLOGIX ---
  return (
    <div className={`min-h-screen flex flex-col items-center justify-between p-8 transition-colors bg-slate-50 text-slate-900`}>
      <div className="flex flex-col items-center mt-12 w-full max-w-sm">
        <div className="mb-6 flex justify-center">
            <img src="/logo.png" alt="TripLogix Conductor" className="w-32 h-32 object-contain drop-shadow-md" />
        </div>
        <h1 className="text-3xl font-black text-slate-800 uppercase tracking-wider mb-1">
          Trip<span className="text-orange-500">Logix</span>
        </h1>
        <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Portal de Operador</p>
      </div>
      <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
        <input type="tel" placeholder="WhatsApp / Teléfono" className="w-full p-5 rounded-[1.8rem] text-sm border bg-white border-slate-200 text-slate-900 focus:border-orange-500 outline-none" value={phone} onChange={e => setPhone(e.target.value)} />
        <input type="password" placeholder="Contraseña" className="w-full p-5 rounded-[1.8rem] text-sm border bg-white border-slate-200 text-slate-900 focus:border-orange-500 outline-none" value={password} onChange={e => setPassword(e.target.value)} />
        {error && <p className="text-red-500 text-[10px] font-bold text-center">{error}</p>}
        <button type="submit" disabled={loading} className="w-full bg-slate-800 text-white font-black p-5 rounded-[1.8rem] shadow-xl flex items-center justify-center active:scale-95 transition-transform uppercase tracking-wider">{loading ? <Loader2 className="animate-spin w-5 h-5"/> : 'INICIAR SESIÓN'}</button>
        <button type="button" onClick={() => setIsRegistering(true)} className="w-full text-slate-500 font-bold text-[10px] py-4">¿Nuevo Operador? <span className="text-orange-500">Regístrate</span></button>
      </form>
    </div>
  );
}
export default App;