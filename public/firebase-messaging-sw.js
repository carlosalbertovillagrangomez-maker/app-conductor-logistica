/* public/firebase-messaging-sw.js */
importScripts("https://www.gstatic.com/firebasejs/12.9.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDCWNc2Lqh4Girn2PHU4Xiy9e-O2JCa8Gk",
  authDomain: "sistema-transporte-dec9d.firebaseapp.com",
  projectId: "sistema-transporte-dec9d",
  storageBucket: "sistema-transporte-dec9d.firebasestorage.app",
  messagingSenderId: "779301031888",
  appId: "1:779301031888:web:e70a41af33d02fad27b3d5"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "Nuevo servicio TripLogix";
  const options = {
    body: payload?.notification?.body || "Tienes una nueva asignación.",
    icon: "/logo.png",
    badge: "/logo.png",
    data: payload?.data || {}
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
