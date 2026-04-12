const express = require('express');
const OpenAI = require('openai');
const admin = require('firebase-admin');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Inicializar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Inicializar Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// ─── RUTA DE ANÁLISIS DE PATRONES ────────────────────────────────────────────
app.post('/analizar', async (req, res) => {
  try {
    // Obtener los últimos 20 reportes de Firestore
    const snapshot = await db
      .collection('reportes')
      .orderBy('fecha', 'desc')
      .limit(20)
      .get();

    const reportes = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      fecha: doc.data().fecha?.toDate().toISOString(),
      ubicacion: {
        lat: doc.data().ubicacion?.latitude,
        lng: doc.data().ubicacion?.longitude,
      },
    }));

    if (reportes.length === 0) {
      return res.json({ mensaje: 'No hay suficientes reportes para analizar' });
    }

    // Enviar reportes a OpenAI para análisis
    const prompt = `
Eres un analista de seguridad urbana para Bogotá, Colombia.
Analiza los siguientes reportes de inseguridad y detecta patrones.

REPORTES:
${JSON.stringify(reportes, null, 2)}

Por favor responde en JSON con este formato exacto:
{
  "hayAlerta": true o false,
  "nivelRiesgo": "alto", "medio" o "bajo",
  "patron": "descripción breve del patrón detectado",
  "zona": "nombre o descripción de la zona afectada",
  "recomendacion": "recomendación para la Policía"
}
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const analisis = JSON.parse(completion.choices[0].message.content);

    // Guardar análisis en Firestore si hay alerta
    if (analisis.hayAlerta) {
      await db.collection('alertas').add({
        ...analisis,
        fecha: admin.firestore.FieldValue.serverTimestamp(),
        reportesAnalizados: reportes.length,
      });
    }

    res.json(analisis);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── RUTA DE SALUD ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'SeguroBogotá Backend funcionando ✅' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});