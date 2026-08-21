import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Truck, LogIn, ShieldCheck, Mail, Lock, Loader2, 
  AlertCircle, LogOut, MapPin, User, Phone, 
  FileText, ChevronLeft, Camera, CreditCard,
  Sun, Moon, Package, Clock, ChevronRight, CheckCircle2, Zap, Calendar, Navigation, MoreVertical, Play, Save,
  Heart, ShieldAlert, Hash, CheckCircle, LocateFixed, Navigation2, BellRing, MessageSquare, Send, Power, PowerOff, X, Volume2, VolumeX, Download, Share2
} from 'lucide-react';
import { db, requestForToken, setupPushNotifications } from './firebase';
import { collection, query, where, getDocs, getDoc, addDoc, onSnapshot, updateDoc, doc, arrayUnion, increment } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

// --- GOOGLE MAPS ---
import { GoogleMap, useJsApiLoader, Marker, Polyline } from '@react-google-maps/api';
import { jsPDF } from 'jspdf';
const GOOGLE_MAPS_API_KEY = "AIzaSyA-t6YcuPK1PdOoHZJOyOsw6PK0tCDJrn0";
const GOOGLE_VECTOR_MAP_ID = "73f56298887c80075f6fc648";
const containerStyle = { width: '100%', height: '100%' };
const centerMX = { lat: 19.4326, lng: -99.1332 };
const libraries = ['places', 'geometry'];

const ICON_START = "https://maps.google.com/mapfiles/ms/icons/green-dot.png";
const ICON_WAYPOINT = "https://maps.google.com/mapfiles/ms/icons/blue-dot.png";
const ICON_END = "https://maps.google.com/mapfiles/ms/icons/red-dot.png";

const NAV_MAP_OPTIONS = {
    mapId: GOOGLE_VECTOR_MAP_ID,
    disableDefaultUI: true,
    gestureHandling: "greedy",
    backgroundColor: "#e2e8f0",
    clickableIcons: false,
    keyboardShortcuts: false,
    mapTypeControl: false,
    fullscreenControl: false,
    streetViewControl: false,
    rotateControl: false,
    tilt: 0,
    heading: 0
};

const NAV_POLYLINE_OPTIONS = {
    strokeColor: "#f97316",
    strokeOpacity: 0.92,
    strokeWeight: 6
};


const DRIVER_MARKER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    <filter id="s" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <circle cx="32" cy="32" r="27" fill="#ffffff" filter="url(#s)"/>
  <circle cx="32" cy="32" r="22" fill="#f97316"/>
  <path d="M20 35h24l-2.5-9.5c-.6-2.1-2.5-3.5-4.7-3.5h-9.6c-2.2 0-4.1 1.4-4.7 3.5L20 35Z" fill="#ffffff"/>
  <rect x="18" y="33" width="28" height="10" rx="4" fill="#ffffff"/>
  <circle cx="24" cy="43" r="4" fill="#0f172a"/>
  <circle cx="40" cy="43" r="4" fill="#0f172a"/>
  <rect x="26" y="25" width="12" height="6" rx="2" fill="#bae6fd"/>
  <path d="M32 10l5 8h-3v5h-4v-5h-3l5-8Z" fill="#ffffff"/>
</svg>`;

const getDriverMarkerIcon = () => {
    try {
        if (!window.google?.maps) return ICON_START;
        return {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(DRIVER_MARKER_SVG)}`,
            scaledSize: new window.google.maps.Size(48, 48),
            anchor: new window.google.maps.Point(24, 24)
        };
    } catch (e) {
        return ICON_START;
    }
};


// =========================================================================
// TRIPLOGIX: TARIFA Y COMPROBANTE OFICIAL DE VIAJE (NO FISCAL)
// La estructura se inspira en plataformas de movilidad: tarifa base + distancia
// + tiempo + cuota operativa + ajustes autorizados. Las tarifas son propias de
// TripLogix y se concentran aquí para poder cambiarlas sin tocar el resto de la app.
// =========================================================================
const TRIPLOGIX_RECEIPT_CONFIG = Object.freeze({
    brandName: 'TripLogix',
    slogan: 'Movilidad inteligente, segura y regulada',
    currency: 'MXN',
    baseFare: 35,
    perKm: 15,
    perMinute: 1.5,
    serviceFee: 12,
    minimumFare: 75,
    defaultDemandMultiplier: 1
});

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const getTimestampMs = (value) => {
    if (!value) return null;
    try {
        if (typeof value?.toDate === 'function') return value.toDate().getTime();
        if (value instanceof Date) return value.getTime();
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : null;
    } catch (e) {
        return null;
    }
};

const getTripDistanceKmForReceipt = (route) => {
    const candidates = [
        route?.receipt?.distanceKm,
        route?.officialGoogleDistanceKm,
        route?.googleMatchedDistanceKm,
        route?.realDistanceDriven,
        route?.actualDistanceKm,
        route?.technicalData?.actualDistance,
        route?.technicalData?.totalDistance
    ];

    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return roundMoney(value);
    }

    return 0;
};

const getTripDurationMinutesForReceipt = (route, forcedEndTimestamp = null) => {
    const startMs = getTimestampMs(
        route?.actualStartTimestamp ||
        route?.navigationStartedAt ||
        route?.startedAt
    );

    const endMs = getTimestampMs(
        forcedEndTimestamp ||
        route?.actualEndTimestamp ||
        route?.finishedAt ||
        route?.receipt?.actualEndTimestamp
    );

    if (startMs && endMs && endMs > startMs) {
        return Math.max(1, Math.round((endMs - startMs) / 60000));
    }

    const candidates = [
        route?.receipt?.durationMinutes,
        route?.actualDurationMinutes,
        route?.technicalData?.actualDuration,
        route?.technicalData?.totalDuration
    ];

    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return Math.max(1, Math.round(value));
    }

    return 0;
};

const calculateTripLogixFare = (route, overrides = {}) => {
    const distanceKm = Number.isFinite(Number(overrides.distanceKm))
        ? Number(overrides.distanceKm)
        : getTripDistanceKmForReceipt(route);

    const durationMinutes = Number.isFinite(Number(overrides.durationMinutes))
        ? Number(overrides.durationMinutes)
        : getTripDurationMinutesForReceipt(route, overrides.actualEndTimestamp);

    const configuredPricing = route?.pricing || {};
    const pricingCurrency = String(
        configuredPricing.currency ||
        route?.currency ||
        route?.serviceCurrency ||
        TRIPLOGIX_RECEIPT_CONFIG.currency
    ).toUpperCase();

    const quotedTotal = Number(
        configuredPricing.quotedTotal ??
        configuredPricing.initialQuote ??
        route?.quotedTotal ??
        route?.initialQuotedTotal
    );
    const fixedQuote = Boolean(
        configuredPricing.fixedQuote === true ||
        configuredPricing.recalculateAtEnd === false ||
        route?.recalculateAtEnd === false ||
        route?.pricingMode === 'fixed_quote'
    );

    const baseFare = Number(configuredPricing.baseFare ?? TRIPLOGIX_RECEIPT_CONFIG.baseFare);
    const perKm = Number(configuredPricing.perKm ?? TRIPLOGIX_RECEIPT_CONFIG.perKm);
    const perMinute = Number(configuredPricing.perMinute ?? TRIPLOGIX_RECEIPT_CONFIG.perMinute);
    const serviceFee = Number(configuredPricing.serviceFee ?? TRIPLOGIX_RECEIPT_CONFIG.serviceFee);
    const minimumFare = Number(configuredPricing.minimumFare ?? TRIPLOGIX_RECEIPT_CONFIG.minimumFare);
    const tolls = Math.max(0, Number(route?.tolls ?? configuredPricing.tolls ?? 0) || 0);

    const demandMultiplierRaw = Number(
        route?.demandMultiplier ??
        route?.surgeMultiplier ??
        configuredPricing.demandMultiplier ??
        TRIPLOGIX_RECEIPT_CONFIG.defaultDemandMultiplier
    );
    const demandMultiplier = Math.min(3, Math.max(1, Number.isFinite(demandMultiplierRaw) ? demandMultiplierRaw : 1));

    const baseAmount = roundMoney(baseFare);
    const distanceAmount = roundMoney(distanceKm * perKm);
    const timeAmount = roundMoney(durationMinutes * perMinute);
    const standardVariableFare = roundMoney(baseAmount + distanceAmount + timeAmount);
    const adjustedVariableFare = roundMoney(standardVariableFare * demandMultiplier);
    const demandAdjustment = roundMoney(adjustedVariableFare - standardVariableFare);
    const minimumFareApplied = adjustedVariableFare < minimumFare;
    const mobilityFare = roundMoney(Math.max(minimumFare, adjustedVariableFare));
    const subtotal = roundMoney(mobilityFare + serviceFee + tolls);

    // Este comprobante no es CFDI, por lo que no se desglosan impuestos fiscales.
    const taxes = 0;
    const calculatedTotal = roundMoney(subtotal + taxes);
    const total = fixedQuote && Number.isFinite(quotedTotal) && quotedTotal > 0
        ? roundMoney(quotedTotal)
        : calculatedTotal;

    return {
        currency: pricingCurrency,
        quotedTotal: Number.isFinite(quotedTotal) && quotedTotal > 0 ? roundMoney(quotedTotal) : null,
        fixedQuote,
        recalculateAtEnd: !fixedQuote,
        distanceKm: roundMoney(distanceKm),
        durationMinutes: Math.max(0, Math.round(durationMinutes)),
        baseFare: roundMoney(baseFare),
        perKm: roundMoney(perKm),
        perMinute: roundMoney(perMinute),
        distanceAmount,
        timeAmount,
        demandMultiplier,
        demandAdjustment,
        minimumFare,
        minimumFareApplied,
        mobilityFare,
        serviceFee: roundMoney(serviceFee),
        tolls: roundMoney(tolls),
        subtotal,
        taxes,
        total
    };
};

const calculateDriverProjectedPricing = ({
    route,
    remainingDistanceMeters,
    remainingDurationMinutes,
    drivenDistanceKm = 0,
    source = 'driver-live-route'
}) => {
    const remainingKm = Math.max(0, Number(remainingDistanceMeters) || 0) / 1000;
    const committedKm = Math.max(0, Number(drivenDistanceKm) || 0);

    const actualStartMs = getTimestampMs(
        route?.actualStartTimestamp ||
        route?.navigationStartedAt ||
        route?.startedAt
    );

    const elapsedMinutes = actualStartMs
        ? Math.max(0, Math.round((Date.now() - actualStartMs) / 60000))
        : 0;

    const projectedDistanceKm = roundMoney(committedKm + remainingKm);
    const projectedDurationMinutes = Math.max(
        0,
        elapsedMinutes + Math.round(Number(remainingDurationMinutes) || 0)
    );

    const pricing = calculateTripLogixFare(route, {
        distanceKm: projectedDistanceKm,
        durationMinutes: projectedDurationMinutes
    });

    const quotedTotal = Number(
        route?.pricing?.quotedTotal ??
        route?.pricing?.initialQuote ??
        route?.quotedTotal ??
        route?.initialQuotedTotal
    );
    const keepQuoteUntilFinish = Boolean(
        route?.serviceModel === 'walk_up' &&
        route?.pricing?.recalculateAtEnd !== false &&
        route?.recalculateAtEnd !== false &&
        Number.isFinite(quotedTotal) &&
        quotedTotal > 0
    );

    return {
        ...pricing,
        ...(keepQuoteUntilFinish ? {
            projectedTotal: pricing.total,
            total: roundMoney(quotedTotal),
            quotedTotal: roundMoney(quotedTotal),
            pricingStage: 'quote_active'
        } : {}),
        projectedDistanceKm,
        projectedDurationMinutes,
        drivenDistanceKm: roundMoney(committedKm),
        remainingDistanceKm: roundMoney(remainingKm),
        remainingDurationMinutes: Math.max(0, Math.round(Number(remainingDurationMinutes) || 0)),
        source,
        updatedAt: new Date().toISOString(),
        model: keepQuoteUntilFinish
            ? 'TripLogix: cotización acordada visible; recálculo final pendiente'
            : 'TripLogix conductor: distancia recorrida + ruta restante + tiempo proyectado'
    };
};
const makeTripLogixFolio = (route, issuedAt) => {
    if (route?.receipt?.folio) return String(route.receipt.folio);
    const datePart = new Date(issuedAt).toISOString().slice(0, 10).replace(/-/g, '');
    const idPart = String(route?.id || route?.tripId || 'VIAJE')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(-8)
        .toUpperCase()
        .padStart(8, '0');
    return `TLX-${datePart}-${idPart}`;
};

const buildTripLogixReceipt = (route, overrides = {}) => {
    const existingReceipt = route?.receipt && typeof route.receipt === 'object'
        ? route.receipt
        : null;

    const issuedAt = overrides.issuedAt || existingReceipt?.issuedAt || new Date().toISOString();
    const actualEndTimestamp = overrides.actualEndTimestamp || route?.actualEndTimestamp || existingReceipt?.actualEndTimestamp || issuedAt;
    const calculatedPricing = calculateTripLogixFare(route, {
        ...overrides,
        actualEndTimestamp
    });

    const pricing = existingReceipt?.pricing && Number.isFinite(Number(existingReceipt.pricing.total))
        ? { ...calculatedPricing, ...existingReceipt.pricing }
        : calculatedPricing;

    const distanceKm = Number.isFinite(Number(existingReceipt?.distanceKm))
        ? Number(existingReceipt.distanceKm)
        : Number(pricing.distanceKm || 0);

    const durationMinutes = Number.isFinite(Number(existingReceipt?.durationMinutes))
        ? Number(existingReceipt.durationMinutes)
        : Number(pricing.durationMinutes || 0);

    return {
        version: Number(existingReceipt?.version || 1),
        documentType: String(existingReceipt?.documentType || 'Comprobante oficial de viaje'),
        fiscalType: String(existingReceipt?.fiscalType || 'NO_FISCAL'),
        folio: String(existingReceipt?.folio || makeTripLogixFolio(route, issuedAt)),
        issuedAt: String(issuedAt),
        issuer: {
            tradeName: String(existingReceipt?.issuer?.tradeName || TRIPLOGIX_RECEIPT_CONFIG.brandName),
            slogan: String(existingReceipt?.issuer?.slogan || TRIPLOGIX_RECEIPT_CONFIG.slogan)
        },
        tripId: String(existingReceipt?.tripId || route?.id || route?.tripId || ''),
        clientName: String(existingReceipt?.clientName || route?.client || route?.clientName || 'Cliente'),
        clientPhone: String(existingReceipt?.clientPhone || route?.clientPhone || route?.requestUser || ''),
        driverName: String(existingReceipt?.driverName || route?.driver || route?.driverName || 'Conductor no registrado'),
        driverId: String(existingReceipt?.driverId || route?.driverId || ''),
        vehicle: String(existingReceipt?.vehicle || route?.vehicle || route?.driverVehicle || route?.vehicleModel || 'Unidad no registrada'),
        vehiclePlate: String(existingReceipt?.vehiclePlate || route?.vehiclePlate || route?.driverVehiclePlate || ''),
        origin: String(existingReceipt?.origin || route?.start || route?.origin || 'Origen no registrado'),
        destination: String(existingReceipt?.destination || route?.end || route?.destination || 'Destino no registrado'),
        serviceType: String(existingReceipt?.serviceType || route?.serviceType || 'Servicio TripLogix'),
        scheduledDate: String(existingReceipt?.scheduledDate || route?.scheduledDate || route?.pickupDate || route?.finalDate || ''),
        scheduledTime: String(existingReceipt?.scheduledTime || route?.scheduledTime || route?.pickupTime || ''),
        actualStartTime: String(existingReceipt?.actualStartTime || route?.actualStartTime || route?.startTime || ''),
        actualStartTimestamp: String(existingReceipt?.actualStartTimestamp || route?.actualStartTimestamp || route?.navigationStartedAt || ''),
        actualEndTime: String(overrides.actualEndTime || existingReceipt?.actualEndTime || route?.actualEndTime || route?.endTime || ''),
        actualEndTimestamp: String(actualEndTimestamp || ''),
        distanceKm: roundMoney(distanceKm),
        durationMinutes: Math.max(0, Math.round(durationMinutes)),
        pricing,
        paymentMethod: String(existingReceipt?.paymentMethod || route?.paymentMethod || 'No registrado'),
        paymentStatus: String(existingReceipt?.paymentStatus || route?.paymentStatus || 'Pendiente de conciliación'),
        notes: String(existingReceipt?.notes || 'Comprobante operativo no fiscal. No sustituye una factura CFDI.')
    };
};

const formatTripLogixMoney = (value, currency = 'MXN') => {
    try {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency,
            minimumFractionDigits: 2
        }).format(Number(value) || 0);
    } catch (e) {
        return `$${(Number(value) || 0).toFixed(2)} ${currency}`;
    }
};

const isDispatcherScheduledTrip = (route) => {
    if (!route) return false;

    // Servicio ocasional/acopio sí puede mostrar la cotización acordada aunque
    // haya sido creado por despacho.
    if (
        route?.serviceModel === 'walk_up' ||
        route?.pricingVisibility === 'visible' ||
        route?.showPricingDuringTrip === true ||
        route?.pricingPolicy === 'dispatcher_visible_quote'
    ) {
        return false;
    }

    return Boolean(
        route?.pricingVisibility === 'hidden_during_trip' ||
        route?.showPricingDuringTrip === false ||
        route?.tripSource === 'dispatcher' ||
        route?.createdBy === 'dispatcher' ||
        route?.pricingPolicy === 'dispatcher_hidden_during_trip' ||
        route?.officialScheduledTime ||
        route?.technicalData?.carpool
    );
};

const shouldHideTripPricingDuringActive = (route) => {
    return isDispatcherScheduledTrip(route) && route?.status !== 'Finalizado';
};

const shouldHideDriverReceiptPricing = (route) => {
    // Los viajes empresariales/programados desde despacho se liquidan
    // semanalmente por kilómetros recorridos. El conductor no debe ver
    // tarifa monetaria ni siquiera al finalizar.
    return isDispatcherScheduledTrip(route);
};

const normalizeWhatsAppPhone = (...values) => {
    for (const value of values) {
        const digits = String(value || '').replace(/\D/g, '');
        if (!digits) continue;

        if (digits.length === 10) return `52${digits}`;
        if (digits.length === 12 && digits.startsWith('52')) return digits;
        if (digits.length >= 11 && digits.length <= 15) return digits;
    }

    return '';
};

const getRoutePassengerPhone = (route, target, stopIndex = 0) => {
    const safeStopIndex = Math.max(0, Number(stopIndex) || 0);
    const waypoints = Array.isArray(route?.waypointsData) ? route.waypointsData : [];
    const finalStopIndex = waypoints.length + 1;
    const passengerSchedule = Array.isArray(route?.passengerSchedule)
        ? route.passengerSchedule
        : [];

    const exactPoint = safeStopIndex === 0
        ? route?.startCoords
        : safeStopIndex >= finalStopIndex
            ? route?.endCoords
            : waypoints[safeStopIndex - 1];

    const targetName = String(
        target?.passengerName ||
        target?.contact ||
        exactPoint?.passengerName ||
        exactPoint?.contact ||
        ''
    ).trim().toLowerCase();

    const scheduleMatch = passengerSchedule.find(item => {
        const itemStopIndex = Number(item?.stopIndex);
        if (Number.isFinite(itemStopIndex) && itemStopIndex === safeStopIndex) return true;

        const itemName = String(
            item?.passengerName ||
            item?.name ||
            item?.contact ||
            ''
        ).trim().toLowerCase();

        return Boolean(targetName && itemName && targetName === itemName);
    });

    const exactPhone = normalizeWhatsAppPhone(
        target?.phone,
        target?.contactPhone,
        target?.whatsapp,
        exactPoint?.phone,
        exactPoint?.contactPhone,
        exactPoint?.whatsapp,
        scheduleMatch?.phone,
        scheduleMatch?.contactPhone,
        scheduleMatch?.whatsapp
    );

    // En rutas empresariales no se usa un teléfono general como respaldo,
    // porque podría abrir el WhatsApp de otro pasajero.
    if (exactPhone || isDispatcherScheduledTrip(route)) return exactPhone;

    return normalizeWhatsAppPhone(
        route?.clientPhone,
        route?.requestUserPhone,
        route?.requestUser
    );
};

