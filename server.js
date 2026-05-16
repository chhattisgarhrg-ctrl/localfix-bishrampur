require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const helmet    = require("helmet");
const rateLimit = require("express-rate-limit");
const twilio    = require("twilio");
const Razorpay  = require("razorpay");
const crypto    = require("crypto");
const admin     = require("firebase-admin");

const app = express();

// ── SECURITY ──────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json({ limit: "10kb" }));

// Rate limiting - 100 requests per 15 min per IP
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: "Too many requests" } });
app.use(limiter);

// Stricter limit for OTP / auth routes
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: "Too many auth attempts" } });

// ── FIREBASE ADMIN ────────────────────────────────────────────
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
}
const db = admin.apps.length ? admin.firestore() : null;

// ── TWILIO ────────────────────────────────────────────────────
const twilioClient = process.env.TWILIO_ACCOUNT_SID
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// ── RAZORPAY ──────────────────────────────────────────────────
const razorpay = process.env.RAZORPAY_KEY_ID
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get("/", (_, res) => res.json({ status: "✅ LocalFix Backend", city: "Bishrampur, CG" }));

// ── SEND WHATSAPP NOTIFICATIONS ───────────────────────────────
app.post("/api/notify", async (req, res) => {
  const { customerPhone, workerPhone, workerName, service, bookingId, address, paymentId } = req.body;
  if (!customerPhone || !workerPhone) return res.status(400).json({ error: "Missing fields" });

  try {
    if (!twilioClient) return res.json({ success: true, mock: true });

    await twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
      to:   `whatsapp:+91${customerPhone}`,
      body: `🔧 *LocalFix - बुकिंग Confirmed!*\n\nBooking ID: *${bookingId}*\nसेवा: ${service}\nWorker: *${workerName}*\nपता: ${address}\n${paymentId ? `Payment: ${paymentId}\n` : "Payment: Cash on Service\n"}\n✅ Worker 15-20 मिनट में आएंगे!\n\n*LocalFix Bishrampur* 🏙️`,
    });

    await twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
      to:   `whatsapp:+91${workerPhone}`,
      body: `🆕 *LocalFix - नया Order!*\n\nBooking: *${bookingId}*\nसेवा: ${service}\n📍 Address: *${address}*\n📞 Customer: +91${customerPhone}\n\nतुरंत जाएं! ⚡`,
    });

    if (db) await db.collection("notifications").add({ bookingId, customerPhone, workerPhone, type:"booking", sentAt: admin.firestore.FieldValue.serverTimestamp() });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── CREATE RAZORPAY ORDER ─────────────────────────────────────
