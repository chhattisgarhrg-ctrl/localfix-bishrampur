import { useState, useEffect, useRef, useCallback } from "react";
import {
  auth, db, storage,
  requestNotificationPermission, onFCMMessage,
} from "./firebase";
import {
  RecaptchaVerifier, signInWithPhoneNumber,
} from "firebase/auth";
import {
  collection, addDoc, doc, setDoc, getDoc, getDocs,
  query, where, orderBy, limit, onSnapshot,
  serverTimestamp, updateDoc,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

const BACKEND = import.meta.env.VITE_BACKEND_URL;
const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
const RZP_KEY  = import.meta.env.VITE_RAZORPAY_KEY_ID;

// ── STATIC DATA ───────────────────────────────────────────────
const CATS = [
  { id:"plumber",     label:"Plumber",      emoji:"🔧" },
  { id:"electrician", label:"Electrician",  emoji:"⚡" },
  { id:"maid",        label:"Maid/Bai",     emoji:"🧹" },
  { id:"ac",          label:"AC Repair",    emoji:"❄️" },
  { id:"driver",      label:"Driver",       emoji:"🚗" },
  { id:"rajmistri",   label:"Rajmistri",    emoji:"🏗️" },
  { id:"gaadi",       label:"Gaadi Repair", emoji:"🔩" },
  { id:"labor",       label:"Labor",        emoji:"👷" },
];

const MOCK_WORKERS = [
  { id:"w1", name:"Ramesh Kumar",     skill:"Plumber",      cat:"plumber",     rating:4.8, reviews:124, dist:0.8, exp:"5 साल",  price:150, online:true,  phone:"9876543210", emoji:"🔧", lat:23.2895, lng:82.3415, photo:null },
  { id:"w2", name:"Suresh Electric",  skill:"Electrician",  cat:"electrician", rating:4.9, reviews:89,  dist:1.2, exp:"8 साल",  price:200, online:true,  phone:"9876543211", emoji:"⚡", lat:23.2910, lng:82.3450, photo:null },
  { id:"w3", name:"Savita Bai",       skill:"Maid/Cleaning",cat:"maid",        rating:4.7, reviews:201, dist:0.5, exp:"3 साल",  price:100, online:true,  phone:"9876543212", emoji:"🧹", lat:23.2875, lng:82.3390, photo:null },
  { id:"w4", name:"Cool Air Service", skill:"AC Repair",    cat:"ac",          rating:4.6, reviews:67,  dist:2.1, exp:"6 साल",  price:300, online:false, phone:"9876543213", emoji:"❄️", lat:23.2950, lng:82.3500, photo:null },
  { id:"w5", name:"Mohan Driver",     skill:"Car Driver",   cat:"driver",      rating:4.9, reviews:310, dist:0.3, exp:"10 साल", price:250, online:true,  phone:"9876543214", emoji:"🚗", lat:23.2865, lng:82.3380, photo:null },
  { id:"w6", name:"Shyam Rajmistri",  skill:"Construction", cat:"rajmistri",   rating:4.5, reviews:45,  dist:3.0, exp:"15 साल", price:500, online:true,  phone:"9876543215", emoji:"🏗️", lat:23.3000, lng:82.3550, photo:null },
  { id:"w7", name:"Bike Doctor",      skill:"Gaadi Repair", cat:"gaadi",       rating:4.7, reviews:178, dist:1.5, exp:"7 साल",  price:200, online:true,  phone:"9876543216", emoji:"🔩", lat:23.2930, lng:82.3470, photo:null },
  { id:"w8", name:"Raju Mazdoor",     skill:"Labor",        cat:"labor",       rating:4.4, reviews:32,  dist:1.0, exp:"2 साल",  price:400, online:false, phone:"9876543217", emoji:"👷", lat:23.2880, lng:82.3420, photo:null },
];

const AI_REPLIES = {
  plumber:     "🔧 Ramesh Kumar available!\nRate: ₹150 | 0.8km | ⭐4.8\nBook karein?",
  electrician: "⚡ Suresh Electric available!\nRate: ₹200 | ⭐4.9\nBooking karein?",
  maid:        "🧹 Savita Bai available!\nRate: ₹100/visit | 0.5km",
  ac:          "❄️ Cool Air Service:\n₹300 se shuru | 2.1km",
  driver:      "🚗 Mohan Driver Online!\nRate: ₹250 | ⭐4.9 | 0.3km",
  rate:        "💰 Rates:\n🔧 Plumber ₹150+\n⚡ Electric ₹200+\n🧹 Maid ₹100+\n❄️ AC ₹300+\n🚗 Driver ₹250+\n🏗️ Rajmistri ₹500+",
  cancel:      "❌ Cancel:\nOrders → Booking → Cancel button",
  emergency:   "🆘 Emergency:\nPolice: 112\nAmbulance: 108\nFire: 101",
  payment:     "💳 Payment:\n• Cash on service\n• UPI (GPay/PhonePe)\n• Online (Razorpay)\nSab safe! ✅",
  default:     "🤖 Home pe category chuniye → Worker select → Book karein! 🚀",
};

// ── HELPERS ───────────────────────────────────────────────────
const loadScript = (src) =>
  new Promise((res) => {
    if (document.querySelector(`script[src="${src}"]`)) return res(true);
    const s = document.createElement("script");
    s.src = src; s.onload = () => res(true);
    document.head.appendChild(s);
  });

const DEFAULT_LOC = "बिश्रामपुर, छत्तीसगढ़";
const BISHRAMPUR  = { lat: 23.2893, lng: 82.3412 };

// ── STYLES ────────────────────────────────────────────────────
const G = {
  app:  { fontFamily:"'Noto Sans Devanagari',sans-serif", background:"#F5EDE6", maxWidth:430, margin:"0 auto", minHeight:"100vh", overflowX:"hidden", position:"relative" },
  top:  { background:"linear-gradient(135deg,#FF6B00,#E64A00)", padding:"13px 14px 17px", color:"white", position:"sticky", top:0, zIndex:100, boxShadow:"0 2px 16px rgba(255,107,0,.4)" },
  card: { background:"white", borderRadius:16, padding:14, boxShadow:"0 4px 24px rgba(255,107,0,.1)", border:"1.5px solid #F0E4D9", marginBottom:12 },
  btn:  { background:"linear-gradient(135deg,#FF6B00,#E64A00)", color:"white", border:"none", borderRadius:12, padding:"13px 20px", fontSize:15, fontWeight:700, cursor:"pointer", width:"100%", fontFamily:"'Noto Sans Devanagari',sans-serif", boxShadow:"0 4px 16px rgba(255,107,0,.4)" },
  inp:  { width:"100%", padding:"11px 13px", border:"1.5px solid #E8D5C4", borderRadius:10, fontSize:14, fontFamily:"'Noto Sans Devanagari',sans-serif", color:"#3D1A00", background:"white", outline:"none", boxSizing:"border-box", marginBottom:12 },
  lbl:  { fontSize:13, fontWeight:700, color:"#2D1500", marginBottom:5, display:"block" },
  chip: (c="#FF6B00", bg="#FFF3E8") => ({ background:bg, color:c, fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, display:"inline-block" }),
  nav:  { position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:430, background:"white", borderTop:"1px solid #EDE0D4", display:"grid", gridTemplateColumns:"repeat(5,1fr)", padding:"8px 0 max(10px,env(safe-area-inset-bottom))", zIndex:200, boxShadow:"0 -4px 20px rgba(0,0,0,.08)" },
};

// ══════════════════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen]       = useState("splash");
  const [user,   setUser]         = useState(null);
  const [cat,    setCat]          = useState("plumber");
  const [workers,setWorkers]      = useState(MOCK_WORKERS);
  const [selW,   setSelW]         = useState(null);
  const [orders, setOrders]       = useState([]);
  const [chatMsgs,setChatMsgs]    = useState([{ role:"bot", text:"नमस्ते! 🙏 किस सेवा की जरूरत है?\n\nPlumber, Electrician, Maid, AC, Driver - सब उपलब्ध! 😊" }]);
  const [userLoc, setUserLoc]     = useState(BISHRAMPUR);
  const [locText, setLocText]     = useState(DEFAULT_LOC);
  const [locLoading,setLocLoad]   = useState(false);
  const [toast,   setToast]       = useState(null);
  const [modal,   setModal]       = useState(null);
  const [updateBar,setUpdateBar]  = useState(false);
  const [installPrompt,setInstall]= useState(null);
  const [showInstallBar,setIBar]  = useState(false);
  const [isOffline,setOffline]    = useState(!navigator.onLine);
  const [fcmToken, setFcmToken]   = useState(null);
  const [liveWorkerLoc,setLiveW]  = useState(null);
  const mapRef   = useRef(null);
  const mapInst  = useRef(null);
  const confirmRef = useRef(null);
  const histRef  = useRef(["splash"]);

  // ── INIT ────────────────────────────────────────────────────
  useEffect(() => {
    setTimeout(() => setScreen("login"), 2500);
    detectLocation();
    loadFCM();
    window._showUpdateBar = () => setUpdateBar(true);
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault(); setInstall(e);
      const t = localStorage.getItem("lf_inst");
      if (!t || Date.now() - parseInt(t) > 3 * 86400000)
        setTimeout(() => setIBar(true), 4000);
    });
    window.addEventListener("appinstalled", () => { setIBar(false); setInstall(null); });
    window.addEventListener("offline", () => setOffline(true));
    window.addEventListener("online",  () => { setOffline(false); showToast("✅ Internet aa gaya!"); });
  }, []);

  // ── FCM ─────────────────────────────────────────────────────
  const loadFCM = async () => {
    const token = await requestNotificationPermission();
    if (token) {
      setFcmToken(token);
      onFCMMessage((payload) => {
        showToast(`🔔 ${payload.notification?.title || "नया Update"}`);
      });
    }
  };

  // ── LOCATION ────────────────────────────────────────────────
  const detectLocation = () => {
    const cached = localStorage.getItem("lf_loc");
    const cachedAt = parseInt(localStorage.getItem("lf_loc_t") || "0");
    if (cached && Date.now() - cachedAt < 10 * 60000) { setLocText(cached); return; }
    if (!navigator.geolocation) return;
    setLocLoad(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setUserLoc({ lat, lng });
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=hi&zoom=14`, { headers:{ "User-Agent":"LocalFix-App" }});
          const d = await r.json();
          const a = d.address || {};
          const area = a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.city || null;
          const dist = a.city || a.county || a.state_district || null;
          const name = area && dist ? `${area}, ${dist}` : area || dist || DEFAULT_LOC;
          setLocText(name);
          localStorage.setItem("lf_loc", name);
          localStorage.setItem("lf_loc_t", Date.now().toString());
        } catch { setLocText(DEFAULT_LOC); }
        setLocLoad(false);
      },
      () => { setLocText(DEFAULT_LOC); setLocLoad(false); },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  };

  // ── FIREBASE AUTH (Real Phone OTP) ───────────────────────────
  const setupRecaptcha = () => {
    if (!confirmRef.current) {
      confirmRef.current = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
    }
    return confirmRef.current;
  };

  const sendOTP = async (phone) => {
    try {
      const verifier = setupRecaptcha();
      const result = await signInWithPhoneNumber(auth, "+91" + phone, verifier);
      return { ok: true, confirm: result };
    } catch (e) {
      confirmRef.current = null;
      return { ok: false, error: e.message };
    }
  };

  const verifyOTP = async (confirmResult, otp) => {
    try {
      const cred = await confirmResult.confirm(otp);
      const user  = cred.user;
      // Save/get user profile from Firestore
      const uRef = doc(db, "users", user.uid);
      const uSnap = await getDoc(uRef);
      let profile = uSnap.exists() ? uSnap.data() : null;
      if (!profile) {
        profile = { uid: user.uid, phone: user.phoneNumber, name: "User", createdAt: serverTimestamp() };
        await setDoc(uRef, profile);
      }
      // Save FCM token
      if (fcmToken) await updateDoc(uRef, { fcmToken });
      setUser({ ...profile, uid: user.uid, phone: user.phoneNumber });
      loadOrders(user.uid);
      setScreen("home");
      showToast("✅ Login हो गया!");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  // ── LOAD ORDERS ──────────────────────────────────────────────
  const loadOrders = (uid) => {
    const q = query(collection(db, "bookings"), where("userId", "==", uid), orderBy("timestamp", "desc"), limit(20));
    onSnapshot(q, (snap) => setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
  };

  // ── LOAD WORKERS ─────────────────────────────────────────────
  const loadWorkers = useCallback(async (category) => {
    try {
      const q = query(collection(db, "workers"), where("category", "==", category), where("active", "==", true), orderBy("rating", "desc"), limit(10));
      const snap = await getDocs(q);
      if (!snap.empty) setWorkers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      else setWorkers(MOCK_WORKERS.filter((w) => w.cat === category));
    } catch { setWorkers(MOCK_WORKERS.filter((w) => w.cat === category)); }
  }, []);

  useEffect(() => { if (user) loadWorkers(cat); }, [cat, user, loadWorkers]);

  // ── LIVE WORKER TRACKING ─────────────────────────────────────
  const startLiveTracking = (workerId) => {
    const ref = doc(db, "worker_locations", workerId);
    return onSnapshot(ref, (snap) => {
      if (snap.exists()) setLiveW(snap.data());
    }, () => {});
  };

  // ── GOOGLE MAPS ───────────────────────────────────────────────
  const initMap = useCallback(async () => {
    if (!mapRef.current || mapInst.current) return;
    await loadScript(`https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places`);
    const map = new window.google.maps.Map(mapRef.current, {
      center: userLoc, zoom: 14,
      disableDefaultUI: true, zoomControl: true,
      styles: [
        { elementType:"geometry",     stylers:[{ color:"#f5ede6" }] },
        { featureType:"road",         elementType:"geometry", stylers:[{ color:"#ffffff" }] },
        { featureType:"water",        elementType:"geometry", stylers:[{ color:"#c9e8f0" }] },
        { featureType:"poi",          elementType:"labels",   stylers:[{ visibility:"off" }] },
      ],
    });
    mapInst.current = map;
    new window.google.maps.Marker({
      position: userLoc, map,
      icon: { path: window.google.maps.SymbolPath.CIRCLE, scale:10, fillColor:"#FF6B00", fillOpacity:1, strokeColor:"white", strokeWeight:3 },
      title: "आप यहाँ हैं",
    });
    workers.filter((w) => w.online).forEach((w) => {
      const m = new window.google.maps.Marker({
        position: { lat: w.lat || BISHRAMPUR.lat, lng: w.lng || BISHRAMPUR.lng }, map,
        label: { text: w.emoji, fontSize: "20px" },
        title: w.name,
      });
      const info = new window.google.maps.InfoWindow({
        content: `<div style="font-family:sans-serif;padding:6px"><strong>${w.name}</strong><br>${w.skill} • ⭐${w.rating}<br><span style="color:#FF6B00">₹${w.price}/visit • ${w.dist}km</span></div>`,
      });
      m.addListener("click", () => info.open(map, m));
    });
    // Live worker marker
    if (liveWorkerLoc) {
      new window.google.maps.Marker({
        position: { lat: liveWorkerLoc.lat, lng: liveWorkerLoc.lng }, map,
        icon: { path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale:6, fillColor:"#2E7D32", fillOpacity:1, strokeColor:"white", strokeWeight:2 },
        title: "Worker",
        animation: window.google.maps.Animation.BOUNCE,
      });
    }
  }, [userLoc, workers, liveWorkerLoc]);

  useEffect(() => { if (screen === "map") { mapInst.current = null; setTimeout(initMap, 100); } }, [screen, initMap]);

  // ── RAZORPAY ─────────────────────────────────────────────────
  const initiatePayment = async (amount, bookingId) => {
    await loadScript("https://checkout.razorpay.com/v1/checkout.js");
    new window.Razorpay({
      key:         RZP_KEY,
      amount:      amount * 100,
      currency:    "INR",
      name:        "LocalFix",
      description: `Booking #${bookingId}`,
      theme:       { color: "#FF6B00" },
      prefill:     { name: user?.name || "", contact: user?.phone || "" },
      handler: async (res) => {
        await updateDoc(doc(db, "bookings", bookingId), { paymentId: res.razorpay_payment_id, status: "paid" });
        notifyBackend(bookingId, res.razorpay_payment_id);
        showToast("✅ Payment Successful!");
        setModal("success");
      },
      modal: { ondismiss: () => showToast("❌ Payment cancelled") },
    }).open();
  };

  // ── CREATE BOOKING ────────────────────────────────────────────
  const createBooking = async (formData) => {
    if (!selW) return;
    const bookingId = "BK" + Date.now();
    const booking = {
      id: bookingId, userId: user?.uid || "guest",
      userPhone: user?.phone || formData.mobile,
      workerId: selW.id, workerName: selW.name, workerPhone: selW.phone,
      service: selW.skill, emoji: selW.emoji,
      address: formData.address, mobile: formData.mobile,
      description: formData.desc, scheduledTime: formData.time,
      amount: selW.price + 50, payMethod: formData.payMethod,
      status: "confirmed", timestamp: serverTimestamp(),
    };
    try { await setDoc(doc(db, "bookings", bookingId), booking); } catch {}
    setOrders((p) => [{ ...booking, timestamp: new Date() }, ...p]);
    if (formData.payMethod !== "cash") {
      initiatePayment(booking.amount, bookingId);
    } else {
      notifyBackend(bookingId, null);
      setModal("success");
    }
    // Start live tracking
    const unsub = startLiveTracking(selW.id);
    setTimeout(unsub, 60 * 60 * 1000); // stop after 1hr
  };

  // ── NOTIFY BACKEND (WhatsApp) ─────────────────────────────────
  const notifyBackend = async (bookingId, paymentId) => {
    if (!BACKEND || BACKEND === "https://localfix-backend.onrender.com") return;
    try {
      await fetch(`${BACKEND}/api/notify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, paymentId, customerPhone: user?.phone, workerPhone: selW?.phone, workerName: selW?.name, service: selW?.skill }),
      });
    } catch {}
  };

  // ── UPLOAD WORKER PHOTO ───────────────────────────────────────
  const uploadPhoto = async (file, workerId) => {
    const r = storageRef(storage, `workers/${workerId}/photo.jpg`);
    await uploadBytes(r, file);
    return getDownloadURL(r);
  };

  // ── AI CHAT ───────────────────────────────────────────────────
  const getAIReply = (msg) => {
    const m = msg.toLowerCase();
    if (m.includes("plumb") || m.includes("पाइप"))      return AI_REPLIES.plumber;
    if (m.includes("elect") || m.includes("बिजली"))     return AI_REPLIES.electrician;
    if (m.includes("maid")  || m.includes("साफ"))       return AI_REPLIES.maid;
    if (m.includes("ac")    || m.includes("ठंडा"))      return AI_REPLIES.ac;
    if (m.includes("driver")|| m.includes("car"))        return AI_REPLIES.driver;
    if (m.includes("rate")  || m.includes("कितना"))     return AI_REPLIES.rate;
    if (m.includes("cancel")|| m.includes("रद्द"))      return AI_REPLIES.cancel;
    if (m.includes("emergency") || m.includes("मदद"))   return AI_REPLIES.emergency;
    if (m.includes("payment") || m.includes("pay"))      return AI_REPLIES.payment;
    return AI_REPLIES.default;
  };

  const sendChat = (text) => {
    if (!text.trim()) return;
    setChatMsgs((p) => [...p, { role:"user", text }]);
    setTimeout(() => setChatMsgs((p) => [...p, { role:"bot", text: getAIReply(text) }]), 700);
  };

  // ── TOAST ─────────────────────────────────────────────────────
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // ── INSTALL ───────────────────────────────────────────────────
  const installApp = async () => {
    setIBar(false);
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    setInstall(null);
    if (outcome === "accepted") showToast("🎉 LocalFix Install हो गया!");
  };

  // ── NAV ───────────────────────────────────────────────────────
  const go = (s) => { setScreen(s); histRef.current.push(s); window.scrollTo(0, 0); };
  const goBack = () => {
    histRef.current.pop();
    const prev = histRef.current[histRef.current.length - 1] || "home";
    setScreen(prev); window.scrollTo(0, 0);
  };
  const nav = (s) => { histRef.current = [s]; setScreen(s); window.scrollTo(0, 0); };

  const visibleWorkers = workers.filter((w) => (w.cat || w.category) === cat);

  // ── RENDER ────────────────────────────────────────────────────
  return (
    <div style={G.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;600;700;800&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
        ::-webkit-scrollbar{display:none} *{scrollbar-width:none}
        input,select,textarea,button,a{font-family:'Noto Sans Devanagari',sans-serif}
        @keyframes fadeIn {from{opacity:0}to{opacity:1}}
        @keyframes slideUp{from{transform:translateY(50px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes popIn  {from{transform:scale(.8);opacity:0}to{transform:scale(1);opacity:1}}
        @keyframes pulse  {0%,100%{box-shadow:0 0 0 0 rgba(198,40,40,.4)}50%{box-shadow:0 0 0 10px rgba(198,40,40,0)}}
        @keyframes bounce {to{transform:translateY(-12px)}}
        .press:active{transform:scale(.97);transition:transform .1s}
        .card-press:active{transform:scale(.98)}
      `}</style>

      {/* Hidden recaptcha for Phone Auth */}
      <div id="recaptcha-container" />

      {/* UPDATE BAR */}
      {updateBar && (
        <div style={{ position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,zIndex:9999,background:"linear-gradient(135deg,#2E7D32,#1B5E20)",color:"white",padding:"11px 14px",display:"flex",alignItems:"center",gap:10,boxShadow:"0 4px 16px rgba(0,0,0,.25)" }}>
          <span style={{ flex:1,fontSize:13,fontWeight:600 }}>🔄 नया Update आया है!</span>
          <button onClick={() => window._applyUpdate?.()} style={{ background:"white",color:"#2E7D32",border:"none",padding:"5px 14px",borderRadius:20,fontSize:12,fontWeight:700,cursor:"pointer" }}>Update करें</button>
          <button onClick={() => setUpdateBar(false)} style={{ background:"none",border:"none",color:"white",fontSize:18,cursor:"pointer",padding:"0 4px" }}>✕</button>
        </div>
      )}

      {/* INSTALL BAR */}
      {showInstallBar && (
        <div style={{ position:"fixed",bottom:86,left:"50%",transform:"translateX(-50%)",width:"calc(100% - 24px)",maxWidth:400,zIndex:9998,background:"white",borderRadius:18,padding:14,boxShadow:"0 8px 32px rgba(0,0,0,.2)",border:"2px solid #FF6B00",animation:"popIn .4s cubic-bezier(.34,1.56,.64,1)" }}>
          <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:10 }}>
            <div style={{ width:48,height:48,background:"linear-gradient(135deg,#FF6B00,#E64A00)",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0 }}>🔧</div>
            <div><div style={{ fontFamily:"'Baloo 2',cursive",fontSize:16,fontWeight:800,color:"#2D1500" }}>LocalFix Install करें</div><div style={{ fontSize:12,color:"#9E7B65",marginTop:1 }}>बिश्रामपुर की सेवा App</div></div>
          </div>
          <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginBottom:12 }}>
            {["⚡ Fast","📵 Offline","🔔 Notifications","🆓 Free"].map((c) => <span key={c} style={{ background:"#FFF3E8",color:"#FF6B00",fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:20 }}>{c}</span>)}
          </div>
          <div style={{ display:"flex",gap:8 }}>
            <button className="press" onClick={installApp} style={{ flex:2,...G.btn,padding:"11px",fontSize:14,borderRadius:12 }}>📲 Install करें</button>
            <button className="press" onClick={() => { setIBar(false); localStorage.setItem("lf_inst",Date.now().toString()); }} style={{ flex:1,background:"#F5EDE6",color:"#9E7B65",border:"none",borderRadius:12,padding:"11px",fontSize:13,cursor:"pointer" }}>बाद में</button>
          </div>
        </div>
      )}

      {/* OFFLINE BAR */}
      {isOffline && (
        <div style={{ position:"fixed",bottom:86,left:"50%",transform:"translateX(-50%)",background:"#C62828",color:"white",padding:"9px 20px",borderRadius:24,fontSize:13,fontWeight:600,zIndex:9997,whiteSpace:"nowrap",boxShadow:"0 4px 16px rgba(0,0,0,.2)" }}>
          📵 Internet नहीं - Offline Mode
        </div>
      )}

      {/* SPLASH */}
      {screen === "splash" && <SplashScreen />}

      {/* LOGIN */}
      {screen === "login" && <LoginScreen onSendOTP={sendOTP} onVerifyOTP={verifyOTP} />}

      {/* MAIN */}
      {user && !["splash","login"].includes(screen) && (
        <>
          {screen === "home" && <HomeScreen cat={cat} setCat={setCat} workers={visibleWorkers} locText={locText} locLoading={locLoading} onBook={(w) => { setSelW(w); go("booking"); }} onMap={() => go("map")} />}
          {screen === "booking" && selW && <BookingScreen worker={selW} onBack={goBack} onConfirm={createBooking} />}
          {screen === "map"     && <MapScreen mapRef={mapRef} onBack={goBack} workers={visibleWorkers} liveWorker={liveWorkerLoc} />}
          {screen === "orders"  && <OrdersScreen orders={orders} />}
          {screen === "chat"    && <ChatScreen msgs={chatMsgs} onSend={sendChat} />}
          {screen === "emergency" && <EmergencyScreen onBack={goBack} />}
          {screen === "profile"   && <ProfileScreen user={user} orders={orders} onWorker={() => go("register")} />}
          {screen === "register"  && <RegisterScreen onBack={goBack} onSuccess={() => { showToast("🎉 Registration हो गई!"); nav("home"); }} uploadPhoto={uploadPhoto} />}
          {screen === "admin"     && <AdminScreen onBack={goBack} db={db} />}

          <BottomNav screen={screen} onNav={nav} />
        </>
      )}

      {/* MODALS */}
      {modal === "success" && (
        <Modal onClose={() => { setModal(null); nav("orders"); }}>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:60 }}>✅</div>
            <div style={{ fontFamily:"'Baloo 2',cursive",fontSize:22,fontWeight:800,color:"#2E7D32",marginTop:8 }}>बुकिंग Confirmed!</div>
            <div style={{ color:"#9E7B65",fontSize:14,marginTop:8,lineHeight:1.7 }}><strong>{selW?.name}</strong> को WhatsApp गया।<br /><strong>15-20 मिनट</strong> में आएंगे।</div>
            <div style={{ marginTop:14,padding:"9px 20px",background:"#E8F5E9",borderRadius:20,display:"inline-block",color:"#2E7D32",fontSize:13,fontWeight:700 }}>🚶 Worker आ रहे हैं...</div>
            <button className="press" style={{ ...G.btn, marginTop:18 }} onClick={() => { setModal(null); nav("orders"); }}>Order Track करें</button>
          </div>
        </Modal>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position:"fixed",bottom:90,left:"50%",transform:"translateX(-50%)",background:"#1A0A00",color:"white",padding:"10px 20px",borderRadius:24,fontSize:13,fontWeight:600,zIndex:9996,whiteSpace:"nowrap",animation:"popIn .3s ease",fontFamily:"'Noto Sans Devanagari',sans-serif" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SCREENS
