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
  buyerName: string;
  phone: string;
  email?: string;
  guests: number;         // 1 to 10
  paymentStatus: PaymentStatus;
  amount?: number;
  notes?: string;
  entered: boolean;
  enteredAt?: string;     // ISO 8601 timestamp
  registeredAt?: string;  // ISO 8601 timestamp
  updatedAt: string;     // ISO 8601 timestamp
  updatedBy?: string;     // Staff identity/role
}

export type StaffRole = 'sales' | 'entry' | 'admin';

export type ConnectionMode = 'connected' | 'connecting' | 'device';

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
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
