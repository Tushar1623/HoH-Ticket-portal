import React from 'react';
import { CheckCircle2, Clock, XCircle, AlertCircle, Ban, Sparkles, UserX } from 'lucide-react';
import { PaymentStatus, TicketStatus } from '../types/ticket';

interface PaymentBadgeProps {
  status: PaymentStatus;
  size?: 'sm' | 'md';
}

export const PaymentBadge: React.FC<PaymentBadgeProps> = ({ status, size = 'md' }) => {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs font-semibold';

  switch (status) {
    case 'Paid':
      return (
        <span className={`inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-medium ${sizeClasses}`}>
          <CheckCircle2 className="w-3 h-3 text-emerald-700" />
          <span>Paid</span>
        </span>
      );
    case 'Pending':
      return (
        <span className={`inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-medium ${sizeClasses}`}>
          <Clock className="w-3 h-3 text-amber-700" />
          <span>Pending</span>
        </span>
      );
    case 'Complimentary':
      return (
        <span className={`inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-900 border border-purple-300 font-medium ${sizeClasses}`}>
          <Sparkles className="w-3 h-3 text-purple-700" />
          <span>Complimentary</span>
        </span>
      );
    case 'Refunded':
      return (
        <span className={`inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-700 border border-gray-300 font-medium ${sizeClasses}`}>
          <XCircle className="w-3 h-3 text-gray-500" />
          <span>Refunded</span>
        </span>
      );
    case 'Cancelled':
      return (
        <span className={`inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-800 border border-rose-300 font-medium ${sizeClasses}`}>
          <Ban className="w-3 h-3 text-rose-700" />
          <span>Cancelled</span>
        </span>
      );
    default:
      return (
        <span className={`inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-700 ${sizeClasses}`}>
          {status}
        </span>
      );
  }
};

interface EntryBadgeProps {
  entered: boolean;
  size?: 'sm' | 'md';
  enteredAt?: string;
}

export const EntryBadge: React.FC<EntryBadgeProps> = ({ entered, size = 'md', enteredAt }) => {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs font-semibold';

  if (entered) {
    return (
      <div className="flex flex-col gap-0.5 items-start">
        <span className={`inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold ${sizeClasses}`}>
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
          <span>Entered</span>
        </span>
        {enteredAt && (
          <span className="text-[10px] text-stone-500 font-mono pl-1">
            {enteredAt.length > 19 ? enteredAt.slice(11, 16) : enteredAt}
          </span>
        )}
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-stone-100 text-stone-600 border border-stone-200 font-medium ${sizeClasses}`}>
      <Clock className="w-3 h-3 text-stone-400" />
      <span>Not Entered</span>
    </span>
  );
};


interface TicketStatusBannerProps {
  status: TicketStatus;
  enteredAt?: string;
  className?: string;
}

export const TicketStatusBanner: React.FC<TicketStatusBannerProps> = ({ status, enteredAt, className = '' }) => {
  switch (status) {
    case 'VALID':
      return (
        <div className={`flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border-2 border-emerald-500 text-emerald-950 ${className}`}>
          <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <div className="font-bold text-base flex items-center gap-1.5">
              <span>Valid Ticket</span>
              <span className="text-xs bg-emerald-200/80 text-emerald-900 px-2 py-0.5 rounded font-semibold uppercase tracking-wider">Approved</span>
            </div>
            <p className="text-xs text-emerald-800 mt-0.5">Ticket registered and ready for venue admission.</p>
          </div>
        </div>
      );

    case 'ALREADY_ENTERED':
      return (
        <div className={`flex items-start gap-3 p-4 rounded-xl bg-rose-50 border-2 border-rose-600 text-rose-950 animate-pulse ${className}`}>
          <div className="w-10 h-10 rounded-full bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <Ban className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <div className="font-bold text-base text-rose-900 flex items-center gap-1.5">
              <span>Already Entered</span>
              <span className="text-xs bg-rose-200 text-rose-900 px-2 py-0.5 rounded font-semibold uppercase tracking-wider">Duplicate Scan</span>
            </div>
            <p className="text-xs text-rose-800 font-medium mt-1">
              Admitted on: <strong className="font-bold text-rose-950">{enteredAt || 'Earlier Session'}</strong>
            </p>
            <p className="text-xs text-rose-700 mt-0.5">This ticket has already been used. Do not admit a second time.</p>
          </div>
        </div>
      );

    case 'NOT_REGISTERED':
      return (
        <div className={`flex items-center gap-3 p-4 rounded-xl bg-amber-50 border-2 border-amber-500 text-amber-950 ${className}`}>
          <div className="w-10 h-10 rounded-full bg-amber-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <UserX className="w-6 h-6" />
          </div>
          <div>
            <div className="font-bold text-base flex items-center gap-1.5">
              <span>Not Registered</span>
              <span className="text-xs bg-amber-200 text-amber-900 px-2 py-0.5 rounded font-semibold uppercase tracking-wider">No Buyer</span>
            </div>
            <p className="text-xs text-amber-800 mt-0.5">Valid ticket code, but no buyer is assigned yet. Direct to registration desk.</p>
          </div>
        </div>
      );

    case 'CANCELLED':
      return (
        <div className={`flex items-center gap-3 p-4 rounded-xl bg-red-50 border-2 border-red-500 text-red-950 ${className}`}>
          <div className="w-10 h-10 rounded-full bg-red-700 text-white flex items-center justify-center shrink-0 shadow-sm">
            <XCircle className="w-6 h-6" />
          </div>
          <div>
            <div className="font-bold text-base text-red-900">Cancelled / Refunded Ticket</div>
            <p className="text-xs text-red-800 mt-0.5">This booking has been cancelled or refunded. Do not admit.</p>
          </div>
        </div>
      );

    case 'INVALID':
    default:
      return (
        <div className={`flex items-center gap-3 p-4 rounded-xl bg-rose-50 border-2 border-rose-400 text-rose-950 ${className}`}>
          <div className="w-10 h-10 rounded-full bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <div className="font-bold text-base text-rose-900">Invalid Ticket Code</div>
            <p className="text-xs text-rose-800 mt-0.5">Code does not match approved range (HOH001 – HOH050).</p>
          </div>
        </div>
      );
  }
};
