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
Eres un analista experto en seguridad urbana para Bogotá, Colombia. Tu tarea es analizar reportes de inseguridad y detectar patrones MUY ESPECÍFICOS.

REPORTES:
${JSON.stringify(reportes, null, 2)}

Instrucciones:
1. Analiza el TIPO de delito específico (robo de celular, robo de vehículo, atraco a peatón, robo en transporte público, etc.)
2. Identifica la HORA del día si hay un patrón (mañana, tarde, noche)
3. Identifica la ZONA específica usando las coordenadas (barrio, localidad, avenida, etc. de Bogotá)
4. La recomendación debe ser CONCRETA y dirigida a la Policía de Bogotá

Responde en JSON con este formato exacto:
{
  "hayAlerta": true o false,
  "nivelRiesgo": "alto", "medio" o "bajo",
  "patron": "descripción MUY específica del patrón. Ejemplo: 'Incremento de robos de celulares a peatones en horario nocturno entre 8pm y 11pm'",
  "zona": "zona específica de Bogotá basada en las coordenadas. Ejemplo: 'Zona Rosa, Chapinero' o 'Carrera 7 con Calle 72, Chapinero'",
  "recomendacion": "recomendación CONCRETA para la Policía. Ejemplo: 'Aumentar patrullaje a pie en la Carrera 13 entre Calles 63 y 72 en horario 8pm-11pm, con especial atención a personas usando audífonos o celulares'"
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