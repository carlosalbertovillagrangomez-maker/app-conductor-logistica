importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

// 1. Configuramos Firebase con los datos de tu proyecto
firebase.initializeApp({
  apiKey: "AIzaSyDCWNc2Lqh4Girn2PHU4Xiy9e-O2JCa8Gk",
  authDomain: "sistema-transporte-dec9d.firebaseapp.com",
  projectId: "sistema-transporte-dec9d",
  storageBucket: "sistema-transporte-dec9d.firebasestorage.app",
  messagingSenderId: "779301031888",
  appId: "1:779301031888:web:e70a41af33d02fad27b3d5"
});

const messaging = firebase.messaging();

// 2. El "Cartero" escucha la alarma cuando el celular está bloqueado
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Mensaje recibido en segundo plano', payload);
  
  const notificationTitle = payload.notification.title || "¡NUEVO VIAJE!";
  const notificationOptions = {
    body: payload.notification.body || "Revisa la app, tienes un viaje prioritario cerca.",
    icon: '/vite.svg', 
    badge: '/vite.svg',
    vibrate: [500, 200, 500, 200, 1000], // Patrón de vibración de alarma
    requireInteraction: true // Obliga al usuario a tocar o cerrar la notificación
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});