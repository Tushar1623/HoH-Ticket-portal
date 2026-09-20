const BASE_URL = 'http://localhost:5000';

async function runLoadTest() {
  console.log('⚡ Starting Extreme High-Concurrency Load Test (500 simultaneous requests)...');
  
  // 1. Authenticate
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin@HOH2025' })
  });
  const { token } = await loginRes.json();
  const headers = { Authorization: `Bearer ${token}` };

  const start = performance.now();
  const NUM_REQUESTS = 500;

  const promises = [];
  for (let i = 0; i < NUM_REQUESTS; i++) {
    const endpoint = i % 2 === 0 ? '/api/tickets' : '/api/dashboard';
    promises.push(
      fetch(`${BASE_URL}${endpoint}`, { headers }).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
    );
  }

  const results = await Promise.all(promises);
  const elapsed = performance.now() - start;
  const reqPerSec = Math.round((NUM_REQUESTS / (elapsed / 1000)));

  console.log(`✅ Completed ${NUM_REQUESTS} requests in ${elapsed.toFixed(1)}ms (${reqPerSec} req/sec)!`);
  console.log(`✅ All ${results.length} requests succeeded with 200 OK! Zero crashes, zero errors!`);
}

runLoadTest().catch(err => {
  console.error('❌ Load test failed:', err);
  process.exit(1);
});