// ══════════════════════════════════════════════════════════════
function SplashScreen() {
  return (
    <div style={{ position:"fixed",inset:0,zIndex:1000,background:"linear-gradient(145deg,#FF6B00,#E64A00,#BF3000)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center" }}>
      <div style={{ fontSize:76,animation:"bounce 1s infinite alternate" }}>🔧</div>
      <div style={{ fontFamily:"'Baloo 2',cursive",fontSize:42,fontWeight:800,color:"white",marginTop:12,animation:"fadeIn .5s .3s both" }}>LocalFix</div>
      <div style={{ color:"rgba(255,255,255,.85)",fontSize:15,marginTop:6,animation:"fadeIn .5s .5s both" }}>आपका अपना सेवा App</div>
      <div style={{ marginTop:14,background:"rgba(255,255,255,.2)",padding:"7px 22px",borderRadius:24,color:"white",fontSize:13,animation:"fadeIn .5s .7s both" }}>📍 बिश्रामपुर, छत्तीसगढ़</div>
    </div>
  );
}

function LoginScreen({ onSendOTP, onVerifyOTP }) {
  const [phone, setPhone]   = useState("");
  const [otp,   setOtp]     = useState("");
  const [step,  setStep]    = useState(1);
  const [loading,setLoading]= useState(false);
  const [err,   setErr]     = useState("");
  const [confirmResult, setCR] = useState(null);

  const handleSend = async () => {
    if (phone.length < 10) return setErr("सही 10-digit number डालें");
    setLoading(true); setErr("");
    const res = await onSendOTP(phone);
    if (res.ok) { setCR(res.confirm); setStep(2); }
    else setErr("OTP नहीं गया। फिर try करें।");
    setLoading(false);
  };

  const handleVerify = async () => {
    if (otp.length < 6) return setErr("6-digit OTP डालें");
    setLoading(true); setErr("");
    const res = await onVerifyOTP(confirmResult, otp);
    if (!res.ok) setErr("OTP गलत है।");
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh",background:"linear-gradient(160deg,#FF6B00 0%,#FF6B00 38%,#F5EDE6 38%)",display:"flex",flexDirection:"column" }}>
      <div style={{ padding:"56px 24px 36px",color:"white",textAlign:"center" }}>
        <div style={{ fontSize:48 }}>🔧</div>
        <div style={{ fontFamily:"'Baloo 2',cursive",fontSize:30,fontWeight:800,marginTop:8 }}>LocalFix</div>
        <div style={{ fontSize:14,opacity:.85,marginTop:4 }}>बिश्रामपुर की सेवा App</div>
      </div>
      <div style={{ flex:1,background:"white",borderRadius:"26px 26px 0 0",padding:26,animation:"slideUp .4s ease" }}>
        {step === 1 ? (
          <>
            <div style={{ fontFamily:"'Baloo 2',cursive",fontSize:22,fontWeight:700,color:"#2D1500",marginBottom:5 }}>Login करें</div>
            <div style={{ color:"#9E7B65",fontSize:13,marginBottom:22 }}>Mobile number डालें, OTP आएगा</div>
            <label style={G.lbl}>📞 Mobile Number</label>
            <div style={{ display:"flex",gap:8,marginBottom:16 }}>
              <div style={{ ...G.inp,width:52,textAlign:"center",marginBottom:0,padding:"11px 6px",flexShrink:0 }}>🇮🇳</div>
              <input style={{ ...G.inp,marginBottom:0,flex:1 }} type="tel" maxLength={10} placeholder="98XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            {err && <div style={{ color:"#C62828",fontSize:13,marginBottom:10 }}>{err}</div>}
            <button className="press" style={{ ...G.btn,opacity:loading?.7:1 }} onClick={handleSend} disabled={loading}>{loading ? "Sending..." : "OTP भेजें →"}</button>
          </>
        ) : (
          <>
            <div style={{ fontFamily:"'Baloo 2',cursive",fontSize:22,fontWeight:700,color:"#2D1500",marginBottom:5 }}>OTP Verify करें</div>
            <div style={{ color:"#9E7B65",fontSize:13,marginBottom:22 }}>+91 {phone} पर OTP गया</div>
            <label style={G.lbl}>🔒 6-Digit OTP</label>
            <input style={{ ...G.inp,fontSize:22,letterSpacing:8,textAlign:"center" }} type="tel" maxLength={6} placeholder="● ● ● ● ● ●" value={otp} onChange={(e) => setOtp(e.target.value)} />
            {err && <div style={{ color:"#C62828",fontSize:13,marginBottom:10 }}>{err}</div>}
            <button className="press" style={{ ...G.btn,opacity:loading?.7:1 }} onClick={handleVerify} disabled={loading}>{loading ? "Verifying..." : "Login करें ✓"}</button>
            <div style={{ textAlign:"center",marginTop:12,color:"#FF6B00",fontSize:13,cursor:"pointer" }} onClick={() => { setStep(1); setErr(""); }}>← वापस जाएं</div>
          </>
        )}
        <div style={{ marginTop:26,textAlign:"center",color:"#9E7B65",fontSize:11,lineHeight:1.7 }}>
          Login करके आप हमारी <span style={{ color:"#FF6B00" }}>Terms & Conditions</span> से सहमत हैं।
        </div>
      </div>
    </div>
  );
}

function HomeScreen({ cat, setCat, workers, locText, locLoading, onBook, onMap }) {
  const [search, setSearch] = useState("");
  const filtered = search ? workers.filter((w) => w.name.toLowerCase().includes(search) || w.skill.toLowerCase().includes(search)) : workers;

  return (
    <div style={{ paddingBottom:76 }}>
      <div style={G.top}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:"'Baloo 2',cursive",fontSize:23,fontWeight:800 }}>🔧 LocalFix</div>
            <div style={{ fontSize:12,opacity:.85,marginTop:1,display:"flex",alignItems:"center",gap:4 }}>
              📍 <span style={{ fontWeight:600 }}>{locLoading ? "Detecting..." : locText}</span>
              {locLoading && <span style={{ fontSize:10 }}>⏳</span>}
            </div>
          </div>
          <button onClick={onMap} style={{ background:"rgba(255,255,255,.2)",border:"none",color:"white",padding:"8px 14px",borderRadius:20,fontSize:13,fontWeight:600,cursor:"pointer" }}>🗺️ Map</button>
        </div>
        <div style={{ marginTop:12,background:"white",borderRadius:12,padding:"10px 13px",display:"flex",alignItems:"center",gap:10,boxShadow:"0 4px 16px rgba(0,0,0,.15)" }}>
          <span>🔍</span>
          <input style={{ flex:1,border:"none",outline:"none",fontSize:14,color:"#3D1A00",background:"transparent",fontFamily:"'Noto Sans Devanagari',sans-serif" }} placeholder="सेवा खोजें... (Plumber, Maid...)" value={search} onChange={(e) => setSearch(e.target.value.toLowerCase())} />
        </div>
      </div>

      {/* Emergency Banner */}
      <div className="press" onClick={() => document.querySelector('[data-nav="emergency"]')?.click()} style={{ margin:"13px 14px 0",background:"linear-gradient(135deg,#C62828,#B71C1C)",borderRadius:14,padding:"12px 14px",display:"flex",alignItems:"center",gap:12,color:"white",cursor:"pointer",animation:"pulse 2s infinite" }}>
        <span style={{ fontSize:26 }}>🆘</span>
        <div style={{ flex:1 }}><div style={{ fontWeight:700,fontSize:14 }}>आपातकाल? तुरंत Help!</div><div style={{ fontSize:12,opacity:.85 }}>Police 112 • Ambulance 108 • Fire 101</div></div>
        <span>→</span>
      </div>

      {/* Promo */}
      <div style={{ fontFamily:"'Baloo 2',cursive",fontSize:17,fontWeight:700,color:"#2D1500",padding:"13px 14px 8px" }}>🎁 ऑफर</div>
      <div style={{ display:"flex",gap:10,padding:"0 14px",overflowX:"auto" }}>
        {[["linear-gradient(135deg,#FF6B00,#FF8C00)","पहली बुकिंग FREE","कोई Platform Fee नहीं"],["linear-gradient(135deg,#2E7D32,#43A047)","30 मिनट में Worker","Guaranteed Service"],["linear-gradient(135deg,#1565C0,#1976D2)","Aadhaar Verified","100% Safe"]].map(([bg,t,s],i) => (
          <div key={i} style={{ minWidth:182,borderRadius:14,padding:"13px 15px",background:bg,color:"white",flexShrink:0 }}><div style={{ fontWeight:700,fontSize:14 }}>{t}</div><div style={{ fontSize:12,opacity:.85,marginTop:3 }}>{s}</div></div>
        ))}
      </div>

      {/* Categories */}
      <div style={{ fontFamily:"'Baloo 2',cursive",fontSize:17,fontWeight:700,color:"#2D1500",padding:"13px 14px 8px" }}>⚡ सेवाएं चुनें</div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,padding:"0 14px" }}>
        {CATS.map((c) => (
          <div key={c.id} className="press" onClick={() => setCat(c.id)} style={{ background:cat===c.id?"#FFF3E8":"white",border:`2px solid ${cat===c.id?"#FF6B00":"transparent"}`,borderRadius:12,padding:"11px 5px",display:"flex",flexDirection:"column",alignItems:"center",gap:5,cursor:"pointer",textAlign:"center",boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}>
            <span style={{ fontSize:25 }}>{c.emoji}</span>
            <span style={{ fontSize:11,fontWeight:700,color:"#2D1500",lineHeight:1.2 }}>{c.label}</span>
          </div>
        ))}
      </div>

      {/* Workers */}
      <div style={{ fontFamily:"'Baloo 2',cursive",fontSize:17,fontWeight:700,color:"#2D1500",padding:"13px 14px 8px",display:"flex",alignItems:"center",gap:8 }}>
        📍 पास के Workers
        <span style={G.chip()}>Online {filtered.filter((w)=>w.online).length}</span>
      </div>
      <div style={{ padding:"0 14px",display:"flex",flexDirection:"column",gap:12 }}>
        {filtered.length === 0 && <div style={{ textAlign:"center",padding:36,color:"#9E7B65" }}><div style={{ fontSize:36 }}>😔</div><div style={{ marginTop:8 }}>Worker नहीं मिला</div></div>}
        {filtered.map((w) => <WorkerCard key={w.id} worker={w} onBook={() => onBook(w)} />)}
      </div>
    </div>
  );
}

