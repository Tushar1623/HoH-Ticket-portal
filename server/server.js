import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://astittvamedia_db_user:18RDgVUxdOdRkcdr@cluster0.ljtgvll.mongodb.net/hoh_tickets_db?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = process.env.DB_NAME || 'hoh_tickets_db';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'tickets';

app.use(cors());
app.use(express.json());

let client;
let db;
let ticketsCollection;

const TOTAL_TICKETS = 50;
const VALID_TICKET_CODES = Array.from({ length: TOTAL_TICKETS }, (_, i) => {
  return `HOH${(i + 1).toString().padStart(3, '0')}`;
});

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

/**
 * Initialize MongoDB connection and seed 50 tickets if empty
 */
async function connectToMongo() {
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    ticketsCollection = db.collection(COLLECTION_NAME);

    // Create unique index on code
    await ticketsCollection.createIndex({ code: 1 }, { unique: true });

    // Seed 50 tickets HOH001-HOH050 if missing
    const existingCount = await ticketsCollection.countDocuments();
    if (existingCount < TOTAL_TICKETS) {
      console.log(`Seeding missing tickets in MongoDB (${existingCount} found)...`);
      const now = new Date().toISOString();
      const ops = VALID_TICKET_CODES.map(code => ({
        updateOne: {
          filter: { code },
          update: {
            $setOnInsert: {
              code,
              qrPayload: code,
              buyerName: '',
              phone: '',
              email: '',
              guests: 1,
              paymentStatus: 'Pending',
              amount: 0,
              notes: '',
              entered: false,
              enteredAt: '',
              registeredAt: '',
              updatedAt: now,
              updatedBy: 'System Init'
            }
          },
          upsert: true
        }
      }));
      await ticketsCollection.bulkWrite(ops);
      console.log('MongoDB successfully seeded with all 50 HOH ticket records.');
    }

    console.log(`Connected to MongoDB Atlas Database: "${DB_NAME}", Collection: "${COLLECTION_NAME}"`);
  } catch (err) {
    console.error('MongoDB connection error:', err);
  }
}

/**
 * Health check endpoint
 */
