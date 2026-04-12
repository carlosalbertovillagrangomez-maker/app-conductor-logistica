import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Truck, LogIn, ShieldCheck, Mail, Lock, Loader2, 
  AlertCircle, LogOut, MapPin, User, Phone, 
  FileText, ChevronLeft, Camera, CreditCard,
  Sun, Moon, Package, Clock, ChevronRight, CheckCircle2, Zap, Calendar, Navigation, MoreVertical, Play, Save,
  Heart, ShieldAlert, Hash, CheckCircle, LocateFixed, Navigation2, BellRing, MessageSquare, Send, Power, PowerOff, X
} from 'lucide-react';
import { db } from './firebase';
import { collection, query, where, getDocs, addDoc, onSnapshot, updateDoc, doc, arrayUnion } from 'firebase/firestore';

// --- GOOGLE MAPS ---
import { GoogleMap, useJsApiLoader, Marker, Polyline } from '@react-google-maps/api';
const GOOGLE_MAPS_API_KEY = "AIzaSyA-t6YcuPK1PdOoHZJOyOsw6PK0tCDJrn0"; 
const containerStyle = { width: '100%', height: '100%' };
const centerMX = { lat: 19.4326, lng: -99.1332 }; 
const libraries = ['places', 'geometry']; 

const ICON_START = "http://maps.google.com/mapfiles/ms/icons/green-dot.png";
const ICON_WAYPOINT = "http://maps.google.com/mapfiles/ms/icons/blue-dot.png";
const ICON_END = "http://maps.google.com/mapfiles/ms/icons/red-dot.png";