function WorkerCard({ worker: w, onBook }) {
  return (
    <div className="card-press" style={{ ...G.card,cursor:"pointer" }} onClick={onBook}>
      <div style={{ display:"flex",alignItems:"center",gap:11 }}>
        <div style={{ width:52,height:52,borderRadius:14,flexShrink:0,position:"relative",background:"linear-gradient(135deg,#FF8C38,#FF6B00)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,overflow:"hidden" }}>
          {w.photo ? <img src={w.photo} alt={w.name} style={{ width:"100%",height:"100%",objectFit:"cover" }} /> : w.emoji}
          {w.online && <div style={{ position:"absolute",bottom:2,right:2,width:11,height:11,background:"#4CAF50",borderRadius:"50%",border:"2px solid white" }} />}
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700,fontSize:15,color:"#2D1500" }}>{w.name}</div>
          <div style={{ fontSize:12,color:"#9E7B65",marginTop:2 }}>{w.skill} • {w.exp}</div>
          <div style={{ display:"flex",alignItems:"center",gap:3,marginTop:3 }}>
            <span style={{ color:"#F9A825",fontSize:12 }}>★★★★★</span>
            <span style={{ fontSize:12,fontWeight:700 }}>{w.rating}</span>
            <span style={{ fontSize:11,color:"#9E7B65" }}>({w.reviews})</span>
          </div>
        </div>
      </div>
      <div style={{ display:"flex",gap:7,marginTop:9,flexWrap:"wrap" }}>
        <span style={G.chip()}>📍 {w.dist || "~"} km</span>
        <span style={G.chip(w.online?"#2E7D32":"#666",w.online?"#E8F5E9":"#F5F5F5")}>{w.online?"🟢 Online":"⚫ Offline"}</span>
        <span style={G.chip("#1565C0","#E3F2FD")}>💰 ₹{w.price}/visit</span>
      </div>
      <div style={{ display:"flex",gap:8,marginTop:11 }}>
        <a href={`tel:+91${w.phone}`} onClick={(e)=>e.stopPropagation()} style={{ flex:1,background:"#E8F5E9",color:"#2E7D32",border:"none",borderRadius:10,padding:"10px",fontSize:13,fontWeight:700,textDecoration:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:5 }}>📞 Call</a>
        <button className="press" onClick={(e)=>{e.stopPropagation();onBook();}} style={{ flex:2,...G.btn,padding:"10px",fontSize:13,borderRadius:10 }}>⚡ अभी Book करें</button>
      </div>
    </div>
  );
}

