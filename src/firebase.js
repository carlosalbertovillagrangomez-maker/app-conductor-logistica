import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyDCWNc2Lqh4Girn2PHU4Xiy9e-O2JCa8Gk",
  authDomain: "sistema-transporte-dec9d.firebaseapp.com",
  projectId: "sistema-transporte-dec9d",
  storageBucket: "sistema-transporte-dec9d.firebasestorage.app",
  messagingSenderId: "779301031888",
  appId: "1:779301031888:web:e70a41af33d02fad27b3d5"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Inicializamos Messaging
export const messaging = typeof window !== 'undefined' ? getMessaging(app) : null;

// Función para pedir permiso y obtener el Token Push del celular
export const requestForToken = async () => {
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const currentToken = await getToken(messaging, {
        // AQUÍ VA TU LLAVE MAESTRA VAPID
        vapidKey: 'RfcfCzSCQyC5wI1obDI4iGhE9HSjHRGxE_5sy0di42s' 
      });
      
      if (currentToken) {
        return currentToken;
      } else {
        console.log('No se pudo obtener el token.');
      }
    } else {
      console.log('El usuario denegó los permisos de notificación.');
    }
  } catch (err) {
    console.error('Error al pedir token de notificaciones', err);
  }
  return null;
};