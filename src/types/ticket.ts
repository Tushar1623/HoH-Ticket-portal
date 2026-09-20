export type PaymentStatus = 'Pending' | 'Paid' | 'Complimentary' | 'Refunded' | 'Cancelled';

export type TicketStatus = 
  | 'VALID'
  | 'ALREADY_ENTERED'
  | 'NOT_REGISTERED'
  | 'INVALID'
  | 'CANCELLED';

export interface TicketRecord {
  code: string;           // e.g. 'HOH001'
  qrPayload?: string;     // Decoded QR content if different
  serialNumber?: number;  // 1 to 50
  bookingId?: string;
  bookingCode?: string;
  buyerName: string;
  phone: string;
  email?: string;
  guests: number;         // 1 to 10
  paymentStatus: PaymentStatus;
  amount?: number;
  notes?: string;
  status?: string;        // 'available' | 'reserved' | 'entered'
  entered: boolean;
  enteredAt?: string;     // ISO 8601 timestamp
  entryCount?: number;
  registeredAt?: string;  // ISO 8601 timestamp
  updatedAt: string;     // ISO 8601 timestamp
  updatedBy?: string;     // Staff identity/role
  bookingCreatedBy?: string;
}

export type StaffRole = 'entry' | 'sales' | 'manager' | 'admin';

export interface StaffSession {
  role: StaffRole;
  identity: string;
  passkey: string;
}

export interface PrepareResetResult {
  resetToken: string;
  expiresInSeconds: number;
  registeredCount: number;
  enteredCount: number;
}

export interface ConfirmResetResult {
  backupTab: string;
  clearedRows: number;
}

export type ConnectionMode = 'connected' | 'connecting' | 'device';

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
  requestId?: string;
}

export interface SummaryCounts {
  total: number;
  registered: number;
  available: number;
  entered: number;
  notEntered: number;
  totalGuests: number;
  totalRevenue: number;
}

