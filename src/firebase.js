import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage
} from "firebase/messaging";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

const firebaseConfig = {
  apiKey: "AIzaSyDCWNc2Lqh4Girn2PHU4Xiy9e-O2JCa8Gk",
  authDomain: "sistema-transporte-dec9d.firebaseapp.com",
  projectId: "sistema-transporte-dec9d",
  storageBucket: "sistema-transporte-dec9d.firebasestorage.app",
  messagingSenderId: "779301031888",
  appId: "1:779301031888:web:e70a41af33d02fad27b3d5"
};

const VAPID_KEY = "RfcfCzSCQyC5wI1obDI4iGhE9HSjHRGxE_5sy0di42s";
const CHANNEL_ID = "triplogix_high_priority";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

let nativeTokenCache = "";
let webMessagingCache = null;

const isNativeApp = () => Capacitor.isNativePlatform();

const createAndroidNotificationChannel = async () => {
  if (!isNativeApp() || Capacitor.getPlatform() !== "android") return;

  try {
    await PushNotifications.createChannel({
      id: CHANNEL_ID,
      name: "Servicios TripLogix",
      description: "Asignaciones de viajes, alertas y actualizaciones importantes.",
      importance: 5,
      visibility: 1,
      vibration: true
    });
  } catch (error) {
    console.warn("No se pudo crear el canal de notificaciones:", error);
  }
};

const getWebMessaging = async () => {
  if (typeof window === "undefined") return null;
  if (!(await isSupported())) return null;

  if (!webMessagingCache) {
    webMessagingCache = getMessaging(app);
  }

  return webMessagingCache;
};

const requestNativeToken = async () => {
  if (nativeTokenCache) return nativeTokenCache;

  await createAndroidNotificationChannel();

  let permission = await PushNotifications.checkPermissions();

  if (permission.receive === "prompt") {
    permission = await PushNotifications.requestPermissions();
  }

  if (permission.receive !== "granted") {
    throw new Error("El permiso de notificaciones fue rechazado.");
  }

  return new Promise(async (resolve, reject) => {
    let registrationHandle;
    let errorHandle;
    let settled = false;

    const cleanup = async () => {
      try {
        await registrationHandle?.remove();
        await errorHandle?.remove();
      } catch (_) {}
    };

    const finish = async (callback) => {
      if (settled) return;
      settled = true;
      await cleanup();
      callback();
    };

    registrationHandle = await PushNotifications.addListener(
      "registration",
      (token) => {
        nativeTokenCache = token.value || "";
        finish(() => resolve(nativeTokenCache));
      }
    );

    errorHandle = await PushNotifications.addListener(
      "registrationError",
      (error) => {
        finish(() => reject(new Error(error?.error || "No se pudo registrar FCM.")));
      }
    );

    try {
      await PushNotifications.register();
    } catch (error) {
      finish(() => reject(error));
    }

    setTimeout(() => {
      finish(() => reject(new Error("Tiempo agotado registrando notificaciones.")));
    }, 15000);
  });
};

const requestWebToken = async () => {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return null;
  }

  let permission = Notification.permission;

  if (permission === "default") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    throw new Error("El permiso de notificaciones fue rechazado.");
  }

  const messaging = await getWebMessaging();
  if (!messaging) return null;

  let serviceWorkerRegistration;

  if ("serviceWorker" in navigator) {
    serviceWorkerRegistration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js"
    );
  }

  return getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration
  });
};

export const requestForToken = async () => {
  try {
    return isNativeApp()
      ? await requestNativeToken()
      : await requestWebToken();
  } catch (error) {
    console.error("Error al pedir token de notificaciones:", error);
    return null;
  }
};

export const setupPushNotifications = async ({
  onToken,
  onNotification,
  onAction
} = {}) => {
  const cleanupHandles = [];

  if (isNativeApp()) {
    await createAndroidNotificationChannel();

    cleanupHandles.push(
      await PushNotifications.addListener("registration", (token) => {
        nativeTokenCache = token.value || "";
        onToken?.(nativeTokenCache);
      })
    );

    cleanupHandles.push(
      await PushNotifications.addListener("registrationError", (error) => {
        console.error("Error registrando notificaciones:", error);
      })
    );

    cleanupHandles.push(
      await PushNotifications.addListener(
        "pushNotificationReceived",
        (notification) => {
          onNotification?.(notification);
        }
      )
    );

    cleanupHandles.push(
      await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action) => {
          onAction?.(action);
        }
      )
    );

    let permission = await PushNotifications.checkPermissions();

    if (permission.receive === "prompt") {
      permission = await PushNotifications.requestPermissions();
    }

    if (permission.receive === "granted") {
      await PushNotifications.register();
    }

    return async () => {
      await Promise.all(
        cleanupHandles.map((handle) =>
          handle?.remove?.().catch(() => {})
        )
      );
    };
  }

  const token = await requestWebToken();
  if (token) onToken?.(token);

  const messaging = await getWebMessaging();
  if (messaging) {
    const unsubscribe = onMessage(messaging, (payload) => {
      onNotification?.(payload);
    });

    return async () => {
      unsubscribe?.();
    };
  }

  return async () => {};
};