function BookingScreen({ worker: w, onBack, onConfirm }) {
  const [addr,  setAddr]  = useState("");
  const [mob,   setMob]   = useState("");
  const [desc,  setDesc]  = useState("");
  const [time,  setTime]  = useState("अभी");
  const [pay,   setPay]   = useState("cash");
  const [loading,setLoad] = useState(false);

  const TIMES = ["अभी","1 घंटे में","शाम 5 बजे","कल सुबह"];
  const total = w.price + 50;

  const handleConfirm = async () => {
    if (!addr.trim()) return alert("पता डालें");
    if (mob.length < 10) return alert("Mobile number डालें");
    setLoad(true);
    await onConfirm({ address:addr, mobile:mob, desc, time, payMethod:pay });
    setLoad(false);
  };

  return (
    <div style={{ paddingBottom:76 }}>
      <div style={{ ...G.top,display:"flex",alignItems:"center",gap:12 }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,.2)",border:"none",color:"white",width:36,height:36,borderRadius:"50%",cursor:"pointer",fontSize:18 }}>←</button>
        <span style={{ fontFamily:"'Baloo 2',cursive",fontSize:20,fontWeight:700 }}>बुकिंग करें</span>
      </div>
      <div style={{ margin:"13px 14px 0",...G.card,display:"flex",alignItems:"center",gap:13 }}>
        <div style={{ width:58,height:58,borderRadius:16,background:"linear-gradient(135deg,#FF8C38,#FF6B00)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,flexShrink:0,overflow:"hidden" }}>
          {w.photo ? <img src={w.photo} alt={w.name} style={{ width:"100%",height:"100%",objectFit:"cover" }} /> : w.emoji}
        </div>
        <div>
          <div style={{ fontWeight:700,fontSize:16,color:"#2D1500" }}>{w.name}</div>
          <div style={{ fontSize:13,color:"#9E7B65",marginTop:2 }}>{w.skill}</div>
          <div style={{ fontSize:13,color:"#FF6B00",fontWeight:700,marginTop:3 }}>★ {w.rating} • 📍 {w.dist} km • 🟢 Online</div>
        </div>
      </div>
      <div style={{ padding:"13px 14px 0" }}>
        <label style={G.lbl}>📍 पता</label>
        <input style={G.inp} placeholder="पूरा पता..." value={addr} onChange={(e)=>setAddr(e.target.value)} />
        <label style={G.lbl}>📞 Mobile Number</label>
        <input style={G.inp} type="tel" placeholder="98XXXXXXXX" value={mob} onChange={(e)=>setMob(e.target.value)} />
        <label style={G.lbl}>📝 काम</label>
        <textarea style={{ ...G.inp,height:70,resize:"none" }} placeholder="क्या काम करवाना है?" value={desc} onChange={(e)=>setDesc(e.target.value)} />
        <label style={G.lbl}>⏰ समय</label>
        <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:13 }}>
          {TIMES.map((t) => <div key={t} className="press" onClick={()=>setTime(t)} style={{ padding:"8px 13px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",background:time===t?"#FF6B00":"white",color:time===t?"white":"#3D1A00",border:`1.5px solid ${time===t?"#FF6B00":"#E8D5C4"}` }}>{t}</div>)}
        </div>
      </div>
      <div style={{ margin:"0 14px",background:"#FFF3E8",borderRadius:14,padding:13,marginBottom:13 }}>
        {[["सेवा शुल्क",`₹${w.price}`],["Visit Charge","₹50"],["Platform Fee","₹0 🎉"]].map(([k,v])=>(
          <div key={k} style={{ display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:6 }}><span>{k}</span><span>{v}</span></div>
        ))}
        <div style={{ display:"flex",justifyContent:"space-between",fontWeight:700,fontSize:15,paddingTop:8,borderTop:"1px dashed #FFB380",marginTop:4 }}><span>कुल</span><span>₹{total}</span></div>
      </div>
      <div style={{ padding:"0 14px 13px" }}>
        <label style={G.lbl}>💳 Payment</label>
        <div style={{ display:"flex",gap:9 }}>
          {[["cash","💵 Cash"],["upi","📱 UPI"],["online","🏦 Online"]].map(([id,label])=>(
            <button key={id} className="press" onClick={()=>setPay(id)} style={{ flex:1,padding:"10px 6px",borderRadius:10,fontSize:12,fontWeight:700,border:`1.5px solid ${pay===id?"#FF6B00":"#E8D5C4"}`,background:pay===id?"#FFF3E8":"white",color:pay===id?"#FF6B00":"#3D1A00",cursor:"pointer" }}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ padding:"0 14px 14px" }}>
        <button className="press" style={{ ...G.btn,opacity:loading?.7:1 }} onClick={handleConfirm} disabled={loading}>
          {loading ? "Processing..." : `✅ Confirm & ${pay==="cash"?"बुक करें":"Pay ₹"+total}`}
        </button>
      </div>
    </div>
  );
}

function MapScreen({ mapRef, onBack, workers, liveWorker }) {
  return (
    <div style={{ height:"100vh",display:"flex",flexDirection:"column" }}>
      <div style={{ ...G.top,display:"flex",alignItems:"center",gap:12 }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,.2)",border:"none",color:"white",width:36,height:36,borderRadius:"50%",cursor:"pointer",fontSize:18 }}>←</button>
        <span style={{ fontFamily:"'Baloo 2',cursive",fontSize:20,fontWeight:700 }}>📍 Workers का Map</span>
      </div>
      <div ref={mapRef} style={{ flex:1,width:"100%" }} />
      <div style={{ padding:"10px 14px",background:"white",borderTop:"1px solid #F0E4D9",fontSize:12,color:"#9E7B65",textAlign:"center" }}>
        🟠 आप &nbsp;|&nbsp; {workers.filter(w=>w.online).map(w=>w.emoji).join(" ")} Workers
        {liveWorker && " | 🟢 Live Worker"}
      </div>
    </div>
  );
}

function OrdersScreen({ orders }) {
  const [ratingModal, setRM] = useState(false);
  const [selRating,   setSR] = useState(0);

  const allOrders = [
    { id:"DEMO1",service:"Plumber",workerName:"Ramesh Kumar",emoji:"🔧",status:"active",createdAt:"आज",amount:200 },
    { id:"DEMO2",service:"Electrician",workerName:"Suresh Electric",emoji:"⚡",status:"done",createdAt:"12 May",amount:350 },
    ...orders,
  ];

  return (
    <div style={{ paddingBottom:76 }}>
      <div style={G.top}><div style={{ fontFamily:"'Baloo 2',cursive",fontSize:22,fontWeight:700 }}>📋 मेरे Orders</div></div>
      <div style={{ padding:"13px 14px 0" }}>
        {allOrders.map((o) => (
          <div key={o.id} style={G.card}>
            <div style={{ display:"flex",alignItems:"center",gap:11,marginBottom:9 }}>
              <div style={{ width:42,height:42,background:"#FFF3E8",borderRadius:11,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22 }}>{o.emoji}</div>
              <div style={{ flex:1 }}><div style={{ fontWeight:700,fontSize:15 }}>{o.service}</div><div style={{ fontSize:12,color:"#9E7B65",marginTop:1 }}>👷 {o.workerName}</div></div>
              <span style={{ padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:o.status==="active"?"#FFF3E8":"#E8F5E9",color:o.status==="active"?"#FF6B00":"#2E7D32" }}>{o.status==="active"?"Active":"Done ✓"}</span>
            </div>
            {o.status === "active" && <div style={{ background:"#FFF3E8",borderRadius:10,padding:"9px 12px",fontSize:13,marginBottom:9 }}>🚶 Worker आ रहे हैं - <strong>~15 मिनट</strong></div>}
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <span style={{ fontSize:12,color:"#9E7B65" }}>📅 {typeof o.createdAt === "string" ? o.createdAt : "Recently"}</span>
              <span style={{ fontWeight:700,fontSize:15 }}>₹{o.amount}</span>
              {o.status === "done" && <button className="press" onClick={() => setRM(true)} style={{ padding:"6px 13px",background:"#FFF3E8",color:"#FF6B00",border:"none",borderRadius:20,fontSize:12,fontWeight:700,cursor:"pointer" }}>⭐ Rate करें</button>}
            </div>
          </div>
        ))}
      </div>
      {ratingModal && (
        <Modal onClose={() => setRM(false)}>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:24,marginBottom:8 }}>⭐ Rating दें</div>
            <div style={{ fontWeight:700,fontSize:16 }}>Suresh Electric</div>
            <div style={{ display:"flex",gap:7,justifyContent:"center",margin:"14px 0" }}>
              {[1,2,3,4,5].map((n) => <button key={n} onClick={() => setSR(n)} style={{ fontSize:34,cursor:"pointer",background:"none",border:"none" }}>{n <= selRating ? "⭐" : "☆"}</button>)}
            </div>
            <textarea style={{ ...G.inp,marginBottom:12 }} placeholder="अपना अनुभव लिखें... (वैकल्पिक)" rows={3} />
            <button className="press" style={G.btn} onClick={() => { if(!selRating) return alert("Rating चुनें"); setRM(false); alert("✅ Rating Submit हो गई!"); }}>Submit करें</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ChatScreen({ msgs, onSend }) {
  const [input, setInput] = useState("");
  const endRef = useRef(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior:"smooth" }), [msgs]);
  const QUICK = ["🔧 Plumber चाहिए","❄️ AC बंद है","💰 Rates","🆘 Emergency","❌ Cancel"];

  return (
    <div style={{ paddingBottom:76,display:"flex",flexDirection:"column",minHeight:"100vh" }}>
      <div style={{ ...G.top,display:"flex",alignItems:"center",gap:10 }}>
        <div style={{ width:34,height:34,background:"rgba(255,255,255,.25)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18 }}>🤖</div>
        <div><div style={{ fontFamily:"'Baloo 2',cursive",fontSize:18,fontWeight:700 }}>LocalFix AI</div><div style={{ fontSize:11,opacity:.8 }}>● हमेशा Online</div></div>
      </div>
      <div style={{ display:"flex",gap:8,padding:"9px 12px",overflowX:"auto",background:"white",borderBottom:"1px solid #F0E4D9" }}>
        {QUICK.map((q) => <button key={q} className="press" onClick={() => onSend(q)} style={{ whiteSpace:"nowrap",padding:"6px 13px",borderRadius:20,background:"#FFF3E8",color:"#FF6B00",fontSize:12,fontWeight:600,border:"none",cursor:"pointer",flexShrink:0 }}>{q}</button>)}
      </div>
      <div style={{ flex:1,padding:13,display:"flex",flexDirection:"column",gap:11,overflowY:"auto" }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display:"flex",gap:8,alignItems:"flex-end",flexDirection:m.role==="user"?"row-reverse":"row" }}>
            <div style={{ width:30,height:30,borderRadius:"50%",flexShrink:0,background:m.role==="bot"?"linear-gradient(135deg,#FF6B00,#E64A00)":"#E3F2FD",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14 }}>{m.role==="bot"?"🤖":"👤"}</div>
            <div style={{ maxWidth:"76%",padding:"10px 13px",borderRadius:16,fontSize:13,lineHeight:1.6,background:m.role==="user"?"linear-gradient(135deg,#FF6B00,#E64A00)":"white",color:m.role==="user"?"white":"#3D1A00",boxShadow:m.role==="bot"?"0 2px 12px rgba(0,0,0,.08)":"none",borderBottomRightRadius:m.role==="user"?4:16,borderBottomLeftRadius:m.role==="bot"?4:16 }}>
              {m.text.split("\n").map((l, j) => <div key={j}>{l}</div>)}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div style={{ padding:"11px 13px",background:"white",borderTop:"1px solid #F0E4D9",display:"flex",gap:9,alignItems:"center",position:"sticky",bottom:76 }}>
        <input style={{ ...G.inp,flex:1,marginBottom:0,borderRadius:24 }} placeholder="हिंदी में लिखें..." value={input} onChange={(e) => setInput(e.target.value)} onKeyPress={(e) => { if (e.key==="Enter" && input.trim()) { onSend(input); setInput(""); } }} />
        <button className="press" onClick={() => { if(input.trim()){ onSend(input); setInput(""); }}} style={{ width:40,height:40,background:"linear-gradient(135deg,#FF6B00,#E64A00)",border:"none",borderRadius:"50%",color:"white",cursor:"pointer",fontSize:17,display:"flex",alignItems:"center",justifyContent:"center" }}>➤</button>
      </div>
    </div>
  );
}

function EmergencyScreen({ onBack }) {
  const EM = [
    ["#C62828","#B71C1C","🚨","Police","112"],["#1565C0","#0D47A1","🚑","Ambulance","108"],
    ["#E65100","#BF360C","🔥","Fire","101"],  ["#6A1B9A","#4A148C","👩","Women Help","1091"],
    ["#00695C","#004D40","👶","Child Help","1098"],["#2E7D32","#1B5E20","🏥","Health","104"],
  ];
  return (
    <div style={{ paddingBottom:76 }}>
      <div style={{ ...G.top,display:"flex",alignItems:"center",gap:10 }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,.2)",border:"none",color:"white",padding:"6px 10px",borderRadius:8,cursor:"pointer",fontSize:16 }}>←</button>
        <span style={{ fontFamily:"'Baloo 2',cursive",fontSize:20,fontWeight:700 }}>🆘 Emergency</span>
      </div>
      <div style={{ margin:13,background:"#FFF3E8",borderRadius:13,padding:11,fontSize:13,color:"#E64A00",fontWeight:600 }}>⚠️ सिर्फ असली आपातकाल में उपयोग करें।</div>
      <div style={{ fontFamily:"'Baloo 2',cursive",fontSize:17,fontWeight:700,color:"#2D1500",padding:"0 14px 10px" }}>📞 तुरंत Call करें</div>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:11,padding:"0 14px" }}>
        {EM.map(([c1,c2,icon,label,num])=>(
          <a key={num} href={`tel:${num}`} className="press" style={{ borderRadius:14,padding:15,color:"white",background:`linear-gradient(135deg,${c1},${c2})`,display:"flex",flexDirection:"column",gap:6,textDecoration:"none",boxShadow:"0 4px 16px rgba(0,0,0,.15)" }}>
            <span style={{ fontSize:28 }}>{icon}</span>
            <span style={{ fontWeight:700,fontSize:13 }}>{label}</span>
            <span style={{ fontFamily:"'Baloo 2',cursive",fontSize:22,fontWeight:800 }}>{num}</span>
          </a>
        ))}
      </div>
      <div style={{ fontFamily:"'Baloo 2',cursive",fontSize:17,fontWeight:700,color:"#2D1500",padding:"13px 14px 8px" }}>🏙️ बिश्रामपुर Local</div>
      {[["🏛️","बिश्रामपुर Police Station","Local थाना","07774200100"],["🏥","CIMS Hospital","24/7 Emergency","07774220200"],["🔥","Fire Station","Emergency","101"]].map(([ic,nm,sub,num])=>(
        <a key={nm} href={`tel:${num}`} style={{ ...G.card,margin:"0 14px 10px",display:"flex",alignItems:"center",gap:11,textDecoration:"none",color:"inherit" }}>
          <span style={{ fontSize:22 }}>{ic}</span>
          <div style={{ flex:1 }}><div style={{ fontWeight:700,fontSize:14 }}>{nm}</div><div style={{ fontSize:12,color:"#9E7B65",marginTop:2 }}>{sub}</div></div>
          <span style={{ color:"#FF6B00",fontWeight:700 }}>📞</span>
        </a>
      ))}
    </div>
  );
}

