import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function dropSampleMflix() {
  console.log('=====================================================');
  console.log('🧹 SAFE ATLAS CLEANUP — DROPPING sample_mflix');
  console.log('=====================================================');

  const uri = process.env.MONGO_URL || process.env.MONGODB_URI;

  if (!uri || uri.includes('<db_password>')) {
    console.error('❌ Error: Please provide your MongoDB Atlas password in .env (MONGO_URL) before running this script.');
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(uri);
    const adminDb = conn.connection.db?.admin();

    if (!adminDb) {
      throw new Error('Admin database handle not accessible.');
    }

    const dbs = await adminDb.listDatabases();
    const dbNames = dbs.databases.map((d: any) => d.name);

    console.log(`\n📦 Existing databases found on cluster: [${dbNames.join(', ')}]`);

    if (!dbNames.includes('sample_mflix')) {
      console.log('✅ sample_mflix is not present on this cluster. Nothing to drop.');
    } else {
      console.log('⚠️ Confirmed: sample_mflix is completely unrelated to HOH Ticket Portal.');
      console.log('🔒 Preserving: [hoh_tickets_db, admin, local]');
      console.log('🗑️ Dropping database: sample_mflix...');

      const sampleDb = conn.connection.client.db('sample_mflix');
      await sampleDb.dropDatabase();
      console.log('✨ SUCCESS: sample_mflix dropped! ~154.64 MB of storage reclaimed.');
    }

    // Report final databases
    const finalDbs = await adminDb.listDatabases();
    console.log('\n📊 Current cluster databases and sizes:');
    finalDbs.databases.forEach((d: any) => {
      console.log(`   - ${d.name}: ${(d.sizeOnDisk / 1024).toFixed(1)} KB`);
    });

  } catch (err: any) {
    console.error('❌ Failed to drop sample_mflix:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

dropSampleMflix();
