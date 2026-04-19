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
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');

// ─── SCRAPER DE NOTICIAS ──────────────────────────────────────────────────────
async function scrapearNoticias() {
  console.log('Iniciando scraping de noticias...');
  const noticias = [];

  const feeds = [
    'https://www.rcnradio.com/feed',
    'https://www.bluradio.com/feed',
    'https://feeds.feedburner.com/semana/noticias',
    'https://www.elcolombiano.com/rss/todas_las_noticias.xml',
  ];

  for (const feedUrl of feeds) {
    try {
      const response = await axios.get(feedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 10000,
      });

      const $ = cheerio.load(response.data, { xmlMode: true });

      // Intentar diferentes estructuras de RSS
      const items = $('item').length > 0 ? $('item') : $('entry');

      items.each((i, el) => {
        const titulo = $(el).find('title').first().text().replace('<![CDATA[', '').replace(']]>', '').trim();
        const descripcion = $(el).find('description, summary, content').first().text().replace('<![CDATA[', '').replace(']]>', '').trim();
        const enlace = $(el).find('link').first().text().trim() || $(el).find('link').first().attr('href') || '';

        if (titulo && titulo.length > 10) {
          noticias.push({ titulo, descripcion: descripcion.substring(0, 300), enlace });
        }
      });

      console.log(`Feed ${feedUrl}: ${$('item, entry').length} items`);
    } catch (error) {
      console.error(`Error en feed ${feedUrl}:`, error.message);
    }
  }

  console.log(`Total noticias encontradas: ${noticias.length}`);
  return noticias;
}
async function procesarNoticiasConIA(noticias) {
  if (noticias.length === 0) return;

  const noticiasSeguridad = noticias.filter(n => {
    const texto = (n.titulo + ' ' + n.descripcion).toLowerCase();
    return texto.includes('robo') || texto.includes('hurto') ||
           texto.includes('atraco') || texto.includes('inseguridad') ||
           texto.includes('delito') || texto.includes('crimen') ||
           texto.includes('secuestro') || texto.includes('extorsión') ||
           texto.includes('homicidio') || texto.includes('banda');
  });

  console.log(`${noticiasSeguridad.length} noticias de seguridad encontradas`);

  for (const noticia of noticiasSeguridad.slice(0, 5)) {
    try {
      const prompt = `
Eres un analista de seguridad urbana para Bogotá. Analiza esta noticia y extrae información estructurada.

NOTICIA:
Título: ${noticia.titulo}
Descripción: ${noticia.descripcion}

Responde en JSON con este formato exacto:
{
  "esRelevante": true o false (solo true si es sobre un incidente de seguridad en Bogotá),
  "tipo": "tipo de incidente (Robo con pistola, Robo con cuchillo o navaja, Raponeo, Chalequeo, Secuestro, Extorsión, Paseo millonario, Otro)",
  "descripcion": "descripción breve del incidente",
  "zona": "zona o barrio de Bogotá donde ocurrió (null si no se menciona)",
  "lat": número de latitud aproximada en Bogotá (null si no se puede determinar),
  "lng": número de longitud aproximada en Bogotá (null si no se puede determinar)
}
`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });

      const resultado = JSON.parse(completion.choices[0].message.content);

      if (resultado.esRelevante) {
        // Verificar si ya existe esta noticia
        const existe = await db.collection('reportes')
          .where('fuente', '==', 'noticias')
          .where('titulo', '==', noticia.titulo)
          .get();

        if (existe.empty) {
          await db.collection('reportes').add({
            tipo: resultado.tipo || 'Otro',
            descripcion: resultado.descripcion,
            zona: resultado.zona,
            fecha: admin.firestore.FieldValue.serverTimestamp(),
            ubicacion: new admin.firestore.GeoPoint(
              resultado.lat || 4.6097,
              resultado.lng || -74.0817
            ),
            fuente: 'noticias',
            titulo: noticia.titulo,
            enlace: noticia.enlace || null,
            usuarioNombre: 'Bot de Noticias',
            rol: 'Testigo',
          });
          console.log(`Reporte guardado: ${noticia.titulo}`);
        }
      }
    } catch (error) {
      console.error('Error procesando noticia:', error.message);
    }
  }
}

// Ejecutar scraping cada 6 horas
cron.schedule('0 */6 * * *', async () => {
  console.log('Ejecutando scraping automático...');
  const noticias = await scrapearNoticias();
  await procesarNoticiasConIA(noticias);
});

// ─── RUTA MANUAL PARA DISPARAR EL SCRAPING ───────────────────────────────────
app.post('/scraper', async (req, res) => {
  try {
    res.json({ mensaje: 'Scraping iniciado en segundo plano' });
    const noticias = await scrapearNoticias();
    await procesarNoticiasConIA(noticias);
  } catch (error) {
    console.error('Error en scraping:', error.message);
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});