function ProfileScreen({ user, orders, onWorker }) {
  return (
    <div style={{ paddingBottom:76 }}>
      <div style={{ background:"linear-gradient(135deg,#FF6B00,#E64A00)",padding:"22px 14px 38px",color:"white",textAlign:"center" }}>
        <div style={{ width:76,height:76,borderRadius:"50%",margin:"0 auto 11px",background:"rgba(255,255,255,.25)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,border:"3px solid rgba(255,255,255,.5)" }}>👤</div>
        <div style={{ fontFamily:"'Baloo 2',cursive",fontSize:22,fontWeight:700 }}>{user?.name || "User"}</div>
        <div style={{ fontSize:13,opacity:.85,marginTop:3 }}>📞 {user?.phone}</div>
        <div style={{ display:"flex",justifyContent:"center",gap:22,marginTop:15 }}>
          {[["Bookings",orders.length],["खर्च","₹"+(orders.reduce((a,o)=>a+(o.amount||0),0))],["Rating","4.8⭐"]].map(([l,v])=>(
            <div key={l} style={{ textAlign:"center" }}><div style={{ fontFamily:"'Baloo 2',cursive",fontSize:22,fontWeight:800 }}>{v}</div><div style={{ fontSize:11,opacity:.75 }}>{l}</div></div>
          ))}
        </div>
      </div>
      <div style={{ margin:"14px 14px",background:"linear-gradient(135deg,#1565C0,#0D47A1)",borderRadius:16,padding:18,color:"white" }}>
        <div style={{ fontFamily:"'Baloo 2',cursive",fontSize:19,fontWeight:800 }}>🔨 Worker हैं आप?</div>
        <div style={{ fontSize:13,opacity:.85,marginTop:5,lineHeight:1.5 }}>LocalFix पर Register करें।<br/>घर बैठे काम मिलेगा। Free!</div>
        <button className="press" onClick={onWorker} style={{ marginTop:13,background:"white",color:"#1565C0",border:"none",borderRadius:10,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:"pointer" }}>अभी Register करें →</button>
      </div>
      <div style={{ margin:"0 14px",background:"white",borderRadius:16,overflow:"hidden",boxShadow:"0 4px 24px rgba(255,107,0,.1)" }}>
        {[["👤","Profile Edit"],["📍","Saved Addresses"],["💳","Payment Methods"],["🔔","Notifications"],["🛡️","Privacy & Terms"],["📞","Customer Support"]].map(([ic,tx])=>(
          <div key={tx} className="press" style={{ display:"flex",alignItems:"center",gap:13,padding:"13px 14px",borderBottom:"1px solid #F5EDE6",cursor:"pointer" }}>
            <span style={{ fontSize:20 }}>{ic}</span>
            <span style={{ flex:1,fontSize:14,fontWeight:600 }}>{tx}</span>
            <span style={{ color:"#9E7B65" }}>›</span>
          </div>
        ))}
        <div className="press" style={{ display:"flex",alignItems:"center",gap:13,padding:"13px 14px",cursor:"pointer" }}>
          <span style={{ fontSize:20 }}>🚪</span>
          <span style={{ flex:1,fontSize:14,fontWeight:600,color:"#C62828" }}>Logout</span>
          <span style={{ color:"#C62828" }}>›</span>
        </div>
      </div>
    </div>
  );
}

function RegisterScreen({ onBack, onSuccess, uploadPhoto }) {
  const [form,  setForm]  = useState({ name:"",phone:"",skill:"",aadhaar:"",area:"",experience:"" });
  const [photo, setPhoto] = useState(null);
  const [loading,setLoad] = useState(false);

  const submit = async () => {
    if (!form.name||!form.phone||!form.skill||!form.aadhaar) return alert("सब field भरें");
    setLoad(true);
    try {
      const workerId = "WK" + Date.now();
      let photoURL = null;
      if (photo) photoURL = await uploadPhoto(photo, workerId);
      await addDoc(collection(db, "worker_applications"), {
        ...form, workerId, photoURL,
        status: "pending", city: "Bishrampur", state: "CG",
        timestamp: serverTimestamp(),
      });
      onSuccess();
    } catch { alert("Error! फिर try करें।"); }
    setLoad(false);
  };

  return (
    <div style={{ paddingBottom:76 }}>
      <div style={{ ...G.top,display:"flex",alignItems:"center",gap:12 }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,.2)",border:"none",color:"white",width:36,height:36,borderRadius:"50%",cursor:"pointer",fontSize:18 }}>←</button>
        <span style={{ fontFamily:"'Baloo 2',cursive",fontSize:20,fontWeight:700 }}>Worker Registration</span>
      </div>
      <div style={{ padding:"13px 14px 0" }}>
        <div style={{ background:"#FFF3E8",borderRadius:13,padding:11,fontSize:13,color:"#FF6B00",fontWeight:600,marginBottom:13 }}>✅ Free &nbsp;|&nbsp; ✅ Aadhaar KYC &nbsp;|&nbsp; ✅ Weekly Payment</div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:13 }}>
          {[["💰","₹500-1500/day"],["📱","App से Orders"],["🛡️","Insurance"],["⭐","Rating System"]].map(([ic,tx])=>(
            <div key={tx} style={{ background:"white",borderRadius:12,padding:13,textAlign:"center",boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}><div style={{ fontSize:24,marginBottom:5 }}>{ic}</div><div style={{ fontSize:13,fontWeight:700,color:"#2D1500" }}>{tx}</div></div>
          ))}
        </div>
        {/* Photo Upload */}
        <label style={G.lbl}>📸 अपनी Photo (Optional)</label>
        <div style={{ marginBottom:13,padding:16,border:"2px dashed #E8D5C4",borderRadius:12,textAlign:"center",cursor:"pointer",background:"white" }} onClick={() => document.getElementById("photo-inp").click()}>
          {photo ? <div style={{ color:"#2E7D32",fontWeight:600 }}>✅ {photo.name}</div> : <div style={{ color:"#9E7B65" }}>📷 Photo upload करें (optional)</div>}
        </div>
        <input id="photo-inp" type="file" accept="image/*" style={{ display:"none" }} onChange={(e) => setPhoto(e.target.files[0])} />
        {[["👤","पूरा नाम","text","Ramesh Kumar","name"],["📞","Mobile","tel","WhatsApp Number","phone"],["🆔","Aadhaar Number","tel","XXXX XXXX XXXX","aadhaar"],["📍","Area","text","Station Road","area"],["⏳","Experience","text","5 साल","experience"]].map(([ic,lb,tp,ph,field])=>(
          <div key={field}><label style={G.lbl}>{ic} {lb}</label><input style={G.inp} type={tp} placeholder={ph} value={form[field]} onChange={(e)=>setForm(p=>({...p,[field]:e.target.value}))} /></div>
        ))}
        <label style={G.lbl}>🔨 काम का प्रकार</label>
        <select style={{ ...G.inp,appearance:"none" }} value={form.skill} onChange={(e)=>setForm(p=>({...p,skill:e.target.value}))}>
          <option value="">चुनें...</option>
          {CATS.map((c)=><option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
        </select>
        <button className="press" style={{ ...G.btn,opacity:loading?.7:1 }} onClick={submit} disabled={loading}>{loading?"Registering...":"🚀 Register करें - Free!"}</button>
      </div>
    </div>
  );
}

function AdminScreen({ onBack, db }) {
  const [workers,  setWorkers]  = useState([]);
  const [bookings, setBookings] = useState([]);
  const [tab,      setTab]      = useState("workers");
  const [loading,  setLoad]     = useState(true);

  useEffect(() => {
    (async () => {
      setLoad(true);
      try {
        const ws = await getDocs(query(collection(db,"worker_applications"),orderBy("timestamp","desc"),limit(20)));
        setWorkers(ws.docs.map(d=>({id:d.id,...d.data()})));
        const bs = await getDocs(query(collection(db,"bookings"),orderBy("timestamp","desc"),limit(20)));
        setBookings(bs.docs.map(d=>({id:d.id,...d.data()})));
      } catch {}
      setLoad(false);
    })();
  }, [db]);

  const approveWorker = async (id, data) => {
    await setDoc(doc(db,"workers",id), { ...data, active:true, verified:true, rating:0, reviews:0, online:false, timestamp:serverTimestamp() });
    await updateDoc(doc(db,"worker_applications",id), { status:"approved" });
    setWorkers(p=>p.map(w=>w.id===id?{...w,status:"approved"}:w));
    alert("✅ Worker Approved!");
  };

  return (
    <div style={{ paddingBottom:76 }}>
      <div style={{ ...G.top,display:"flex",alignItems:"center",gap:12 }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,.2)",border:"none",color:"white",width:36,height:36,borderRadius:"50%",cursor:"pointer",fontSize:18 }}>←</button>
        <span style={{ fontFamily:"'Baloo 2',cursive",fontSize:20,fontWeight:700 }}>🛠️ Admin Panel</span>
      </div>
      <div style={{ display:"flex",gap:0,margin:"13px 14px",background:"white",borderRadius:12,overflow:"hidden",boxShadow:"0 2px 8px rgba(0,0,0,.08)" }}>
        {[["workers","👷 Workers"],["bookings","📋 Bookings"]].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ flex:1,padding:"12px",border:"none",background:tab===id?"linear-gradient(135deg,#FF6B00,#E64A00)":"white",color:tab===id?"white":"#9E7B65",fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"'Noto Sans Devanagari',sans-serif" }}>{label}</button>
        ))}
      </div>
      {loading && <div style={{ textAlign:"center",padding:40,color:"#9E7B65" }}>Loading...</div>}
      {!loading && tab === "workers" && workers.map((w)=>(
        <div key={w.id} style={{ ...G.card,margin:"0 14px 10px" }}>
          <div style={{ fontWeight:700,fontSize:15 }}>{w.name}</div>
          <div style={{ fontSize:13,color:"#9E7B65",marginTop:3 }}>{w.skill} • {w.phone} • {w.area}</div>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10 }}>
            <span style={{ padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:w.status==="approved"?"#E8F5E9":"#FFF3E8",color:w.status==="approved"?"#2E7D32":"#FF6B00" }}>{w.status==="approved"?"✅ Approved":"⏳ Pending"}</span>
            {w.status !== "approved" && <button className="press" onClick={()=>approveWorker(w.id,w)} style={{ background:"linear-gradient(135deg,#2E7D32,#1B5E20)",color:"white",border:"none",borderRadius:10,padding:"8px 16px",fontSize:13,fontWeight:700,cursor:"pointer" }}>✅ Approve</button>}
          </div>
        </div>
      ))}
      {!loading && tab === "bookings" && bookings.map((b)=>(
        <div key={b.id} style={{ ...G.card,margin:"0 14px 10px" }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div style={{ fontWeight:700,fontSize:14 }}>{b.service}</div>
            <span style={{ padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:"#FFF3E8",color:"#FF6B00" }}>{b.status}</span>
          </div>
          <div style={{ fontSize:13,color:"#9E7B65",marginTop:4 }}>Worker: {b.workerName} • ₹{b.amount}</div>
          <div style={{ fontSize:12,color:"#9E7B65",marginTop:2 }}>📍 {b.address}</div>
        </div>
      ))}
    </div>
  );
}

function BottomNav({ screen, onNav }) {
  const items = [["home","🏠","Home"],["orders","📋","Orders"],["chat","🤖","AI"],["emergency","🆘","SOS"],["profile","👤","Profile"]];
  return (
    <nav style={G.nav}>
      {items.map(([id,icon,label])=>(
        <button key={id} data-nav={id} onClick={()=>onNav(id)} style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"pointer",padding:4,background:"none",border:"none" }}>
          <span style={{ fontSize:22 }}>{icon}</span>
          <span style={{ fontSize:10,fontWeight:600,color:screen===id?"#FF6B00":"#999",fontFamily:"'Noto Sans Devanagari',sans-serif" }}>{label}</span>
          {id==="orders" && <div style={{ width:5,height:5,background:"#FF6B00",borderRadius:"50%" }} />}
        </button>
      ))}
    </nav>
  );
}

function Modal({ children, onClose }) {
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:500,display:"flex",alignItems:"flex-end",justifyContent:"center" }} onClick={(e)=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:"white",borderRadius:"24px 24px 0 0",padding:22,width:"100%",maxWidth:430,animation:"slideUp .35s cubic-bezier(.34,1.56,.64,1)" }}>
        {children}
      </div>
    </div>
  );
}
