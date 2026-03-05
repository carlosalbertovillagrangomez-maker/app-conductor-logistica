import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Truck, LogIn, ShieldCheck, Mail, Lock, Loader2, 
  AlertCircle, LogOut, MapPin, User, Phone, 
  FileText, ChevronLeft, Camera, CreditCard,
  Sun, Moon, Package, Clock, ChevronRight, CheckCircle2, Zap, Calendar, Navigation, MoreVertical, Play, Save,
  Heart, ShieldAlert, Hash, CheckCircle, LocateFixed, Navigation2
} from 'lucide-react';
import { db } from './firebase';
import { collection, query, where, getDocs, addDoc, onSnapshot, updateDoc, doc } from 'firebase/firestore';

// --- GOOGLE MAPS ---
import { GoogleMap, useJsApiLoader, Marker, Polyline } from '@react-google-maps/api';
const GOOGLE_MAPS_API_KEY = "AIzaSyA-t6YcuPK1PdOoHZJOyOsw6PK0tCDJrn0"; 
const containerStyle = { width: '100%', height: '100%' };
const centerMX = { lat: 19.4326, lng: -99.1332 }; 

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

  // --- NAVEGACIÓN Y GPS AVANZADO ---
  const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: GOOGLE_MAPS_API_KEY });
  const mapRef = useRef(null);
  
  const [userLocation, setUserLocation] = useState(null);
  const [isTracking, setIsTracking] = useState(true);
  const isTrackingRef = useRef(true); // Para no matar el GPS al mover el mapa
  const latestLocRef = useRef(null);
  
  const [nextStopIdx, setNextStopIdx] = useState(0); // 0 = Origen, 1 = Parada 1...
  const [routeUpdateTick, setRouteUpdateTick] = useState(0); // Reloj interno para OSRM
  const [liveRouteData, setLiveRouteData] = useState({ 
      geometry: [], totalDuration: 0, totalDistance: 0, nextStopDuration: 0, nextStopDistance: 0 
  });

  const handleMapLoad = useCallback((map) => { mapRef.current = map; }, []);

  // Mantener Refs actualizados
  useEffect(() => { latestLocRef.current = userLocation; }, [userLocation]);
  useEffect(() => { isTrackingRef.current = isTracking; }, [isTracking]);

  // 1. GENERAR LISTA DE TODOS LOS PUNTOS A VISITAR
  const allTargets = useMemo(() => {
      if (!selectedRoute) return [];
      const targets = [];
      if (selectedRoute.startCoords) {
          targets.push({ ...selectedRoute.startCoords, label: 'Origen', address: selectedRoute.start, icon: ICON_START });
      }
      if (selectedRoute.waypointsData) {
          selectedRoute.waypointsData.forEach((wp, idx) => {
              targets.push({ ...wp, label: `Parada ${String.fromCharCode(66 + idx)}`, address: selectedRoute.waypoints[idx], icon: ICON_WAYPOINT });
          });
      }
      if (selectedRoute.endCoords) {
          targets.push({ ...selectedRoute.endCoords, label: 'Destino Final', address: selectedRoute.end, icon: ICON_END });
      }
      return targets;
  }, [selectedRoute]);

  // 2. ESCUCHAR GPS EN VIVO (Movimiento ultra suave)
  useEffect(() => {
    let watchId;
    if (currentDriver && selectedRoute && selectedRoute.status === 'En Ruta') {
      if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition(
          (position) => {
            const loc = { lat: position.coords.latitude, lng: position.coords.longitude };
            setUserLocation(loc);
            
            if (isTrackingRef.current && mapRef.current) {
                mapRef.current.panTo(loc);
            }
          },
          (error) => console.error("Error GPS:", error),
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
        );
      }
    }
    return () => { if (watchId) navigator.geolocation.clearWatch(watchId); };
  }, [currentDriver, selectedRoute]);

  // 3. RELOJ INTERNO (Pide nueva ruta a OSRM cada 5 segundos para no saturar)
  useEffect(() => {
      if (selectedRoute?.status !== 'En Ruta') return;
      const interval = setInterval(() => setRouteUpdateTick(t => t + 1), 5000);
      return () => clearInterval(interval);
  }, [selectedRoute?.status]);

  // 4. RECÁLCULO DINÁMICO Y SUBIDA A FIREBASE
  useEffect(() => {
      if (selectedRoute?.status !== 'En Ruta' || allTargets.length === 0) return;
      const loc = latestLocRef.current;
      if (!loc) return;

      const updateLiveRoute = async () => {
          // A. Subir GPS al despachador
          try {
              await updateDoc(doc(db, "rutas", selectedRoute.id), { 
                  currentLocation: loc, lastUpdate: new Date().toISOString() 
              });
          } catch(e) {}

          // B. Recalcular Ruta (Desde Chofer -> Puntos Pendientes)
          try {
              let coordsArray = [`${loc.lng},${loc.lat}`]; 
              for (let i = nextStopIdx; i < allTargets.length; i++) {
                  coordsArray.push(`${allTargets[i].lng},${allTargets[i].lat}`);
              }

              const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordsArray.join(';')}?overview=full&geometries=geojson`);
              const data = await res.json();
              
              if (data.code === 'Ok' && data.routes.length > 0) {
                  const r = data.routes[0];
                  const geo = r.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
                  setLiveRouteData({ 
                      geometry: geo, 
                      totalDuration: Math.round(r.duration / 60), 
                      totalDistance: (r.distance / 1000).toFixed(1),
                      nextStopDuration: r.legs.length > 0 ? Math.round(r.legs[0].duration / 60) : 0,
                      nextStopDistance: r.legs.length > 0 ? (r.legs[0].distance / 1000).toFixed(1) : 0
                  });
              }
          } catch (e) { console.error("Error recalculando OSRM", e); }
      };

      updateLiveRoute();
  }, [routeUpdateTick, nextStopIdx, selectedRoute, allTargets]); // Se ejecuta al tick de 5s o al cambiar de parada

  // --- CONTROLES DE UI ---
  const centerOnUser = () => {
      setIsTracking(true);
      if (mapRef.current && userLocation) {
          mapRef.current.panTo(userLocation);
          mapRef.current.setZoom(17);
      }
  };

  const handleMapDrag = () => { setIsTracking(false); };

  const cerrarRuta = () => {
      setSelectedRoute(null);
      setNextStopIdx(0);
      setLiveRouteData({ geometry: [], totalDuration: 0, totalDistance: 0, nextStopDuration: 0, nextStopDistance: 0 }); 
      setIsPanelExpanded(true); 
      setIsTracking(true);
  };

  const handleLlegadaPunto = () => {
      setNextStopIdx(prev => prev + 1);
      // Forzar un recalculado inmediato sin esperar los 5 segundos
      setRouteUpdateTick(t => t + 1); 
  };

  // --- ESTADOS PARA EL EXPEDIENTE ---
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
    } catch (e) { alert("Error al iniciar"); }
  };

  const handleEndTrip = async (routeId) => {
    if (!confirm("¿Has completado el viaje por completo?")) return;
    try {
      await updateDoc(doc(db, "rutas", routeId), { status: 'Finalizado', endTime: new Date().toISOString() });
      setSelectedRoute(prev => ({ ...prev, status: 'Finalizado' }));
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
        created: new Date().toISOString(), joined: new Date().toLocaleDateString(), trips: 0, rating: 5, fotoPerfil: '', identificacion: ''
      };
      await addDoc(collection(db, "conductores"), nuevoConductor);
      alert("¡Registro enviado! Tu expediente está en revisión por el despacho.");
      setIsRegistering(false);
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

  // ========================================================
  // VISTA 1: NAVEGACIÓN EN VIVO (MAPA AVANZADO)
  // ========================================================
  if (currentDriver && selectedRoute && selectedRoute.status === 'En Ruta') {
      const currentGeometry = liveRouteData.geometry.length > 0 ? liveRouteData.geometry : selectedRoute.technicalData?.geometry;

      const isHeadingToDestination = nextStopIdx >= allTargets.length - 1;
      const currentTarget = allTargets[nextStopIdx] || allTargets[allTargets.length - 1];
      const nextStopName = currentTarget?.label || 'Destino';
      const nextStopAddress = currentTarget?.address || '';

      return (
          <div className={`h-screen w-full flex flex-col font-sans transition-colors ${theme.bg} ${theme.text} overflow-hidden`}>
              <div className={`p-4 flex items-center gap-4 shadow-lg z-20 shrink-0 ${darkMode ? 'bg-slate-900 border-b border-slate-800' : 'bg-white'}`}>
                  <button onClick={cerrarRuta} className={`p-2 rounded-full border ${darkMode ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-100'} transition`}><ChevronLeft className="w-5 h-5" /></button>
                  <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                          <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]"></div>
                          <h2 className="text-sm font-black tracking-tight text-green-500 uppercase">Navegación Activa</h2>
                      </div>
                      <p className={`text-[10px] uppercase font-bold text-slate-400 line-clamp-1`}>{selectedRoute.client} • {nextStopName}</p>
                  </div>
              </div>

              <div className="flex-1 relative bg-slate-200 w-full h-full">
                  {!isLoaded ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 gap-3 z-10"><Loader2 className="animate-spin text-blue-600 w-8 h-8"/><p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Cargando GPS...</p></div>
                  ) : (
                      <>
                        <GoogleMap 
                            mapContainerStyle={containerStyle} 
                            center={centerMX} 
                            zoom={16} 
                            onLoad={handleMapLoad} 
                            onDragStart={handleMapDrag} 
                            options={{ streetViewControl: false, mapTypeControl: false, myLocationButton: false, zoomControl: false, fullscreenControl: false }}
                        >
                            {/* RUTA DINÁMICA */}
                            {currentGeometry && <Polyline path={currentGeometry} options={{ strokeColor: "#3b82f6", strokeOpacity: 0.9, strokeWeight: 6 }} />}

                            {/* PINES DINÁMICOS: Solo mostramos de la meta actual en adelante */}
                            {allTargets.map((target, idx) => {
                                if (idx < nextStopIdx) return null; // Ocultar los que ya visitamos
                                return <Marker key={idx} position={{lat: target.lat, lng: target.lng}} icon={target.icon} />;
                            })}
                            
                            {/* MARCADOR DEL COCHE */}
                            {userLocation && (
                                <Marker 
                                    position={userLocation} 
                                    icon={{ path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, fillColor: "#22c55e", fillOpacity: 1, strokeWeight: 2, strokeColor: "white", rotation: 0 }} 
                                    zIndex={999} 
                                />
                            )}
                        </GoogleMap>

                        {/* BOTÓN DE CENTRAR */}
                        {userLocation && (
                            <button 
                                onClick={centerOnUser} 
                                style={{ bottom: isPanelExpanded ? '340px' : '100px' }} 
                                className={`absolute left-4 p-3 rounded-full shadow-[0_4px_15px_rgba(0,0,0,0.2)] border transition-all duration-300 z-10 ${isTracking ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-blue-600 border-slate-200 active:bg-blue-50'}`}>
                                {isTracking ? <Navigation2 className="w-6 h-6" /> : <LocateFixed className="w-6 h-6" />}
                            </button>
                        )}
                      </>
                  )}
              </div>

              {/* PANEL INFERIOR MINIMIZABLE */}
              <div className={`z-20 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] rounded-t-[2rem] -mt-6 shrink-0 relative flex flex-col transition-all duration-300 ${darkMode ? 'bg-slate-900 border-t border-slate-800' : 'bg-white border-t border-slate-200'} ${isPanelExpanded ? 'max-h-[70vh] p-6' : 'h-[90px] px-6 py-4 cursor-pointer'}`}>
                  
                  <div className="w-full flex justify-center pb-3" onClick={() => setIsPanelExpanded(!isPanelExpanded)}>
                      <div className="w-12 h-1.5 bg-slate-300 hover:bg-slate-400 rounded-full transition-colors cursor-pointer"></div>
                  </div>

                  {isPanelExpanded ? (
                      <>
                        {/* PRÓXIMO OBJETIVO (GRANDE) */}
                        <div className={`mb-4 rounded-xl p-4 border shadow-sm ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-blue-50/50 border-blue-100'}`}>
                            <p className="text-[10px] font-black uppercase text-blue-500 mb-1 tracking-widest">Siguiente Objetivo</p>
                            <p className="font-bold text-sm text-slate-800 dark:text-white truncate mb-3">{nextStopName}: <span className="font-medium text-slate-500 dark:text-slate-400">{nextStopAddress}</span></p>
                            
                            <div className="flex justify-between items-center bg-white dark:bg-slate-900 rounded-lg p-3 border border-slate-100 dark:border-slate-800 shadow-sm">
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Faltan</span>
                                    <span className="font-black text-blue-600 text-xl">{liveRouteData.nextStopDistance || '--'} <span className="text-sm">km</span></span>
                                </div>
                                <div className="w-px h-8 bg-slate-100 dark:bg-slate-800"></div>
                                <div className="flex flex-col text-right">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Llegada en</span>
                                    <span className="font-black text-green-500 text-xl">{liveRouteData.nextStopDuration || '--'} <span className="text-sm">min</span></span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3 shrink-0 mt-auto pb-4">
                            {/* BOTÓN CHECK-IN (Solo si no es el destino final) */}
                            {!isHeadingToDestination && (
                                <button 
                                    onClick={handleLlegadaPunto} 
                                    className="w-full bg-blue-100 hover:bg-blue-200 text-blue-700 border border-blue-200 font-black p-4 rounded-2xl shadow-sm flex items-center justify-center gap-2 active:scale-95 transition-all text-sm tracking-widest"
                                >
                                    <MapPin className="w-5 h-5"/> LLEGUÉ A {nextStopName.toUpperCase()}
                                </button>
                            )}

                            {/* BOTÓN FINALIZAR (Solo resalta si ya estamos en el destino final) */}
                            <button 
                                onClick={() => handleEndTrip(selectedRoute.id)} 
                                className={`w-full text-white font-black p-4 rounded-2xl shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all text-sm tracking-widest ${isHeadingToDestination ? 'bg-red-600 hover:bg-red-700 shadow-red-500/40 animate-pulse' : 'bg-red-400 hover:bg-red-500 shadow-red-400/20'}`}
                            >
                                <CheckCircle className="w-5 h-5"/> TERMINAR SERVICIO
                            </button>
                            
                            <button onClick={() => openGoogleMaps(selectedRoute)} className={`w-full font-bold p-4 rounded-2xl border flex items-center justify-center gap-2 text-xs tracking-wide transition-all active:scale-95 ${darkMode ? 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}><Navigation className="w-4 h-4"/> MAPS EXTERNO</button>
                        </div>
                      </>
                  ) : (
                      // VISTA MINIMIZADA (Para ver el mapa)
                      <div className="flex justify-between items-center px-2" onClick={() => setIsPanelExpanded(true)}>
                          <div>
                              <p className="text-[10px] font-black uppercase text-blue-500 tracking-widest line-clamp-1">{nextStopName}</p>
                              <p className="text-xl font-black text-slate-800 dark:text-white leading-none mt-1">{liveRouteData.nextStopDistance || '--'} <span className="text-sm font-medium text-slate-500">km</span></p>
                          </div>
                          <div className="text-right">
                              <p className="text-[10px] font-black uppercase text-green-500 tracking-widest">Llegada en</p>
                              <p className="text-xl font-black text-green-500 leading-none mt-1">{liveRouteData.nextStopDuration || '--'} <span className="text-sm font-medium text-green-400">min</span></p>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      );
  }

  // ========================================================
  // VISTA 2: DETALLE DEL VIAJE (ANTES O DESPUÉS)
  // ========================================================
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

  // ========================================================
  // VISTA LISTADO PRINCIPAL CON PESTAÑAS (EN CURSO / FINALIZADOS)
  // ========================================================
  if (currentDriver && !isEditingProfile) {
    const rFiltradas = misRutas
        .filter(x => {
            if (mainTab === 'Finalizados') return x.status === 'Finalizado';
            return x.status !== 'Finalizado' && (filterType === 'Todos' || x.serviceType === filterType);
        })
        .sort((a,b) => new Date(`${a.scheduledDate || '2099-12-31'}T${a.scheduledTime || '00:00'}`) - new Date(`${b.scheduledDate || '2099-12-31'}T${b.scheduledTime || '00:00'}`));

    return (
      <div className={`min-h-screen transition-colors duration-300 flex flex-col font-sans ${theme.bg} ${theme.text}`}>
        <div className={`p-5 flex justify-between items-center shadow-sm border-b ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <button onClick={() => setIsEditingProfile(true)} className="flex items-center gap-3"><div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black shadow-lg shadow-blue-500/20">{currentDriver.initials}</div><div className="text-left"><h2 className="text-xs font-bold leading-tight">{currentDriver.name}</h2><p className="text-[8px] uppercase tracking-tighter text-slate-400">Mi Expediente</p></div></button>
          <div className="flex items-center gap-2"><button onClick={() => setDarkMode(!darkMode)} className="p-2">{darkMode ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-slate-500" />}</button><button onClick={() => { localStorage.removeItem('driver_session'); setCurrentDriver(null); }} className="p-2 text-slate-400"><LogOut className="w-5 h-5" /></button></div>
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
            <div key={ruta.id} onClick={() => setSelectedRoute(ruta)} className={`p-5 rounded-[2rem] border transition-all flex items-center justify-between active:scale-95 shadow-sm cursor-pointer ${theme.card} ${ruta.serviceType === 'Prioritario' ? 'border-l-4 border-l-yellow-400' : ''}`}><div className="flex items-center gap-4"><div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${ruta.status === 'Finalizado' ? 'bg-slate-100 text-slate-600' : ruta.status === 'En Ruta' ? 'bg-green-100 text-green-600 animate-pulse' : ruta.serviceType === 'Prioritario' ? 'bg-yellow-100 text-yellow-600' : 'bg-blue-50 text-blue-600'}`}>{ruta.status === 'Finalizado' ? <CheckCircle2 className="w-6 h-6"/> : ruta.status === 'En Ruta' ? <Play className="w-6 h-6 fill-current"/> : ruta.serviceType === 'Prioritario' ? <Zap className="w-6 h-6" /> : <MapPin className="w-6 h-6" />}</div><div><h4 className="font-bold text-sm tracking-tight line-clamp-1">{ruta.end || ruta.destino}</h4><p className="text-[10px] text-slate-400 font-bold uppercase">Cliente: {ruta.client}</p></div></div><ChevronRight className="w-4 h-4 text-blue-500" /></div>
          ))}
        </div>
      </div>
    );
  }

  // --- VISTA REGISTRO Y EDICIÓN ---
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

  // --- VISTA LOGIN ---
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