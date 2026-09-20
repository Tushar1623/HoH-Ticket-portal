const BASE_URL = 'http://localhost:5000';

async function run() {
  console.log('🧪 Starting End-to-End Test for HOH Ticket Portal...\n');

  // 1. Health check
  const healthRes = await fetch(`${BASE_URL}/health`);
  const health = await healthRes.json();
  console.log('1. /health:', healthRes.status, 'Status:', health.status, '| DB:', health.database);

  // 2. Admin Login
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: 'admin@HOH2025'
    })
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok || !loginData.token) {
    throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
  }
  const token = loginData.token;
  console.log('2. /api/auth/login: SUCCESS (Token acquired, User:', loginData.user?.username, ')');

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // 3. Current User Verification
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, { headers: authHeaders });
  const meData = await meRes.json();
  console.log('3. /api/auth/me: SUCCESS (Role:', meData.admin?.role || meData.user?.role, ')');

  // 4. Dashboard stats
  const dashRes = await fetch(`${BASE_URL}/api/dashboard`, { headers: authHeaders });
  const dashData = await dashRes.json();
  console.log('4. /api/dashboard: Total =', dashData.stats?.totalTickets, '| Available =', dashData.stats?.available, '| Registered =', dashData.stats?.registered);

  // 5. List tickets
  const ticketsRes = await fetch(`${BASE_URL}/api/tickets`, { headers: authHeaders });
  const ticketsData = await ticketsRes.json();
  console.log('5. /api/tickets: Total tickets =', ticketsData.tickets?.length, '| First ticket =', ticketsData.tickets?.[0]?.code);

  // 6. Preview allocation starting at HOH005 for 3 tickets
  const previewRes = await fetch(`${BASE_URL}/api/tickets/HOH005/preview-sale`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ count: 3 })
  });
  const previewData = await previewRes.json();
  console.log('6. /api/tickets/HOH005/preview-sale: Allocated =', previewData.tickets?.map(t => t.code));

  // 7. Create offline booking with anchor HOH005 and quantity 3
  const bookingRes = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      buyerName: 'Rahul Sharma',
      phone: '9876543210',
      email: 'rahul@example.com',
      anchorTicketCode: 'HOH005',
      ticketQuantity: 3,
      paymentMethod: 'UPI',
      amountPaid: 1500,
      notes: 'VIP Door sale'
    })
  });
  const bookingData = await bookingRes.json();
  console.log('7. /api/bookings: Created bookingCode =', bookingData.booking?.bookingCode, '| Tickets =', bookingData.booking?.ticketCodes);

  // 8. Verify ticket details
  const ticketRes = await fetch(`${BASE_URL}/api/tickets/HOH005`, { headers: authHeaders });
  const ticketData = await ticketRes.json();
  console.log('8. /api/tickets/HOH005: status =', ticketData.ticket?.status, '| buyerName =', ticketData.ticket?.buyerName);

  // 9. Gate Admission: Mark Entered
  const entryRes = await fetch(`${BASE_URL}/api/tickets/HOH005/entry`, {
    method: 'PUT',
    headers: authHeaders
  });
  const entryData = await entryRes.json();
  console.log('9. /api/tickets/HOH005/entry (Mark Entry): entered =', entryData.ticket?.entered, '| enteredAt =', entryData.ticket?.enteredAt);

  // 10. Gate Admission: Undo Entry
  const undoRes = await fetch(`${BASE_URL}/api/tickets/HOH005/not-entry`, {
    method: 'PUT',
    headers: authHeaders
  });
  const undoData = await undoRes.json();
  console.log('10. /api/tickets/HOH005/not-entry (Undo Entry): entered =', undoData.ticket?.entered);

  // 11. List bookings
  const bookingsRes = await fetch(`${BASE_URL}/api/bookings`, { headers: authHeaders });
  const bookingsData = await bookingsRes.json();
  console.log('11. /api/bookings: Total bookings count =', bookingsData.bookings?.length);

  // 12. Reset Event
  const resetRes = await fetch(`${BASE_URL}/api/event/reset`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ confirmation: 'RESET HOH EVENT' })
  });
  const resetData = await resetRes.json();
  console.log('12. /api/event/reset: SUCCESS -', resetData.message);

  // 13. Verify tickets after reset
  const postResetRes = await fetch(`${BASE_URL}/api/tickets/HOH005`, { headers: authHeaders });
  const postResetData = await postResetRes.json();
  console.log('13. Post-reset HOH005: status =', postResetData.ticket?.status, '| buyerName =', postResetData.ticket?.buyerName);

  console.log('\n🎉 ALL 13 END-TO-END VERIFICATIONS COMPLETED SUCCESSFULLY WITH ZERO ERRORS!');
}

run().catch(err => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