const translateNavigationInstruction = (instruction = '') => {
    let text = stripHtml(instruction || 'Continúa por la ruta');
    const replacements = [
        [/^Head north(?:west)?/i, 'Dirígete hacia el norte'],
        [/^Head south(?:west)?/i, 'Dirígete hacia el sur'],
        [/^Head east/i, 'Dirígete hacia el este'],
        [/^Head west/i, 'Dirígete hacia el oeste'],
        [/Turn left/i, 'Gira a la izquierda'],
        [/Turn right/i, 'Gira a la derecha'],
        [/Slight left/i, 'Mantente ligeramente a la izquierda'],
        [/Slight right/i, 'Mantente ligeramente a la derecha'],
        [/Keep left/i, 'Mantente a la izquierda'],
        [/Keep right/i, 'Mantente a la derecha'],
        [/Continue straight/i, 'Continúa derecho'],
        [/Continue to follow/i, 'Continúa por'],
        [/Continue on/i, 'Continúa por'],
        [/Make a U-turn/i, 'Da vuelta en U'],
        [/At the roundabout, take the (\d+)(?:st|nd|rd|th) exit/i, 'En la glorieta, toma la salida $1'],
        [/Destination will be on the left/i, 'El destino estará a la izquierda'],
        [/Destination will be on the right/i, 'El destino estará a la derecha'],
        [/toward/i, 'hacia'],
        [/onto/i, 'en'],
        [/and continue/i, 'y continúa']
    ];

    replacements.forEach(([pattern, replacement]) => {
        text = text.replace(pattern, replacement);
    });

    return text.replace(/\s+/g, ' ').trim();
};

const speakNavigationText = async (text) => {
    const cleanText = translateNavigationInstruction(text);
    if (!cleanText) return false;

    if (Capacitor.isNativePlatform()) {
        try {
            await TextToSpeech.stop().catch(() => {});
            await TextToSpeech.speak({
                text: cleanText,
                lang: 'es-MX',
                rate: 0.92,
                pitch: 1.0,
                volume: 1.0,
                category: 'playback',
                queueStrategy: 0
            });
            return true;
        } catch (nativeVoiceError) {
            console.warn('Voz nativa no disponible:', nativeVoiceError);
        }
    }

    if (!('speechSynthesis' in window)) return false;

    try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume?.();
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'es-MX';
        utterance.rate = 0.92;
        utterance.volume = 1;
        const voices = window.speechSynthesis.getVoices?.() || [];
        utterance.voice = voices.find(v => /^es-MX$/i.test(v.lang)) || voices.find(v => /^es/i.test(v.lang)) || null;
        window.speechSynthesis.speak(utterance);
        return true;
    } catch (webVoiceError) {
        console.warn('Narración web no disponible:', webVoiceError);
        return false;
    }
};

const getTripDisplayedPricing = (route) => {
    if (!route) {
        return {
            currency: 'MXN',
            total: 0,
            distanceKm: 0,
            durationMinutes: 0,
            source: 'Sin información'
        };
    }

    const storedCandidates = [
        route?.pricing?.total,
        route?.pricing?.estimatedTotal,
        route?.receipt?.pricing?.total,
        route?.finalFare,
        route?.estimatedFare,
        route?.fare,
        route?.price,
        route?.totalPrice,
        route?.technicalData?.pricing?.total,
        route?.technicalData?.carpool?.price,
        route?.technicalData?.carpool?.totalPrice
    ];

    const storedTotal = storedCandidates
        .map(value => Number(value))
        .find(value => Number.isFinite(value) && value > 0);

    const distanceKm = Number(
        route?.liveNavigation?.distanceKm ??
        route?.technicalData?.totalDistance ??
        route?.distanceKm ??
        0
    ) || 0;

    const durationMinutes = Number(
        route?.liveNavigation?.durationMinutes ??
        route?.technicalData?.totalDuration ??
        route?.durationMinutes ??
        0
    ) || 0;

    const calculated = calculateTripLogixFare(route, {
        distanceKm,
        durationMinutes
    });

    return {
        ...calculated,
        total: Number.isFinite(storedTotal) ? roundMoney(storedTotal) : calculated.total,
        currency: String(route?.pricing?.currency || calculated.currency || 'MXN').toUpperCase(),
        source: Number.isFinite(storedTotal) ? 'Tarifa oficial del despacho' : 'Estimación TripLogix'
    };
};

const formatTripLogixDateTime = (value) => {
    const ms = getTimestampMs(value);
    if (!ms) return 'No registrado';
    return new Date(ms).toLocaleString('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
};

const getCompletedTripSortTimestamp = (route) => {
    const directCandidates = [
        route?.actualEndTimestamp,
        route?.finishedAt,
        route?.completedAt,
        route?.endTimestamp,
        route?.receipt?.actualEndTimestamp,
        route?.updatedAt
    ];

    for (const candidate of directCandidates) {
        const value = getTimestampMs(candidate);
        if (value) return value;
    }

    const dateKey = String(route?.finalDate || route?.scheduledDate || '').trim();
    const endTime = String(route?.endTime || route?.actualEndTime || '').trim();

    if (dateKey && endTime) {
        const combined = getTimestampMs(`${dateKey} ${endTime}`);
        if (combined) return combined;
    }

    return (
        getTimestampMs(route?.createdDate) ||
        getTimestampMs(route?.scheduledDate) ||
        0
    );
};

const createTripLogixReceiptPdf = (route) => {
    const receipt = buildTripLogixReceipt(route);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 16;
    const contentWidth = pageWidth - margin * 2;
    let y = 16;

    const ensureSpace = (needed = 16) => {
        if (y + needed > 286) {
            pdf.addPage();
            y = 18;
        }
    };

    const addLine = (label, value, options = {}) => {
        ensureSpace(options.height || 9);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(options.labelSize || 7.5);
        pdf.setTextColor(100, 116, 139);
        pdf.text(String(label).toUpperCase(), margin, y);
        y += 3.2;

        pdf.setFont('helvetica', options.bold ? 'bold' : 'normal');
        pdf.setFontSize(options.valueSize || 9.2);
        pdf.setTextColor(15, 23, 42);
        const lines = pdf.splitTextToSize(String(value || 'No registrado'), contentWidth);
        pdf.text(lines, margin, y);
        y += lines.length * 4.2 + 2.6;
    };

    const addSectionTitle = (title) => {
        ensureSpace(11);
        y += 1;
        pdf.setFillColor(248, 250, 252);
        pdf.roundedRect(margin, y - 4.5, contentWidth, 8.5, 2, 2, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.5);
        pdf.setTextColor(249, 115, 22);
        pdf.text(String(title).toUpperCase(), margin + 4, y + 1);
        y += 8.5;
    };

    // Encabezado oficial TripLogix.
    pdf.setFillColor(15, 23, 42);
    pdf.roundedRect(margin, y, contentWidth, 33, 4, 4, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(22);
    pdf.setTextColor(255, 255, 255);
    pdf.text('Trip', margin + 8, y + 13);
    pdf.setTextColor(249, 115, 22);
    pdf.text('Logix', margin + 24.5, y + 13);
    pdf.setFontSize(9);
    pdf.setTextColor(226, 232, 240);
    pdf.text(TRIPLOGIX_RECEIPT_CONFIG.slogan, margin + 8, y + 21);
    pdf.setFontSize(8);
    pdf.text('COMPROBANTE OFICIAL DE VIAJE - NO FISCAL', margin + 8, y + 28);
    y += 38;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(15, 23, 42);
    pdf.text(`Folio: ${receipt.folio}`, margin, y);
    y += 7;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`Emitido: ${formatTripLogixDateTime(receipt.issuedAt)}`, margin, y);
    y += 7;
    pdf.text(`ID de viaje: ${receipt.tripId || 'No registrado'}`, margin, y);
    y += 6;

    addSectionTitle('Pasajero y conductor');
    addLine('Pasajero', receipt.clientName);
    if (receipt.clientPhone) addLine('Contacto del pasajero', receipt.clientPhone);
    addLine('Conductor', receipt.driverName);
    addLine('Unidad', `${receipt.vehicle}${receipt.vehiclePlate ? ` - Placas ${receipt.vehiclePlate}` : ''}`);

    addSectionTitle('Ruta del servicio');
    addLine('Origen', receipt.origin);
    addLine('Destino', receipt.destination);
    addLine('Tipo de servicio', receipt.serviceType);
    addLine('Inicio real', receipt.actualStartTime || formatTripLogixDateTime(receipt.actualStartTimestamp));
    addLine('Finalización', receipt.actualEndTime || formatTripLogixDateTime(receipt.actualEndTimestamp));
    addLine('Distancia considerada', `${receipt.distanceKm.toFixed(2)} km`);
    addLine('Duración considerada', `${receipt.durationMinutes} min`);

    if (shouldHideDriverReceiptPricing(route)) {
        addSectionTitle('Liquidación empresarial');
        addLine(
            'Esquema de liquidación',
            'Liquidación semanal por kilómetros recorridos. La tarifa monetaria no se muestra al conductor.'
        );
        addLine('Kilómetros del servicio', `${receipt.distanceKm.toFixed(2)} km`, { bold: true, valueSize: 11 });
    } else {
        addSectionTitle('Desglose del importe');
        const pricingRows = [
            ['Tarifa base', receipt.pricing.baseFare],
            [`Distancia (${receipt.distanceKm.toFixed(2)} km x ${formatTripLogixMoney(receipt.pricing.perKm)})`, receipt.pricing.distanceAmount],
            [`Tiempo (${receipt.durationMinutes} min x ${formatTripLogixMoney(receipt.pricing.perMinute)})`, receipt.pricing.timeAmount]
        ];

        if (receipt.pricing.demandMultiplier > 1) {
            pricingRows.push([`Ajuste de demanda x${receipt.pricing.demandMultiplier.toFixed(2)}`, receipt.pricing.demandAdjustment]);
        }
        if (receipt.pricing.minimumFareApplied) {
            pricingRows.push(['Ajuste a tarifa mínima', Math.max(0, receipt.pricing.minimumFare - (receipt.pricing.baseFare + receipt.pricing.distanceAmount + receipt.pricing.timeAmount + receipt.pricing.demandAdjustment))]);
        }
        pricingRows.push(['Cuota operativa y de seguridad', receipt.pricing.serviceFee]);
        if (receipt.pricing.tolls > 0) pricingRows.push(['Peajes registrados', receipt.pricing.tolls]);

        pricingRows.forEach(([label, value]) => {
            ensureSpace(8);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            pdf.setTextColor(71, 85, 105);
            pdf.text(String(label), margin, y);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(15, 23, 42);
            pdf.text(formatTripLogixMoney(value, receipt.pricing.currency), pageWidth - margin, y, { align: 'right' });
            y += 7;
        });

        ensureSpace(22);
        pdf.setDrawColor(226, 232, 240);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 8;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(249, 115, 22);
        pdf.text('TOTAL', margin, y);
        pdf.text(formatTripLogixMoney(receipt.pricing.total, receipt.pricing.currency), pageWidth - margin, y, { align: 'right' });
        y += 10;

        addLine('Método de pago', receipt.paymentMethod);
        addLine('Estado del pago', receipt.paymentStatus);
    }

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.8);
    pdf.setTextColor(124, 45, 18);
    pdf.text(receipt.notes, pageWidth / 2, 284, { align: 'center' });

    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
        pdf.setPage(page);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`TripLogix - ${receipt.folio} - Página ${page} de ${pages}`, pageWidth / 2, 291, { align: 'center' });
    }

    return { pdf, receipt };
};

const writeTripLogixPdfToNativeCache = async (pdf, filename) => {
    const dataUri = String(pdf.output('datauristring') || '');
    const base64Data = dataUri.includes(',') ? dataUri.split(',')[1] : '';

    if (!base64Data) {
        throw new Error('No fue posible convertir el recibo PDF.');
    }

    await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache,
        recursive: true
    });

    const uriResult = await Filesystem.getUri({
        path: filename,
        directory: Directory.Cache
    });

    return uriResult.uri;
};

const downloadTripLogixReceiptPdf = async (route) => {
    try {
        const { pdf, receipt } = createTripLogixReceiptPdf(route);
        const filename = `TripLogix_Recibo_${receipt.folio}.pdf`;

        if (Capacitor.isNativePlatform()) {
            const fileUri = await writeTripLogixPdfToNativeCache(pdf, filename);

            await Share.share({
                title: `Recibo TripLogix ${receipt.folio}`,
                text: 'Abre, guarda o envía tu comprobante oficial de viaje.',
                files: [fileUri],
                dialogTitle: 'Guardar recibo PDF'
            });
            return;
        }

        pdf.save(filename);
    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error('No se pudo generar el recibo PDF:', error);
        alert('No se pudo generar el recibo PDF. Vuelve a intentarlo.');
    }
};

const shareTripLogixReceiptPdf = async (route) => {
    try {
        const { pdf, receipt } = createTripLogixReceiptPdf(route);
        const filename = `TripLogix_Recibo_${receipt.folio}.pdf`;

        if (Capacitor.isNativePlatform()) {
            const fileUri = await writeTripLogixPdfToNativeCache(pdf, filename);

            await Share.share({
                title: `Recibo TripLogix ${receipt.folio}`,
                text: `Comprobante oficial de viaje TripLogix ${receipt.folio}`,
                files: [fileUri],
                dialogTitle: 'Compartir recibo'
            });
            return;
        }

        const blob = pdf.output('blob');

        try {
            const file = new File([blob], filename, { type: 'application/pdf' });
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: `Recibo TripLogix ${receipt.folio}`,
                    text: `Comprobante oficial de viaje TripLogix ${receipt.folio}`,
                    files: [file]
                });
                return;
            }
        } catch (webShareError) {
            if (webShareError?.name === 'AbortError') return;
            console.warn('No se pudo compartir directamente el PDF:', webShareError);
        }

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error('No se pudo compartir el recibo PDF:', error);
        alert('No se pudo compartir el recibo PDF. Vuelve a intentarlo.');
    }
};