app.post("/api/payment/create", async (req, res) => {
  const { amount, bookingId, customerPhone } = req.body;
  if (!amount || amount < 1) return res.status(400).json({ error: "Invalid amount" });

  try {
    if (!razorpay) return res.json({ mock: true, orderId: "mock_" + Date.now() });
    const order = await razorpay.orders.create({ amount: amount * 100, currency: "INR", receipt: bookingId, notes: { customerPhone, bookingId } });
    if (db) await db.collection("payment_orders").doc(order.id).set({ orderId: order.id, amount, bookingId, status:"created", createdAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ success: true, orderId: order.id });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── RAZORPAY WEBHOOK ─────────────────────────────────────────
app.post("/api/payment/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig  = req.headers["x-razorpay-signature"];
  const body = req.body.toString();
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "").update(body).digest("hex");
  if (sig !== expected) return res.status(400).json({ error: "Invalid signature" });

  const event = JSON.parse(body);
  if (event.event === "payment.captured") {
    const p = event.payload.payment.entity;
    if (db) {
      await db.collection("payments").add({ paymentId:p.id, orderId:p.order_id, amount:p.amount/100, status:"captured", capturedAt: admin.firestore.FieldValue.serverTimestamp() });
      const snap = await db.collection("bookings").where("razorpayOrderId","==",p.order_id).limit(1).get();
      if (!snap.empty) await snap.docs[0].ref.update({ status:"paid", paymentId:p.id });
    }
    if (twilioClient && p.notes?.customerPhone) {
      await twilioClient.messages.create({ from:`whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`, to:`whatsapp:+91${p.notes.customerPhone}`, body:`✅ Payment ₹${p.amount/100} Successful!\nPayment ID: ${p.id}\nबुकिंग Confirmed! 🎉` }).catch(()=>{});
    }
  }
  res.json({ received: true });
});

// ── GET NEARBY WORKERS ────────────────────────────────────────
app.get("/api/workers", async (req, res) => {
  const { lat, lng, cat, radius = 10 } = req.query;
  try {
    if (!db) return res.json({ workers: [] });
    let q = db.collection("workers").where("active","==",true);
    if (cat) q = q.where("category","==",cat);
    const snap = await q.get();
    let workers = snap.docs.map(d=>({id:d.id,...d.data()}));
    if (lat && lng) {
      workers = workers.filter(w => {
        if (!w.lat||!w.lng) return true;
        w.distKm = Math.round(haversine(+lat,+lng,w.lat,w.lng)*10)/10;
        return w.distKm <= +radius;
      }).sort((a,b)=>(a.distKm||99)-(b.distKm||99));
    }
    res.json({ success: true, count: workers.length, workers });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── REGISTER WORKER ───────────────────────────────────────────
app.post("/api/workers/register", authLimiter, async (req, res) => {
  const { name, phone, skill, aadhaar, area } = req.body;
  if (!name||!phone||!skill||!aadhaar) return res.status(400).json({ error: "Missing required fields" });

  try {
    const workerId = "WK" + Date.now();
    if (db) {
      await db.collection("workers").doc(workerId).set({ id:workerId, name, phone, category:skill, aadhaar:aadhaar.replace(/\s/g,""), area, city:"Bishrampur", state:"CG", active:false, verified:false, rating:0, reviews:0, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      if (twilioClient) {
        await twilioClient.messages.create({ from:`whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`, to:`whatsapp:+91${process.env.ADMIN_PHONE}`, body:`🆕 नया Worker!\nNaam: ${name}\nPhone: ${phone}\nSkill: ${skill}\nArea: ${area}\n\nApprove karein.` }).catch(()=>{});
      }
    }
    res.json({ success: true, workerId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SEND PUSH NOTIFICATION (FCM) ─────────────────────────────
app.post("/api/push", async (req, res) => {
  const { token, title, body, url } = req.body;
  if (!token) return res.status(400).json({ error: "FCM token required" });
  try {
    if (!admin.apps.length) return res.json({ mock: true });
    await admin.messaging().send({ token, notification:{ title, body }, webpush:{ fcmOptions:{ link: url || "/" } } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SUBMIT RATING ─────────────────────────────────────────────
app.post("/api/rating", async (req, res) => {
  const { workerId, bookingId, rating, review, userId } = req.body;
  if (!workerId||!rating) return res.status(400).json({ error: "Missing fields" });
  try {
    if (db) {
      await db.collection("ratings").add({ workerId, bookingId, rating:+rating, review, userId, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      const snap = await db.collection("ratings").where("workerId","==",workerId).get();
      const all  = snap.docs.map(d=>d.data().rating);
      const avg  = Math.round((all.reduce((a,b)=>a+b,0)/all.length)*10)/10;
      await db.collection("workers").doc(workerId).update({ rating:avg, reviews:all.length });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── UPDATE WORKER LIVE LOCATION ───────────────────────────────
app.post("/api/worker/location", async (req, res) => {
  const { workerId, lat, lng } = req.body;
  if (!workerId||!lat||!lng) return res.status(400).json({ error: "Missing fields" });
  try {
    if (db) await db.collection("worker_locations").doc(workerId).set({ lat:+lat, lng:+lng, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HAVERSINE ─────────────────────────────────────────────────
function haversine(lat1,lon1,lat2,lon2) {
  const R = 6371, dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

app.listen(process.env.PORT || 3000, () => console.log("🚀 LocalFix Backend running | Bishrampur CG"));
module.exports = app;