app.get('/api/health', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ ok: false, error: 'Database disconnected' });
    }
    const count = await ticketsCollection.countDocuments();
    return res.json({
      ok: true,
      database: 'MongoDB Atlas',
      cluster: 'Cluster0',
      dbName: DB_NAME,
      collection: COLLECTION_NAME,
      totalTickets: count,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Get all 50 tickets
 */
app.get('/api/tickets', async (req, res) => {
  try {
    const list = await ticketsCollection.find({}).sort({ code: 1 }).toArray();
    const map = {};
    list.forEach(item => {
      // Remove mongo _id for clean object
      const { _id, ...cleanItem } = item;
      map[cleanItem.code] = cleanItem;
    });
    return res.json({ ok: true, data: map, count: list.length });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Lookup single ticket
 */
app.get('/api/tickets/:code', async (req, res) => {
  try {
    const code = normalizeCode(req.params.code);
    const item = await ticketsCollection.findOne({ code });
    if (!item) {
      return res.status(404).json({ ok: false, error: `Ticket ${code} not found.` });
    }
    const { _id, ...cleanItem } = item;
    return res.json({ ok: true, data: cleanItem });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Register / Update Buyer Record (Atomic Upsert)
 */
app.post('/api/tickets/upsert', async (req, res) => {
  try {
    const record = req.body.record || req.body;
    if (!record || !record.code) {
      return res.status(400).json({ ok: false, error: 'Missing code in request body' });
    }

    const code = normalizeCode(record.code);
    if (!VALID_TICKET_CODES.includes(code)) {
      return res.status(400).json({ ok: false, error: `Invalid code ${code}. Range is HOH001 to HOH050.` });
    }

    const existing = await ticketsCollection.findOne({ code });
    const now = new Date().toISOString();
    const registeredAt = (existing && existing.registeredAt) ? existing.registeredAt : now;

    const updateDoc = {
      buyerName: String(record.buyerName || '').trim(),
      phone: String(record.phone || '').trim(),
      email: String(record.email || '').trim(),
      guests: Number(record.guests) || 1,
      paymentStatus: record.paymentStatus || 'Pending',
      amount: record.amount !== undefined ? Number(record.amount) : 0,
      notes: String(record.notes || '').trim(),
      registeredAt,
      updatedAt: now,
      updatedBy: record.updatedBy || 'Staff'
    };

    const result = await ticketsCollection.findOneAndUpdate(
      { code },
      { $set: updateDoc },
      { returnDocument: 'after', upsert: true }
    );

    const updated = result.value || result;
    const { _id, ...cleanItem } = updated || { code, ...updateDoc };

    return res.json({
      ok: true,
      data: cleanItem,
      message: `Buyer details saved to MongoDB for ticket ${code}!`
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Atomic Entry Verification with Duplicate Prevention (BR 05, BR 06)
 */
app.post('/api/tickets/mark-entered', async (req, res) => {
  try {
    const { code: rawCode, staffId } = req.body;
    const code = normalizeCode(rawCode);

    if (!VALID_TICKET_CODES.includes(code)) {
      return res.status(400).json({ ok: false, error: `Invalid ticket code ${code}` });
    }

    // First check ticket existence and buyer status
    const current = await ticketsCollection.findOne({ code });
    if (!current) {
      return res.status(404).json({ ok: false, error: `Ticket ${code} not found.` });
    }

    if (!current.buyerName || current.buyerName.trim() === '') {
      return res.status(400).json({
        ok: false,
        error: 'Admission denied: Ticket has no registered buyer.'
      });
    }

    if (current.paymentStatus === 'Cancelled' || current.paymentStatus === 'Refunded') {
      return res.status(400).json({
        ok: false,
        error: `Admission denied: Ticket is marked as ${current.paymentStatus}.`
      });
    }

    if (current.entered === true) {
      return res.status(409).json({
        ok: false,
        error: `Already Entered at ${current.enteredAt || 'earlier session'}. Duplicate admission blocked!`
      });
    }

    // Atomic update: only updates if entered is STILL false (prevents race condition)
    const now = new Date().toISOString();
    const updateResult = await ticketsCollection.findOneAndUpdate(
      { code, entered: false },
      {
        $set: {
          entered: true,
          enteredAt: now,
          updatedAt: now,
          updatedBy: staffId || 'Gate Staff'
        }
      },
      { returnDocument: 'after' }
    );

    const doc = updateResult.value || updateResult;
    if (!doc || doc.entered !== true) {
      // Race condition caught: another device marked it in between
      return res.status(409).json({
        ok: false,
        error: 'Concurrent admission detected: Ticket was just marked entered by another device.'
      });
    }

    const { _id, ...cleanDoc } = doc;
    return res.json({
      ok: true,
      data: cleanDoc,
      message: `Admission confirmed for ${code}! Marked Entered.`
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Reset all 50 tickets to initial unentered state (for dry-runs)
 */
app.post('/api/tickets/reset', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const ops = VALID_TICKET_CODES.map(code => ({
      updateOne: {
        filter: { code },
        update: {
          $set: {
            buyerName: '',
            phone: '',
            email: '',
            guests: 1,
            paymentStatus: 'Pending',
            amount: 0,
            notes: '',
            entered: false,
            enteredAt: '',
            registeredAt: '',
            updatedAt: now,
            updatedBy: 'Reset'
          }
        }
      }
    }));
    await ticketsCollection.bulkWrite(ops);
    return res.json({ ok: true, message: 'All 50 tickets reset to clean state in MongoDB.' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, async () => {
  console.log(`HOH Backend API server running on http://localhost:${PORT}`);
  await connectToMongo();
});
