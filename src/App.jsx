import React, { useState, useEffect } from 'react';
import { 
  Truck, LogIn, ShieldCheck, Mail, Lock, Loader2, 
  AlertCircle, LogOut, MapPin, User, Phone, 
  FileText, ChevronLeft, Camera, CreditCard,
  Sun, Moon, Package, Clock, ChevronRight, CheckCircle2, Zap, Calendar, Navigation, MoreVertical, Play, Save,
  Heart, ShieldAlert, Hash, CheckCircle
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
  const [filterType, setFilterType] = useState('Todos');
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  // --- ESTADOS PARA EL EXPEDIENTE ---
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [rfc, setRfc] = useState('');
  const [bloodType, setBloodType] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseType, setLicenseType] = useState('');
  const [licenseExp, setLicenseExp] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleType, setVehicleType] = useState('');

  useEffect(() => {
    const savedDriver = localStorage.getItem('driver_session');
    if (savedDriver) {
      const driverData = JSON.parse(savedDriver);
      setCurrentDriver(driverData);
      cargarDatosEnFormulario(driverData);
      escucharRutas(driverData.id);
    }
    setIsReady(true);
  }, []);

  const cargarDatosEnFormulario = (data) => {
    setName(data.name || '');
    setPhone(data.phone || '');
    setAddress(data.address || '');
    setRfc(data.rfc || '');
    setBloodType(data.bloodType || '');
    setEmergencyContact(data.emergencyContact || '');
    setLicenseNumber(data.licenseNumber || '');
    setLicenseType(data.licenseType || '');
    setLicenseExp(data.licenseExp || '');
    setVehicleModel(data.vehicleModel || '');
    setVehiclePlate(data.vehiclePlate || '');
    setVehicleType(data.vehicleType || '');
    setEmail(data.email || '');
    setPassword(data.password || '');
  };

  const escucharRutas = (driverId) => {
    // Escucha rutas filtrando por driverId
    const q = query(collection(db, "rutas"), where("driverId", "==", driverId));
    return onSnapshot(q, (snapshot) => {
      setMisRutas(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
  };

  // --- ACCIONES DE VIAJE ---
  const handleStartTrip = async (routeId) => {
    if (!confirm("¿Deseas iniciar este viaje ahora?")) return;
    try {
      await updateDoc(doc(db, "rutas", routeId), { 
        status: 'En Ruta', 
        startTime: new Date().toISOString() 
      });
      setSelectedRoute(prev => ({ ...prev, status: 'En Ruta' }));
    } catch (e) { alert("Error al iniciar"); }
  };

  const handleEndTrip = async (routeId) => {
    if (!confirm("¿Has completado todas las entregas de esta ruta?")) return;
    try {
      await updateDoc(doc(db, "rutas", routeId), { 
        status: 'Finalizado', 
        endTime: new Date().toISOString() 
      });
      setSelectedRoute(prev => ({ ...prev, status: 'Finalizado' }));
      alert("¡Ruta finalizada con éxito!");
    } catch (e) { alert("Error al finalizar"); }
  };

  // --- PERFIL, LOGIN Y REGISTRO ---
  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const driverRef = doc(db, "conductores", currentDriver.id);
      const updatedData = {
        name: name.trim(), phone: phone.trim(), address: address.trim(),
        rfc: rfc.trim().toUpperCase(), bloodType: bloodType.trim().toUpperCase(),
        emergencyContact: emergencyContact.trim(), licenseNumber: licenseNumber.trim(),
        licenseType: licenseType.trim(), licenseExp: licenseExp,
        vehicleModel: vehicleModel.trim(), vehiclePlate: vehiclePlate.trim().toUpperCase(),
        vehicleType: vehicleType.trim(), vehicle: `${vehicleModel} (${vehiclePlate.toUpperCase()})`,
        initials: name.substring(0, 2).toUpperCase(),
      };
      await updateDoc(driverRef, updatedData);
      const newState = { ...currentDriver, ...updatedData };
      setCurrentDriver(newState);
      localStorage.setItem('driver_session', JSON.stringify(newState));
      setIsEditingProfile(false);
      alert("Perfil actualizado");
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const nuevoConductor = {
        name: name.trim(), email: email.trim().toLowerCase(), password,
        phone: phone.trim(), address: address.trim(), rfc: rfc.toUpperCase(),
        bloodType: bloodType.toUpperCase(), emergencyContact, licenseNumber,
        licenseType, licenseExp, vehicleModel, vehiclePlate: vehiclePlate.toUpperCase(),
        vehicleType, vehicle: `${vehicleModel} (${vehiclePlate.toUpperCase()})`,
        status: 'Pendiente', initials: name.substring(0, 2).toUpperCase(),
        created: new Date().toISOString(), trips: 0, rating: 5
      };
      await addDoc(collection(db, "conductores"), nuevoConductor);
      alert("Registro enviado a revisión");
      setIsRegistering(false);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    const q = query(collection(db, "conductores"), where("email", "==", email.trim().toLowerCase()));
    const snap = await getDocs(q);
    if (snap.empty) { setError('Usuario no encontrado'); setLoading(false); return; }
    const data = { id: snap.docs[0].id, ...snap.docs[0].data() };
    if (data.password === password && data.status === 'Aprobado') {
      setCurrentDriver(data);
      localStorage.setItem('driver_session', JSON.stringify(data));
      cargarDatosEnFormulario(data);
      escucharRutas(data.id);
    } else { setError('Credenciales inválidas o cuenta no aprobada'); }
    setLoading(false);
  };

  const openGoogleMaps = (ruta) => {
    const origin = encodeURIComponent(ruta.start);
    const destination = encodeURIComponent(ruta.end);
    let waypoints = ruta.waypoints?.length > 0 ? '&waypoints=' + ruta.waypoints.map(wp => encodeURIComponent(wp)).join('|') : '';
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints}&travelmode=driving`, '_blank');
  };

  if (!isReady) return null;

  const theme = {
    bg: darkMode ? 'bg-slate-950' : 'bg-slate-50',
    text: darkMode ? 'text-white' : 'text-slate-900',
    card: darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200',
    input: darkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900',
    subtext: darkMode ? 'text-slate-500' : 'text-slate-400'
  };

  // --- VISTA DETALLE DEL VIAJE (CORREGIDA) ---
  if (currentDriver && selectedRoute) {
    return (
      <div className={`min-h-screen flex flex-col font-sans transition-colors ${theme.bg} ${theme.text}`}>
        <div className={`p-5 flex items-center gap-4 sticky top-0 z-10 backdrop-blur-md border-b ${darkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-white/80 border-slate-200'}`}>
          <button onClick={() => setSelectedRoute(null)} className="p-2 rounded-full border border-slate-200 dark:border-slate-700"><ChevronLeft className="w-5 h-5" /></button>
          <div><h2 className="text-sm font-bold">Detalle de Ruta</h2><p className={`text-[10px] uppercase font-bold text-blue-500`}>{selectedRoute.client}</p></div>
        </div>

        <div className="flex-1 p-6 space-y-6 overflow-y-auto pb-40">
          <div className={`p-5 rounded-[2rem] border ${theme.card} flex justify-between items-center`}>
             <div>
                <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Estatus actual</p>
                <div className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-2 ${
                    selectedRoute.status === 'Finalizado' ? 'bg-slate-100 text-slate-600' :
                    selectedRoute.status === 'En Ruta' ? 'bg-green-100 text-green-700 animate-pulse' : 'bg-blue-100 text-blue-700'
                }`}>
                   {selectedRoute.status === 'Finalizado' ? <CheckCircle2 className="w-3 h-3"/> : <Play className="w-3 h-3"/>}
                   {selectedRoute.status || 'Pendiente'}
                </div>
             </div>
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
           {selectedRoute.status === 'Pendiente' || !selectedRoute.status ? (
             <button onClick={() => handleStartTrip(selectedRoute.id)} className="w-full bg-green-600 text-white font-black p-4 rounded-2xl shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all"><Play className="w-5 h-5 fill-white"/> INICIAR VIAJE</button>
           ) : selectedRoute.status === 'En Ruta' ? (
             <button onClick={() => handleEndTrip(selectedRoute.id)} className="w-full bg-red-600 text-white font-black p-4 rounded-2xl shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all"><CheckCircle className="w-5 h-5"/> TERMINAR SERVICIO</button>
           ) : (
             <div className="w-full bg-slate-100 text-slate-400 font-black p-4 rounded-2xl flex items-center justify-center gap-2 cursor-not-allowed"><CheckCircle2 className="w-5 h-5"/> SERVICIO COMPLETADO</div>
           )}
           <button onClick={() => openGoogleMaps(selectedRoute)} className={`w-full font-black p-4 rounded-2xl border flex items-center justify-center gap-2 ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}><Navigation className="w-5 h-5 text-blue-500"/> ABRIR MAPAS</button>
        </div>
      </div>
    );
  }

  // --- VISTA PERFIL (Sincronizada con imágenes) ---
  if (currentDriver && isEditingProfile) {
    return (
      <div className={`min-h-screen flex flex-col font-sans transition-colors ${theme.bg} ${theme.text}`}>
        <div className={`p-5 flex items-center gap-4 border-b sticky top-0 z-20 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} backdrop-blur-md`}>
          <button onClick={() => setIsEditingProfile(false)} className="p-2 rounded-full border border-slate-200 dark:border-slate-700"><ChevronLeft className="w-5 h-5"/></button>
          <h2 className="text-sm font-bold">Mi Expediente</h2>
        </div>
        <form onSubmit={handleUpdateProfile} className="flex-1 p-6 space-y-8 overflow-y-auto pb-32">
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase text-blue-500 tracking-widest"><User className="inline w-3 h-3 mb-1"/> Datos de Identidad</p>
            <input type="text" placeholder="Nombre completo" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={name} onChange={e => setName(e.target.value)} />
            <div className="grid grid-cols-2 gap-4"><input type="text" placeholder="RFC" className={`w-full p-4 rounded-2xl text-sm border uppercase ${theme.input}`} value={rfc} onChange={e => setRfc(e.target.value)} /><input type="text" placeholder="WhatsApp" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={phone} onChange={e => setPhone(e.target.value)} /></div>
            <input type="text" placeholder="Dirección completa" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={address} onChange={e => setAddress(e.target.value)} />
          </div>
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase text-orange-500 tracking-widest"><Truck className="inline w-3 h-3 mb-1"/> Unidad</p>
            <input type="text" placeholder="Modelo de Vehículo" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={vehicleModel} onChange={e => setVehicleModel(e.target.value)} />
            <div className="grid grid-cols-2 gap-4"><input type="text" placeholder="Placas" className={`w-full p-4 rounded-2xl text-sm border uppercase ${theme.input}`} value={vehiclePlate} onChange={e => setVehiclePlate(e.target.value)} /><input type="text" placeholder="Tipo" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={vehicleType} onChange={e => setVehicleType(e.target.value)} /></div>
          </div>
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase text-purple-500 tracking-widest"><FileText className="inline w-3 h-3 mb-1"/> Licencia</p>
            <input type="text" placeholder="Número" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} />
            <div className="grid grid-cols-2 gap-4"><input type="text" placeholder="Tipo" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={licenseType} onChange={e => setLicenseType(e.target.value)} /><input type="text" placeholder="Vigencia" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={licenseExp} onChange={e => setLicenseExp(e.target.value)} /></div>
          </div>
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase text-red-500 tracking-widest"><ShieldAlert className="inline w-3 h-3 mb-1"/> Salud</p>
            <div className="grid grid-cols-2 gap-4"><input type="text" placeholder="Sangre" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={bloodType} onChange={e => setBloodType(e.target.value)} /><input type="text" placeholder="Tel. Emergencia" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} /></div>
          </div>
        </form>
        <div className="p-5 border-t fixed bottom-0 left-0 right-0 bg-inherit z-30">
          <button onClick={handleUpdateProfile} disabled={loading} className="w-full bg-blue-600 text-white font-black p-5 rounded-3xl shadow-xl flex items-center justify-center gap-2">{loading ? <Loader2 className="animate-spin w-5 h-5"/> : <><Save className="w-5 h-5"/> GUARDAR EXPEDIENTE</>}</button>
        </div>
      </div>
    );
  }

  // --- VISTA LISTADO ---
  if (currentDriver) {
    const rFiltradas = misRutas.filter(x => filterType === 'Todos' || x.serviceType === filterType).sort((a,b) => new Date(`${a.scheduledDate || '2099-12-31'}T${a.scheduledTime || '00:00'}`) - new Date(`${b.scheduledDate || '2099-12-31'}T${b.scheduledTime || '00:00'}`));

    return (
      <div className={`min-h-screen transition-colors duration-300 flex flex-col font-sans ${theme.bg} ${theme.text}`}>
        <div className={`p-5 flex justify-between items-center shadow-sm border-b ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <button onClick={() => setIsEditingProfile(true)} className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black shadow-lg shadow-blue-500/20">{currentDriver.initials}</div>
            <div className="text-left"><h2 className="text-xs font-bold leading-tight">{currentDriver.name}</h2><p className="text-[8px] uppercase tracking-tighter text-slate-400">Mi Perfil</p></div>
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => setDarkMode(!darkMode)} className="p-2">{darkMode ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-slate-500" />}</button>
            <button onClick={() => { localStorage.removeItem('driver_session'); setCurrentDriver(null); }} className="p-2 text-slate-400"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="px-6 pt-6 pb-2">
            <div className={`flex p-1 rounded-xl ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100'}`}>
                {['Todos', 'Prioritario', 'Programado'].map((tipo) => (
                    <button key={tipo} onClick={() => setFilterType(tipo)} className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${filterType === tipo ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>{tipo}</button>
                ))}
            </div>
        </div>

        <div className="flex-1 p-6 space-y-4 overflow-y-auto">
          {rFiltradas.length === 0 ? <div className="text-center py-20 text-slate-400 text-sm">Sin servicios asignados</div> : rFiltradas.map(ruta => (
            <div key={ruta.id} onClick={() => setSelectedRoute(ruta)} className={`p-5 rounded-[2rem] border transition-all flex items-center justify-between active:scale-95 shadow-sm cursor-pointer ${theme.card} ${ruta.serviceType === 'Prioritario' ? 'border-l-4 border-l-yellow-400' : ''}`}>
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${ruta.serviceType === 'Prioritario' ? 'bg-yellow-100 text-yellow-600' : 'bg-blue-50 text-blue-600'}`}>{ruta.serviceType === 'Prioritario' ? <Zap className="w-6 h-6" /> : <MapPin className="w-6 h-6" />}</div>
                <div><h4 className="font-bold text-sm tracking-tight line-clamp-1">{ruta.end || ruta.destino}</h4><p className="text-[10px] text-slate-400 font-bold uppercase">Cliente: {ruta.client}</p></div>
              </div>
              <ChevronRight className="w-4 h-4 text-blue-500" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- VISTA REGISTRO ---
  if (isRegistering) {
    return (
      <div className={`min-h-screen p-8 font-sans overflow-y-auto transition-colors ${theme.bg} ${theme.text}`}>
        <button onClick={() => setIsRegistering(false)} className="mb-6 flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-widest"><ChevronLeft className="w-4 h-4"/> Volver</button>
        <h1 className="text-3xl font-black tracking-tight mb-8">Nuevo Operador</h1>
        <form onSubmit={handleRegister} className="space-y-6 pb-12">
          <input type="text" placeholder="Nombre completo *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={name} onChange={e => setName(e.target.value)} required />
          <input type="email" placeholder="Correo electrónico *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={email} onChange={e => setEmail(e.target.value)} required />
          <input type="password" placeholder="Contraseña *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={password} onChange={e => setPassword(e.target.value)} required />
          <input type="text" placeholder="RFC *" className={`w-full p-4 rounded-2xl text-sm border uppercase ${theme.input}`} value={rfc} onChange={e => setRfc(e.target.value)} required />
          <div className="grid grid-cols-2 gap-4"><input type="text" placeholder="Modelo Vehículo *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={vehicleModel} onChange={e => setVehicleModel(e.target.value)} required /><input type="text" placeholder="Placas *" className={`w-full p-4 rounded-2xl text-sm border uppercase ${theme.input}`} value={vehiclePlate} onChange={e => setVehiclePlate(e.target.value)} required /></div>
          <input type="text" placeholder="Licencia *" className={`w-full p-4 rounded-2xl text-sm border ${theme.input}`} value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} required />
          {error && <p className="text-red-500 text-xs text-center">{error}</p>}
          <button type="submit" disabled={loading} className="w-full bg-slate-900 text-white p-5 rounded-3xl font-black uppercase text-[10px] shadow-xl">{loading ? <Loader2 className="animate-spin mx-auto w-5 h-5"/> : 'Enviar Registro'}</button>
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
        <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white font-black p-5 rounded-[1.8rem] shadow-xl">{loading ? <Loader2 className="animate-spin mx-auto w-4 h-4"/> : 'INICIAR SESIÓN'}</button>
        <button type="button" onClick={() => setIsRegistering(true)} className="w-full text-slate-500 font-bold text-[10px] py-4">¿Nuevo? <span className="text-blue-600">Regístrate</span></button>
      </form>
    </div>
  );
}

export default App;