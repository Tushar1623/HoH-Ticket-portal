export interface InMemoryTicket {
  code: string;
  serialNumber: number;
  qrPayload: string;
  bookingId: string | null;
  status: 'available' | 'reserved' | 'active' | 'entered';
  entered: boolean;
  enteredAt: string | null;
  entryCount: number;
  buyerName: string;
  buyerPhone: string;
  buyerEmail: string;
  bookingCode: string;
  paymentStatus: 'Pending' | 'Paid' | 'Complimentary' | 'Refunded' | 'Cancelled';
  totalAmount: number;
  bookingCreatedBy: string;
  updatedAt: string;
}

const memoryTickets: InMemoryTicket[] = [];

function initMemoryTickets() {
  if (memoryTickets.length === 50) return;
  memoryTickets.length = 0;
  const now = new Date().toISOString();
  for (let i = 1; i <= 50; i++) {
    const code = `HOH${String(i).padStart(3, '0')}`;
    memoryTickets.push({
      code,
      serialNumber: i,
      qrPayload: code,
      bookingId: null,
      status: 'available',
      entered: false,
      enteredAt: null,
      entryCount: 0,
      buyerName: '',
      buyerPhone: '',
      buyerEmail: '',
      bookingCode: '',
      paymentStatus: 'Pending',
      totalAmount: 0,
      bookingCreatedBy: '',
      updatedAt: now
    });
  }
}

initMemoryTickets();

export function getMemoryTickets(): InMemoryTicket[] {
  initMemoryTickets();
  return [...memoryTickets];
}

export function getMemoryTicketByCode(code: string): InMemoryTicket | undefined {
  initMemoryTickets();
  return memoryTickets.find(t => t.code.toUpperCase() === code.trim().toUpperCase());
}

export function updateMemoryTicket(code: string, patch: Partial<InMemoryTicket>): InMemoryTicket | null {
  initMemoryTickets();
  const ticket = memoryTickets.find(t => t.code.toUpperCase() === code.trim().toUpperCase());
  if (!ticket) return null;
  Object.assign(ticket, patch, { updatedAt: new Date().toISOString() });
  return ticket;
}

export function resetMemoryTickets(): void {
  memoryTickets.length = 0;
  initMemoryTickets();
}
