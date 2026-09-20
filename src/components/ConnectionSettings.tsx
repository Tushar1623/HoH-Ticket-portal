import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, AlertCircle, RefreshCw,
  Database, Server, ShieldCheck, Check, Info, Lock,
  Trash2, Sparkles, HardDrive
} from 'lucide-react';
import { ConnectionMode } from '../types/ticket';
import { apiClient } from '../lib/apiClient';

interface ConnectionSettingsProps {
  connectionMode: ConnectionMode;
  onConnectionChange: (mode: ConnectionMode) => void;
  onResetDatabase: () => void;
}

export const ConnectionSettings: React.FC<ConnectionSettingsProps> = ({
  connectionMode,
  onConnectionChange,
  onResetDatabase
}) => {
  const [testing, setTesting] = useState<boolean>(false);
  const [cleaning, setCleaning] = useState<boolean>(false);
  const [cleanFeedback, setCleanFeedback] = useState<{
    success: boolean;
    message: string;
    stats?: any;
  } | null>(null);

  const [healthStatus, setHealthStatus] = useState<{
    ok: boolean;
    timestamp?: string;
    service?: string;
    error?: string;
  } | null>(null);

  const checkHealth = async () => {
    setTesting(true);
    setHealthStatus(null);
    try {
      const res = await fetch('/health');
      if (res.ok) {
        const json = await res.json();
        setHealthStatus({ ok: true, timestamp: json.timestamp, service: json.service });
        onConnectionChange('connected');
      } else {
        setHealthStatus({ ok: false, error: `HTTP ${res.status}: Server returned error` });
        onConnectionChange('device');
      }
    } catch (err: any) {
      setHealthStatus({ ok: false, error: err.message || 'Cannot reach Express API server' });
      onConnectionChange('device');
    } finally {
      setTesting(false);
    }
  };

  const handleCleanDatabase = async () => {
    if (!window.confirm('Are you sure you want to clean and compact the MongoDB database? This will purge bloated collections, reclaim disk storage, and re-seed 50 clean tickets.')) {
      return;
    }

    setCleaning(true);
    setCleanFeedback(null);
    try {
      const session = apiClient.getSession();
      const res = await fetch('/api/admin/clean-database', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Staff-Passkey': session.passkey || ''
        }
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setCleanFeedback({
          success: true,
          message: json.message || 'Database cleaned and compacted successfully!',
          stats: json.storageStats
        });
        onResetDatabase();
      } else {
        setCleanFeedback({
          success: false,
          message: json.error || 'Failed to clean database. Ensure Admin authorization.'
        });
      }
    } catch (err: any) {
      setCleanFeedback({
        success: false,
        message: err.message || 'Error connecting to database clean service.'
      });
    } finally {
      setCleaning(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-4 sm:px-6 space-y-6">
      {/* Page Title */}
      <div>
        <h2 className="text-2xl font-serif font-bold text-hoh-burgundy flex items-center gap-2">
          <span>MongoDB Atlas Backend & Server Health</span>
          <span className="text-xs bg-hoh-gold/20 text-hoh-gold-dark font-sans font-semibold px-2 py-0.5 rounded-full border border-hoh-gold/40">
            Node.js + Express
          </span>
        </h2>
        <p className="text-sm text-hoh-muted mt-0.5">
          Ultra-compact schema & storage optimization engine for MongoDB Atlas Free Tier.
        </p>
      </div>

      {/* MongoDB Cluster Card */}
      <div className="bg-gradient-to-r from-[#2A0C13] to-[#4A1622] text-white p-5 rounded-2xl border-2 border-hoh-gold/40 shadow-theatre flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-600/30 border border-emerald-400/40 flex items-center justify-center shrink-0">
            <Database className="w-6 h-6 text-emerald-300" />
          </div>
          <div>
            <div className="text-[11px] text-hoh-gold font-mono uppercase tracking-wider font-bold">
              Database Engine Active
            </div>
            <div className="font-bold text-base text-white">
              MongoDB Atlas &bull; Cluster0
            </div>
            <div className="font-mono text-[11px] text-stone-300 mt-0.5 truncate max-w-sm sm:max-w-md">
              Target: cluster0.ljtgvll.mongodb.net (hoh_tickets)
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={checkHealth}
          disabled={testing}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-hoh-gold hover:bg-amber-400 text-stone-950 font-bold text-xs rounded-xl shadow-sm transition-colors shrink-0 disabled:opacity-50"
        >
          {testing ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Pinging Backend...</span>
            </>
          ) : (
            <>
              <Server className="w-3.5 h-3.5" />
              <span>Ping API Server</span>
            </>
          )}
        </button>
      </div>

      {/* Health Status Banner */}
      {healthStatus && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-sm ${
            healthStatus.ok
              ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
              : 'bg-amber-50 border-amber-300 text-amber-950'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {healthStatus.ok ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            )}
            <div>
              <strong>{healthStatus.ok ? 'Backend API Server Connected (Port 5000)' : 'API Server Not Connected'}</strong>
              {healthStatus.timestamp && (
                <span className="block text-xs text-stone-500 font-mono">
                  Verified at: {new Date(healthStatus.timestamp).toLocaleTimeString()}
                </span>
              )}
              {healthStatus.error && (
                <span className="block text-xs text-amber-800 font-mono mt-0.5">
                  {healthStatus.error}
                </span>
              )}
            </div>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
            healthStatus.ok ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-200 text-amber-900'
          }`}>
            {healthStatus.ok ? 'HTTP 200 OK' : 'OFFLINE'}
          </span>
        </div>
      )}

      {/* Clean Database & Storage Reclaim Section */}
      <div className="bg-white p-5 rounded-2xl border-2 border-stone-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-100">
          <div>
            <h3 className="text-base font-serif font-bold text-hoh-burgundy flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-hoh-gold" />
              <span>Storage Optimization & Database Clean</span>
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Purge bloated legacy collections, remove audit snapshots, and compact schema down to minimum bytes.
            </p>
          </div>

          <button
            type="button"
            onClick={handleCleanDatabase}
            disabled={cleaning}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-hoh-burgundy hover:bg-hoh-burgundy-light text-white font-bold text-xs rounded-xl shadow transition-colors shrink-0 disabled:opacity-50 cursor-pointer"
          >
            {cleaning ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-hoh-gold" />
                <span>Compacting & Cleaning...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4 text-hoh-gold" />
                <span>Purge Bloat & Clean MongoDB</span>
              </>
            )}
          </button>
        </div>

        {cleanFeedback && (
          <div
            className={`p-4 rounded-xl border text-xs ${
              cleanFeedback.success
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                : 'bg-rose-50 border-rose-300 text-rose-950'
            }`}
          >
            <div className="font-bold text-sm mb-1">{cleanFeedback.message}</div>
            {cleanFeedback.stats && (
              <div className="mt-2 pt-2 border-t border-emerald-200 font-mono flex flex-wrap gap-4 text-emerald-900">
                <span>Storage Size: <strong>{cleanFeedback.stats.storageSize}</strong></span>
                <span>Data Size: <strong>{cleanFeedback.stats.dataSize}</strong></span>
                <span>Active Documents: <strong>{cleanFeedback.stats.objects}</strong></span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Architecture & Security Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Core Principles */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm space-y-3">
          <h3 className="text-sm font-bold text-hoh-burgundy flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-hoh-gold" />
            <span>Zero-Bloat Schema Guarantees</span>
          </h3>
          <ul className="text-xs text-stone-700 space-y-2 leading-relaxed">
            <li className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>Primary Key as Code:</strong> `_id: "HOH001"` eliminates redundant ObjectId and secondary unique index overhead.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>No Unbounded Embedded Arrays:</strong> Tickets do not embed infinite history arrays, preventing disk fragmentation.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>14-Day TTL Auto-Pruning:</strong> Audit logs automatically expire and purge, preventing Atlas 512MB quota exhaustion.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>O(1) Gate Verification:</strong> Single B-tree lookup directly on the ticket pass with zero join or populate overhead.</span>
            </li>
          </ul>
        </div>

        {/* Collections & Model Schema */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm space-y-3">
          <h3 className="text-sm font-bold text-hoh-burgundy flex items-center gap-2">
            <Database className="w-4 h-4 text-hoh-gold" />
            <span>Optimized Collections</span>
          </h3>
          <div className="space-y-2 text-xs">
            <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-200 font-mono">
              <span className="font-bold text-hoh-burgundy">tickets</span>
              <p className="text-[11px] text-stone-500 font-sans mt-0.5">
                50 fixed lean documents (`_id: "HOH001"`) with direct buyer details and gate admission state.
              </p>
            </div>
            <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-200 font-mono">
              <span className="font-bold text-hoh-burgundy">bookings</span>
              <p className="text-[11px] text-stone-500 font-sans mt-0.5">
                Compact order summary: `_id: "HOH-BOOK-000001"`, buyer contact, and seat list.
              </p>
            </div>
            <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-200 font-mono">
              <span className="font-bold text-hoh-burgundy">audit_logs (TTL Index)</span>
              <p className="text-[11px] text-stone-500 font-sans mt-0.5">
                Compact string deltas with automatic 14-day auto-purge. Zero large snapshot dumps.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Staff Passkey Reference */}
      <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm space-y-3">
        <h3 className="text-sm font-bold text-hoh-burgundy flex items-center gap-2">
          <Lock className="w-4 h-4 text-hoh-gold" />
          <span>Role-Based Passkey & Authorization Matrix</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-center">
            <span className="font-bold block text-hoh-burgundy">Super Admin</span>
            <span className="font-mono text-[11px] text-stone-600">hoh-admin-2025</span>
            <span className="text-[10px] text-emerald-600 block mt-1 font-semibold">Full Access & Reset</span>
          </div>
          <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-center">
            <span className="font-bold block text-hoh-burgundy">Event Manager</span>
            <span className="font-mono text-[11px] text-stone-600">hoh-mgr-2025</span>
            <span className="text-[10px] text-emerald-600 block mt-1 font-semibold">Corrections & Clears</span>
          </div>
          <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-center">
            <span className="font-bold block text-hoh-burgundy">Box Office Sales</span>
            <span className="font-mono text-[11px] text-stone-600">hoh-sales-2025</span>
            <span className="text-[10px] text-emerald-600 block mt-1 font-semibold">Buyer Registration</span>
          </div>
          <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-center">
            <span className="font-bold block text-hoh-burgundy">Gate Scanner</span>
            <span className="font-mono text-[11px] text-stone-600">hoh-door-2025</span>
            <span className="text-[10px] text-emerald-600 block mt-1 font-semibold">Door Verification</span>
          </div>
        </div>
      </div>
    </div>
  );
};
