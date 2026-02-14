import React, { useState, useEffect } from 'react';
import { 
  Truck, LogIn, ShieldCheck, Mail, Lock, Loader2, 
  AlertCircle, LogOut, MapPin, User, Phone, 
  FileText, ChevronLeft, Camera, CreditCard,
  Sun, Moon, Package, Clock, ChevronRight, CheckCircle2, Zap, Calendar, Navigation, MoreVertical, Play
} from 'lucide-react';
import { db } from './firebase';
import { collection, query, where, getDocs, addDoc, onSnapshot, updateDoc, doc } from 'firebase/firestore';

function App() {
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentDriver, setCurrentDriver] = useState(null);
  const [isReady, setIsReady] = useState(false);
  
  const [misRutas, setMisRutas] = useState([]);
  const [darkMode, setDarkMode] = useState(false);
  
  // ESTADO PARA FILTROS
  const [filterType, setFilterType] = useState('Todos');
  
  // ESTADO PARA LA VISTA DE DETALLE
  const [selectedRoute, setSelectedRoute] = useState(null);

  // --- ESTADOS DEL FORMULARIO ---
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [license, setLicense] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');

  // 1. AL CARGAR
  useEffect(() => {
    const savedDriver = localStorage.getItem('driver_session');
    if (savedDriver) {
      const driverData = JSON.parse(savedDriver);
      setCurrentDriver(driverData);
      escucharRutas(driverData.id);
    }
    setIsReady(true);
  }, []);

  // 2. ESCUCHAR RUTAS
  const escucharRutas = (driverId) => {
    const q = query(collection(db, "rutas"), where("driverId", "==", driverId));
    return onSnapshot(q, (snapshot) => {
      const rutasEncontradas = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      }));
      setMisRutas(rutasEncontradas);
    });
  };

  // --- FUNCIÓN PARA INICIAR VIAJE ---
  const handleStartTrip = async (routeId) => {
    if (!confirm("¿Estás listo para iniciar este viaje?")) return;
    
    try {
        await updateDoc(doc(db, "rutas", routeId), {
            status: 'En Ruta',
            startTime: new Date().toISOString()
        });
        // No cerramos la vista para que pueda ir directo al mapa
        alert("¡Viaje iniciado! El estatus se ha actualizado.");
    } catch (error) {
        console.error("Error al iniciar:", error);
        alert("Hubo un error al iniciar el viaje.");
    }
  };

  // --- HELPER PARA ABRIR GOOGLE MAPS ---
  const openGoogleMaps = (ruta) => {
    if (!ruta.start || !ruta.end) return;
    
    const origin = encodeURIComponent(ruta.start);
    const destination = encodeURIComponent(ruta.end);
    let waypoints = '';
    
    if (ruta.waypoints && ruta.waypoints.length > 0) {
      waypoints = '&waypoints=' + ruta.waypoints.map(wp => encodeURIComponent(wp)).join('|');
    }
    
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints}&travelmode=driving`;
    window.open(url, '_blank');
  };

  // --- LÓGICA DE FILTRADO ---
  const getRutasFiltradas = () => {
    let rutas = [...misRutas];
    if (filterType !== 'Todos') {
      rutas = rutas.filter(r => r.serviceType === filterType);
    }
    rutas.sort((a, b) => {
      if (filterType === 'Todos') {
        if (a.serviceType === 'Prioritario' && b.serviceType !== 'Prioritario') return -1;
        if (a.serviceType !== 'Prioritario' && b.serviceType === 'Prioritario') return 1;
      }
      const fechaA = new Date(`${a.scheduledDate || '2099-12-31'}T${a.scheduledTime || '00:00'}`);
      const fechaB = new Date(`${b.scheduledDate || '2099-12-31'}T${b.scheduledTime || '00:00'}`);
      return fechaA - fechaB;
    });
    return rutas;
  };

  const rutasVisibles = getRutasFiltradas();

  // 3. REGISTRO
  const handleRegister = async (e) => {
    e.preventDefault();
    if (!email || !password || !name || !phone || !vehicleModel || !vehiclePlate) {
      return setError('Todos los campos son obligatorios.');
    }
    setLoading(true);
    setError('');
    try {
      const cleanEmail = email.trim().toLowerCase();
      const nuevoConductor = {
        name: name.trim(),
        email: cleanEmail,
        password: password,
        phone: phone.trim(),
        licenseNumber: license.trim(),
        vehicle: `${vehicleModel} (${vehiclePlate.toUpperCase()})`,
        vehicleModel: vehicleModel,
        vehiclePlate: vehiclePlate.toUpperCase(),
        status: 'Pendiente',
        initials: name.substring(0, 2).toUpperCase(),
        created: new Date().toISOString(),
        joined: new Date().toLocaleDateString(),
        fotoPerfil: '', identificacion: ''
      };
      await addDoc(collection(db, "conductores"), nuevoConductor);
      alert("¡Registro enviado! Tu unidad y datos están en revisión.");
      setIsRegistering(false);
    } catch (e) { setError('Error al registrar: ' + e.message); } 
    finally { setLoading(false); }
  };

  // 4. LOGIN
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const cleanEmail = email.trim().toLowerCase();
      const q = query(collection(db, "conductores"), where("email", "==", cleanEmail));
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) {
        setError('El correo no coincide con ningún conductor registrado.');
      } else {
        const driverData = { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() };
        if (driverData.password !== password) {
          setError('Contraseña incorrecta.');
        } else if (driverData.status !== 'Aprobado') {
          setError('Tu cuenta aún está pendiente de aprobación.');
        } else {
          setCurrentDriver(driverData);
          localStorage.setItem('driver_session', JSON.stringify(driverData));
          escucharRutas(driverData.id);
        }
      }
    } catch (e) { setError('Error de conexión.'); } 
    finally { setLoading(false); }
  };

  if (!isReady) return null;

  const theme = {
    bg: darkMode ? 'bg-slate-950' : 'bg-slate-50',
    text: darkMode ? 'text-white' : 'text-slate-900',
    card: darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200',
    input: darkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900',
    subtext: darkMode ? 'text-slate-500' : 'text-slate-400',
    activeTab: darkMode ? 'bg-slate-800 text-white border-slate-700' : 'bg-white text-blue-600 border-slate-200 shadow-sm',
    inactiveTab: darkMode ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'
  };

  // --- VISTA DETALLE DEL VIAJE ---
  if (currentDriver && selectedRoute) {
    return (
      <div className={`min-h-screen flex flex-col font-sans transition-colors ${theme.bg} ${theme.text}`}>
        {/* Header Detalle */}
        <div className={`p-5 flex items-center gap-4 sticky top-0 z-10 backdrop-blur-md border-b ${darkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-white/80 border-slate-200'}`}>
          <button onClick={() => setSelectedRoute(null)} className={`p-2 rounded-full border ${darkMode ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'}`}>
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-sm font-bold leading-tight">Detalle del Servicio</h2>
            <p className={`text-[10px] font-medium uppercase tracking-widest ${theme.subtext}`}>ID: {selectedRoute.id.slice(0, 8)}</p>
          </div>
        </div>

        <div className="flex-1 p-6 space-y-6 overflow-y-auto">
          {/* Tarjeta de Estado */}
          <div className={`p-5 rounded-[2rem] border ${theme.card} flex justify-between items-center`}>
             <div>
                <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${theme.subtext}`}>Estado actual</p>
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold ${
                    selectedRoute.status === 'En Ruta' ? 'bg-green-100 text-green-700 animate-pulse' : 
                    selectedRoute.serviceType === 'Prioritario' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
                }`}>
                   {selectedRoute.status === 'En Ruta' ? <Play className="w-3 h-3"/> : (selectedRoute.serviceType === 'Prioritario' ? <Zap className="w-3 h-3"/> : <Calendar className="w-3 h-3"/>)}
                   {selectedRoute.status || selectedRoute.serviceType}
                </div>
             </div>
             {selectedRoute.technicalData && (
               <div className="text-right">
                  <p className="text-2xl font-black">{selectedRoute.technicalData.totalDistance} <span className="text-xs font-bold text-slate-400">km</span></p>
                  <p className="text-xs font-bold text-green-500">{selectedRoute.technicalData.totalDuration} min est.</p>
               </div>
             )}
          </div>

          {/* Información del Cliente */}
          <div className={`p-5 rounded-[2rem] border ${theme.card}`}>
             <h3 className="text-sm font-bold mb-4 flex items-center gap-2"><User className="w-4 h-4 text-blue-500"/> Cliente</h3>
             <div className="space-y-3">
               <div>
                 <p className={`text-[10px] font-bold uppercase ${theme.subtext}`}>Empresa / Nombre</p>
                 <p className="font-bold text-lg">{selectedRoute.client}</p>
               </div>
               {selectedRoute.requestUser && (
                 <div>
                   <p className={`text-[10px] font-bold uppercase ${theme.subtext}`}>Solicitado por</p>
                   <p className="font-medium text-sm">{selectedRoute.requestUser}</p>
                 </div>
               )}
             </div>
          </div>

          {/* Desglose de Ruta (Timeline) */}
          <div className={`p-5 rounded-[2rem] border ${theme.card}`}>
             <h3 className="text-sm font-bold mb-6 flex items-center gap-2"><MapPin className="w-4 h-4 text-blue-500"/> Itinerario</h3>
             
             <div className="relative pl-2 space-y-8">
                <div className={`absolute left-[15px] top-2 bottom-4 w-0.5 ${darkMode ? 'bg-slate-800' : 'bg-slate-200'}`}></div>

                {/* Inicio */}
                <div className="relative flex gap-4">
                   <div className="w-3 h-3 rounded-full bg-green-500 ring-4 ring-green-500/20 shrink-0 z-10 mt-1.5"></div>
                   <div>
                      <p className={`text-[10px] font-bold uppercase ${theme.subtext}`}>Origen</p>
                      <p className="text-xs font-medium leading-relaxed">{selectedRoute.start}</p>
                      
                      {/* Info del PRIMER tramo */}
                      {selectedRoute.technicalData?.segments && selectedRoute.technicalData.segments[0] && (
                        <div className="mt-1 inline-block bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[9px] font-mono text-slate-500">
                           ⬇ {selectedRoute.technicalData.segments[0].distance} km • {selectedRoute.technicalData.segments[0].duration} min
                        </div>
                      )}
                   </div>
                </div>

                {/* Waypoints */}
                {selectedRoute.waypoints && selectedRoute.waypoints.map((wp, idx) => (
                   <div key={idx} className="relative flex gap-4">
                      <div className={`w-2 h-2 rounded-full shrink-0 z-10 mt-2 ${darkMode ? 'bg-slate-400 ring-4 ring-slate-800' : 'bg-slate-300 ring-4 ring-white'}`}></div>
                      <div>
                         <p className={`text-[10px] font-bold uppercase ${theme.subtext}`}>Parada {idx + 1}</p>
                         <p className="text-xs font-medium leading-relaxed">{wp}</p>
                         {/* Info del tramo siguiente */}
                         {selectedRoute.technicalData?.segments && selectedRoute.technicalData.segments[idx + 1] && (
                            <div className="mt-1 inline-block bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[9px] font-mono text-slate-500">
                               ⬇ {selectedRoute.technicalData.segments[idx + 1].distance} km • {selectedRoute.technicalData.segments[idx + 1].duration} min
                            </div>
                         )}
                      </div>
                   </div>
                ))}

                {/* Destino */}
                <div className="relative flex gap-4">
                   <div className="w-3 h-3 rounded-full bg-red-500 ring-4 ring-red-500/20 shrink-0 z-10 mt-1.5"></div>
                   <div>
                      <p className={`text-[10px] font-bold uppercase ${theme.subtext}`}>Destino Final</p>
                      <p className="text-xs font-medium leading-relaxed">{selectedRoute.end}</p>
                   </div>
                </div>
             </div>
          </div>
        </div>

        {/* Footer con Acciones (BOTONES) */}
        <div className={`p-5 border-t ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} grid grid-cols-1 gap-3`}>
           
           {/* 1. BOTÓN INICIAR VIAJE (Solo si no ha iniciado) */}
           {selectedRoute.status !== 'En Ruta' && selectedRoute.status !== 'Finalizado' && (
               <button 
                 onClick={() => handleStartTrip(selectedRoute.id)}
                 className="w-full bg-green-600 text-white font-black p-4 rounded-[1.5rem] shadow-xl flex items-center justify-center gap-2 hover:bg-green-700 active:scale-95 transition-all"
               >
                 <Play className="w-5 h-5 fill-white"/>
                 INICIAR VIAJE
               </button>
           )}

           {/* 2. BOTÓN GOOGLE MAPS */}
           <button 
             onClick={() => openGoogleMaps(selectedRoute)}
             className={`w-full font-black p-4 rounded-[1.5rem] shadow-sm flex items-center justify-center gap-2 border active:scale-95 transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
           >
             <Navigation className="w-5 h-5 text-blue-500"/>
             ABRIR EN GOOGLE MAPS
           </button>
        </div>
      </div>
    );
  }

  // --- VISTA 1: LISTADO (PANEL) ---
  if (currentDriver) {
    return (
      <div className={`min-h-screen transition-colors duration-300 flex flex-col font-sans ${theme.bg} ${theme.text}`}>
        {/* Header */}
        <div className={`p-5 flex justify-between items-center shadow-sm border-b transition-colors ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black shadow-lg shadow-blue-500/20">
              {currentDriver.initials}
            </div>
            <div>
              <h2 className="text-xs font-bold leading-tight">{currentDriver.name}</h2>
              <div className="flex items-center gap-1">
                <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${currentDriver.status === 'En Ruta' ? 'bg-orange-500' : 'bg-green-500'}`}></div>
                <p className="text-[9px] font-black uppercase tracking-tighter text-slate-400">En servicio</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDarkMode(!darkMode)} className={`p-2 rounded-xl border transition-all ${darkMode ? 'bg-slate-800 border-slate-700 text-yellow-400' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={() => { localStorage.removeItem('driver_session'); setCurrentDriver(null); }} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="px-6 pt-6 pb-2">
            <div className={`flex p-1 rounded-xl ${darkMode ? 'bg-slate-900 border border-slate-800' : 'bg-slate-100'}`}>
                {['Todos', 'Prioritario', 'Programado'].map((tipo) => (
                    <button key={tipo} onClick={() => setFilterType(tipo)} className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${filterType === tipo ? theme.activeTab : theme.inactiveTab}`}>
                        {tipo === 'Prioritario' && <Zap className="w-3 h-3"/>}
                        {tipo === 'Programado' && <Calendar className="w-3 h-3"/>}
                        {tipo}
                    </button>
                ))}
            </div>
        </div>

        {/* Listado */}
        <div className="flex-1 p-6 space-y-6 overflow-y-auto">
          <div className="flex justify-between items-end">
            <div><h3 className="text-2xl font-black tracking-tight">Mis servicios</h3><p className={`text-xs font-medium uppercase tracking-widest ${theme.subtext}`}>{rutasVisibles.length} órdenes {filterType !== 'Todos' ? filterType.toLowerCase() + 's' : ''}</p></div>
          </div>

          {rutasVisibles.length === 0 ? (
            <div className={`border-2 border-dashed p-12 rounded-[2.5rem] text-center transition-colors ${darkMode ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200'}`}>
              <Clock className="w-10 h-10 text-slate-300 mx-auto mb-4 opacity-50" /><p className="text-sm font-bold text-slate-400">Sin rutas asignadas</p>
            </div>
          ) : (
            <div className="space-y-4">
              {rutasVisibles.map(ruta => (
                <div key={ruta.id} onClick={() => setSelectedRoute(ruta)} className={`p-5 rounded-[2rem] border transition-all flex items-center justify-between active:scale-95 shadow-sm cursor-pointer ${theme.card} ${ruta.serviceType === 'Prioritario' ? (darkMode ? 'border-l-4 border-l-yellow-500' : 'border-l-4 border-l-yellow-400') : ''}`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${ruta.serviceType === 'Prioritario' ? 'bg-yellow-100' : (darkMode ? 'bg-blue-600/10' : 'bg-blue-50')}`}>
                      {ruta.serviceType === 'Prioritario' ? <Zap className="text-yellow-600 w-6 h-6" /> : <MapPin className="text-blue-600 w-6 h-6" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm tracking-tight line-clamp-1">{ruta.end || ruta.destino || 'Dirección pendiente'}</h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Cliente: {ruta.client || 'General'}</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                          {ruta.technicalData && (<span className={`text-[10px] font-mono font-bold ${darkMode ? 'text-green-400' : 'text-green-600'}`}>{ruta.technicalData.totalDistance} km • {ruta.technicalData.totalDuration} min</span>)}
                          {ruta.serviceType === 'Programado' && (<span className={`text-[10px] font-mono font-bold flex items-center gap-1 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}><Calendar className="w-3 h-3"/> {ruta.scheduledDate} {ruta.scheduledTime}</span>)}
                      </div>
                    </div>
                  </div>
                  <div className={`p-2 rounded-full ${darkMode ? 'bg-slate-800' : 'bg-slate-50'}`}><ChevronRight className="w-4 h-4 text-blue-500" /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- VISTA 2: SI ESTÁ EN REGISTRO ---
  if (isRegistering) {
    return (
      <div className={`min-h-screen p-8 font-sans overflow-y-auto transition-colors ${theme.bg} ${theme.text}`}>
        <button onClick={() => setIsRegistering(false)} className="mb-6 flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-[0.2em]"><ChevronLeft className="w-4 h-4"/> Volver</button>
        <div className="mb-8"><h1 className="text-3xl font-black tracking-tight">Registro de Operador</h1><p className="text-slate-500 text-xs mt-1">Completa tu expediente.</p></div>
        <form onSubmit={handleRegister} className="space-y-4 pb-10">
          <div className="space-y-3">
            <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">Identidad</p>
            <div className="relative group"><User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4"/><input type="text" placeholder="Nombre completo" className={`w-full p-4 pl-12 rounded-2xl text-sm outline-none border transition-all ${theme.input}`} value={name} onChange={e => setName(e.target.value)} /></div>
            <div className="relative group"><Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4"/><input type="email" placeholder="Correo electrónico" className={`w-full p-4 pl-12 rounded-2xl text-sm outline-none border transition-all ${theme.input}`} value={email} onChange={e => setEmail(e.target.value)} /></div>
            <div className="relative group"><Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4"/><input type="password" placeholder="Contraseña de acceso" className={`w-full p-4 pl-12 rounded-2xl text-sm outline-none border transition-all ${theme.input}`} value={password} onChange={e => setPassword(e.target.value)} /></div>
          </div>
          <div className="space-y-3 pt-2">
            <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">Unidad</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative group"><Truck className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4"/><input type="text" placeholder="Modelo" className={`w-full p-4 pl-12 rounded-2xl text-sm outline-none border transition-all ${theme.input}`} value={vehicleModel} onChange={e => setVehicleModel(e.target.value)} /></div>
              <input type="text" placeholder="Placas" className={`w-full p-4 rounded-2xl text-sm outline-none border transition-all uppercase ${theme.input}`} value={vehiclePlate} onChange={e => setVehiclePlate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-3 pt-2">
            <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">Documentos</p>
            <div className="relative group"><Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4"/><input type="text" placeholder="WhatsApp" className={`w-full p-4 pl-12 rounded-2xl text-sm outline-none border transition-all ${theme.input}`} value={phone} onChange={e => setPhone(e.target.value)} /></div>
            <div className="relative group"><FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4"/><input type="text" placeholder="No. de Licencia" className={`w-full p-4 pl-12 rounded-2xl text-sm outline-none border transition-all ${theme.input}`} value={license} onChange={e => setLicense(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-4">
            <div className={`flex flex-col items-center justify-center p-4 border rounded-3xl border-dashed ${theme.card}`}><Camera className="w-6 h-6 text-slate-400 mb-2" /><span className="text-[8px] font-bold text-slate-500 uppercase">Selfie</span></div>
            <div className={`flex flex-col items-center justify-center p-4 border rounded-3xl border-dashed ${theme.card}`}><CreditCard className="w-6 h-6 text-slate-400 mb-2" /><span className="text-[8px] font-bold text-slate-500 uppercase">Foto ID</span></div>
          </div>
          {error && <p className="text-red-500 text-[10px] font-bold bg-red-50 p-4 rounded-2xl border border-red-100 text-center">{error}</p>}
          <button type="submit" disabled={loading} className="w-full bg-slate-900 text-white p-5 rounded-[2rem] font-black uppercase tracking-[0.2em] text-[10px] shadow-xl mt-4 active:scale-95 transition-all">{loading ? <Loader2 className="animate-spin mx-auto w-4 h-4"/> : 'Solicitar Aprobación'}</button>
        </form>
      </div>
    );
  }

  // --- VISTA 3: LOGIN ---
  return (
    <div className={`min-h-screen flex flex-col items-center justify-between p-8 transition-colors ${theme.bg} ${theme.text}`}>
      <div className="flex flex-col items-center mt-12 w-full max-w-sm">
        <div className="w-24 h-24 bg-blue-600 rounded-[2.2rem] flex items-center justify-center mb-8 shadow-2xl rotate-6 shadow-blue-500/30"><Truck className="w-12 h-12 text-white" /></div>
        <h1 className="text-4xl font-black tracking-tighter italic">LOGÍSTICA</h1>
      </div>
      <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
        <div className="relative"><Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4"/><input type="email" placeholder="Email" className={`w-full p-5 pl-12 rounded-[1.8rem] text-sm outline-none border transition-all ${theme.input}`} value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="relative"><Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4"/><input type="password" placeholder="Contraseña" className={`w-full p-5 pl-12 rounded-[1.8rem] text-sm outline-none border transition-all ${theme.input}`} value={password} onChange={e => setPassword(e.target.value)} /></div>
        {error && <p className="text-red-500 text-[10px] font-bold text-center bg-red-50 p-3 rounded-xl border border-red-100">{error}</p>}
        <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white font-black p-5 rounded-[1.8rem] shadow-xl hover:bg-blue-700 transition-all active:scale-95">{loading ? <Loader2 className="animate-spin mx-auto w-4 h-4"/> : 'INICIAR SESIÓN'}</button>
        <button type="button" onClick={() => setIsRegistering(true)} className="w-full text-slate-500 font-bold text-[10px] py-4 uppercase tracking-widest hover:text-blue-600 transition-colors">¿Nuevo Operador? <span className="text-blue-600">Regístrate</span></button>
      </form>
      <div className="mb-4 flex flex-col items-center gap-4 w-full">
        <button onClick={() => setDarkMode(!darkMode)} className="flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:bg-slate-100 transition-colors">{darkMode ? <Sun className="w-3 h-3"/> : <Moon className="w-3 h-3"/>}{darkMode ? 'Modo Claro' : 'Modo Oscuro'}</button>
        <div className={`flex items-center gap-2 px-5 py-2.5 rounded-full border ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}><div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div><span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Terminal Segura</span></div>
      </div>
    </div>
  );
}

export default App;