// HELPER: Cálculo de distancia para la GEOCERCA
const getDistanceMeters = (p1, p2) => {
    const aPoint = normalizePoint(p1);
    const bPoint = normalizePoint(p2);
    if (!aPoint || !bPoint) return 0;

    const R = 6371e3;
    const dLat = (bPoint.lat - aPoint.lat) * Math.PI / 180;
    const dLon = (bPoint.lng - aPoint.lng) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(aPoint.lat * Math.PI / 180) *
        Math.cos(bPoint.lat * Math.PI / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const calculatePathDistanceKm = (path = []) => {
    const points = normalizePath(path);
    if (points.length < 2) return 0;

    let meters = 0;
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        const segmentMeters = getDistanceMeters(previous, current);
        const previousTime = new Date(previous.recordedAt || previous.timestamp || 0).getTime();
        const currentTime = new Date(current.recordedAt || current.timestamp || 0).getTime();
        const elapsedSeconds = previousTime && currentTime && currentTime > previousTime
            ? (currentTime - previousTime) / 1000
            : null;
        const maxPlausibleMeters = elapsedSeconds ? Math.max(120, elapsedSeconds * 45) : 250;
        const accuracyNoise = Math.max(Number(previous.accuracy) || 0, Number(current.accuracy) || 0) * 0.45;
        const minimumMovement = Math.max(7, accuracyNoise);
        const isSegmentBreak = Boolean(
            current?.segmentStart ||
            current?.routeBreak ||
            current?.gpsGap ||
            (elapsedSeconds !== null && elapsedSeconds > 30)
        );

        if (
            !isSegmentBreak &&
            Number.isFinite(segmentMeters) &&
            segmentMeters >= minimumMovement &&
            segmentMeters <= maxPlausibleMeters
        ) {
            meters += segmentMeters;
        }
    }

    return roundMoney(meters / 1000);
};

const chooseReliableDistanceKm = (route, persistedDistanceKm, tracedDistanceKm) => {
    const persisted = Math.max(0, Number(persistedDistanceKm) || 0);
    const traced = Math.max(0, Number(tracedDistanceKm) || 0);
    const estimatedGapKm = Math.max(0, Number(route?.gpsGapEstimatedDistanceKm) || 0);
    if (!persisted) return traced;
    if (!traced) return persisted;

    // Cuando hubo pérdida de señal, el acumulador persistido incluye la estimación
    // por ruta vehicular conocida. No debemos volver a escoger el trazo GPS menor,
    // porque precisamente ese trazo contiene el hueco sin señal.
    if (estimatedGapKm > 0) return roundMoney(persisted);

    const larger = Math.max(persisted, traced);
    const smaller = Math.min(persisted, traced);
    if (smaller > 0 && larger / smaller > 1.35) return roundMoney(smaller);
    return roundMoney((persisted + traced) / 2);
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

// Reduce el peso de una geometría SIN saltarse curvas de forma agresiva.
// Para navegación preferimos conservar la geometría detallada que entrega Google.
const downsamplePath = (path, maxPoints = 260) => {
    const valid = normalizePath(path);
    if (valid.length <= maxPoints) return valid;

    // Conserva puntos de giro y limita la distancia física entre puntos guardados.
    // Esto evita el antiguo muestreo "cada N puntos", que podía dibujar cuerdas
    // rectas atravesando casas, terrenos o manzanas.
    const result = [valid[0]];
    let lastKept = valid[0];
    let previousHeading = null;
    const targetSpacingMeters = Math.max(12, Math.min(35, (calculatePathDistanceKm(valid) * 1000) / Math.max(1, maxPoints - 1)));

    for (let index = 1; index < valid.length - 1; index += 1) {
        const point = valid[index];
        const previous = valid[index - 1];
        const next = valid[index + 1];
        const distanceFromKept = getDistanceMeters(lastKept, point);

        let headingA = previousHeading;
        let headingB = null;
        try {
            const dy1 = point.lat - previous.lat;
            const dx1 = point.lng - previous.lng;
            const dy2 = next.lat - point.lat;
            const dx2 = next.lng - point.lng;
            headingA = Math.atan2(dy1, dx1) * 180 / Math.PI;
            headingB = Math.atan2(dy2, dx2) * 180 / Math.PI;
        } catch (_) {}
        const turn = Number.isFinite(headingA) && Number.isFinite(headingB)
            ? Math.abs(((headingB - headingA + 540) % 360) - 180)
            : 0;

        if (distanceFromKept >= targetSpacingMeters || turn >= 8) {
            result.push(point);
            lastKept = point;
        }
        previousHeading = headingB;
    }

    result.push(valid[valid.length - 1]);
    return result;
};

const splitGpsTraceSegments = (path, options = {}) => {
    const points = normalizePath(path);
    if (!points.length) return [];
    const maxGapMs = Number(options.maxGapMs) || 18000;
    const maxBridgeMeters = Number(options.maxBridgeMeters) || 120;
    const segments = [];
    let current = [];

    const flush = () => {
        if (current.length > 1) segments.push(current);
        current = [];
    };

    points.forEach((point, index) => {
        if (index === 0) {
            current = [point];
            return;
        }
        const previous = points[index - 1];
        const previousMs = getTimestampMs(previous?.recordedAt || previous?.timestamp);
        const currentMs = getTimestampMs(point?.recordedAt || point?.timestamp);
        const gapMs = previousMs && currentMs && currentMs > previousMs ? currentMs - previousMs : 0;
        const bridgeMeters = getDistanceMeters(previous, point);
        const gapSeconds = gapMs > 0 ? gapMs / 1000 : 0;
        const speedMps = gapSeconds > 0 ? bridgeMeters / gapSeconds : 0;
        const explicitBreak = Boolean(point?.segmentStart || point?.routeBreak || point?.gpsGap);

        if (explicitBreak || gapMs > maxGapMs || bridgeMeters > maxBridgeMeters || speedMps > 42) {
            flush();
            current = [point];
            return;
        }
        current.push(point);
    });
    flush();
    return segments;
};

const getClosestPathMatch = (point, path) => {
    const loc = normalizePoint(point);
    const geometry = normalizePath(path);
    if (!loc || geometry.length < 2) return { index: -1, distanceMeters: Infinity };
    let bestIndex = -1;
    let bestDistance = Infinity;
    geometry.forEach((candidate, index) => {
        const distance = getDistanceMeters(loc, candidate);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    });
    return { index: bestIndex, distanceMeters: bestDistance };
};

// Cuando el GPS desaparece NO inventamos una recta entre dos posiciones.
// Si ambos extremos están cerca de una ruta vehicular conocida, estimamos el hueco
// recorriendo esa geometría (ruta Google viva primero; plan original después).
const getKnownRoadGapDistanceKm = (fromPoint, toPoint, candidatePaths = []) => {
    const from = normalizePoint(fromPoint);
    const to = normalizePoint(toPoint);
    if (!from || !to) return 0;
    const directMeters = getDistanceMeters(from, to);

    for (const rawPath of candidatePaths) {
        const path = normalizePath(rawPath);
        if (path.length < 2) continue;
        const startMatch = getClosestPathMatch(from, path);
        const endMatch = getClosestPathMatch(to, path);
        if (startMatch.index < 0 || endMatch.index < 0) continue;
        if (startMatch.distanceMeters > 260 || endMatch.distanceMeters > 260) continue;
        if (endMatch.index < startMatch.index) continue;

        const roadMeters = getDistanceAlongPathMeters(path, startMatch.index, endMatch.index);
        if (!Number.isFinite(roadMeters) || roadMeters <= 0) continue;
        if (directMeters > 0 && roadMeters < directMeters * 0.75) continue;
        if (directMeters > 0 && roadMeters > Math.max(directMeters * 4, directMeters + 6000)) continue;
        return roundMoney(roadMeters / 1000);
    }
    return 0;
};

const isSalidaRoute = (route) => String(
    route?.technicalData?.carpool?.mode ||
    route?.carpoolMode ||
    route?.tripDirection ||
    ''
).toLowerCase().includes('regreso');

const stripHtml = (value = '') => String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const formatInstructionDistance = (meters) => {
    const value = Number(meters);
    if (!Number.isFinite(value) || value <= 0) return '';

    if (value >= 1000) {
        return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} km`;
    }

    const rounded = value > 300
        ? Math.round(value / 100) * 100
        : value > 100
            ? Math.round(value / 50) * 50
            : Math.max(10, Math.round(value / 10) * 10);

    return `${rounded} m`;
};

const getVoiceDistanceBucket = (meters) => {
    const value = Number(meters);
    if (!Number.isFinite(value)) return 'far';
    if (value <= 70) return '70';
    if (value <= 180) return '180';
    if (value <= 450) return '450';
    if (value <= 900) return '900';
    return 'far';
};

const getNextNavigationStep = (location, steps, startIndex = 0) => {
    const loc = normalizePoint(location);
    if (!loc || !Array.isArray(steps) || steps.length === 0) return null;

    let bestIndex = 0;
    let bestScore = Infinity;

    const safeStart = Math.max(0, Math.min(steps.length - 1, Number(startIndex) || 0));
    const searchFrom = Math.max(0, safeStart - 1);

    for (let index = searchFrom; index < steps.length; index++) {
        const step = steps[index];
        const end = normalizePoint(step.end);
        if (!end) continue;

        const distance = getDistanceMeters(loc, end);
        const passedPenalty = index < safeStart ? 2500 : 0;
        const score = distance + passedPenalty;

        if (score < bestScore) {
            bestScore = score;
            bestIndex = index;
        }

        // No necesitamos recorrer cientos de pasos lejanos.
        if (index > safeStart + 25 && bestScore < 1500) break;
    }

    const selected = steps[bestIndex];
    const endPoint = normalizePoint(selected?.end);
    const meters = endPoint ? getDistanceMeters(loc, endPoint) : Number(selected?.distanceMeters) || 0;

    return {
        ...selected,
        index: bestIndex,
        meters,
        distanceText: formatInstructionDistance(meters),
        voiceKey: `${bestIndex}-${getVoiceDistanceBucket(meters)}`
    };
};

// === NUEVOS HELPERS: FORZAR HORA MÉXICO CENTRAL ===
const getMexicoTime = () => new Date().toLocaleTimeString('es-419', { hour: '2-digit', minute:'2-digit' });
const getMexicoDate = () => new Date().toLocaleDateString('es-419');


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
    const salida = isSalidaRoute(route);

    if (stopIndex === 0) {
        return normalizeTimeString(
            route?.startCoords?.departureTime ||
            route?.startCoords?.pickupTime ||
            route?.scheduledTime ||
            getPickupTimeValue(route)
        );
    }

    if (stopIndex > 0 && stopIndex < finalIndex) {
        const waypoint = route?.waypointsData?.[stopIndex - 1];
        return normalizeTimeString(
            (salida ? (waypoint?.dropoffTime || waypoint?.plannedDropoffTime) : '') ||
            waypoint?.plannedTime ||
            waypoint?.pickupTime ||
            waypoint?.plannedPickupTime ||
            waypoint?.horaRecogida ||
            waypoint?.horaPickup ||
            ''
        );
    }

    if (salida) {
        return normalizeTimeString(
            route?.endCoords?.dropoffTime ||
            route?.endCoords?.plannedDropoffTime ||
            route?.endCoords?.plannedTime ||
            route?.estimatedFinalArrivalTime ||
            ''
        );
    }

    return getTargetArrivalTimeValue(route);
};

const getStopScheduleLabel = (route, stopIndex) => {
    const waypointsCount = route?.waypointsData?.length || 0;
    const finalIndex = waypointsCount + 1;
    const salida = isSalidaRoute(route);

    if (salida) {
        if (stopIndex === 0) return 'Salida programada';
        if (stopIndex >= finalIndex) return 'Última entrega estimada';
        return 'Entrega estimada';
    }
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
            return value.toDate().toLocaleDateString('en-CA', {});
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

const normalizeHeadingDegrees = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return ((number % 360) + 360) % 360;
};

const getHeadingDifference = (from, to) => {
    const a = normalizeHeadingDegrees(from);
    const b = normalizeHeadingDegrees(to);
    return Math.abs(((b - a + 540) % 360) - 180);
};

const safeSetMapCamera = (map, loc, heading = 0, zoom = 17) => {
    const validLoc = normalizePoint(loc);
    if (!map || !validLoc) return;

    try {
        map.panTo({ lat: validLoc.lat, lng: validLoc.lng });

        const currentZoom = Number(map.getZoom?.());
        if (!Number.isFinite(currentZoom) || Math.abs(currentZoom - zoom) >= 2) {
            map.setZoom(zoom);
        }

        // Rumbo-arriba estable: gira el mapa vectorial, pero mantiene tilt 0.
        // Así la ruta queda hacia adelante sin reactivar el modo 3D que causaba pantalla negra.
        if (typeof map.setTilt === 'function' && Number(map.getTilt?.()) !== 0) {
            map.setTilt(0);
        }

        const targetHeading = normalizeHeadingDegrees(heading);
        const currentHeading = normalizeHeadingDegrees(map.getHeading?.() || 0);

        if (
            typeof map.setHeading === 'function' &&
            getHeadingDifference(currentHeading, targetHeading) >= 8
        ) {
            map.setHeading(targetHeading);
        }
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
  const assignmentTrackerInitializedRef = useRef(false);
  const knownAssignedRouteIdsRef = useRef(new Set());

  const [darkMode, setDarkMode] = useState(false);
  const [filterType, setFilterType] = useState('Próximo');
  const [mainTab, setMainTab] = useState('Pendientes'); 
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [completedTripNotice, setCompletedTripNotice] = useState(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);

  const [isWaiting, setIsWaiting] = useState(false);
  const [showTripChat, setShowTripChat] = useState(false);
  const [chatText, setChatText] = useState('');
  const [evidence, setEvidence] = useState(null);
  const [incomingOffer, setIncomingOffer] = useState(null);

  const [showJustification, setShowJustification] = useState(false);
  const [justificationText, setJustificationText] = useState('');
  const [distanceOff, setDistanceOff] = useState(0);

  const { isLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: GOOGLE_MAPS_API_KEY, libraries, language: 'es' });
  const mapRef = useRef(null);
  const [mapRenderKey] = useState(0); // Se mantiene únicamente para la vista previa.
  const mapReadyRef = useRef(false);
  const lastCameraMoveRef = useRef(0);
  const lastDriverLocationWriteRef = useRef(0);
  const lastDirectionsRequestRef = useRef(0);
  const lastDirectionsOriginRef = useRef(null);
  const directionsBusyRef = useRef(false);
  const directionsServiceRef = useRef(null);
  const directionsRequestIdRef = useRef(0);
  const lastDirectionsStopRef = useRef(null);
  const navigationStepsRef = useRef([]);
  const navigationStepIndexRef = useRef(0);
  const navigationGeometryRef = useRef([]);
  const lastUiLocationRef = useRef({ loc: null, timestamp: 0 });
  const pendingDistanceKmRef = useRef(0);
  const pendingGapDistanceKmRef = useRef(0);
  const pendingRoutePointsRef = useRef([]);
  const telemetryBusyRef = useRef(false);
  const flushTelemetryRef = useRef(async () => {});
  const routeListenerUnsubscribeRef = useRef(null);
  const liveNavigationRef = useRef({
      distanceKm: 0,
      durationMinutes: 0,
      nextStopDistanceKm: 0,
      nextStopDurationMinutes: 0,
      stopIndex: 0,
      source: 'fallback'
  });
  const liveRouteGeometryRef = useRef([]);
  const livePricingRef = useRef(null);
  const liveRoutePublishDirtyRef = useRef(false);
  const committedDistanceKmRef = useRef(0);
  const serviceDistanceStartedRef = useRef(false);
  const serviceDistanceStartedAtRef = useRef('');
  const nextStopIdxRef = useRef(0);
  const userHeadingRef = useRef(0);
  const pushCleanupRef = useRef(null);

  const [userLocation, setUserLocation] = useState(null);
  const [userHeading, setUserHeading] = useState(0); 
  const [isTracking, setIsTracking] = useState(true);
  
  const isTrackingRef = useRef(true); 
  const latestLocRef = useRef(null);
  const prevLocRef = useRef(null); 
  const odometerLocRef = useRef(null);
  const odometerMetaRef = useRef({ timestamp: 0, accuracy: Infinity });
  const lastIncomingChatRef = useRef({ routeId: '', key: '' }); 
  
  const [nextStopIdx, setNextStopIdx] = useState(0); 
  const [routeUpdateTick, setRouteUpdateTick] = useState(0); 
  const [sharedPassengerStatuses, setSharedPassengerStatuses] = useState({});

  useEffect(() => {
      nextStopIdxRef.current = nextStopIdx;
  }, [nextStopIdx]);

  useEffect(() => {
      setSharedPassengerStatuses({});
  }, [selectedRoute?.id, nextStopIdx]);

  useEffect(() => {
      const startedAt =
          selectedRoute?.serviceDistanceStartedAt ||
          selectedRoute?.firstStopAttendedTimestamp ||
          selectedRoute?.firstBoardingTimestamp ||
          '';

      serviceDistanceStartedAtRef.current = String(startedAt || '');
      serviceDistanceStartedRef.current = Boolean(
          startedAt ||
          Number(selectedRoute?.realDistanceDriven) > 0 ||
          nextStopIdx > 0
      );
  }, [
      selectedRoute?.id,
      selectedRoute?.serviceDistanceStartedAt,
      selectedRoute?.firstStopAttendedTimestamp,
      selectedRoute?.firstBoardingTimestamp,
      selectedRoute?.realDistanceDriven,
      nextStopIdx
  ]);

  const [alertedStops, setAlertedStops] = useState([]); 
  const [isApproaching, setIsApproaching] = useState(false); 

  const [liveRouteData, setLiveRouteData] = useState({ geometry: [], totalDuration: 0, totalDistance: 0, nextStopDuration: 0, nextStopDistance: 0 });
  const [resolvedNextStopLocation, setResolvedNextStopLocation] = useState(null);

  // === ESTADOS PARA EL ASISTENTE DE NAVEGACIÓN Y VOZ ===
  const [nextManeuver, setNextManeuver] = useState({ instruction: '', distance: '' });
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const lastSpokenRef = useRef(null);
  const lastSpokenInstructionRef = useRef({ instruction: '', bucket: '', timestamp: 0 });

  const wakeLockRef = useRef(null);
  const chatScrollRef = useRef(null);

  const handleMapLoad = useCallback((map) => {
      mapRef.current = map;
      mapReadyRef.current = true;

      try {
          if (typeof map.setTilt === 'function') map.setTilt(0);
          if (typeof map.setHeading === 'function') map.setHeading(0);

          setTimeout(() => {
              try {
                  if (window.google?.maps?.event) {
                      window.google.maps.event.trigger(map, 'resize');
                  }

                  const loc = normalizePoint(latestLocRef.current);
                  if (loc) safeSetMapCamera(map, loc, 0, 17);
              } catch (e) {
                  console.warn('No se pudo refrescar el mapa al cargar:', e);
              }
          }, 250);
      } catch (e) {
          console.error('Error inicializando mapa:', e);
      }
  }, []);

  const handleMapUnmount = useCallback((map) => {
      if (mapRef.current === map) {
          mapRef.current = null;
          mapReadyRef.current = false;
      }
  }, []);

  // Recuperación segura al volver de segundo plano.
  // No cambia estados, no remonta el mapa y no dispara una nueva ruta automáticamente.
  useEffect(() => {
      const resumeMapSafely = () => {
          if (document.visibilityState && document.visibilityState !== 'visible') return;

          setTimeout(() => {
              const map = mapRef.current;
              if (!map) return;

              try {
                  if (window.google?.maps?.event) {
                      window.google.maps.event.trigger(map, 'resize');
                  }

                  const loc = normalizePoint(latestLocRef.current);
                  if (loc) safeSetMapCamera(map, loc, 0, 17);
              } catch (e) {
                  console.warn('No se pudo recuperar el mapa:', e);
              }
          }, 450);
      };

      document.addEventListener('visibilitychange', resumeMapSafely);
      window.addEventListener('pageshow', resumeMapSafely);
      window.addEventListener('focus', resumeMapSafely);

      return () => {
          document.removeEventListener('visibilitychange', resumeMapSafely);
          window.removeEventListener('pageshow', resumeMapSafely);
          window.removeEventListener('focus', resumeMapSafely);
      };
  }, []);

  useEffect(() => { latestLocRef.current = userLocation; }, [userLocation]);
  useEffect(() => { userHeadingRef.current = normalizeHeadingDegrees(userHeading); }, [userHeading]);
  useEffect(() => { isTrackingRef.current = isTracking; }, [isTracking]);
  useEffect(() => { if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight; }, [selectedRoute?.chat, isWaiting, showTripChat]);

  useEffect(() => {
      const routeId = selectedRoute?.id || '';
      const chat = Array.isArray(selectedRoute?.chat) ? selectedRoute.chat : [];
      const lastMessage = chat[chat.length - 1];
      const key = lastMessage ? `${lastMessage.timestamp || lastMessage.time || ''}|${lastMessage.sender || ''}|${lastMessage.text || ''}` : '';

      if (lastIncomingChatRef.current.routeId !== routeId) {
          lastIncomingChatRef.current = { routeId, key };
          return;
      }

      if (key && key !== lastIncomingChatRef.current.key && !['Conductor', 'Sistema'].includes(lastMessage?.sender)) {
          if ('vibrate' in navigator) navigator.vibrate([180, 80, 180]);
          speakNavigationText(lastMessage?.sender === 'Despacho' ? 'Mensaje de torre de control' : 'Mensaje del pasajero').catch(() => {});
      }
      lastIncomingChatRef.current = { routeId, key };
  }, [selectedRoute?.id, selectedRoute?.chat]);

  // === LÓGICA DEL NARRADOR NATIVO / WEB ===
  // Estilo Google/Waze: no lee cada cambio de metros.
  // Una maniobra se anuncia a distancia, cerca del giro y únicamente vuelve
  // a hablar si cambió de maniobra o pasó un tiempo suficientemente largo.
  useEffect(() => {
      if (!voiceEnabled || !nextManeuver.instruction) return;

      const cleanText = translateNavigationInstruction(nextManeuver.instruction);
      if (!cleanText) return;

      const voiceKey = String(nextManeuver.voiceKey || '');
      const bucket = voiceKey.split('-').pop() || 'far';
      const allowedBuckets = new Set(['450', '180', '70']);
      if (!allowedBuckets.has(bucket)) return;

      const now = Date.now();
      const previous = lastSpokenInstructionRef.current || {};
      const sameInstruction = previous.instruction === cleanText;
      const sameBucket = previous.bucket === bucket;
      if (sameInstruction && sameBucket) return;

      // Evita una voz continua por recálculos de Google.
      // El aviso cercano (70 m) puede romper el cooldown; los demás esperan.
      const cooldownMs = bucket === '70' ? 12000 : 30000;
      if (sameInstruction && now - Number(previous.timestamp || 0) < cooldownMs) return;

      const spokenDistance =
          bucket === '450' ? 'En aproximadamente 400 metros. ' :
          bucket === '180' ? 'Más adelante. ' :
          '';

      speakNavigationText(`${spokenDistance}${cleanText}`)
          .then(spoken => {
              if (spoken) {
                  lastSpokenRef.current = { key: `${cleanText}-${bucket}`, timestamp: now };
                  lastSpokenInstructionRef.current = { instruction: cleanText, bucket, timestamp: now };
              }
          });
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


  useEffect(() => {
      if (!selectedRoute?.id || misRutas.length === 0) return;

      const latest = misRutas.find(route => route.id === selectedRoute.id);
      if (!latest) return;

      // Sincroniza el documento completo: paradas, teléfonos, evidencias,
      // bitácora, alertas y geometría. Así un punto nuevo no borra ni congela
      // la información del punto anterior en la pantalla del conductor.
      setSelectedRoute(prev => prev ? { ...prev, ...latest } : latest);
  }, [misRutas, selectedRoute?.id]);

  // --- DETECCIÓN ROBUSTA DE VIAJES NUEVOS ASIGNADOS DESDE DESPACHO ---
  // No depende de que cambie el número total de rutas: detecta IDs nuevos asignados.
  useEffect(() => {
      if (!currentDriver?.id) return;
      const assignedActive = misRutas.filter(route =>
          !['Finalizado', 'Completado', 'Cancelado'].includes(route?.status) &&
          (route?.driverId === currentDriver.id || route?.ofertaPara === currentDriver.id)
      );
      const currentIds = new Set(assignedActive.map(route => route.id));

      if (!assignmentTrackerInitializedRef.current) {
          knownAssignedRouteIdsRef.current = currentIds;
          assignmentTrackerInitializedRef.current = true;
          return;
      }

      const newlyAssigned = assignedActive.filter(route => !knownAssignedRouteIdsRef.current.has(route.id) && route?.ofertaEstado !== 'Pendiente');
      if (newlyAssigned.length > 0) {
          playAlertSound();
          if ('vibrate' in navigator) navigator.vibrate([400, 120, 400, 120, 700]);
          speakNavigationText('Nuevo viaje asignado').catch(() => {});
          setMainTab('Pendientes');
      }
      knownAssignedRouteIdsRef.current = currentIds;
  }, [misRutas, currentDriver?.id]);

  useEffect(() => {
      setResolvedNextStopLocation(null);
  }, [selectedRoute?.id, nextStopIdx]);

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
              label: isSalidaRoute(selectedRoute) ? 'Salida empresa' : 'Origen',
              address: selectedRoute.start,
              icon: ICON_START,
              contact: selectedRoute.startCoords.passengerName || selectedRoute.startCoords.contact,
              plannedTime: getStopPlannedTimeValue(selectedRoute, 0),
              passengersSchedule: Array.isArray(selectedRoute.startCoords?.passengersSchedule) ? selectedRoute.startCoords.passengersSchedule : []
          });
      }

      if (selectedRoute.waypointsData) {
          selectedRoute.waypointsData.forEach((wp, idx) => {
              addTarget(wp, {
                  label: isSalidaRoute(selectedRoute) ? `Entrega ${String.fromCharCode(66 + idx)}` : `Parada ${String.fromCharCode(66 + idx)}`,
                  address: selectedRoute.waypoints?.[idx] || wp.address,
                  icon: ICON_WAYPOINT,
                  contact: wp.passengerName || wp.contact,
                  plannedTime: getStopPlannedTimeValue(selectedRoute, idx + 1),
                  passengersSchedule: Array.isArray(wp?.passengersSchedule) ? wp.passengersSchedule : []
              });
          });
      }

      if (selectedRoute.endCoords) {
          const finalIndex = (selectedRoute.waypointsData?.length || 0) + 1;
          addTarget(selectedRoute.endCoords, {
              label: isSalidaRoute(selectedRoute) ? 'Última descarga' : 'Destino Final',
              address: selectedRoute.end,
              icon: ICON_END,
              contact: selectedRoute.endCoords.passengerName || selectedRoute.endCoords.contact,
              plannedTime: getStopPlannedTimeValue(selectedRoute, finalIndex),
              passengersSchedule: Array.isArray(selectedRoute.endCoords?.passengersSchedule) ? selectedRoute.endCoords.passengersSchedule : []
          });
      }

      return targets;
  }, [selectedRoute]);

  useEffect(() => {
      const geometry = downsamplePath(selectedRoute?.technicalData?.geometry, 220);
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
    let watchId = null;

    const shouldTrack = Boolean(
        currentDriver &&
        (currentDriver.isOnline || selectedRoute?.status === 'En Ruta')
    );

    if (!shouldTrack || !('geolocation' in navigator)) return undefined;

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const loc = normalizePoint({
            lat: position.coords.latitude,
            lng: position.coords.longitude
        });
        if (!loc) return;

        const now = Date.now();
        const accuracy = Number(position.coords.accuracy) || 9999;
        const previousUiLoc = normalizePoint(lastUiLocationRef.current.loc);
        const movedForUi = previousUiLoc ? getDistanceMeters(previousUiLoc, loc) : Infinity;

        // La referencia se actualiza siempre; React solo se actualiza a una frecuencia controlada.
        latestLocRef.current = loc;

        if (
            !previousUiLoc ||
            movedForUi >= 2.5 ||
            now - lastUiLocationRef.current.timestamp >= 1500
        ) {
            lastUiLocationRef.current = { loc, timestamp: now };
            setUserLocation(loc);
        }

        // Rumbo estable sin girar el canvas del mapa.
        const previousHeadingLoc = normalizePoint(prevLocRef.current);
        if (previousHeadingLoc && window.google?.maps?.geometry) {
            const p1 = new window.google.maps.LatLng(previousHeadingLoc.lat, previousHeadingLoc.lng);
            const p2 = new window.google.maps.LatLng(loc.lat, loc.lng);
            const moved = window.google.maps.geometry.spherical.computeDistanceBetween(p1, p2);

            if (moved >= 5) {
                let newHeading = Number(position.coords.heading);
                if (!Number.isFinite(newHeading) || Number(position.coords.speed) < 1) {
                    newHeading = window.google.maps.geometry.spherical.computeHeading(p1, p2);
                }

                if (Number.isFinite(newHeading)) {
                    const normalizedHeading = ((newHeading % 360) + 360) % 360;
                    setUserHeading(Math.round(normalizedHeading / 10) * 10);
                }

                prevLocRef.current = loc;
            }
        } else {
            prevLocRef.current = loc;
        }

        // El kilometraje operativo comienza al confirmar el primer punto.
        // Antes de ese momento se publica el GPS, pero no se suma distancia al servicio.
        const serviceDistanceActive = Boolean(serviceDistanceStartedRef.current);

        if (selectedRoute?.status === 'En Ruta' && accuracy <= 35 && serviceDistanceActive) {
            const previousOdometerLoc = normalizePoint(odometerLocRef.current);
            const previousMeta = odometerMetaRef.current || { timestamp: 0, accuracy: Infinity };

            if (!previousOdometerLoc) {
                odometerLocRef.current = loc;
                odometerMetaRef.current = { timestamp: position.timestamp || now, accuracy };
                pendingRoutePointsRef.current.push({
                    ...loc,
                    recordedAt: new Date(position.timestamp || now).toISOString(),
                    accuracy,
                    segmentStart: true
                });
            } else {
                const movedMeters = getDistanceMeters(previousOdometerLoc, loc);
                const elapsedSeconds = Math.max(0.5, ((position.timestamp || now) - (previousMeta.timestamp || now)) / 1000);
                const maximumPlausibleMeters = Math.max(120, elapsedSeconds * 45);
                const minimumMovement = Math.max(7, Math.max(accuracy, Number(previousMeta.accuracy) || 0) * 0.45);
                const signalGap = elapsedSeconds > 30;

                if (signalGap || movedMeters > maximumPlausibleMeters) {
                    // No unimos el último punto conocido con el primero al recuperar señal.
                    // Para el kilometraje estimamos únicamente el hueco que pueda recorrerse
                    // sobre una geometría vehicular conocida. Visualmente sigue siendo un corte.
                    const gapRoadKm = getKnownRoadGapDistanceKm(
                        previousOdometerLoc,
                        loc,
                        [
                            navigationGeometryRef.current,
                            selectedRoute?.originalPlan?.geometry,
                            selectedRoute?.technicalData?.geometry
                        ]
                    );
                    const maxGapKmByTime = Math.max(0.25, elapsedSeconds * 0.05); // hasta 180 km/h
                    const acceptedGapKm = gapRoadKm > 0 && gapRoadKm <= maxGapKmByTime
                        ? gapRoadKm
                        : 0;

                    if (acceptedGapKm > 0) {
                        pendingDistanceKmRef.current += acceptedGapKm;
                        pendingGapDistanceKmRef.current += acceptedGapKm;
                    }

                    console.warn('Corte/reconexión GPS: se inicia un nuevo segmento.', {
                        movedMeters,
                        elapsedSeconds,
                        accuracy,
                        estimatedRoadGapKm: acceptedGapKm
                    });
                    pendingRoutePointsRef.current.push({
                        ...loc,
                        recordedAt: new Date(position.timestamp || now).toISOString(),
                        accuracy,
                        segmentStart: true,
                        gpsGap: signalGap,
                        gapSeconds: Math.round(elapsedSeconds),
                        gapEstimatedKm: acceptedGapKm,
                        gapFillSource: acceptedGapKm > 0 ? 'known-road-geometry' : 'unresolved-gap'
                    });
                    if (pendingRoutePointsRef.current.length > 20) {
                        pendingRoutePointsRef.current = pendingRoutePointsRef.current.slice(-20);
                    }
                    odometerLocRef.current = loc;
                    odometerMetaRef.current = { timestamp: position.timestamp || now, accuracy };
                } else if (movedMeters >= minimumMovement) {
                    pendingDistanceKmRef.current += movedMeters / 1000;
                    pendingRoutePointsRef.current.push({
                        ...loc,
                        recordedAt: new Date(position.timestamp || now).toISOString(),
                        accuracy
                    });
                    if (pendingRoutePointsRef.current.length > 20) pendingRoutePointsRef.current = pendingRoutePointsRef.current.slice(-20);
                    odometerLocRef.current = loc;
                    odometerMetaRef.current = { timestamp: position.timestamp || now, accuracy };
                }
            }
        } else if (selectedRoute?.status === 'En Ruta' && !serviceDistanceActive) {
            odometerLocRef.current = loc;
            odometerMetaRef.current = { timestamp: position.timestamp || now, accuracy };
            pendingDistanceKmRef.current = 0;
            pendingRoutePointsRef.current = [];
        }
      },
      (gpsError) => {
          console.error('Error de GPS:', gpsError);
      },
      {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 20000
      }
    );

    return () => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [currentDriver?.id, currentDriver?.isOnline, selectedRoute?.id, selectedRoute?.status]);

  const driverLocationForMap = useMemo(() => {
      return (
          normalizePoint(userLocation) ||
          normalizePoint(selectedRoute?.currentLocation) ||
          normalizePoint(currentDriver?.currentLocation)
      );
  }, [userLocation, selectedRoute?.currentLocation, currentDriver?.currentLocation]);

  // Mantiene visible al conductor en la torre incluso después de finalizar una ruta.
  useEffect(() => {
      if (!currentDriver?.id || !currentDriver?.isOnline) return undefined;
      const publishIdleLocation = () => {
          const loc = normalizePoint(latestLocRef.current || driverLocationForMap);
          if (!loc) return;
          updateDoc(doc(db, 'conductores', currentDriver.id), {
              currentLocation: loc,
              heading: normalizeHeadingDegrees(userHeadingRef.current),
              lastLocationUpdate: new Date().toISOString()
          }).catch(error => console.warn('No se pudo actualizar la ubicación del conductor:', error));
      };
      publishIdleLocation();
      const interval = setInterval(publishIdleLocation, 10000);
      return () => clearInterval(interval);
  }, [currentDriver?.id, currentDriver?.isOnline]);


  // Envío por lotes de ubicación, ruta recalculada, rumbo, ETA y precio oficial.
  // La geometría pesada solo se publica cuando Google recalcula la ruta.
  useEffect(() => {
      if (!currentDriver || selectedRoute?.status !== 'En Ruta' || !selectedRoute?.id) return undefined;

      const flushTelemetry = async (force = false) => {
          if (telemetryBusyRef.current) return;

          const loc = normalizePoint(latestLocRef.current || driverLocationForMap);
          if (!loc) return;

          const now = Date.now();
          if (!force && now - lastDriverLocationWriteRef.current < 10000) return;

          telemetryBusyRef.current = true;
          lastDriverLocationWriteRef.current = now;

          const distanceToFlush = pendingDistanceKmRef.current;
          const gapDistanceToFlush = pendingGapDistanceKmRef.current;
          const pointsToFlush = pendingRoutePointsRef.current.slice(-10);
          const shouldPublishGeometry =
              liveRoutePublishDirtyRef.current &&
              normalizePath(liveRouteGeometryRef.current).length > 1;

          try {
              const updatedAt = new Date().toISOString();
              const heading = normalizeHeadingDegrees(userHeadingRef.current);

              const liveNavigation = {
                  ...liveNavigationRef.current,
                  stopIndex: nextStopIdx,
                  currentStopIndex: nextStopIdx,
                  driverId: currentDriver.id,
                  heading,
                  updatedAt
              };

              const payload = {
                  currentLocation: loc,
                  currentStopIndex: nextStopIdx,
                  nextStopIdx,
                  liveHeading: heading,
                  lastUpdate: updatedAt,
                  liveNavigation
              };

              if (livePricingRef.current?.total !== undefined) {
                  payload.pricing = {
                      ...livePricingRef.current,
                      updatedAt
                  };
                  payload.pricingStatus = 'Calculada por conductor';
              }

              if (shouldPublishGeometry) {
                  // Publicamos una geometría con suficiente detalle para que la torre no
                  // dibuje atajos rectos entre calles. El mapa del conductor conserva aún más detalle.
                  payload.liveRouteGeometry = downsamplePath(liveRouteGeometryRef.current, 1800);
                  payload.liveRouteUpdatedAt = updatedAt;
              }

              if (distanceToFlush > 0) {
                  payload.realDistanceDriven = increment(distanceToFlush);
              }
              if (gapDistanceToFlush > 0) {
                  payload.gpsGapEstimatedDistanceKm = increment(gapDistanceToFlush);
              }

              if (pointsToFlush.length > 0) {
                  payload.rutaReal = arrayUnion(...pointsToFlush);
              }

              await updateDoc(doc(db, 'rutas', selectedRoute.id), payload);

              if (distanceToFlush > 0) {
                  committedDistanceKmRef.current = roundMoney(
                      committedDistanceKmRef.current + distanceToFlush
                  );
                  pendingDistanceKmRef.current = Math.max(
                      0,
                      pendingDistanceKmRef.current - distanceToFlush
                  );
              }
              if (gapDistanceToFlush > 0) {
                  pendingGapDistanceKmRef.current = Math.max(
                      0,
                      pendingGapDistanceKmRef.current - gapDistanceToFlush
                  );
              }

              if (pointsToFlush.length > 0) {
                  pendingRoutePointsRef.current = [];
              }

              if (shouldPublishGeometry) {
                  liveRoutePublishDirtyRef.current = false;
              }

              if (currentDriver.isOnline) {
                  updateDoc(doc(db, 'conductores', currentDriver.id), {
                      currentLocation: loc,
                      heading,
                      lastLocationUpdate: updatedAt
                  }).catch(() => {});
              }
          } catch (e) {
              console.error('Error enviando telemetría:', e);
          } finally {
              telemetryBusyRef.current = false;
          }
      };

      flushTelemetryRef.current = flushTelemetry;
      flushTelemetry();
      const interval = setInterval(flushTelemetry, 12000);

      return () => {
          clearInterval(interval);
          flushTelemetryRef.current = async () => {};
      };
  }, [
      currentDriver?.id,
      currentDriver?.isOnline,
      selectedRoute?.id,
      selectedRoute?.status,
      nextStopIdx
  ]);

  const snappedLocation = useMemo(() => {
      const liveGeometry = normalizePath(liveRouteData.geometry);
      const savedGeometry = normalizePath(selectedRoute?.technicalData?.geometry);
      const geo = liveGeometry.length > 0 ? liveGeometry : savedGeometry;
      return getSnappedLocation(driverLocationForMap, geo);
  }, [driverLocationForMap, liveRouteData.geometry, selectedRoute?.technicalData?.geometry]);

  useEffect(() => {
      // La cámara sigue el GPS REAL. El marcador puede pegarse visualmente a la ruta,
      // pero una geometría vieja nunca debe congelar el desplazamiento del mapa.
      const cameraLocation = normalizePoint(driverLocationForMap);
      if (!isTrackingRef.current || !mapRef.current || selectedRoute?.status !== 'En Ruta' || !cameraLocation) return;

      const now = Date.now();
      if (now - lastCameraMoveRef.current < 1200) return;

      safeSetMapCamera(mapRef.current, cameraLocation, userHeading, 17);
      lastCameraMoveRef.current = now;
  }, [driverLocationForMap, selectedRoute?.status, userHeading]);

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

      try {
          const distanceKm = Number(incomingOffer?.technicalData?.totalDistance) || 0;
          const durationMinutes = Number(incomingOffer?.technicalData?.totalDuration) || 0;
          const acceptedAt = new Date().toISOString();

          const officialPricing = {
              ...calculateTripLogixFare(incomingOffer, {
                  distanceKm,
                  durationMinutes
              }),
              source: 'driver-planned-route',
              updatedAt: acceptedAt,
              model: 'TripLogix calculado por la app del conductor'
          };

          await updateDoc(doc(db, "rutas", incomingOffer.id), {
              driver: currentDriver.name,
              driverId: currentDriver.id,
              driverPhone: currentDriver.phone || '',
              driverVehicle: currentDriver.vehicle || '',
              vehicleModel: currentDriver.vehicleModel || '',
              vehicleType: currentDriver.vehicleType || '',
              vehiclePlate: currentDriver.vehiclePlate || '',
              driverPhoto: currentDriver.fotoPerfil || '',
              driverRating: Number(currentDriver.rating) || 5,
              ofertaEstado: 'Aceptada',
              status: 'Aceptada',
              acceptedAt,
              pricing: officialPricing,
              pricingStatus: 'Calculada por conductor'
          });

          setIncomingOffer(null);
          setMainTab('Pendientes');
      } catch (e) {
          console.error('Error al aceptar viaje:', e);
          alert("Error al aceptar viaje");
      }
  };
  const rechazarViaje = async () => {
      if (!incomingOffer || !currentDriver) return;
      try { await updateDoc(doc(db, "rutas", incomingOffer.id), { ofertaEstado: 'Rechazada', rechazadoPor: arrayUnion(currentDriver.id), ofertaPara: '' }); setIncomingOffer(null); } catch (e) {}
  };

  useEffect(() => {
      if (selectedRoute?.status !== 'En Ruta') return undefined;

      setRouteUpdateTick(t => t + 1);
      const interval = setInterval(() => setRouteUpdateTick(t => t + 1), 30000);
      return () => clearInterval(interval);
  }, [selectedRoute?.id, selectedRoute?.status]);

  useEffect(() => {
      if (
          selectedRoute?.status !== 'En Ruta' ||
          !selectedRoute?.id ||
          allTargets.length === 0
      ) return;

      const loc = normalizePoint(latestLocRef.current || driverLocationForMap);
      if (!loc) return;

      const plannedGeometry = normalizePath(selectedRoute?.technicalData?.geometry);
      const fallbackMetrics = getFallbackRouteMetrics(
          loc,
          allTargets,
          nextStopIdx,
          plannedGeometry
      );

      const applyMetricsAndProximity = (metrics, geometry = null) => {
          const nextDistMeters = Math.max(0, Number(metrics.nextDistMeters) || 0);
          const remainingDistMeters = Math.max(0, Number(metrics.remainingDistMeters) || 0);
          const nextDurMins = Math.max(0, Number(metrics.nextDurMins) || 0);
          const totalDurMins = Math.max(0, Number(metrics.totalDurMins) || 0);
          const source = geometry
              ? 'driver-google-directions'
              : 'driver-fallback';

          const heading = normalizeHeadingDegrees(userHeadingRef.current);
          const updatedAt = new Date().toISOString();

          liveNavigationRef.current = {
              distanceKm: roundMoney(remainingDistMeters / 1000),
              durationMinutes: Math.round(totalDurMins),
              nextStopDistanceKm: roundMoney(nextDistMeters / 1000),
              nextStopDurationMinutes: Math.round(nextDurMins),
              distanceMeters: Math.round(remainingDistMeters),
              durationSeconds: Math.round(totalDurMins * 60),
              totalDistanceMeters: Math.round(remainingDistMeters),
              totalDurationSeconds: Math.round(totalDurMins * 60),
              nextStopDistanceMeters: Math.round(nextDistMeters),
              nextStopDurationSeconds: Math.round(nextDurMins * 60),
              stopIndex: nextStopIdx,
              currentStopIndex: nextStopIdx,
              heading,
              source,
              updatedAt
          };

          const drivenDistanceKm =
              committedDistanceKmRef.current +
              pendingDistanceKmRef.current;

          livePricingRef.current = calculateDriverProjectedPricing({
              route: selectedRoute,
              remainingDistanceMeters: remainingDistMeters,
              remainingDurationMinutes: totalDurMins,
              drivenDistanceKm,
              source: geometry
                  ? 'driver-live-route'
                  : 'driver-live-fallback'
          });

          if (geometry) {
              const normalizedGeometry = normalizePath(geometry);
              if (normalizedGeometry.length > 1) {
                  liveRouteGeometryRef.current = normalizedGeometry;
                  liveRoutePublishDirtyRef.current = true;
              }
          }

          setLiveRouteData(prev => {
              const nextGeometry = geometry
                  ? normalizePath(geometry)
                  : prev.geometry;

              const nextState = {
                  geometry: nextGeometry,
                  totalDuration: totalDurMins,
                  totalDistance: (remainingDistMeters / 1000).toFixed(1),
                  nextStopDuration: nextDurMins,
                  nextStopDistance: (nextDistMeters / 1000).toFixed(1)
              };

              const same =
                  prev.totalDuration === nextState.totalDuration &&
                  prev.totalDistance === nextState.totalDistance &&
                  prev.nextStopDuration === nextState.nextStopDuration &&
                  prev.nextStopDistance === nextState.nextStopDistance &&
                  prev.geometry === nextState.geometry;

              return same ? prev : nextState;
          });

          if (
              (nextDistMeters <= 500 || nextDurMins <= 2) &&
              !alertedStops.includes(nextStopIdx)
          ) {
              setAlertedStops(prev => prev.includes(nextStopIdx) ? prev : [...prev, nextStopIdx]);
              setIsApproaching(true);

              updateDoc(doc(db, 'rutas', selectedRoute.id), {
                  proximityAlert: {
                      active: true,
                      stopIndex: nextStopIdx,
                      passenger: allTargets[nextStopIdx]?.contact || 'Pasajero',
                      etaMins: nextDurMins,
                      timestamp: updatedAt
                  }
              }).catch(e => console.error('Error enviando alerta de proximidad:', e));
          }
      };

      // La interfaz recibe datos inmediatamente sin esperar a Google.
      applyMetricsAndProximity(fallbackMetrics);

      if (!isLoaded || !window.google?.maps?.DirectionsService || directionsBusyRef.current) {
          return;
      }

      const now = Date.now();
      const previousOrigin = normalizePoint(lastDirectionsOriginRef.current);
      const movedSinceLastRoute = previousOrigin
          ? getDistanceMeters(previousOrigin, loc)
          : Infinity;

      const stopChanged = lastDirectionsStopRef.current !== nextStopIdx;
      const routeExpired = now - lastDirectionsRequestRef.current >= 30000;
      const driverLeftRouteArea = movedSinceLastRoute >= 90;

      if (!stopChanged && !routeExpired && !driverLeftRouteArea) return;

      if (!directionsServiceRef.current) {
          directionsServiceRef.current = new window.google.maps.DirectionsService();
      }

      const getDirectionsLocation = (target) => {
          if (!target) return null;
          const address = String(target.address || '').trim();
          // Preferir la dirección textual hace que Google resuelva el acceso vehicular
          // de la calle, en lugar de terminar exactamente sobre una coordenada interna
          // del predio que puede dibujar una línea sobre casas o lotes.
          if (address.length >= 6) return address;
          const point = normalizePoint(target);
          return point ? { lat: point.lat, lng: point.lng } : null;
      };

      const destinationTarget = allTargets[allTargets.length - 1];
      const destinationLocation = getDirectionsLocation(destinationTarget);
      if (!destinationLocation) return;

      const waypoints = [];
      for (let i = nextStopIdx; i < allTargets.length - 1; i++) {
          const location = getDirectionsLocation(allTargets[i]);
          if (location) {
              waypoints.push({ location, stopover: true });
          }
      }

      directionsBusyRef.current = true;
      lastDirectionsRequestRef.current = now;
      lastDirectionsOriginRef.current = loc;
      lastDirectionsStopRef.current = nextStopIdx;

      const requestId = ++directionsRequestIdRef.current;

      directionsServiceRef.current.route({
          origin: { lat: loc.lat, lng: loc.lng },
          destination: destinationLocation,
          waypoints,
          optimizeWaypoints: false,
          travelMode: window.google.maps.TravelMode.DRIVING,
          provideRouteAlternatives: waypoints.length === 0,
          avoidFerries: true,
          avoidHighways: false,
          avoidTolls: false,
          drivingOptions: {
              departureTime: new Date(),
              trafficModel: window.google.maps.TrafficModel?.BEST_GUESS || 'bestguess'
          }
      }, (result, status) => {
          if (requestId !== directionsRequestIdRef.current) return;
          directionsBusyRef.current = false;

          if (
              status !== window.google.maps.DirectionsStatus.OK ||
              !result?.routes?.[0]
          ) {
              console.warn('DirectionsService no disponible:', status);
              return;
          }

          const route = [...result.routes].sort((a, b) => {
              const distanceA = (a.legs || []).reduce((sum, leg) => sum + (Number(leg.distance?.value) || 0), 0);
              const distanceB = (b.legs || []).reduce((sum, leg) => sum + (Number(leg.distance?.value) || 0), 0);
              return distanceA - distanceB;
          })[0];
          const legs = Array.isArray(route.legs) ? route.legs : [];
          let remainingMeters = 0;
          let remainingSeconds = 0;

          const steps = [];
          legs.forEach((leg, legIndex) => {
              remainingMeters += Number(leg.distance?.value) || 0;
              remainingSeconds += Number(leg.duration?.value) || 0;

              (leg.steps || []).forEach((step, stepIndex) => {
                  const startPoint = normalizePoint({
                      lat: typeof step.start_location?.lat === 'function'
                          ? step.start_location.lat()
                          : step.start_location?.lat,
                      lng: typeof step.start_location?.lng === 'function'
                          ? step.start_location.lng()
                          : step.start_location?.lng
                  });

                  const endPoint = normalizePoint({
                      lat: typeof step.end_location?.lat === 'function'
                          ? step.end_location.lat()
                          : step.end_location?.lat,
                      lng: typeof step.end_location?.lng === 'function'
                          ? step.end_location.lng()
                          : step.end_location?.lng
                  });

                  if (!endPoint) return;

                  steps.push({
                      key: `${legIndex}-${stepIndex}`,
                      instruction: translateNavigationInstruction(step.instructions || 'Continúa por la ruta'),
                      distanceMeters: Number(step.distance?.value) || 0,
                      distanceText: step.distance?.text || '',
                      start: startPoint,
                      end: endPoint
                  });
              });
          });

          const firstLeg = legs[0];
          const nextDistMeters =
              Number(firstLeg?.distance?.value) ||
              fallbackMetrics.nextDistMeters;
          const nextDurMins =
              Math.max(1, Math.round((Number(firstLeg?.duration?.value) || 0) / 60)) ||
              fallbackMetrics.nextDurMins;
          const totalDurMins =
              Math.max(1, Math.round(remainingSeconds / 60)) ||
              fallbackMetrics.totalDurMins;

          // Usar la geometría detallada de cada paso. overview_path puede simplificar
          // curvas y aparentar que la ruta atraviesa manzanas cuando se hace zoom.
          const detailedPath = [];
          legs.forEach(leg => {
              (leg.steps || []).forEach(step => {
                  const stepPath = Array.isArray(step.path) ? step.path : [];
                  stepPath.forEach(point => {
                      const normalized = normalizePoint({
                          lat: typeof point.lat === 'function' ? point.lat() : point.lat,
                          lng: typeof point.lng === 'function' ? point.lng() : point.lng
                      });
                      if (normalized) detailedPath.push(normalized);
                  });
              });
          });

          const overviewPath = (route.overview_path || []).map(point => ({
              lat: typeof point.lat === 'function' ? point.lat() : point.lat,
              lng: typeof point.lng === 'function' ? point.lng() : point.lng
          }));

          // Mantener el trazado detallado que Google confirma sobre calles.
          // No hacemos muestreo uniforme: era la causa principal de los "atajos" visuales.
          const routeGeometry = normalizePath(
              detailedPath.length > 1 ? detailedPath : overviewPath
          );

          const firstLegEnd = normalizePoint({
              lat: typeof firstLeg?.end_location?.lat === 'function' ? firstLeg.end_location.lat() : firstLeg?.end_location?.lat,
              lng: typeof firstLeg?.end_location?.lng === 'function' ? firstLeg.end_location.lng() : firstLeg?.end_location?.lng
          });
          if (firstLegEnd) setResolvedNextStopLocation(firstLegEnd);

          navigationStepsRef.current = steps;
          navigationGeometryRef.current = routeGeometry;

          applyMetricsAndProximity({
              nextDistMeters,
              remainingDistMeters: remainingMeters || fallbackMetrics.remainingDistMeters,
              nextDurMins,
              totalDurMins
          }, routeGeometry);

          // Publica en Firestore la misma distancia y ETA mostradas al conductor.
          // La app de cliente leerá route.liveNavigation para evitar diferencias.
          flushTelemetryRef.current(true).catch(() => {});

          navigationStepIndexRef.current = 0;
          const nextStep = getNextNavigationStep(loc, steps, navigationStepIndexRef.current);
          if (nextStep) {
              navigationStepIndexRef.current = Math.max(
                  navigationStepIndexRef.current,
                  nextStep.index
              );
              setNextManeuver(prev => {
                  const next = {
                      instruction: nextStep.instruction,
                      distance: nextStep.distanceText || formatInstructionDistance(nextStep.meters),
                      voiceKey: nextStep.voiceKey
                  };

                  return (
                      prev.instruction === next.instruction &&
                      prev.distance === next.distance &&
                      prev.voiceKey === next.voiceKey
                  ) ? prev : next;
              });
          }
      });
  }, [
      routeUpdateTick,
      nextStopIdx,
      selectedRoute?.id,
      selectedRoute?.status,
      selectedRoute?.technicalData?.geometry,
      allTargets,
      alertedStops,
      isLoaded
  ]);

  // Actualiza el texto de la maniobra usando la ruta ya descargada.
  // No vuelve a consultar Google y, por lo tanto, no sobrecarga el mapa.
  useEffect(() => {
      if (selectedRoute?.status !== 'En Ruta') return;

      const loc = normalizePoint(driverLocationForMap);
      const steps = navigationStepsRef.current;
      if (!loc || !steps.length) return;

      const nextStep = getNextNavigationStep(loc, steps, navigationStepIndexRef.current);
      if (!nextStep) return;

      navigationStepIndexRef.current = Math.max(
          navigationStepIndexRef.current,
          nextStep.index
      );

      setNextManeuver(prev => {
          const next = {
              instruction: nextStep.instruction,
              distance: nextStep.distanceText || formatInstructionDistance(nextStep.meters),
              voiceKey: nextStep.voiceKey
          };

          return (
              prev.instruction === next.instruction &&
              prev.distance === next.distance &&
              prev.voiceKey === next.voiceKey
          ) ? prev : next;
      });
  }, [driverLocationForMap, selectedRoute?.status]);

  const centerOnUser = () => {
      setIsTracking(true);
      const cameraLocation = normalizePoint(latestLocRef.current || driverLocationForMap || snappedLocation);
      if (mapRef.current && cameraLocation) {
          safeSetMapCamera(mapRef.current, cameraLocation, userHeading, 17);
      }
  };

  const handleMapDrag = () => { setIsTracking(false); };

  const cerrarRuta = () => {
      localStorage.removeItem('active_trip_id');
      setShowTripChat(false);
      setSelectedRoute(null);
      nextStopIdxRef.current = 0;
      serviceDistanceStartedRef.current = false;
      serviceDistanceStartedAtRef.current = '';
      setNextStopIdx(0);
      setAlertedStops([]);
      setIsApproaching(false);
      setIsWaiting(false);
      setLiveRouteData({ geometry: [], totalDuration: 0, totalDistance: 0, nextStopDuration: 0, nextStopDistance: 0 });
      setNextManeuver({ instruction: '', distance: '' });
      setIsPanelExpanded(true);
      setIsTracking(true);
      odometerLocRef.current = null;
      odometerMetaRef.current = { timestamp: 0, accuracy: Infinity };
      prevLocRef.current = null;
      mapRef.current = null;
      mapReadyRef.current = false;
      directionsBusyRef.current = false;
      directionsRequestIdRef.current += 1;
      directionsServiceRef.current = null;
      navigationStepsRef.current = [];
      navigationStepIndexRef.current = 0;
      navigationGeometryRef.current = [];
      lastDirectionsOriginRef.current = null;
      lastDirectionsRequestRef.current = 0;
      lastDirectionsStopRef.current = null;
      pendingDistanceKmRef.current = 0;
      pendingGapDistanceKmRef.current = 0;
      pendingRoutePointsRef.current = [];
      committedDistanceKmRef.current = 0;
      liveRouteGeometryRef.current = [];
      livePricingRef.current = null;
      liveRoutePublishDirtyRef.current = false;
      liveNavigationRef.current = { distanceKm: 0, durationMinutes: 0, nextStopDistanceKm: 0, nextStopDurationMinutes: 0, stopIndex: 0, source: 'driver-fallback' };

      if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
      }
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
                      (err) => { console.error('No se pudo obtener la ubicación precisa:', err); alert('Activa la ubicación precisa para aparecer correctamente en la torre de control.'); },
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

  const abrirWhatsAppPasajero = (route = selectedRoute, target = null, stopIndex = nextStopIdx) => {
      const phoneNumber = getRoutePassengerPhone(route, target, stopIndex);

      if (!phoneNumber) {
          alert('Este pasajero no tiene un número de WhatsApp registrado. Agrégalo desde el despachador para habilitar este botón.');
          return;
      }

      const passengerName = String(
          target?.passengerName ||
          target?.contact ||
          route?.client ||
          'pasajero'
      ).trim();

      const message = encodeURIComponent(
          `Hola ${passengerName}, soy tu conductor de TripLogix. Estoy en ruta y te contacto sobre tu servicio.`
      );

      const url = `https://wa.me/${phoneNumber}?text=${message}`;
      const opened = window.open(url, '_blank', 'noopener,noreferrer');

      if (!opened) {
          window.location.href = url;
      }
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

  const advanceAfterStop = async (isFinalDestination) => {
      setEvidence(null);
      setIsWaiting(false);
      setIsApproaching(false);

      if (isFinalDestination) {
          await handleEndTrip(selectedRoute.id);
          return;
      }

      const newIdx = Math.min(nextStopIdx + 1, Math.max(0, allTargets.length - 1));
      nextStopIdxRef.current = newIdx;
      setNextStopIdx(newIdx);
      setSelectedRoute(prev => prev ? {
          ...prev,
          currentStopIndex: newIdx,
          nextStopIdx: newIdx,
          proximityAlert: { ...(prev.proximityAlert || {}), active: false }
      } : prev);
      localStorage.setItem(`trip_idx_${selectedRoute.id}`, String(newIdx));
      setRouteUpdateTick(t => t + 1);

      try {
          await updateDoc(doc(db, 'rutas', selectedRoute.id), {
              currentStopIndex: newIdx,
              nextStopIdx: newIdx,
              'proximityAlert.active': false,
              lastUpdate: new Date().toISOString()
          });
      } catch (advanceError) {
          console.warn('No se pudo publicar el siguiente punto:', advanceError);
      }
  };

  const confirmarAbordaje = async (isFinalDestination) => {
      const target = allTargets[nextStopIdx] || {};
      const nowIso = new Date().toISOString();
      const nowTime = getMexicoTime();
      const isDropoff = isSalidaRoute(selectedRoute) && nextStopIdx > 0;
      const llegadaData = {
          eventId: `${selectedRoute.id}-${isDropoff ? 'dropoff' : 'boarding'}-${nextStopIdx}-${Date.now()}`,
          type: isDropoff ? 'dropoff' : (isFinalDestination ? 'destination_arrival' : 'boarding'),
          status: isDropoff ? 'Pasajero en destino' : (isFinalDestination ? 'Destino confirmado' : 'Pasajero a bordo'),
          stopIndex: nextStopIdx,
          label: target?.label || (isFinalDestination ? 'Destino Final' : `Punto ${nextStopIdx + 1}`),
          passenger: target?.contact || target?.passengerName || 'Pasajero',
          address: target?.address || '',
          photo: evidence || '',
          location: normalizePoint(userLocation),
          time: nowTime,
          timestamp: nowIso
      };

      const auditEntry = {
          evento: isDropoff ? 'Pasajero descargado / en destino' : (isFinalDestination ? 'Llegada al destino final' : 'Pasajero a bordo'),
          motivo: llegadaData.passenger,
          punto: llegadaData.label,
          stopIndex: nextStopIdx,
          timestamp: nowIso,
          time: nowTime
      };

      const updates = {
          evidenciasLlegada: arrayUnion(llegadaData),
          stopEvents: arrayUnion(llegadaData),
          bitacora: arrayUnion(auditEntry),
          chat: arrayUnion({
              sender: 'Sistema',
              text: isDropoff
                  ? `Pasajero en destino en ${llegadaData.label}: ${llegadaData.passenger}`
                  : (isFinalDestination
                      ? `Destino final confirmado: ${llegadaData.passenger}`
                      : `Pasajero a bordo en ${llegadaData.label}: ${llegadaData.passenger}`),
              time: nowTime,
              timestamp: nowIso,
              stopIndex: nextStopIdx
          }),
          'proximityAlert.active': false,
          lastUpdate: nowIso
      };

      if (nextStopIdx === 0 && !isFinalDestination) {
          const startLocation = normalizePoint(userLocation);
          updates.firstStopAttendedTime = nowTime;
          updates.firstStopAttendedTimestamp = nowIso;
          updates.firstStopAttendedStatus = 'Pasajero a bordo';
          updates.firstStopAttendedPassenger = llegadaData.passenger;
          updates.firstStopAttendedLocation = startLocation;
          updates.firstBoardingTime = nowTime;
          updates.firstBoardingTimestamp = nowIso;

          if (!serviceDistanceStartedRef.current) {
              updates.serviceDistanceStartedAt = nowIso;
              updates.serviceDistanceStartLocation = startLocation;
              updates.realDistanceDriven = 0;
              updates.rutaReal = startLocation ? [{ ...startLocation, recordedAt: nowIso, accuracy: 0, segmentStart: true }] : [];

              serviceDistanceStartedRef.current = true;
              serviceDistanceStartedAtRef.current = nowIso;
              odometerLocRef.current = startLocation;
              odometerMetaRef.current = { timestamp: Date.now(), accuracy: 0 };
              pendingDistanceKmRef.current = 0;
              pendingGapDistanceKmRef.current = 0;
              pendingRoutePointsRef.current = [];
              committedDistanceKmRef.current = 0;
          }
      }

      try {
          await updateDoc(doc(db, 'rutas', selectedRoute.id), updates);
          setSelectedRoute(prev => prev ? {
              ...prev,
              ...(nextStopIdx === 0 && !isFinalDestination ? {
                  firstStopAttendedTime: nowTime,
                  firstStopAttendedTimestamp: nowIso,
                  firstStopAttendedStatus: 'Pasajero a bordo',
                  firstStopAttendedPassenger: llegadaData.passenger,
                  firstStopAttendedLocation: normalizePoint(userLocation),
                  firstBoardingTime: nowTime,
                  firstBoardingTimestamp: nowIso,
                  serviceDistanceStartedAt: updates.serviceDistanceStartedAt || prev.serviceDistanceStartedAt,
                  serviceDistanceStartLocation: updates.serviceDistanceStartLocation || prev.serviceDistanceStartLocation
              } : {}),
              proximityAlert: { ...(prev.proximityAlert || {}), active: false }
          } : prev);
          await advanceAfterStop(isFinalDestination);
      } catch (boardingError) {
          console.error('No se pudo registrar el abordaje:', boardingError);
          alert('No se pudo guardar el abordaje. Revisa la conexión e inténtalo de nuevo.');
      }
  };

  const reportarAusencia = async (isFinalDestination) => {
      const target = allTargets[nextStopIdx] || {};
      const passengerName = target?.contact || target?.passengerName || 'Pasajero';
      const reasonInput = window.prompt(
          `Motivo para ${passengerName}: escribe "NO SALIÓ" o "CANCELÓ".`,
          'NO SALIÓ'
      );
      if (reasonInput === null) return;
      const normalizedReason = String(reasonInput || '').trim().toUpperCase();
      const absenceStatus = normalizedReason.includes('CANCEL')
          ? 'Canceló'
          : 'No se presentó';

      const confirmed = window.confirm(
          `Se registrará "${absenceStatus}" para ${passengerName} y el viaje continuará al siguiente punto. ¿Confirmas?`
      );
      if (!confirmed) return;

      const nowIso = new Date().toISOString();
      const nowTime = getMexicoTime();
      const noShowData = {
          eventId: `${selectedRoute.id}-absence-${nextStopIdx}-${Date.now()}`,
          type: 'absence',
          status: absenceStatus,
          stopIndex: nextStopIdx,
          label: target?.label || `Punto ${nextStopIdx + 1}`,
          passenger: passengerName,
          address: target?.address || '',
          photo: evidence || '',
          location: normalizePoint(userLocation),
          time: nowTime,
          timestamp: nowIso
      };

      const auditEntry = {
          evento: absenceStatus === 'Canceló' ? 'Pasajero canceló' : 'Pasajero no se presentó',
          motivo: passengerName,
          punto: noShowData.label,
          stopIndex: nextStopIdx,
          timestamp: nowIso,
          time: nowTime
      };

      try {
          const absenceUpdates = {
              evidencias: arrayUnion(noShowData),
              stopEvents: arrayUnion(noShowData),
              bitacora: arrayUnion(auditEntry),
              chat: arrayUnion({
                  sender: 'Sistema',
                  text: `${absenceStatus} en ${noShowData.label}: ${passengerName}. El conductor continúa al siguiente punto.`,
                  time: nowTime,
                  timestamp: nowIso,
                  stopIndex: nextStopIdx
              }),
              'proximityAlert.active': false,
              lastUpdate: nowIso
          };

          if (nextStopIdx === 0) {
              const startLocation = normalizePoint(userLocation);
              absenceUpdates.firstStopAttendedTime = nowTime;
              absenceUpdates.firstStopAttendedTimestamp = nowIso;
              absenceUpdates.firstStopAttendedStatus = absenceStatus;
              absenceUpdates.firstStopAttendedPassenger = passengerName;
              absenceUpdates.firstStopAttendedLocation = startLocation;

              if (!serviceDistanceStartedRef.current) {
                  absenceUpdates.serviceDistanceStartedAt = nowIso;
                  absenceUpdates.serviceDistanceStartLocation = startLocation;
                  absenceUpdates.realDistanceDriven = 0;
                  absenceUpdates.rutaReal = startLocation ? [{ ...startLocation, recordedAt: nowIso, accuracy: 0, segmentStart: true }] : [];

                  serviceDistanceStartedRef.current = true;
                  serviceDistanceStartedAtRef.current = nowIso;
                  odometerLocRef.current = startLocation;
                  odometerMetaRef.current = { timestamp: Date.now(), accuracy: 0 };
                  pendingDistanceKmRef.current = 0;
                  pendingRoutePointsRef.current = [];
                  committedDistanceKmRef.current = 0;
              }
          }

          await updateDoc(doc(db, 'rutas', selectedRoute.id), absenceUpdates);
          setSelectedRoute(prev => prev ? {
              ...prev,
              ...(nextStopIdx === 0 ? {
                  firstStopAttendedTime: nowTime,
                  firstStopAttendedTimestamp: nowIso,
                  firstStopAttendedStatus: absenceStatus,
                  firstStopAttendedPassenger: passengerName,
                  firstStopAttendedLocation: normalizePoint(userLocation),
                  serviceDistanceStartedAt: absenceUpdates.serviceDistanceStartedAt || prev.serviceDistanceStartedAt,
                  serviceDistanceStartLocation: absenceUpdates.serviceDistanceStartLocation || prev.serviceDistanceStartLocation
              } : {}),
              proximityAlert: { ...(prev.proximityAlert || {}), active: false }
          } : prev);
          await advanceAfterStop(isFinalDestination);
      } catch (absenceError) {
          console.error('No se pudo registrar la ausencia:', absenceError);
          alert('No se pudo guardar la ausencia. Revisa la conexión e inténtalo de nuevo.');
      }
  };

  const getSharedPassengerKey = (passenger, index = 0) => String(
      passenger?.passengerName || passenger?.name || passenger?.contact || `Pasajero ${index + 1}`
  ).trim().toLowerCase();

  const getSharedPassengerStoredStatus = (passenger, index = 0) => {
      const key = getSharedPassengerKey(passenger, index);
      if (sharedPassengerStatuses[key]) return sharedPassengerStatuses[key];
      const events = Array.isArray(selectedRoute?.stopEvents) ? selectedRoute.stopEvents : [];
      const passengerName = String(passenger?.passengerName || passenger?.name || passenger?.contact || '').trim().toLowerCase();
      const event = [...events].reverse().find(item =>
          item?.sharedPassenger === true &&
          Number(item?.stopIndex) === Number(nextStopIdx) &&
          String(item?.passenger || '').trim().toLowerCase() === passengerName
      );
      return event?.status || '';
  };

  const registrarPasajeroCompartido = async (passenger, status, index = 0) => {
      if (!selectedRoute?.id) return;
      const target = allTargets[nextStopIdx] || {};
      const passengerName = String(passenger?.passengerName || passenger?.name || passenger?.contact || `Pasajero ${index + 1}`).trim();
      const isDropoff = isSalidaRoute(selectedRoute) && nextStopIdx > 0;
      const normalizedStatus = status === 'A bordo'
          ? (isDropoff ? 'En destino' : 'A bordo')
          : (isDropoff ? 'No se entregó' : 'No se presentó');
      const nowIso = new Date().toISOString();
      const nowTime = getMexicoTime();
      const location = normalizePoint(userLocation);
      const eventData = {
          eventId: `${selectedRoute.id}-shared-${nextStopIdx}-${index}-${Date.now()}`,
          type: normalizedStatus === 'A bordo' ? 'boarding' : normalizedStatus === 'En destino' ? 'dropoff' : 'absence',
          status: normalizedStatus,
          sharedPassenger: true,
          stopIndex: nextStopIdx,
          label: target?.label || `Punto ${nextStopIdx + 1}`,
          passenger: passengerName,
          address: target?.address || '',
          phone: passenger?.phone || passenger?.contactPhone || '',
          photo: evidence || '',
          location,
          time: nowTime,
          timestamp: nowIso
      };
      const auditEntry = {
          evento: normalizedStatus === 'A bordo'
              ? 'Pasajero compartido a bordo'
              : normalizedStatus === 'En destino'
                  ? 'Pasajero compartido descargado / en destino'
                  : isDropoff ? 'Pasajero compartido no entregado' : 'Pasajero compartido no se presentó',
          motivo: passengerName,
          punto: eventData.label,
          stopIndex: nextStopIdx,
          timestamp: nowIso,
          time: nowTime
      };
      const updates = {
          stopEvents: arrayUnion(eventData),
          bitacora: arrayUnion(auditEntry),
          chat: arrayUnion({
              sender: 'Sistema',
              text: `${passengerName}: ${normalizedStatus}`,
              time: nowTime,
              timestamp: nowIso,
              stopIndex: nextStopIdx
          }),
          'proximityAlert.active': false,
          lastUpdate: nowIso
      };
      if (evidence) {
          if (['A bordo', 'En destino'].includes(normalizedStatus)) updates.evidenciasLlegada = arrayUnion(eventData);
          else updates.evidencias = arrayUnion(eventData);
      }

      // El primer punto físico inicia el servicio aunque alguno de los pasajeros no suba.
      if (nextStopIdx === 0 && !selectedRoute?.firstStopAttendedTimestamp) {
          updates.firstStopAttendedTime = nowTime;
          updates.firstStopAttendedTimestamp = nowIso;
          updates.firstStopAttendedStatus = `Punto compartido · ${normalizedStatus}`;
          updates.firstStopAttendedPassenger = passengerName;
          updates.firstStopAttendedLocation = location;

          if (!serviceDistanceStartedRef.current) {
              updates.serviceDistanceStartedAt = nowIso;
              updates.serviceDistanceStartLocation = location;
              updates.realDistanceDriven = 0;
              updates.rutaReal = location ? [location] : [];
              serviceDistanceStartedRef.current = true;
              serviceDistanceStartedAtRef.current = nowIso;
              odometerLocRef.current = location;
              odometerMetaRef.current = { timestamp: Date.now(), accuracy: 0 };
              pendingDistanceKmRef.current = 0;
              pendingGapDistanceKmRef.current = 0;
              pendingRoutePointsRef.current = [];
              committedDistanceKmRef.current = 0;
          }
      }

      if (normalizedStatus === 'A bordo' && !selectedRoute?.firstBoardingTimestamp) {
          updates.firstBoardingTime = nowTime;
          updates.firstBoardingTimestamp = nowIso;
      }

      try {
          await updateDoc(doc(db, 'rutas', selectedRoute.id), updates);
          const key = getSharedPassengerKey(passenger, index);
          setSharedPassengerStatuses(prev => ({ ...prev, [key]: normalizedStatus }));
          setSelectedRoute(prev => prev ? {
              ...prev,
              ...(updates.firstStopAttendedTimestamp ? {
                  firstStopAttendedTime: updates.firstStopAttendedTime,
                  firstStopAttendedTimestamp: updates.firstStopAttendedTimestamp,
                  firstStopAttendedStatus: updates.firstStopAttendedStatus,
                  firstStopAttendedPassenger: updates.firstStopAttendedPassenger,
                  serviceDistanceStartedAt: updates.serviceDistanceStartedAt || prev.serviceDistanceStartedAt
              } : {}),
              ...(updates.firstBoardingTimestamp ? {
                  firstBoardingTime: updates.firstBoardingTime,
                  firstBoardingTimestamp: updates.firstBoardingTimestamp
              } : {}),
              proximityAlert: { ...(prev.proximityAlert || {}), active: false }
          } : prev);
      } catch (error) {
          console.error('No se pudo registrar al pasajero del punto compartido:', error);
          alert('No se pudo guardar el estado del pasajero. Revisa la conexión.');
      }
  };

  const continuarPuntoCompartido = async (passengers, isFinalDestination) => {
      const pendientes = passengers.filter((passenger, index) => !getSharedPassengerStoredStatus(passenger, index));
      if (pendientes.length > 0) {
          alert(`Falta registrar ${pendientes.length} pasajero${pendientes.length === 1 ? '' : 's'} antes de continuar.`);
          return;
      }
      await advanceAfterStop(isFinalDestination);
  };

  const handleSelectRoute = (ruta) => {
      committedDistanceKmRef.current = Math.max(0, Number(ruta?.realDistanceDriven) || 0);
      serviceDistanceStartedAtRef.current = String(
          ruta?.serviceDistanceStartedAt ||
          ruta?.firstStopAttendedTimestamp ||
          ruta?.firstBoardingTimestamp ||
          ''
      );
      serviceDistanceStartedRef.current = Boolean(
          serviceDistanceStartedAtRef.current ||
          Number(ruta?.realDistanceDriven) > 0 ||
          Number(ruta?.nextStopIdx ?? ruta?.currentStopIndex ?? 0) > 0
      );
      liveRouteGeometryRef.current = normalizePath(ruta?.liveRouteGeometry);
      livePricingRef.current = ruta?.pricing?.total !== undefined ? { ...ruta.pricing } : null;
      liveRoutePublishDirtyRef.current = false;

      setSelectedRoute(ruta);
      setAlertedStops([]);
      setIsApproaching(false);
      setIsWaiting(false);

      if (ruta.status === 'En Ruta') {
          localStorage.setItem('active_trip_id', ruta.id);
          const savedIdx = localStorage.getItem(`trip_idx_${ruta.id}`);
          const resolvedIdx = savedIdx
              ? parseInt(savedIdx, 10)
              : Number(ruta?.nextStopIdx ?? ruta?.currentStopIndex ?? 0) || 0;
          nextStopIdxRef.current = resolvedIdx;
          setNextStopIdx(resolvedIdx);
      } else {
          nextStopIdxRef.current = 0;
          setNextStopIdx(0);
      }
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

  useEffect(() => {
      if (!currentDriver?.id) return undefined;

      let cancelled = false;

      const configurePush = async () => {
          try {
              if (pushCleanupRef.current) {
                  await pushCleanupRef.current();
                  pushCleanupRef.current = null;
              }

              const cleanup = await setupPushNotifications({
                  onToken: async (token) => {
                      if (!token || cancelled) return;
                      await updateDoc(doc(db, 'conductores', currentDriver.id), {
                          pushToken: token,
                          pushPlatform: 'android',
                          pushUpdatedAt: new Date().toISOString()
                      });
                  },
                  onNotification: (notification) => {
                      if (cancelled) return;
                      playAlertSound();
                      if ('vibrate' in navigator) {
                          navigator.vibrate([500, 180, 500]);
                      }
                      setMainTab('Pendientes');
                  },
                  onAction: async (action) => {
                      if (cancelled) return;

                      const routeId =
                          action?.notification?.data?.routeId ||
                          action?.notification?.data?.tripId;

                      if (!routeId) {
                          setMainTab('Pendientes');
                          return;
                      }

                      try {
                          const routeSnapshot = await getDoc(doc(db, 'rutas', routeId));
                          if (routeSnapshot.exists()) {
                              handleSelectRoute({
                                  id: routeSnapshot.id,
                                  ...routeSnapshot.data()
                              });
                          }
                      } catch (pushOpenError) {
                          console.error('No se pudo abrir el viaje de la notificación:', pushOpenError);
                          setMainTab('Pendientes');
                      }
                  }
              });

              if (!cancelled) pushCleanupRef.current = cleanup;
          } catch (pushError) {
              console.error('No se pudieron configurar las notificaciones push:', pushError);
          }
      };

      configurePush();

      return () => {
          cancelled = true;
          if (pushCleanupRef.current) {
              Promise.resolve(pushCleanupRef.current()).catch(() => {});
              pushCleanupRef.current = null;
          }
      };
  }, [currentDriver?.id]);

  const cargarDatosEnFormulario = (data) => {
    setName(data.name || ''); setPhone(data.phone || ''); setAddress(data.address || ''); setRfc(data.rfc || ''); setBloodType(data.bloodType || ''); setEmergencyContact(data.emergencyContact || ''); setLicenseNumber(data.licenseNumber || ''); setLicenseType(data.licenseType || ''); setLicenseExp(data.licenseExp || ''); setVehicleModel(data.vehicleModel || ''); setVehiclePlate(data.vehiclePlate || ''); setVehicleType(data.vehicleType || ''); setPassword(data.password || '');
  };

  const escucharRutas = (driverId) => {
    if (!driverId) return;

    if (routeListenerUnsubscribeRef.current) {
        routeListenerUnsubscribeRef.current();
        routeListenerUnsubscribeRef.current = null;
    }

    const q = query(collection(db, "rutas"), where("driverId", "==", driverId));
    routeListenerUnsubscribeRef.current = onSnapshot(
        q,
        (snapshot) => {
            setMisRutas(snapshot.docs.map(routeDoc => ({
                id: routeDoc.id,
                ...routeDoc.data()
            })));
        },
        (listenerError) => {
            console.error('Error escuchando rutas:', listenerError);
        }
    );

    return routeListenerUnsubscribeRef.current;
  };

  useEffect(() => {
      return () => {
          if (routeListenerUnsubscribeRef.current) {
              routeListenerUnsubscribeRef.current();
              routeListenerUnsubscribeRef.current = null;
          }
      };
  }, []);

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
      const navigationStartedAt = new Date().toISOString();
      const plannedDistanceKm = Number(routeToStart?.technicalData?.totalDistance) || 0;
      const plannedDurationMinutes = Number(routeToStart?.technicalData?.totalDuration) || 0;
      const plannedCalculatedPricing = calculateTripLogixFare(routeToStart, {
          distanceKm: plannedDistanceKm,
          durationMinutes: plannedDurationMinutes
      });
      const initialQuotedTotal = Number(
          routeToStart?.pricing?.quotedTotal ??
          routeToStart?.pricing?.initialQuote ??
          routeToStart?.quotedTotal
      );
      const preserveWalkUpQuote = Boolean(
          routeToStart?.serviceModel === 'walk_up' &&
          Number.isFinite(initialQuotedTotal) &&
          initialQuotedTotal > 0
      );
      const plannedPricing = {
          ...plannedCalculatedPricing,
          ...(preserveWalkUpQuote ? {
              ...routeToStart.pricing,
              currency: routeToStart?.pricing?.currency || plannedCalculatedPricing.currency,
              quotedTotal: initialQuotedTotal,
              projectedTotal: plannedCalculatedPricing.total,
              total: initialQuotedTotal,
              pricingStage: 'quote_active'
          } : {}),
          source: preserveWalkUpQuote ? 'dispatcher-walk-up-quote' : 'driver-planned-route',
          updatedAt: navigationStartedAt,
          model: preserveWalkUpQuote
              ? 'TripLogix cotización inicial del despachador; recálculo al cierre si aplica'
              : 'TripLogix calculado por la app del conductor'
      };

      const immutableOriginalPlan = routeToStart?.originalPlan || {
          version: 1,
          createdAt: routeToStart?.createdDate || navigationStartedAt,
          geometry: normalizePath(routeToStart?.technicalData?.geometry),
          totalDistance: routeToStart?.technicalData?.totalDistance || null,
          totalDuration: routeToStart?.technicalData?.totalDuration || 0,
          start: routeToStart?.start || '',
          startCoords: normalizePoint(routeToStart?.startCoords),
          waypoints: Array.isArray(routeToStart?.waypoints) ? [...routeToStart.waypoints] : [],
          waypointsData: Array.isArray(routeToStart?.waypointsData) ? routeToStart.waypointsData.map(point => ({ ...point })) : [],
          end: routeToStart?.end || '',
          endCoords: normalizePoint(routeToStart?.endCoords)
      };

      const updateData = {
          status: 'En Ruta',
          originalPlan: immutableOriginalPlan,
          actualStartTime,
          actualStartTimestamp: navigationStartedAt,
          navigationStartedAt,
          pricing: plannedPricing,
          pricingStatus: 'Calculada por conductor',
          firstStopAttendedTime: null,
          firstStopAttendedTimestamp: null,
          firstStopAttendedStatus: null,
          firstStopAttendedPassenger: null,
          firstStopAttendedLocation: null,
          firstBoardingTime: null,
          firstBoardingTimestamp: null,
          serviceDistanceStartedAt: null,
          serviceDistanceStartLocation: null,
          realDistanceDriven: 0,
          gpsGapEstimatedDistanceKm: 0,
          rutaReal: [],
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

      nextStopIdxRef.current = 0;
      serviceDistanceStartedRef.current = false;
      serviceDistanceStartedAtRef.current = '';
      odometerLocRef.current = normalizePoint(userLocation);
      setNextStopIdx(0);
      setAlertedStops([]);
      setIsApproaching(false);
      setIsWaiting(false);
      setLiveRouteData({ geometry: [], totalDuration: 0, totalDistance: 0, nextStopDuration: 0, nextStopDistance: 0 });
      setNextManeuver({ instruction: '', distance: '', voiceKey: '' });

      directionsBusyRef.current = false;
      directionsRequestIdRef.current += 1;
      navigationStepsRef.current = [];
      navigationStepIndexRef.current = 0;
      navigationGeometryRef.current = [];
      lastDirectionsOriginRef.current = null;
      lastDirectionsRequestRef.current = 0;
      lastDirectionsStopRef.current = null;
      pendingDistanceKmRef.current = 0;
      pendingGapDistanceKmRef.current = 0;
      pendingRoutePointsRef.current = [];
      committedDistanceKmRef.current = Math.max(0, Number(routeToStart?.realDistanceDriven) || 0);
      liveRouteGeometryRef.current = [];
      liveRoutePublishDirtyRef.current = false;
      livePricingRef.current = plannedPricing;
      liveNavigationRef.current = { distanceKm: 0, durationMinutes: 0, nextStopDistanceKm: 0, nextStopDurationMinutes: 0, stopIndex: 0, source: 'driver-fallback' };
      setRouteUpdateTick(t => t + 1);

      // Saludo inicial de voz
      if (voiceEnabled && 'speechSynthesis' in window) {
          try {
              window.speechSynthesis.cancel();
              const utterance = new SpeechSynthesisUtterance(
                  `Viaje iniciado. Respeta el horario planificado. Primer punto programado: ${formatPickupTime(getStopPlannedTimeValue(routeToStart, 0))}.`
              );
              utterance.lang = 'es-MX';
              utterance.rate = 0.94;
              window.speechSynthesis.speak(utterance);
          } catch (voiceError) {
              console.warn('No se pudo iniciar la voz:', voiceError);
          }
      }
    } catch (e) {
        console.error(e);
        alert("Error al iniciar");
    }
  };

  const handleEndTrip = async (routeId) => {
    if (!confirm("¿Has completado el viaje por completo?")) return;

    try {
      // Vaciar primero la telemetría acumulada para que el recibo use la distancia real más reciente.
      await flushTelemetryRef.current(true);

      let routeFromRealtime = misRutas.find(item => item.id === routeId) || selectedRoute || {};
      try {
          const freshRouteSnapshot = await getDoc(doc(db, 'rutas', routeId));
          if (freshRouteSnapshot.exists()) {
              routeFromRealtime = { id: freshRouteSnapshot.id, ...freshRouteSnapshot.data() };
          }
      } catch (readError) {
          console.warn('No se pudo releer el viaje antes del recibo:', readError);
      }
      const actualEndTimestamp = new Date().toISOString();
      const actualEndTime = getMexicoTime();

      const persistedDistanceKm = Math.max(
          0,
          Number(routeFromRealtime?.realDistanceDriven) || 0,
          Number(selectedRoute?.realDistanceDriven) || 0,
          Number(committedDistanceKmRef.current) || 0
      );
      const tracedDistanceKm = calculatePathDistanceKm(
          routeFromRealtime?.rutaReal || selectedRoute?.rutaReal || []
      );
      const gpsMeasuredDistanceKm = chooseReliableDistanceKm(routeFromRealtime, persistedDistanceKm, tracedDistanceKm);
      const googleReferenceDistanceKm = Math.max(
          0,
          Number(routeFromRealtime?.officialGoogleDistanceKm) || 0,
          Number(routeFromRealtime?.googleMatchedDistanceKm) || 0,
          Number(routeFromRealtime?.originalPlan?.totalDistance) || 0,
          Number(selectedRoute?.originalPlan?.totalDistance) || 0,
          Number(routeFromRealtime?.technicalData?.totalDistance) || 0,
          Number(selectedRoute?.technicalData?.totalDistance) || 0
      );

      // Para liquidación usamos la distancia Google cuando coincide razonablemente
      // con el GPS real (margen <= 5%). Así 31.6 km vs 32.0 km se homologa a
      // la referencia vial de Google sin ocultar desvíos reales importantes.
      const relativeDifference = googleReferenceDistanceKm > 0 && gpsMeasuredDistanceKm > 0
          ? Math.abs(googleReferenceDistanceKm - gpsMeasuredDistanceKm) / googleReferenceDistanceKm
          : Infinity;
      const finalRealDistanceKm =
          googleReferenceDistanceKm > 0 && (gpsMeasuredDistanceKm <= 0 || relativeDifference <= 0.05)
              ? roundMoney(googleReferenceDistanceKm)
              : gpsMeasuredDistanceKm;
      const distanceSource =
          finalRealDistanceKm === roundMoney(googleReferenceDistanceKm)
              ? 'google-driving-reference'
              : 'gps-measured';

      const routeForReceipt = {
          ...routeFromRealtime,
          ...selectedRoute,
          id: routeId,
          actualEndTimestamp,
          actualEndTime,
          endTime: actualEndTime,
          vehicle: routeFromRealtime?.vehicle || currentDriver?.vehicle || `${currentDriver?.vehicleModel || 'Unidad'} (${currentDriver?.vehiclePlate || 'sin placas'})`,
          vehiclePlate: routeFromRealtime?.vehiclePlate || currentDriver?.vehiclePlate || '',
          gpsMeasuredDistanceKm,
          officialGoogleDistanceKm: finalRealDistanceKm,
          distanceSource,
          realDistanceDriven: finalRealDistanceKm,
          finalDistanceKm: finalRealDistanceKm
      };

      const receipt = buildTripLogixReceipt(routeForReceipt, {
          issuedAt: actualEndTimestamp,
          actualEndTimestamp,
          actualEndTime,
          distanceKm: finalRealDistanceKm
      });

      const finalPricing = {
          ...receipt.pricing,
          source: 'driver-final',
          updatedAt: actualEndTimestamp,
          model: 'TripLogix costo final calculado por la app del conductor'
      };

      const finalUpdate = {
          status: 'Finalizado',
          endTime: actualEndTime,
          actualEndTime,
          actualEndTimestamp,
          finishedAt: actualEndTimestamp,
          finalDate: getMexicoDate(),
          receipt: {
              ...receipt,
              pricing: finalPricing
          },
          pricing: finalPricing,
          pricingStatus: 'Final calculada por conductor',
          finalFare: finalPricing.total,
          gpsMeasuredDistanceKm,
          officialGoogleDistanceKm: finalRealDistanceKm,
          distanceSource,
          realDistanceDriven: finalRealDistanceKm,
          finalDistanceKm: finalRealDistanceKm,
          finalDurationMinutes: receipt.durationMinutes,
          liveHeading: normalizeHeadingDegrees(userHeadingRef.current),
          "proximityAlert.active": false
      };

      await updateDoc(doc(db, "rutas", routeId), finalUpdate);

      // El viaje termina, pero el conductor puede seguir En Línea. Publicar inmediatamente
      // su posición actual evita que la torre se quede con el cursor en el último destino.
      if (currentDriver?.id && currentDriver?.isOnline) {
          const finalDriverLocation = normalizePoint(latestLocRef.current || driverLocationForMap);
          if (finalDriverLocation) {
              await updateDoc(doc(db, 'conductores', currentDriver.id), {
                  currentLocation: finalDriverLocation,
                  heading: normalizeHeadingDegrees(userHeadingRef.current),
                  lastLocationUpdate: actualEndTimestamp,
                  lastTripFinishedAt: actualEndTimestamp
              }).catch(error => console.warn('No se pudo publicar la ubicación posterior al viaje:', error));
          }
      }

      const completedRoute = {
          ...routeForReceipt,
          ...finalUpdate,
          id: routeId
      };

      setSelectedRoute(completedRoute);
      setCompletedTripNotice(completedRoute);
      localStorage.removeItem('active_trip_id');
      localStorage.removeItem(`trip_idx_${routeId}`);
      odometerLocRef.current = null;
      odometerMetaRef.current = { timestamp: 0, accuracy: Infinity };
      serviceDistanceStartedRef.current = false;
      serviceDistanceStartedAtRef.current = '';
      pendingDistanceKmRef.current = 0;
      pendingGapDistanceKmRef.current = 0;
      pendingRoutePointsRef.current = [];
      directionsRequestIdRef.current += 1;
      directionsBusyRef.current = false;

      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } catch (e) {
      console.error('No se pudo finalizar el viaje y generar el recibo:', e);
      alert('No se pudo finalizar el viaje. Revisa la conexión e inténtalo nuevamente.');
    }
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
      return getDriverMarkerIcon();
  }, [isLoaded]);

  useEffect(() => {
      if (selectedRoute?.status !== 'En Ruta' || !mapRef.current) return;

      const timer = setTimeout(() => {
          try {
              if (window.google?.maps?.event) {
                  window.google.maps.event.trigger(mapRef.current, 'resize');
              }

              const loc = normalizePoint(latestLocRef.current);
              if (loc && isTrackingRef.current) {
                  safeSetMapCamera(mapRef.current, loc, userHeading, 17);
              }
          } catch (e) {
              console.warn('No se pudo redimensionar el mapa:', e);
          }
      }, 380);

      return () => clearTimeout(timer);
  }, [isPanelExpanded, selectedRoute?.status]);

  const navigationRenderGeometry = useMemo(() => {
      const localGoogleGeometry = normalizePath(liveRouteData.geometry);
      const publishedGoogleGeometry = normalizePath(selectedRoute?.liveRouteGeometry);

      // Durante el recorrido solo se dibuja una ruta confirmada por Google Directions.
      // La geometría OSRM del despachador es únicamente para planeación y no se usa
      // como navegación activa, evitando líneas visuales por zonas sin calles.
      return localGoogleGeometry.length > 1
          ? localGoogleGeometry
          : publishedGoogleGeometry;
  }, [liveRouteData.geometry, selectedRoute?.liveRouteGeometry]);

  if (!isReady) return null;

  const theme = { bg: darkMode ? 'bg-slate-950' : 'bg-slate-50', text: darkMode ? 'text-white' : 'text-slate-900', card: darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200', input: darkMode ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-900', activeTab: darkMode ? 'bg-slate-800 text-white' : 'bg-white text-orange-500 shadow-sm' };

  // ==============================================================
  // VISTA 1: NAVEGACIÓN EN VIVO (ESTATUS: EN RUTA)
  // ==============================================================
  if (currentDriver && selectedRoute && selectedRoute.status === 'En Ruta') {
      const currentGeometry = navigationRenderGeometry;
      const isHeadingToDestination = nextStopIdx >= allTargets.length - 1;
      const currentTarget = allTargets[nextStopIdx] || allTargets[allTargets.length - 1];
      const safeMapCenter =
          normalizePoint(selectedRoute.startCoords) ||
          currentGeometry[0] ||
          normalizePoint(currentTarget) ||
          centerMX;
      const nextStopName = currentTarget?.label || 'Destino';
      const nextStopAddress = currentTarget?.address || '';
      const plannedCurrentStopTimeRaw = getStopPlannedTimeValue(selectedRoute, nextStopIdx);
      const plannedCurrentStopTime = formatPickupTime(plannedCurrentStopTimeRaw);
      const plannedCurrentStopLabel = getStopScheduleLabel(selectedRoute, nextStopIdx);
      const firstPointArrivalTime = getFirstPointArrivalText(selectedRoute);
      const currentEstimatedArrivalTime = getEstimatedArrivalTimeFromMinutes(liveRouteData.nextStopDuration);
      const isHeadingToFirstPoint = nextStopIdx === 0;
      const currentPassengerPhoneRaw = getRoutePassengerPhone(selectedRoute, currentTarget, nextStopIdx);
      const travelledSegments = splitGpsTraceSegments(selectedRoute?.rutaReal);
      const sharedPassengers = Array.isArray(currentTarget?.passengersSchedule) ? currentTarget.passengersSchedule : [];
      const isSharedPassengerStop = sharedPassengers.length > 1;
      const currentPassengerPhone = isSharedPassengerStop ? '' : currentPassengerPhoneRaw;
      const sharedCompletedCount = sharedPassengers.filter((passenger, index) => Boolean(getSharedPassengerStoredStatus(passenger, index))).length;

      return (
          <div className={`h-screen w-full flex flex-col font-sans transition-colors ${theme.bg} ${theme.text} overflow-hidden relative`}>

              {showTripChat && (
                  <div
                      className="fixed inset-0 z-[10040] bg-slate-950/85 backdrop-blur-sm flex flex-col"
                      style={{
                          paddingTop: 'env(safe-area-inset-top)',
                          paddingBottom: 'env(safe-area-inset-bottom)'
                      }}
                  >
                      <div className="bg-slate-900 text-white px-4 py-4 flex items-center gap-3 shadow-lg shrink-0">
                          <button
                              type="button"
                              onClick={() => setShowTripChat(false)}
                              className="p-2 rounded-full bg-white/10 active:scale-95 transition"
                          >
                              <ChevronLeft className="w-5 h-5" />
                          </button>
                          <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-black uppercase tracking-widest text-orange-400">Chat del viaje</p>
                              <p className="font-black truncate">{currentTarget?.contact || selectedRoute.client || 'Pasajero'}</p>
                          </div>
                          <button
                              type="button"
                              onClick={() => abrirWhatsAppPasajero(selectedRoute, currentTarget, nextStopIdx)}
                              disabled={!currentPassengerPhone}
                              className={`px-3 py-2 rounded-xl text-[10px] font-black flex items-center gap-1.5 ${
                                  currentPassengerPhone
                                      ? 'bg-green-500 text-white active:scale-95'
                                      : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                              }`}
                          >
                              <Phone className="w-4 h-4" /> WHATSAPP
                          </button>
                      </div>

                      <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-100">
                          {(selectedRoute.chat || []).length === 0 && (
                              <div className="h-full flex items-center justify-center text-center p-8">
                                  <div>
                                      <MessageSquare className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                                      <p className="font-black text-slate-500">Aún no hay mensajes</p>
                                      <p className="text-xs text-slate-400 mt-1">Escribe al cliente sin salir de la navegación.</p>
                                  </div>
                              </div>
                          )}

                          {(selectedRoute.chat || []).map((msg, index) => {
                              if (msg.sender === 'Sistema') {
                                  return (
                                      <div key={index} className="text-center">
                                          <span className="inline-block bg-red-100 text-red-700 px-3 py-1 rounded-full text-[10px] font-bold">
                                              {msg.text}
                                          </span>
                                      </div>
                                  );
                              }

                              const isDriverMessage = msg.sender === 'Conductor';

                              return (
                                  <div key={index} className={`flex ${isDriverMessage ? 'justify-end' : 'justify-start'}`}>
                                      <div className={`max-w-[82%] p-3 rounded-2xl shadow-sm ${
                                          isDriverMessage
                                              ? 'bg-orange-500 text-white rounded-tr-sm'
                                              : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                                      }`}>
                                          <p className="text-sm leading-snug">{msg.text}</p>
                                          <p className={`text-[9px] font-bold text-right mt-1 ${
                                              isDriverMessage ? 'text-orange-100' : 'text-slate-400'
                                          }`}>
                                              {msg.time}
                                          </p>
                                      </div>
                                  </div>
                              );
                          })}
                      </div>

                      <div className="bg-white border-t border-slate-200 p-3 flex items-center gap-2 shrink-0">
                          <input
                              type="text"
                              value={chatText}
                              onChange={(event) => setChatText(event.target.value)}
                              onKeyDown={(event) => event.key === 'Enter' && enviarMensaje()}
                              placeholder="Escribe un mensaje al cliente..."
                              className="flex-1 min-w-0 bg-slate-100 border border-slate-200 rounded-full px-4 py-3 text-sm outline-none focus:border-orange-500"
                          />
                          <button
                              type="button"
                              onClick={enviarMensaje}
                              className="p-3 bg-orange-500 text-white rounded-full shadow-lg active:scale-95 transition"
                          >
                              <Send className="w-5 h-5" />
                          </button>
                      </div>
                  </div>
              )}

              {completedTripNotice && (
                  <div className="fixed inset-0 z-[10020] bg-slate-900/85 backdrop-blur-md flex items-center justify-center p-5">
                      <div className="w-full max-w-sm bg-white rounded-[2rem] shadow-2xl overflow-hidden border-4 border-green-500 text-slate-800">
                          <div className="bg-green-600 text-white p-6 text-center">
                              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                                  <CheckCircle2 className="w-9 h-9" />
                              </div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-green-100">Cierre registrado</p>
                              <h2 className="text-2xl font-black mt-1">Viaje finalizado</h2>
                              <p className="text-sm text-green-100 mt-2">El mismo comprobante queda disponible para conductor, cliente y despacho.</p>
                          </div>
                          <div className="p-5">
                              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
                                  <p className="text-[10px] font-black uppercase text-slate-400">Folio</p>
                                  <p className="font-black text-slate-800 mt-1">{buildTripLogixReceipt(completedTripNotice).folio}</p>
                                  <div className={`grid ${shouldHideDriverReceiptPricing(completedTripNotice) ? 'grid-cols-1' : 'grid-cols-2'} gap-3 mt-4`}>
                                      <div>
                                          <p className="text-[10px] font-black uppercase text-slate-400">Distancia</p>
                                          <p className="text-lg font-black">{buildTripLogixReceipt(completedTripNotice).distanceKm.toFixed(2)} km</p>
                                      </div>
                                      {!shouldHideDriverReceiptPricing(completedTripNotice) && (
                                          <div className="text-right">
                                              <p className="text-[10px] font-black uppercase text-slate-400">Total</p>
                                              <p className="text-lg font-black text-orange-600">{formatTripLogixMoney(buildTripLogixReceipt(completedTripNotice).pricing.total, buildTripLogixReceipt(completedTripNotice).pricing.currency)}</p>
                                          </div>
                                      )}
                                  </div>
                                  {shouldHideDriverReceiptPricing(completedTripNotice) && (
                                      <div className="mt-3 rounded-xl bg-blue-50 border border-blue-200 px-3 py-2">
                                          <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Ruta empresarial</p>
                                          <p className="text-xs font-bold text-blue-900 mt-1">Liquidación semanal por kilómetros recorridos. Sin tarifa final para conductor.</p>
                                      </div>
                                  )}
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                  <button
                                      type="button"
                                      onClick={() => downloadTripLogixReceiptPdf(completedTripNotice)}
                                      className="p-4 rounded-2xl bg-orange-500 text-white font-black text-xs flex items-center justify-center gap-2 active:scale-95 transition"
                                  >
                                      <Download className="w-4 h-4" /> PDF
                                  </button>
                                  <button
                                      type="button"
                                      onClick={() => shareTripLogixReceiptPdf(completedTripNotice)}
                                      className="p-4 rounded-2xl bg-slate-800 text-white font-black text-xs flex items-center justify-center gap-2 active:scale-95 transition"
                                  >
                                      <Share2 className="w-4 h-4" /> COMPARTIR
                                  </button>
                              </div>
                              <button
                                  type="button"
                                  onClick={() => {
                                      setCompletedTripNotice(null);
                                      setSelectedRoute(null);
                                      setMainTab('Finalizados');
                                  }}
                                  className="w-full mt-3 p-3 rounded-2xl bg-slate-100 text-slate-700 font-black text-xs uppercase tracking-widest"
                              >
                                  Ver viajes finalizados
                              </button>
                          </div>
                      </div>
                  </div>
              )}
              
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
                              <button
                                  type="button"
                                  onClick={() => abrirWhatsAppPasajero(selectedRoute, currentTarget, nextStopIdx)}
                                  disabled={!currentPassengerPhone}
                                  className={`flex-1 p-3 rounded-xl flex flex-col items-center justify-center gap-1 font-black text-xs transition shadow-sm ${
                                      currentPassengerPhone
                                          ? 'bg-green-500 hover:bg-green-600 text-white active:scale-95'
                                          : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                  }`}
                              >
                                  <Phone className="w-5 h-5"/> WHATSAPP
                              </button>
                              <label className={`flex-1 p-3 rounded-xl flex flex-col items-center justify-center gap-1 font-black text-xs cursor-pointer transition-colors shadow-sm ${evidence ? 'bg-green-100 text-green-700 border-2 border-green-500' : 'bg-slate-800 text-white hover:bg-slate-900'}`}>
                                  {evidence ? <CheckCircle2 className="w-5 h-5"/> : <Camera className="w-5 h-5"/>} {evidence ? 'FOTO LISTA' : 'TOMAR FOTO'}
                                  <input type="file" accept="image/*" capture="environment" hidden onChange={handlePhoto} />
                              </label>
                          </div>
                          {isSharedPassengerStop ? (
                              <div className="space-y-3">
                                  <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
                                      <div className="flex items-center justify-between gap-2 mb-2">
                                          <div>
                                              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Punto compartido</p>
                                              <p className="text-xs font-bold text-slate-600 mt-0.5">Registra a cada pasajero antes de continuar.</p>
                                          </div>
                                          <span className="text-[10px] font-black bg-blue-600 text-white rounded-full px-2.5 py-1">{sharedCompletedCount}/{sharedPassengers.length}</span>
                                      </div>
                                      <div className="max-h-[32vh] overflow-y-auto space-y-2 pr-1">
                                          {sharedPassengers.map((passenger, passengerIndex) => {
                                              const passengerName = passenger?.passengerName || passenger?.name || passenger?.contact || `Pasajero ${passengerIndex + 1}`;
                                              const status = getSharedPassengerStoredStatus(passenger, passengerIndex);
                                              const passengerPhone = normalizeWhatsAppPhone(passenger?.phone, passenger?.contactPhone, passenger?.whatsapp);
                                              return (
                                                  <div key={`${passengerName}-${passengerIndex}`} className="bg-white border border-blue-100 rounded-xl p-2.5 shadow-sm">
                                                      <div className="flex items-center justify-between gap-2 mb-2">
                                                          <div className="min-w-0">
                                                              <p className="text-xs font-black text-slate-800 truncate">{passengerName}</p>
                                                              <p className={`text-[9px] font-black uppercase mt-0.5 ${['A bordo', 'En destino'].includes(status) ? 'text-green-600' : status ? 'text-red-600' : 'text-slate-400'}`}>{status || 'Pendiente'}</p>
                                                          </div>
                                                          {passengerPhone && (
                                                              <button
                                                                  type="button"
                                                                  onClick={() => abrirWhatsAppPasajero(selectedRoute, { ...currentTarget, passengerName, contact: passengerName, phone: passenger?.phone, contactPhone: passenger?.contactPhone }, nextStopIdx)}
                                                                  className="px-2.5 py-2 rounded-lg bg-green-50 text-green-600 border border-green-200 text-[9px] font-black"
                                                              >WA</button>
                                                          )}
                                                      </div>
                                                      <div className="grid grid-cols-2 gap-2">
                                                          <button
                                                              type="button"
                                                              disabled={Boolean(status)}
                                                              onClick={() => registrarPasajeroCompartido(passenger, 'A bordo', passengerIndex)}
                                                              className={`py-2 rounded-lg text-[9px] font-black uppercase ${['A bordo', 'En destino'].includes(status) ? 'bg-green-600 text-white' : status ? 'bg-slate-100 text-slate-300' : 'bg-green-50 text-green-700 border border-green-200'}`}
                                                          >{isSalidaRoute(selectedRoute) && nextStopIdx > 0 ? 'En destino' : 'A bordo'}</button>
                                                          <button
                                                              type="button"
                                                              disabled={Boolean(status)}
                                                              onClick={() => registrarPasajeroCompartido(passenger, 'No se presentó', passengerIndex)}
                                                              className={`py-2 rounded-lg text-[9px] font-black uppercase ${status === 'No se presentó' ? 'bg-red-600 text-white' : status ? 'bg-slate-100 text-slate-300' : 'bg-red-50 text-red-600 border border-red-200'}`}
                                                          >{isSalidaRoute(selectedRoute) && nextStopIdx > 0 ? 'No entregado' : 'No salió'}</button>
                                                      </div>
                                                  </div>
                                              );
                                          })}
                                      </div>
                                  </div>
                                  <button
                                      type="button"
                                      onClick={() => continuarPuntoCompartido(sharedPassengers, isHeadingToDestination)}
                                      disabled={sharedCompletedCount < sharedPassengers.length}
                                      className={`w-full p-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 ${sharedCompletedCount === sharedPassengers.length ? 'bg-orange-500 text-white active:scale-95' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                                  >
                                      <CheckCircle className="w-5 h-5" /> {isHeadingToDestination ? 'FINALIZAR VIAJE' : 'CONTINUAR RUTA'}
                                  </button>
                              </div>
                          ) : (
                              <div className="flex gap-2">
                                  <button onClick={() => reportarAusencia(isHeadingToDestination)} className="w-1/3 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 p-3 rounded-xl font-bold text-[10px] leading-tight active:scale-95 transition-transform">{isSalidaRoute(selectedRoute) && nextStopIdx > 0 ? 'NO ENTREGADO / CAMBIO' : 'NO SALIÓ / CANCELÓ'}</button>
                                  <button onClick={() => confirmarAbordaje(isHeadingToDestination)} className="w-2/3 bg-orange-500 hover:bg-orange-600 text-white p-3 rounded-xl font-black text-sm active:scale-95 transition-transform flex items-center justify-center gap-2">
                                      {isSalidaRoute(selectedRoute) && nextStopIdx > 0
                                          ? <><CheckCircle className="w-5 h-5"/> {isHeadingToDestination ? 'EN DESTINO Y FINALIZAR' : 'PASAJERO EN DESTINO'}</>
                                          : (isHeadingToDestination ? <><CheckCircle className="w-5 h-5"/> FINALIZAR VIAJE</> : <><User className="w-5 h-5"/> PASAJERO A BORDO</>)}
                                  </button>
                              </div>
                          )}
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
                  <div className="absolute top-[78px] left-3 right-3 bg-slate-900/92 backdrop-blur-md rounded-xl p-2 shadow-xl z-30 border border-slate-700 flex items-center gap-2.5 animate-[fadeIn_0.3s_ease-out]">
                      <div className="bg-orange-500 w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-inner">
                          <Navigation className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 text-white">
                          <div className="flex items-center gap-2 min-w-0">
                              <p className="text-base font-black whitespace-nowrap">{nextManeuver.distance}</p>
                              <p className="text-[11px] font-medium text-slate-300 leading-tight line-clamp-2">{translateNavigationInstruction(nextManeuver.instruction)}</p>
                          </div>
                      </div>
                      <button 
                          onClick={async () => {
                              const nextValue = !voiceEnabled;
                              setVoiceEnabled(nextValue);
                              if (!nextValue) {
                                  TextToSpeech.stop().catch(() => {});
                                  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                              } else {
                                  await speakNavigationText('Indicaciones por voz activadas');
                              }
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
                            center={centerMX}
                            zoom={16}
                            onLoad={handleMapLoad}
                            onUnmount={handleMapUnmount}
                            onDragStart={handleMapDrag}
                            options={NAV_MAP_OPTIONS}
                        >
                            {travelledSegments.map((segment, segmentIndex) => (
                                <Polyline
                                    key={`driver-travelled-${segmentIndex}`}
                                    path={segment}
                                    options={{ strokeColor: '#2563eb', strokeOpacity: 0.95, strokeWeight: 6, zIndex: 2 }}
                                />
                            ))}
                            {currentGeometry.length > 0 && (
                                <Polyline
                                    path={currentGeometry}
                                    options={{
                                        ...NAV_POLYLINE_OPTIONS,
                                        strokeColor: '#f97316',
                                        strokeOpacity: 1,
                                        strokeWeight: 6,
                                        zIndex: 4
                                    }}
                                />
                            )}
                            {currentTarget && (resolvedNextStopLocation || normalizePoint(currentTarget)) && (
                                <Marker
                                    position={resolvedNextStopLocation || normalizePoint(currentTarget)}
                                    icon={currentTarget.icon}
                                    title={`Siguiente punto: ${currentTarget.contact || currentTarget.label || 'Parada'}`}
                                    zIndex={9000}
                                />
                            )}
                            {snappedLocation && (
                                <Marker
                                    position={snappedLocation}
                                    icon={driverMarkerIcon}
                                    title="Tu ubicación actual"
                                    zIndex={9999}
                                />
                            )}
                        </GoogleMap>

                        <div className="absolute left-4 top-[150px] z-30 bg-white/95 backdrop-blur border border-slate-200 rounded-xl px-3 py-2 shadow-lg">
                            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Lectura de ruta</p>
                            <div className="flex items-center gap-2 text-[10px] font-bold text-slate-700">
                                <span className="w-6 h-1 rounded-full bg-blue-600"></span>
                                <span>Recorrido</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] font-bold text-slate-700 mt-1">
                                <span className="w-6 h-1.5 rounded-full bg-orange-500"></span>
                                <span>Por recorrer</span>
                            </div>
                        </div>

                        {!snappedLocation && (
                            <div className="absolute top-4 left-4 right-4 z-20 bg-white/95 border border-orange-200 rounded-2xl px-4 py-3 shadow-lg text-center">
                                <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Esperando GPS del conductor</p>
                                <p className="text-xs font-bold text-slate-600 mt-1">Activa ubicación precisa y permisos de localización para ver el carrito en el mapa.</p>
                            </div>
                        )}

                        {snappedLocation && currentGeometry.length === 0 && (
                            <div className="absolute top-4 left-4 right-4 z-20 bg-white/95 border border-blue-200 rounded-2xl px-4 py-3 shadow-lg text-center">
                                <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Calculando ruta por calles</p>
                                <p className="text-xs font-bold text-slate-600 mt-1">La línea aparecerá cuando Google confirme la ruta vehicular.</p>
                            </div>
                        )}

                        <div className="absolute right-4 top-[150px] z-30 flex flex-col gap-3">
                            <button
                                type="button"
                                onClick={() => setShowTripChat(true)}
                                className="w-14 h-14 rounded-2xl bg-slate-900 text-white shadow-2xl border border-slate-700 flex flex-col items-center justify-center active:scale-95 transition"
                                title="Abrir chat"
                            >
                                <MessageSquare className="w-5 h-5" />
                                <span className="text-[8px] font-black mt-1">CHAT</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => abrirWhatsAppPasajero(selectedRoute, currentTarget, nextStopIdx)}
                                disabled={!currentPassengerPhone}
                                className={`w-14 h-14 rounded-2xl shadow-2xl flex flex-col items-center justify-center transition ${
                                    currentPassengerPhone
                                        ? 'bg-green-500 text-white active:scale-95'
                                        : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                                }`}
                                title={currentPassengerPhone ? 'Enviar WhatsApp al pasajero' : 'Pasajero sin WhatsApp registrado'}
                            >
                                <Phone className="w-5 h-5" />
                                <span className="text-[8px] font-black mt-1">WHATSAPP</span>
                            </button>
                        </div>

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

        {completedTripNotice && (
            <div className="fixed inset-0 z-[10020] bg-slate-900/85 backdrop-blur-md flex items-center justify-center p-5">
                <div className="w-full max-w-sm bg-white rounded-[2rem] shadow-2xl overflow-hidden border-4 border-green-500 text-slate-800">
                    <div className="bg-green-600 text-white p-6 text-center">
                        <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                            <CheckCircle2 className="w-9 h-9" />
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-green-100">Cierre registrado</p>
                        <h2 className="text-2xl font-black mt-1">Viaje finalizado</h2>
                        <p className="text-sm text-green-100 mt-2">El comprobante quedó guardado para conductor, cliente y despacho.</p>
                    </div>
                    <div className="p-5">
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
                            <p className="text-[10px] font-black uppercase text-slate-400">Folio</p>
                            <p className="font-black text-slate-800 mt-1">{buildTripLogixReceipt(completedTripNotice).folio}</p>
                            <div className={`grid ${shouldHideDriverReceiptPricing(completedTripNotice) ? 'grid-cols-1' : 'grid-cols-2'} gap-3 mt-4`}>
                                <div>
                                    <p className="text-[10px] font-black uppercase text-slate-400">Distancia</p>
                                    <p className="text-lg font-black">{buildTripLogixReceipt(completedTripNotice).distanceKm.toFixed(2)} km</p>
                                </div>
                                {!shouldHideDriverReceiptPricing(completedTripNotice) && (
                                    <div className="text-right">
                                        <p className="text-[10px] font-black uppercase text-slate-400">Total</p>
                                        <p className="text-lg font-black text-orange-600">{formatTripLogixMoney(buildTripLogixReceipt(completedTripNotice).pricing.total, buildTripLogixReceipt(completedTripNotice).pricing.currency)}</p>
                                    </div>
                                )}
                            </div>
                            {shouldHideDriverReceiptPricing(completedTripNotice) && (
                                <div className="mt-3 rounded-xl bg-blue-50 border border-blue-200 px-3 py-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Ruta empresarial</p>
                                    <p className="text-xs font-bold text-blue-900 mt-1">Liquidación semanal por kilómetros recorridos. Sin tarifa final para conductor.</p>
                                </div>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => downloadTripLogixReceiptPdf(completedTripNotice)}
                                className="p-4 rounded-2xl bg-orange-500 text-white font-black text-xs flex items-center justify-center gap-2 active:scale-95 transition"
                            >
                                <Download className="w-4 h-4" /> PDF
                            </button>
                            <button
                                type="button"
                                onClick={() => shareTripLogixReceiptPdf(completedTripNotice)}
                                className="p-4 rounded-2xl bg-slate-800 text-white font-black text-xs flex items-center justify-center gap-2 active:scale-95 transition"
                            >
                                <Share2 className="w-4 h-4" /> COMPARTIR
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setCompletedTripNotice(null);
                                setSelectedRoute(null);
                                setMainTab('Finalizados');
                            }}
                            className="w-full mt-3 p-3 rounded-2xl bg-slate-100 text-slate-700 font-black text-xs uppercase tracking-widest"
                        >
                            Ver viajes finalizados
                        </button>
                    </div>
                </div>
            </div>
        )}
        
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

            {!shouldHideTripPricingDuringActive(selectedRoute) ? (
                <div className="mb-4 rounded-2xl p-4 bg-green-50 border border-green-200 text-green-800 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-green-600">Valor del servicio</p>
                        <p className="text-[9px] font-bold uppercase text-green-600 mt-1">{getTripDisplayedPricing(selectedRoute).source}</p>
                    </div>
                    <p className="text-2xl font-black">{formatTripLogixMoney(getTripDisplayedPricing(selectedRoute).total, getTripDisplayedPricing(selectedRoute).currency)}</p>
                </div>
            ) : (
                <div className="mb-4 rounded-2xl p-4 bg-blue-50 border border-blue-200 text-blue-800 shadow-sm">
                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Servicio corporativo programado</p>
                    <p className="text-sm font-black mt-1">La tarifa no se muestra durante el recorrido.</p>
                </div>
            )}

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
                <div className="space-y-3 mt-2">
                    <div className="w-full bg-green-50 text-green-700 border border-green-200 font-black p-4 rounded-2xl flex items-center justify-center gap-2">
                        <CheckCircle2 className="w-5 h-5"/> VIAJE FINALIZADO
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => downloadTripLogixReceiptPdf(selectedRoute)}
                            className="p-3 rounded-xl bg-orange-500 text-white font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2"
                        >
                            <Download className="w-4 h-4" /> Recibo PDF
                        </button>
                        <button
                            type="button"
                            onClick={() => shareTripLogixReceiptPdf(selectedRoute)}
                            className="p-3 rounded-xl bg-slate-800 text-white font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2"
                        >
                            <Share2 className="w-4 h-4" /> Compartir
                        </button>
                    </div>
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
    const todayStr = new Date().toLocaleDateString('en-CA', {}); // YYYY-MM-DD
    
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
            if (mainTab === 'Finalizados') {
                return getCompletedTripSortTimestamp(b) - getCompletedTripSortTimestamp(a);
            }

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
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 bg-slate-900/90 backdrop-blur-md animate-in fade-in zoom-in duration-300" style={{ paddingTop: "max(12px, env(safe-area-inset-top))", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
                <div className="bg-white rounded-[2rem] w-full max-w-sm max-h-[calc(100dvh-24px)] overflow-hidden shadow-2xl border-4 border-yellow-400 flex flex-col">
                    <div className="bg-yellow-400 p-6 text-center shrink-0 relative overflow-hidden"><div className="absolute inset-0 bg-yellow-500/20 animate-pulse"></div><div className="relative z-10 flex flex-col items-center"><div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-lg mb-3"><Zap className="w-8 h-8 text-yellow-500" /></div><h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase">¡NUEVO VIAJE!</h2><p className="text-xs font-bold text-yellow-900 mt-1 uppercase tracking-widest">A unos kilómetros de ti</p></div></div>
                    <div className="p-5 bg-slate-50 space-y-3 overflow-y-auto">
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm text-center"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Cliente Solicitante</p><p className="text-lg font-black text-slate-800">{incomingOffer.client}</p></div>
                        <div className="bg-slate-900 p-4 rounded-2xl shadow-sm text-center border border-slate-800">
                            <p className="text-[10px] font-black text-orange-300 uppercase tracking-widest mb-1">Hora de recogida</p>
                            <p className="text-xl font-black text-white flex items-center justify-center gap-2">
                                <Clock className="w-5 h-5 text-orange-400" />
                                {getPickupScheduleText(incomingOffer)}
                            </p>
                        </div>
                        {!shouldHideTripPricingDuringActive(incomingOffer) ? (
                            <div className="bg-green-50 p-4 rounded-2xl border border-green-200 shadow-sm text-center">
                                <p className="text-[10px] font-black text-green-600 uppercase tracking-widest">Valor del servicio</p>
                                <p className="text-2xl font-black text-green-700 mt-1">
                                    {formatTripLogixMoney(getTripDisplayedPricing(incomingOffer).total, getTripDisplayedPricing(incomingOffer).currency)}
                                </p>
                                <p className="text-[9px] font-bold text-green-600 mt-1 uppercase">
                                    {getTripDisplayedPricing(incomingOffer).source}
                                </p>
                            </div>
                        ) : (
                            <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200 shadow-sm text-center">
                                <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Servicio corporativo programado</p>
                                <p className="text-sm font-black text-blue-800 mt-1">Tarifa administrada por despacho</p>
                            </div>
                        )}
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden"><div className="absolute left-0 top-0 bottom-0 w-1.5 bg-orange-500"></div><p className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-1 pl-2">Recoger en:</p><p className="text-sm font-medium text-slate-700 line-clamp-2 pl-2">{incomingOffer.start}</p></div>
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden"><div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-500"></div><p className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1 pl-2">Llevar a:</p><p className="text-sm font-medium text-slate-700 line-clamp-2 pl-2">{incomingOffer.end}</p></div>
                    </div>
                    <div className="p-4 bg-white border-t border-slate-100 flex gap-3 shrink-0 sticky bottom-0"><button onClick={rechazarViaje} className="w-1/3 py-4 rounded-2xl bg-red-50 text-red-600 font-bold text-xs uppercase tracking-widest border border-red-200 hover:bg-red-100 transition active:scale-95">Rechazar</button><button onClick={aceptarViaje} className="w-2/3 py-4 rounded-2xl bg-green-500 text-white font-black text-sm uppercase tracking-widest shadow-xl shadow-green-500/30 hover:bg-green-600 transition active:scale-95 flex items-center justify-center gap-2"><CheckCircle className="w-5 h-5"/> Aceptar Viaje</button></div>
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
                    <div className="flex items-center gap-2">
                        {ruta.status === 'Finalizado' && (
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    downloadTripLogixReceiptPdf(ruta);
                                }}
                                className="p-2.5 rounded-xl bg-orange-100 text-orange-600 border border-orange-200 active:scale-95 transition"
                                title="Descargar recibo PDF"
                            >
                                <FileText className="w-4 h-4" />
                            </button>
                        )}
                        <ChevronRight className="w-4 h-4 text-orange-500" />
                    </div>
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