function App() {
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentDriver, setCurrentDriver] = useState(null);
  const [isReady, setIsReady] = useState(false);
  
  const [misRutas, setMisRutas] = useState([]);
  const [darkMode, setDarkMode] = useState(false);
  const [filterType, setFilterType] = useState('Todos');
  const [mainTab, setMainTab] = useState('Pendientes'); 
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);

  // --- MODO DE ESPERA ---
  const [isWaiting, setIsWaiting] = useState(false);
  const [chatText, setChatText] = useState('');
  const [evidence, setEvidence] = useState(null);
  const [incomingOffer, setIncomingOffer] = useState(null);

  // --- NAVEGACIÓN Y GPS AVANZADO ---
  const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: GOOGLE_MAPS_API_KEY, libraries });
  const mapRef = useRef(null);
  
  const [userLocation, setUserLocation] = useState(null);
  const [userHeading, setUserHeading] = useState(0); 
  const [isTracking, setIsTracking] = useState(true);
  
  const isTrackingRef = useRef(true); 
  const latestLocRef = useRef(null);
  const prevLocRef = useRef(null); 
  
  const [nextStopIdx, setNextStopIdx] = useState(0); 
  const [routeUpdateTick, setRouteUpdateTick] = useState(0); 
  
  const [alertedStops, setAlertedStops] = useState([]); 
  const [isApproaching, setIsApproaching] = useState(false); 

  const [liveRouteData, setLiveRouteData] = useState({ 
      geometry: [], totalDuration: 0, totalDistance: 0, nextStopDuration: 0, nextStopDistance: 0 
  });

  const wakeLockRef = useRef(null);
  const chatScrollRef = useRef(null);

  const handleMapLoad = useCallback((map) => { mapRef.current = map; }, []);

  useEffect(() => { latestLocRef.current = userLocation; }, [userLocation]);
  useEffect(() => { isTrackingRef.current = isTracking; }, [isTracking]);

  useEffect(() => {
      if (chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
  }, [selectedRoute?.chat, isWaiting]);

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

  useEffect(() => {
    const requestWakeLock = async () => {
        if ('wakeLock' in navigator && selectedRoute?.status === 'En Ruta') {
            try { wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch (err) {}
        }
    };
    const handleVisibilityChange = () => { if (document.visibilityState === 'visible') requestWakeLock(); };
    if (selectedRoute?.status === 'En Ruta') {
        requestWakeLock(); document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; }
    };
  }, [selectedRoute?.status]);

  const allTargets = useMemo(() => {
      if (!selectedRoute) return [];
      const targets = [];
      if (selectedRoute.startCoords) { targets.push({ ...selectedRoute.startCoords, label: 'Origen', address: selectedRoute.start, icon: ICON_START, contact: selectedRoute.startCoords.contact }); }
      if (selectedRoute.waypointsData) { selectedRoute.waypointsData.forEach((wp, idx) => { targets.push({ ...wp, label: `Parada ${String.fromCharCode(66 + idx)}`, address: selectedRoute.waypoints[idx], icon: ICON_WAYPOINT, contact: wp.contact }); }); }
      if (selectedRoute.endCoords) { targets.push({ ...selectedRoute.endCoords, label: 'Destino Final', address: selectedRoute.end, icon: ICON_END, contact: selectedRoute.endCoords.contact }); }
      return targets;
  }, [selectedRoute]);

  useEffect(() => {
      if (isLoaded && mapRef.current && selectedRoute?.technicalData?.geometry?.length > 0) {
          if (!userLocation) {
              const bounds = new window.google.maps.LatLngBounds();
              selectedRoute.technicalData.geometry.forEach(coord => bounds.extend(coord));
              mapRef.current.fitBounds(bounds);
          }
      }
  }, [isLoaded, selectedRoute?.id]); 

  // GPS EN SEGUNDO PLANO Y MODO EN LÍNEA
  useEffect(() => {
    let watchId;
    if (currentDriver && (currentDriver.isOnline || (selectedRoute && selectedRoute.status === 'En Ruta'))) {
      if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition(
          async (position) => {
            const loc = { lat: position.coords.latitude, lng: position.coords.longitude };
            setUserLocation(loc);
            let heading = position.coords.heading;
            if (heading === null || isNaN(heading)) {
                if (prevLocRef.current && window.google?.maps?.geometry) {
                    heading = window.google.maps.geometry.spherical.computeHeading(prevLocRef.current, loc);
                } else { heading = 0; }
            }
            if (heading !== null && !isNaN(heading)) { setUserHeading(heading); }
            prevLocRef.current = loc;

            // Enviar ubicación al backend si está en línea (incluso sin ruta activa)
            if (currentDriver.isOnline && (!selectedRoute || selectedRoute.status !== 'En Ruta')) {
                try { await updateDoc(doc(db, "conductores", currentDriver.id), { currentLocation: loc }); } catch(e){}
            }

            if (isTrackingRef.current && mapRef.current && selectedRoute?.status === 'En Ruta') {
                mapRef.current.panTo(loc); mapRef.current.setZoom(19); mapRef.current.setTilt(60);
                if (heading !== null && !isNaN(heading)) { mapRef.current.setHeading(heading); }
            }
          },
          (error) => console.error("Error GPS:", error),
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
        );
      }
    }
    return () => { if (watchId) navigator.geolocation.clearWatch(watchId); };
  }, [currentDriver, selectedRoute]);

  // ESCUCHAR OFERTAS DE VIAJE
  useEffect(() => {
      if (!currentDriver || !currentDriver.isOnline || selectedRoute?.status === 'En Ruta') return;

      const q = query(collection(db, "rutas"), where("ofertaPara", "==", currentDriver.id), where("ofertaEstado", "==", "Pendiente"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
          if (!snapshot.empty) {
              const offer = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
              setIncomingOffer(offer);
              if ("vibrate" in navigator) navigator.vibrate([500, 200, 500, 200, 1000]); // Vibrar fuerte
          } else {
              setIncomingOffer(null);
          }
      });
      return () => unsubscribe();
  }, [currentDriver, selectedRoute]);

  // ACEPTAR/RECHAZAR OFERTA
  const aceptarViaje = async () => {
      if (!incomingOffer || !currentDriver) return;
      try {
          await updateDoc(doc(db, "rutas", incomingOffer.id), {
              driver: currentDriver.name,
              driverId: currentDriver.id,
              ofertaEstado: 'Aceptada'
          });
          setIncomingOffer(null);
          setMainTab('Pendientes');
      } catch (e) { alert("Error al aceptar viaje"); }
  };

  const rechazarViaje = async () => {
      if (!incomingOffer || !currentDriver) return;
      try {
          await updateDoc(doc(db, "rutas", incomingOffer.id), {
              ofertaEstado: 'Rechazada',
              rechazadoPor: arrayUnion(currentDriver.id),
              ofertaPara: '' 
          });
          setIncomingOffer(null);
      } catch (e) {}
  };


  useEffect(() => {
      if (selectedRoute?.status !== 'En Ruta') return;
      const interval = setInterval(() => setRouteUpdateTick(t => t + 1), 5000);
      return () => clearInterval(interval);
  }, [selectedRoute?.status]);

  useEffect(() => {
      if (selectedRoute?.status !== 'En Ruta' || allTargets.length === 0) return;
      const loc = latestLocRef.current;
      if (!loc) return;

      const updateLiveRoute = async () => {
          try {
              let coordsArray = [`${loc.lng},${loc.lat}`]; 
              for (let i = nextStopIdx; i < allTargets.length; i++) { coordsArray.push(`${allTargets[i].lng},${allTargets[i].lat}`); }

              const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordsArray.join(';')}?overview=full&geometries=geojson`);
              const data = await res.json();
              
              if (data.code === 'Ok' && data.routes.length > 0) {
                  const r = data.routes[0];
                  const geo = r.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
                  const newTotalDist = (r.distance / 1000).toFixed(1);
                  const newTotalDur = Math.round(r.duration / 60);
                  const nextDistMeters = r.legs.length > 0 ? r.legs[0].distance : 0;
                  const nextDurMins = r.legs.length > 0 ? Math.round(r.legs[0].duration / 60) : 0;

                  setLiveRouteData({ 
                      geometry: geo, totalDuration: newTotalDur, totalDistance: newTotalDist,
                      nextStopDuration: nextDurMins, nextStopDistance: (nextDistMeters / 1000).toFixed(1)
                  });

                  let proximityUpdate = {};
                  if ((nextDistMeters <= 500 || nextDurMins <= 2) && !alertedStops.includes(nextStopIdx)) {
                      setAlertedStops(prev => [...prev, nextStopIdx]);
                      setIsApproaching(true); 
                      proximityUpdate = {
                          proximityAlert: {
                              active: true, stopIndex: nextStopIdx, passenger: allTargets[nextStopIdx]?.contact || 'Pasajero',
                              etaMins: nextDurMins, timestamp: new Date().toISOString()
                          }
                      };
                  }

                  await updateDoc(doc(db, "rutas", selectedRoute.id), { 
                      currentLocation: loc, lastUpdate: new Date().toISOString(),
                      "technicalData.geometry": geo, "technicalData.totalDistance": newTotalDist, "technicalData.totalDuration": newTotalDur,
                      ...proximityUpdate 
                  });
              }
          } catch (e) { 
              try { await updateDoc(doc(db, "rutas", selectedRoute.id), { currentLocation: loc, lastUpdate: new Date().toISOString() }); } catch(firebaseErr) {}
          }
      };

      updateLiveRoute();
  }, [routeUpdateTick, nextStopIdx, selectedRoute, allTargets]);

  const centerOnUser = () => {
      setIsTracking(true);
      if (mapRef.current && userLocation) {
          mapRef.current.panTo(userLocation); mapRef.current.setZoom(19); mapRef.current.setTilt(60);
          if (userHeading) mapRef.current.setHeading(userHeading);
      }
  };

  const handleMapDrag = () => { setIsTracking(false); };

  const cerrarRuta = () => {
      localStorage.removeItem('active_trip_id'); setSelectedRoute(null); setNextStopIdx(0); setAlertedStops([]); 
      setIsApproaching(false); setIsWaiting(false);
      setLiveRouteData({ geometry: [], totalDuration: 0, totalDistance: 0, nextStopDuration: 0, nextStopDistance: 0 }); 
      setIsPanelExpanded(true); setIsTracking(true);
  };

  // --- TOGGLE ONLINE CON PERMISO DE GPS FORZADO Y FALLBACK A XALAPA ---
  const toggleOnlineStatus = async () => {
      if (!currentDriver) return;
      const newStatus = !currentDriver.isOnline;
      
      try {
          await updateDoc(doc(db, "conductores", currentDriver.id), { isOnline: newStatus });
          const updatedDriver = { ...currentDriver, isOnline: newStatus };
          setCurrentDriver(updatedDriver);
          localStorage.setItem('driver_session', JSON.stringify(updatedDriver));

          if (newStatus && "geolocation" in navigator) {
               // Forzamos la petición de GPS al navegador
               navigator.geolocation.getCurrentPosition(
                  async (pos) => {
                      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                      setUserLocation(loc);
                      await updateDoc(doc(db, "conductores", currentDriver.id), { currentLocation: loc });
                  },
                  async (err) => {
                      // Si falla el GPS, usamos el Fallback de Xalapa (en lugar de CDMX)
                      console.warn("Fallo el GPS o el usuario no dio permiso, usando Fallback en Xalapa.");
                      const fallbackLoc = { lat: 19.5432, lng: -96.9273 }; 
                      setUserLocation(fallbackLoc);
                      await updateDoc(doc(db, "conductores", currentDriver.id), { currentLocation: fallbackLoc });
                  },
                  { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
               );
          }
      } catch (e) { console.error("Error cambiando estado:", e); }
  };

  const marcarLlegada = async () => {
      setIsWaiting(true); setEvidence(null); setIsApproaching(false);
      try { await updateDoc(doc(db, "rutas", selectedRoute.id), { "proximityAlert.active": false }); } catch(e){}
  };

  const enviarMensaje = async () => {
      if(!chatText.trim()) return;
      const msg = { sender: 'Conductor', text: chatText.trim(), time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), timestamp: new Date().toISOString() };
      try { await updateDoc(doc(db, "rutas", selectedRoute.id), { chat: arrayUnion(msg) }); setChatText(''); } catch(e) { console.error(e); }
  };

  const handlePhoto = (e) => {
      const file = e.target.files[0];
      if(file) {
          const reader = new FileReader();
          reader.onload = (event) => {
              const img = new Image();
              img.onload = () => {
                  const canvas = document.createElement('canvas');
                  const MAX_WIDTH = 800; 
                  const scaleSize = MAX_WIDTH / img.width;
                  canvas.width = MAX_WIDTH;
                  canvas.height = img.height * scaleSize;
                  const ctx = canvas.getContext('2d');
                  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                  setEvidence(canvas.toDataURL('image/jpeg', 0.6));
              }
              img.src = event.target.result;
          };
          reader.readAsDataURL(file);
      }
  };

  const confirmarAbordaje = async (isFinalDestination) => {
      if(isFinalDestination) { handleEndTrip(selectedRoute.id); setIsWaiting(false); } 
      else {
          const newIdx = nextStopIdx + 1;
          setNextStopIdx(newIdx); localStorage.setItem(`trip_idx_${selectedRoute.id}`, newIdx); 
          setIsWaiting(false); setRouteUpdateTick(t => t + 1); 
      }
  };

  const reportarAusencia = async (isFinalDestination) => {
      if(!evidence) return alert("⚠️ Por favor, toma una foto de evidencia del lugar antes de reportar la ausencia.");
      const target = allTargets[nextStopIdx];
      const noShowData = { stopIndex: nextStopIdx, passenger: target?.contact || 'Pasajero', address: target?.address || '', photo: evidence, time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), timestamp: new Date().toISOString() };

      try {
          await updateDoc(doc(db, "rutas", selectedRoute.id), { evidencias: arrayUnion(noShowData), chat: arrayUnion({ sender: 'Sistema', text: `Conductor reportó AUSENCIA en ${target?.label}. Evidencia guardada.`, time: noShowData.time, timestamp: noShowData.timestamp }) });
          alert("✅ Evidencia guardada correctamente en el sistema.");
          confirmarAbordaje(isFinalDestination); 
      } catch (e) { alert("Error al subir evidencia. Revisa tu conexión."); }
  };

  const handleSelectRoute = (ruta) => {
      setSelectedRoute(ruta); setAlertedStops([]); setIsApproaching(false); setIsWaiting(false);
      if (ruta.status === 'En Ruta') {
          localStorage.setItem('active_trip_id', ruta.id);
          const savedIdx = localStorage.getItem(`trip_idx_${ruta.id}`);
          if (savedIdx) setNextStopIdx(parseInt(savedIdx, 10));
      } else { setNextStopIdx(0); }
  };

  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [address, setAddress] = useState(''); const [rfc, setRfc] = useState('');
  const [bloodType, setBloodType] = useState(''); const [emergencyContact, setEmergencyContact] = useState('');
  const [licenseNumber, setLicenseNumber] = useState(''); const [licenseType, setLicenseType] = useState('');
  const [licenseExp, setLicenseExp] = useState(''); const [vehicleModel, setVehicleModel] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState(''); const [vehicleType, setVehicleType] = useState('');

  useEffect(() => {
    const savedDriver = localStorage.getItem('driver_session');
    if (savedDriver) {
      const driverData = JSON.parse(savedDriver);
      setCurrentDriver(driverData); cargarDatosEnFormulario(driverData); escucharRutas(driverData.id);
    }
    setIsReady(true);
  }, []);

  const cargarDatosEnFormulario = (data) => {
    setName(data.name || ''); setPhone(data.phone || ''); setAddress(data.address || '');
    setRfc(data.rfc || ''); setBloodType(data.bloodType || ''); setEmergencyContact(data.emergencyContact || '');
    setLicenseNumber(data.licenseNumber || ''); setLicenseType(data.licenseType || ''); setLicenseExp(data.licenseExp || '');
    setVehicleModel(data.vehicleModel || ''); setVehiclePlate(data.vehiclePlate || ''); setVehicleType(data.vehicleType || '');
    setEmail(data.email || ''); setPassword(data.password || '');
  };

  const escucharRutas = (driverId) => {
    const q = query(collection(db, "rutas"), where("driverId", "==", driverId));
    return onSnapshot(q, (snapshot) => setMisRutas(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
  };

  const handleStartTrip = async (routeId) => {
    if (!confirm("¿Deseas iniciar este viaje ahora?")) return;
    try {
      await updateDoc(doc(db, "rutas", routeId), { status: 'En Ruta', startTime: new Date().toISOString() });
      setSelectedRoute(prev => ({ ...prev, status: 'En Ruta' }));
      localStorage.setItem('active_trip_id', routeId); localStorage.setItem(`trip_idx_${routeId}`, 0);
      setNextStopIdx(0); setAlertedStops([]); setIsApproaching(false); setIsWaiting(false);
    } catch (e) { alert("Error al iniciar"); }
  };

  const handleEndTrip = async (routeId) => {
    if (!confirm("¿Has completado el viaje por completo?")) return;
    try {
      await updateDoc(doc(db, "rutas", routeId), { status: 'Finalizado', endTime: new Date().toISOString(), "proximityAlert.active": false });
      setSelectedRoute(prev => ({ ...prev, status: 'Finalizado' }));
      localStorage.removeItem('active_trip_id'); localStorage.removeItem(`trip_idx_${routeId}`);
      alert("¡Ruta finalizada con éxito!");
    } catch (e) { alert("Error al finalizar"); }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!email || !password || !name || !phone || !vehicleModel || !vehiclePlate || !rfc || !licenseNumber) return setError('Faltan campos obligatorios.');
    setLoading(true); setError('');
    try {
      const nuevoConductor = {
        name: name.trim(), email: email.trim().toLowerCase(), password, phone: phone.trim(), address: address.trim(),
        rfc: rfc.trim().toUpperCase(), bloodType: bloodType.trim().toUpperCase(), emergencyContact: emergencyContact.trim(),
        licenseNumber: licenseNumber.trim(), licenseType: licenseType.trim(), licenseExp: licenseExp,
        vehicleModel: vehicleModel.trim(), vehiclePlate: vehiclePlate.trim().toUpperCase(), vehicleType: vehicleType.trim(),
        vehicle: `${vehicleModel} (${vehiclePlate.toUpperCase()})`, status: 'Pendiente', initials: name.substring(0, 2).toUpperCase(),
        isOnline: false, created: new Date().toISOString(), joined: new Date().toLocaleDateString(), trips: 0, rating: 5, fotoPerfil: '', identificacion: ''
      };
      await addDoc(collection(db, "conductores"), nuevoConductor);
      alert("¡Registro enviado! Tu expediente está en revisión."); setIsRegistering(false);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const driverRef = doc(db, "conductores", currentDriver.id);
      const updatedData = {
        name: name.trim(), phone: phone.trim(), address: address.trim(), rfc: rfc.trim().toUpperCase(), bloodType: bloodType.trim().toUpperCase(),
        emergencyContact: emergencyContact.trim(), licenseNumber: licenseNumber.trim(), licenseType: licenseType.trim(), licenseExp: licenseExp,
        vehicleModel: vehicleModel.trim(), vehiclePlate: vehiclePlate.trim().toUpperCase(), vehicleType: vehicleType.trim(),
        vehicle: `${vehicleModel} (${vehiclePlate.toUpperCase()})`, initials: name.substring(0, 2).toUpperCase(),
      };
      await updateDoc(driverRef, updatedData);
      const newState = { ...currentDriver, ...updatedData };
      setCurrentDriver(newState); localStorage.setItem('driver_session', JSON.stringify(newState));
      alert("¡Expediente actualizado!"); setIsEditingProfile(false);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault(); setLoading(true);
    const q = query(collection(db, "conductores"), where("email", "==", email.trim().toLowerCase()));
    const snap = await getDocs(q);
    if (snap.empty) { setError('Usuario no encontrado'); setLoading(false); return; }
    const data = { id: snap.docs[0].id, ...snap.docs[0].data() };
    if (data.password === password && data.status === 'Aprobado') {
      setCurrentDriver(data); localStorage.setItem('driver_session', JSON.stringify(data));
      cargarDatosEnFormulario(data); escucharRutas(data.id);
    } else { setError('Credenciales inválidas o cuenta no aprobada'); }
    setLoading(false);
  };

  const openGoogleMaps = (ruta) => {
    const origin = encodeURIComponent(ruta.start); const destination = encodeURIComponent(ruta.end);
    let waypoints = ruta.waypoints?.length > 0 ? '&waypoints=' + ruta.waypoints.map(wp => encodeURIComponent(wp)).join('|') : '';
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints}&travelmode=driving`, '_blank');
  };

  if (!isReady) return null;

  const theme = {
    bg: darkMode ? 'bg-slate-950' : 'bg-slate-50', text: darkMode ? 'text-white' : 'text-slate-900',
    card: darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200',
    input: darkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-900',
    subtext: darkMode ? 'text-slate-500' : 'text-slate-400', activeTab: darkMode ? 'bg-slate-800 text-white' : 'bg-white text-blue-600 shadow-sm'
  };

  if (currentDriver && selectedRoute && selectedRoute.status === 'En Ruta') {
      const currentGeometry = liveRouteData.geometry.length > 0 ? liveRouteData.geometry : selectedRoute.technicalData?.geometry;
      const isHeadingToDestination = nextStopIdx >= allTargets.length - 1;
      const currentTarget = allTargets[nextStopIdx] || allTargets[allTargets.length - 1];
      const nextStopName = currentTarget?.label || 'Destino';
      const nextStopAddress = currentTarget?.address || '';

      return (
          <div className={`h-screen w-full flex flex-col font-sans transition-colors ${theme.bg} ${theme.text} overflow-hidden relative`}>
              {isWaiting && (
                  <div className="absolute inset-0 z-50 bg-slate-50 flex flex-col animate-[fadeIn_0.3s_ease-out]">
                      <div className="bg-slate-800 text-white p-4 pt-8 pb-4 flex justify-between items-center shadow-md shrink-0">
                          <div>
                              <p className="text-[10px] font-bold text-blue-300 uppercase tracking-widest">En el punto de encuentro</p>
                              <h2 className="text-lg font-black">{currentTarget?.contact || 'Pasajero'}</h2>
                          </div>
                          <button onClick={() => setIsWaiting(false)} className="p-2 bg-slate-700 rounded-full hover:bg-slate-600 transition"><X className="w-5 h-5"/></button>
                      </div>

                      <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-100 flex flex-col">
                          <div className="text-center text-[10px] text-slate-400 font-bold mb-4 uppercase">Inicio de Conversación Segura</div>
                          {(selectedRoute.chat || []).map((msg, i) => {
                              if (msg.sender === 'Sistema') return <div key={i} className="text-center"><span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-[10px] font-bold shadow-sm">{msg.text}</span></div>
                              const isDriver = msg.sender === 'Conductor';
                              return (
                                  <div key={i} className={`flex w-full ${isDriver ? 'justify-end' : 'justify-start'}`}>
                                      <div className={`max-w-[80%] p-3 rounded-2xl shadow-sm relative ${isDriver ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'}`}>
                                          <p className="text-sm font-medium leading-snug">{msg.text}</p>
                                          <p className={`text-[9px] mt-1 text-right font-bold ${isDriver ? 'text-blue-300' : 'text-slate-400'}`}>{msg.time}</p>
                                      </div>
                                  </div>
                              );
                          })}
                      </div>

                      <div className="bg-white p-3 border-t border-slate-200 flex items-center gap-2 shrink-0">
                          <input type="text" value={chatText} onChange={e=>setChatText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enviarMensaje()} placeholder="Envía un mensaje al cliente..." className="flex-1 bg-slate-100 border border-slate-200 rounded-full px-4 py-3 text-sm outline-none focus:border-blue-500 focus:bg-white transition-colors" />
                          <button onClick={enviarMensaje} className="p-3 bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 active:scale-95 transition-transform"><Send className="w-5 h-5 ml-1"/></button>
                      </div>

                      <div className="bg-white p-4 border-t border-slate-200 shadow-[0_-10px_20px_rgba(0,0,0,0.05)] shrink-0 space-y-3">
                          <div className="flex gap-2">
                              <a href={`https://wa.me/52${selectedRoute.clientPhone || '1234567890'}?text=Hola,%20soy%20tu%20conductor%20de%20log%C3%ADstica.%20Ya%20me%20encuentro%20afuera.`} target="_blank" rel="noreferrer" className="flex-1 bg-green-500 hover:bg-green-600 text-white p-3 rounded-xl flex flex-col items-center justify-center gap-1 font-black text-xs transition-colors shadow-sm"><Phone className="w-5 h-5"/> WHATSAPP</a>
                              <label className={`flex-1 p-3 rounded-xl flex flex-col items-center justify-center gap-1 font-black text-xs cursor-pointer transition-colors shadow-sm ${evidence ? 'bg-green-100 text-green-700 border-2 border-green-500' : 'bg-slate-800 text-white hover:bg-slate-900'}`}>
                                  {evidence ? <CheckCircle2 className="w-5 h-5"/> : <Camera className="w-5 h-5"/>} 
                                  {evidence ? 'FOTO LISTA' : 'TOMAR FOTO'}
                                  <input type="file" accept="image/*" capture="environment" hidden onChange={handlePhoto} />
                              </label>
                          </div>
                          <div className="flex gap-2">
                              <button onClick={() => reportarAusencia(isHeadingToDestination)} className="w-1/3 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 p-3 rounded-xl font-bold text-[10px] leading-tight active:scale-95 transition-transform">NO SE PRESENTÓ</button>
                              <button onClick={() => confirmarAbordaje(isHeadingToDestination)} className="w-2/3 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-xl font-black text-sm active:scale-95 transition-transform flex items-center justify-center gap-2">
                                  {isHeadingToDestination ? <><CheckCircle className="w-5 h-5"/> FINALIZAR VIAJE</> : <><User className="w-5 h-5"/> PASAJERO A BORDO</>}
                              </button>
                          </div>
                      </div>
                  </div>
              )}

              <div className={`p-4 flex items-center gap-4 shadow-lg z-20 shrink-0 ${darkMode ? 'bg-slate-900 border-b border-slate-800' : 'bg-white'} ${isApproaching ? 'border-b-4 border-orange-500 bg-orange-50' : ''}`}>
                  <button onClick={cerrarRuta} className={`p-2 rounded-full border ${darkMode ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-100'} transition`}><ChevronLeft className="w-5 h-5" /></button>
                  <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                          {isApproaching ? <BellRing className="w-4 h-4 text-orange-500 animate-bounce" /> : <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]"></div>}
                          <h2 className={`text-sm font-black tracking-tight uppercase ${isApproaching ? 'text-orange-600' : 'text-green-500'}`}>{isApproaching ? 'Notificando al Pasajero...' : 'Navegación Activa'}</h2>
                      </div>
                      <p className={`text-[10px] uppercase font-bold text-slate-400 line-clamp-1`}>{selectedRoute.client} • {nextStopName}</p>
                  </div>
              </div>

              <div className="flex-1 relative bg-slate-200 w-full h-full">
                  {!isLoaded ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 gap-3 z-10"><Loader2 className="animate-spin text-blue-600 w-8 h-8"/><p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Cargando GPS...</p></div>
                  ) : (
                      <>
                        <GoogleMap mapContainerStyle={containerStyle} center={centerMX} zoom={16} onLoad={handleMapLoad} onDragStart={handleMapDrag} options={{ mapId: "DEMO_MAP_ID", streetViewControl: false, mapTypeControl: false, myLocationButton: false, zoomControl: false, fullscreenControl: false }}>
                            {currentGeometry && <Polyline path={currentGeometry} options={{ strokeColor: "#3b82f6", strokeOpacity: 0.9, strokeWeight: 6 }} />}
                            {allTargets.map((target, idx) => { if (idx < nextStopIdx) return null; return <Marker key={idx} position={{lat: target.lat, lng: target.lng}} icon={target.icon} />; })}
                            {userLocation && <Marker position={userLocation} icon={{ path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, fillColor: "#22c55e", fillOpacity: 1, strokeWeight: 2, strokeColor: "white", rotation: userHeading }} zIndex={999} />}
                        </GoogleMap>
                        {userLocation && (
                            <button onClick={centerOnUser} style={{ bottom: isPanelExpanded ? '340px' : '100px' }} className={`absolute left-4 p-3 rounded-full shadow-[0_4px_15px_rgba(0,0,0,0.2)] border transition-all duration-300 z-10 ${isTracking ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-blue-600 border-slate-200 active:bg-blue-50'}`}>
                                {isTracking ? <Navigation2 className="w-6 h-6" /> : <LocateFixed className="w-6 h-6" />}
                            </button>
                        )}
                      </>
                  )}
              </div>

              <div className={`z-20 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] rounded-t-[2rem] -mt-6 shrink-0 relative flex flex-col transition-all duration-300 ${darkMode ? 'bg-slate-900 border-t border-slate-800' : 'bg-white border-t border-slate-200'} ${isPanelExpanded ? 'max-h-[70vh] p-6' : 'h-[90px] px-6 py-4 cursor-pointer'}`}>
                  <div className="w-full flex justify-center pb-3" onClick={() => setIsPanelExpanded(!isPanelExpanded)}><div className="w-12 h-1.5 bg-slate-300 hover:bg-slate-400 rounded-full transition-colors cursor-pointer"></div></div>

                  {isPanelExpanded ? (
                      <>
                        <div className="flex justify-between items-center mb-4 px-2">
                            <div className="text-center"><p className="text-[10px] font-black uppercase text-slate-400 mb-0.5 tracking-widest">Restante Total</p><p className="text-2xl font-black text-slate-800 dark:text-white">{liveRouteData.totalDistance || selectedRoute.technicalData?.totalDistance} <span className="text-sm text-slate-400">km</span></p></div>
                            <div className="w-px h-8 bg-slate-200 dark:bg-slate-800"></div>
                            <div className="text-center"><p className="text-[10px] font-black uppercase text-slate-400 mb-0.5 tracking-widest">Tiempo Total</p><p className="text-2xl font-black text-slate-800 dark:text-white">{liveRouteData.totalDuration || selectedRoute.technicalData?.totalDuration} <span className="text-sm text-slate-400">min</span></p></div>
                        </div>
                        
                        <div className={`mb-6 rounded-xl p-4 border shadow-sm ${isApproaching ? 'bg-orange-100 border-orange-300' : darkMode ? 'bg-slate-800 border-slate-700' : 'bg-blue-50/50 border-blue-100'}`}>
                            <p className={`text-[10px] font-black uppercase mb-1 tracking-widest ${isApproaching ? 'text-orange-600 animate-pulse' : 'text-blue-500'}`}>{isApproaching ? 'Llegando al punto...' : 'Siguiente Objetivo'}</p>
                            <p className="font-bold text-sm text-slate-800 dark:text-white truncate mb-3">{nextStopName}: <span className="font-medium text-slate-500 dark:text-slate-400">{nextStopAddress}</span></p>
                            <div className="flex justify-between items-center bg-white dark:bg-slate-900 rounded-lg p-3 border border-slate-100 dark:border-slate-800 shadow-sm">
                                <div className="flex flex-col"><span className="text-[10px] font-bold text-slate-400 uppercase">Faltan</span><span className="font-black text-blue-600 text-xl">{liveRouteData.nextStopDistance || '--'} <span className="text-sm">km</span></span></div>
                                <div className="w-px h-8 bg-slate-100 dark:bg-slate-800"></div>
                                <div className="flex flex-col text-right"><span className="text-[10px] font-bold text-slate-400 uppercase">Llegada en</span><span className="font-black text-green-500 text-xl">{liveRouteData.nextStopDuration || '--'} <span className="text-sm">min</span></span></div>
                            </div>
                        </div>

                        <div className="space-y-3 shrink-0 mt-auto pb-4">
                            {!isHeadingToDestination ? (
                                <button onClick={marcarLlegada} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black p-4 rounded-2xl shadow-xl shadow-blue-500/30 flex items-center justify-center gap-2 active:scale-95 transition-all tracking-widest">
                                    <MessageSquare className="w-5 h-5"/> LLEGUÉ AL PUNTO (VER OPCIONES)
                                </button>
                            ) : (
                                <button onClick={marcarLlegada} className="w-full text-white font-black p-4 rounded-2xl shadow-xl shadow-red-500/40 bg-red-600 hover:bg-red-700 flex items-center justify-center gap-2 active:scale-95 transition-all tracking-widest animate-pulse">
                                    <CheckCircle className="w-5 h-5"/> LLEGUÉ AL DESTINO (VER OPCIONES)
                                </button>
                            )}
                            <button onClick={() => openGoogleMaps(selectedRoute)} className={`w-full font-bold p-4 rounded-2xl border flex items-center justify-center gap-2 text-xs tracking-wide transition-all active:scale-95 ${darkMode ? 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}><Navigation className="w-4 h-4"/> MAPS EXTERNO</button>
                        </div>
                      </>
                  ) : (
                      <div className="flex justify-between items-center px-2" onClick={() => setIsPanelExpanded(true)}>
                          <div><p className="text-[10px] font-black uppercase text-blue-500 tracking-widest line-clamp-1">{nextStopName}</p><p className="text-xl font-black text-slate-800 dark:text-white leading-none mt-1">{liveRouteData.nextStopDistance || '--'} <span className="text-sm font-medium text-slate-500">km</span></p></div>
                          <div className="text-right"><p className="text-[10px] font-black uppercase text-green-500 tracking-widest">Llegada en</p><p className="text-xl font-black text-green-500 leading-none mt-1">{liveRouteData.nextStopDuration || '--'} <span className="text-sm font-medium text-green-400">min</span></p></div>
                      </div>
                  )}
              </div>
          </div>
      );
  }

  if (currentDriver && selectedRoute && selectedRoute.status !== 'En Ruta') {
    return (
      <div className={`min-h-screen flex flex-col font-sans transition-colors ${theme.bg} ${theme.text}`}>
        <div className={`p-5 flex items-center gap-4 sticky top-0 z-10 backdrop-blur-md border-b ${darkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-white/80 border-slate-200'}`}>
          <button onClick={cerrarRuta} className={`p-2 rounded-full border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}><ChevronLeft className="w-5 h-5" /></button>
          <div><h2 className="text-sm font-bold">Detalle de Ruta</h2><p className={`text-[10px] uppercase font-bold text-blue-500`}>{selectedRoute.client}</p></div>
        </div>
        <div className="flex-1 p-6 space-y-6 overflow-y-auto pb-40">
          <div className={`p-5 rounded-[2rem] border ${theme.card} flex justify-between items-center`}>
             <div><p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Estatus actual</p><div className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-2 ${selectedRoute.status === 'Finalizado' ? 'bg-slate-100 text-slate-600' : 'bg-blue-100 text-blue-700'}`}>{selectedRoute.status === 'Finalizado' ? <CheckCircle2 className="w-3 h-3"/> : <Play className="w-3 h-3"/>}{selectedRoute.status || 'Pendiente'}</div></div>
             {selectedRoute.technicalData && <div className="text-right"><p className="text-2xl font-black">{selectedRoute.technicalData.totalDistance} <span className="text-xs text-slate-400">km</span></p></div>}
          </div>
          <div className={`p-5 rounded-[2rem] border ${theme.card}`}>
             <h3 className="text-sm font-bold mb-6 flex items-center gap-2"><MapPin className="w-4 h-4 text-blue-500"/> Itinerario</h3>
             <div className="relative pl-2 space-y-8">
                <div className={`absolute left-[15px] top-2 bottom-4 w-0.5 ${darkMode ? 'bg-slate-800' : 'bg-slate-200'}`}></div>
                <div className="relative flex gap-4"><div className="w-3 h-3 rounded-full bg-green-500 z-10 mt-1.5 ring-4 ring-green-500/20"></div><div className="flex-1"><p className="text-[10px] font-black uppercase text-slate-400">Origen</p><p className="text-xs font-medium">{selectedRoute.start}</p>{selectedRoute.technicalData?.segments?.[0] && <div className="mt-2 text-[10px] font-mono text-blue-500">⬇ {selectedRoute.technicalData.segments[0].distance} km • {selectedRoute.technicalData.segments[0].duration} min</div>}</div></div>
                {selectedRoute.waypoints?.map((wp, i) => (<div key={i} className="relative flex gap-4"><div className="w-3 h-3 rounded-full bg-blue-500 z-10 mt-1.5 ring-4 ring-blue-500/20"></div><div className="flex-1"><p className="text-[10px] font-black uppercase text-slate-400">Parada {i+1}</p><p className="text-xs font-medium">{wp}</p>{selectedRoute.technicalData?.segments?.[i + 1] && <div className="mt-2 text-[10px] font-mono text-blue-500">⬇ {selectedRoute.technicalData.segments[i + 1].distance} km • {selectedRoute.technicalData.segments[i + 1].duration} min</div>}</div></div>))}
                <div className="relative flex gap-4"><div className="w-3 h-3 rounded-full bg-red-500 z-10 mt-1.5 ring-4 ring-red-500/20"></div><div className="flex-1"><p className="text-[10px] font-black uppercase text-slate-400">Destino</p><p className="text-xs font-medium">{selectedRoute.end}</p></div></div>
             </div>
          </div>
        </div>
        <div className={`p-5 border-t fixed bottom-0 left-0 right-0 z-30 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} grid gap-3 shadow-2xl`}>
           {selectedRoute.status === 'Pendiente' || !selectedRoute.status ? <button onClick={() => handleStartTrip(selectedRoute.id)} className="w-full bg-green-600 text-white font-black p-4 rounded-2xl shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all"><Play className="w-5 h-5 fill-white"/> INICIAR VIAJE</button> : <div className="w-full bg-slate-100 text-slate-400 font-black p-4 rounded-2xl flex items-center justify-center gap-2 cursor-not-allowed"><CheckCircle2 className="w-5 h-5"/> SERVICIO COMPLETADO</div>}
           <button onClick={() => openGoogleMaps(selectedRoute)} className={`w-full font-black p-4 rounded-2xl border flex items-center justify-center gap-2 ${darkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-600'}`}><Navigation className="w-5 h-5 text-blue-500"/> ABRIR MAPAS</button>
        </div>
      </div>
    );
  }

  if (currentDriver && !isEditingProfile) {
    const rFiltradas = misRutas
        .filter(x => {
            if (mainTab === 'Finalizados') return x.status === 'Finalizado';
            return x.status !== 'Finalizado' && (filterType === 'Todos' || x.serviceType === filterType);
        })
        .sort((a,b) => new Date(`${a.scheduledDate || '2099-12-31'}T${a.scheduledTime || '00:00'}`) - new Date(`${b.scheduledDate || '2099-12-31'}T${b.scheduledTime || '00:00'}`));

    return (
      <div className={`min-h-screen transition-colors duration-300 flex flex-col font-sans relative ${theme.bg} ${theme.text}`}>
        
        {/* --- MODAL SUPERPUESTO DE OFERTA DE VIAJE --- */}
        {incomingOffer && (
            <div className="absolute inset-0 z-[9999] flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-md animate-in fade-in zoom-in duration-300">
                <div className="bg-white rounded-[2.5rem] w-full max-w-sm overflow-hidden shadow-2xl border-4 border-yellow-400 flex flex-col">
                    <div className="bg-yellow-400 p-6 text-center shrink-0 relative overflow-hidden">
                        <div className="absolute inset-0 bg-yellow-500/20 animate-pulse"></div>
                        <div className="relative z-10 flex flex-col items-center">
                            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-lg mb-3">
                                <Zap className="w-8 h-8 text-yellow-500" />
                            </div>
                            <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase">¡NUEVO VIAJE!</h2>
                            <p className="text-xs font-bold text-yellow-900 mt-1 uppercase tracking-widest">A unos kilómetros de ti</p>
                        </div>
                    </div>
                    <div className="p-6 bg-slate-50 space-y-4">
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm text-center">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Cliente Solicitante</p>
                            <p className="text-lg font-black text-slate-800">{incomingOffer.client}</p>
                        </div>
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-blue-500"></div>
                            <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-1 pl-2">Recoger en:</p>
                            <p className="text-sm font-medium text-slate-700 line-clamp-2 pl-2">{incomingOffer.start}</p>
                        </div>
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-500"></div>
                            <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1 pl-2">Llevar a:</p>
                            <p className="text-sm font-medium text-slate-700 line-clamp-2 pl-2">{incomingOffer.end}</p>
                        </div>
                    </div>
                    <div className="p-6 bg-white border-t border-slate-100 flex gap-3 shrink-0">
                        <button onClick={rechazarViaje} className="w-1/3 py-4 rounded-2xl bg-red-50 text-red-600 font-bold text-xs uppercase tracking-widest border border-red-200 hover:bg-red-100 transition active:scale-95">Rechazar</button>
                        <button onClick={aceptarViaje} className="w-2/3 py-4 rounded-2xl bg-green-500 text-white font-black text-sm uppercase tracking-widest shadow-xl shadow-green-500/30 hover:bg-green-600 transition active:scale-95 flex items-center justify-center gap-2"><CheckCircle className="w-5 h-5"/> Aceptar Viaje</button>
                    </div>
                </div>
            </div>
        )}

        <div className={`p-5 flex flex-col gap-4 shadow-sm border-b ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex justify-between items-center">
              <button onClick={() => setIsEditingProfile(true)} className="flex items-center gap-3"><div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black shadow-lg shadow-blue-500/20">{currentDriver.initials}</div><div className="text-left"><h2 className="text-xs font-bold leading-tight">{currentDriver.name}</h2><p className="text-[8px] uppercase tracking-tighter text-slate-400">Mi Expediente</p></div></button>
              <div className="flex items-center gap-2"><button onClick={() => setDarkMode(!darkMode)} className="p-2">{darkMode ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-slate-500" />}</button><button onClick={() => { localStorage.removeItem('driver_session'); setCurrentDriver(null); }} className="p-2 text-slate-400"><LogOut className="w-5 h-5" /></button></div>
          </div>
          
          <div className="flex justify-between items-center bg-slate-100 dark:bg-slate-800 p-2 rounded-2xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 pl-2">
                  {currentDriver.isOnline ? <Power className="w-4 h-4 text-green-500" /> : <PowerOff className="w-4 h-4 text-slate-400" />}
                  <div>
                      <p className="text-[9px] font-black uppercase text-slate-400">Estado de Operador</p>
                      <p className={`text-xs font-bold ${currentDriver.isOnline ? 'text-green-600' : 'text-slate-500'}`}>{currentDriver.isOnline ? 'Conectado (Recibiendo Viajes)' : 'Desconectado'}</p>
                  </div>
              </div>
              <button onClick={toggleOnlineStatus} className={`w-14 h-8 rounded-full transition-colors relative shadow-inner ${currentDriver.isOnline ? 'bg-green-500' : 'bg-slate-300'}`}>
                  <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${currentDriver.isOnline ? 'left-7' : 'left-1'}`}></div>
              </button>
          </div>
        </div>
        
        <div className="px-6 pt-6 pb-2">
            <div className="flex gap-4 mb-4 border-b border-slate-200 dark:border-slate-800 pb-2">
                <button onClick={() => setMainTab('Pendientes')} className={`text-sm font-black uppercase tracking-wider pb-2 border-b-2 transition-all ${mainTab === 'Pendientes' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400'}`}>En Curso</button>
                <button onClick={() => setMainTab('Finalizados')} className={`text-sm font-black uppercase tracking-wider pb-2 border-b-2 transition-all ${mainTab === 'Finalizados' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400'}`}>Finalizados</button>
            </div>
            {mainTab === 'Pendientes' && (
                <div className={`flex p-1 rounded-xl ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100'}`}>
                    {['Todos', 'Prioritario', 'Programado'].map((tipo) => (<button key={tipo} onClick={() => setFilterType(tipo)} className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${filterType === tipo ? theme.activeTab : 'text-slate-400'}`}>{tipo}</button>))}
                </div>
            )}
        </div>

        <div className="flex-1 p-6 space-y-4 overflow-y-auto">
          {rFiltradas.length === 0 ? <div className="text-center py-20 text-slate-400 text-sm">Sin servicios {mainTab === 'Finalizados' ? 'completados' : 'asignados'}</div> : rFiltradas.map(ruta => (
            <div key={ruta.id} onClick={() => handleSelectRoute(ruta)} className={`p-5 rounded-[2rem] border transition-all flex items-center justify-between active:scale-95 shadow-sm cursor-pointer ${theme.card} ${ruta.serviceType === 'Prioritario' ? 'border-l-4 border-l-yellow-400' : ''}`}><div className="flex items-center gap-4"><div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${ruta.status === 'Finalizado' ? 'bg-slate-100 text-slate-600' : ruta.status === 'En Ruta' ? 'bg-green-100 text-green-600 animate-pulse' : ruta.serviceType === 'Prioritario' ? 'bg-yellow-100 text-yellow-600' : 'bg-blue-50 text-blue-600'}`}>{ruta.status === 'Finalizado' ? <CheckCircle2 className="w-6 h-6"/> : ruta.status === 'En Ruta' ? <Play className="w-6 h-6 fill-current"/> : ruta.serviceType === 'Prioritario' ? <Zap className="w-6 h-6" /> : <MapPin className="w-6 h-6" />}</div><div><h4 className="font-bold text-sm tracking-tight line-clamp-1">{ruta.end || ruta.destino}</h4><p className="text-[10px] text-slate-400 font-bold uppercase">Cliente: {ruta.client}</p></div></div><ChevronRight className="w-4 h-4 text-blue-500" /></div>
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
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase text-blue-500 tracking-widest flex items-center gap-2"><User className="w-3 h-3"/> Identidad</p>
            <input type="text" placeholder="Nombre completo *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={name} onChange={e => setName(e.target.value)} required={!isEditing} />
            {!isEditing && (<><input type="email" placeholder="Correo electrónico *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={email} onChange={e => setEmail(e.target.value)} required /><input type="password" placeholder="Contraseña *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={password} onChange={e => setPassword(e.target.value)} required /></>)}
            <div className="grid grid-cols-2 gap-4"><input type="text" placeholder="RFC *" className={`w-full p-4 rounded-2xl text-sm border uppercase ${theme.input}`} value={rfc} onChange={e => setRfc(e.target.value)} required={!isEditing} /><input type="text" placeholder="WhatsApp *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={phone} onChange={e => setPhone(e.target.value)} required={!isEditing} /></div>
            <input type="text" placeholder="Dirección completa" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={address} onChange={e => setAddress(e.target.value)} />
          </div>
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase text-orange-500 tracking-widest flex items-center gap-2"><Truck className="w-3 h-3"/> Vehículo</p>
            <input type="text" placeholder="Modelo (Ej. Ford) *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={vehicleModel} onChange={e => setVehicleModel(e.target.value)} required={!isEditing} />
            <div className="grid grid-cols-2 gap-4"><input type="text" placeholder="Placas *" className={`w-full p-4 rounded-2xl text-sm border uppercase ${theme.input}`} value={vehiclePlate} onChange={e => setVehiclePlate(e.target.value)} required={!isEditing} /><input type="text" placeholder="Tipo (Caja, etc)" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={vehicleType} onChange={e => setVehicleType(e.target.value)} /></div>
          </div>
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase text-purple-500 tracking-widest flex items-center gap-2"><FileText className="w-3 h-3"/> Licencia</p>
            <input type="text" placeholder="Número *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} required={!isEditing} />
            <div className="grid grid-cols-2 gap-4"><input type="text" placeholder="Tipo (Federal, B)" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={licenseType} onChange={e => setLicenseType(e.target.value)} /><input type="text" placeholder="Vigencia" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={licenseExp} onChange={e => setLicenseExp(e.target.value)} /></div>
          </div>
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase text-red-500 tracking-widest flex items-center gap-2"><ShieldAlert className="w-3 h-3"/> Salud</p>
            <div className="grid grid-cols-2 gap-4"><input type="text" placeholder="Tipo Sangre" className={`w-full p-4 rounded-2xl text-sm border uppercase ${theme.input}`} value={bloodType} onChange={e => setBloodType(e.target.value)} /><input type="text" placeholder="Tel. Emergencia" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} /></div>
          </div>
          {error && <p className="text-red-500 text-xs text-center">{error}</p>}
          <div className={`p-5 border-t fixed bottom-0 left-0 right-0 z-30 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}><button type="submit" disabled={loading} className="w-full bg-blue-600 text-white font-black p-4 rounded-2xl shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all">{loading ? <Loader2 className="animate-spin w-5 h-5"/> : (isEditing ? <><Save className="w-5 h-5"/> GUARDAR CAMBIOS</> : 'Enviar Registro')}</button></div>
        </form>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex flex-col items-center justify-between p-8 transition-colors ${theme.bg} ${theme.text}`}>
      <div className="flex flex-col items-center mt-12 w-full max-w-sm"><div className="w-24 h-24 bg-blue-600 rounded-[2.2rem] flex items-center justify-center mb-8 shadow-2xl rotate-6 shadow-blue-500/30"><Truck className="w-12 h-12 text-white" /></div><h1 className="text-4xl font-black tracking-tighter italic">LOGÍSTICA</h1></div>
      <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
        <input type="email" placeholder="Email" className={`w-full p-5 rounded-[1.8rem] text-sm border ${theme.input}`} value={email} onChange={e => setEmail(e.target.value)} />
        <input type="password" placeholder="Contraseña" className={`w-full p-5 rounded-[1.8rem] text-sm border ${theme.input}`} value={password} onChange={e => setPassword(e.target.value)} />
        {error && <p className="text-red-500 text-[10px] font-bold text-center">{error}</p>}
        <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white font-black p-5 rounded-[1.8rem] shadow-xl flex items-center justify-center">{loading ? <Loader2 className="animate-spin w-5 h-5"/> : 'INICIAR SESIÓN'}</button>
        <button type="button" onClick={() => setIsRegistering(true)} className="w-full text-slate-500 font-bold text-[10px] py-4">¿Nuevo Operador? <span className="text-blue-600">Regístrate</span></button>
      </form>
    </div>
  );
}

export default App;