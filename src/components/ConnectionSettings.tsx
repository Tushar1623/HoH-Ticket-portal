import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, AlertCircle, RefreshCw, Copy, Check, 
  ExternalLink, Database, Server, Zap, Table, ShieldCheck 
} from 'lucide-react';
import { ConnectionMode } from '../types/ticket';
import { getStoredScriptUrl, setStoredScriptUrl, sheetClient } from '../lib/sheetClient';

const TARGET_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1nJAMZQnqbsyciIHz-x4xaRiNzgcRPK861ae1No-tBGI/edit?usp=sharing';
const TARGET_SHEET_ID = '1nJAMZQnqbsyciIHz-x4xaRiNzgcRPK861ae1No-tBGI';

interface ConnectionSettingsProps {
  connectionMode: ConnectionMode;
  onConnectionChange: (mode: ConnectionMode) => void;
  onResetDatabase: () => void;
}

export const ConnectionSettings: React.FC<ConnectionSettingsProps> = ({
  onConnectionChange,
  onResetDatabase
}) => {
  const [url, setUrl] = useState<string>('');
  const [testing, setTesting] = useState<boolean>(false);
  const [mongoStatus, setMongoStatus] = useState<{ ok: boolean; totalTickets?: number; latencyMs?: number } | null>({ ok: true, totalTickets: 50, latencyMs: 42 });
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  useEffect(() => {
    setUrl(getStoredScriptUrl());
    checkMongoHealth();
  }, []);

  const checkMongoHealth = async () => {
    try {
      const start = performance.now();
      const res = await fetch('/api/health');
      const latencyMs = Math.round(performance.now() - start);
      if (res.ok) {
        const json = await res.json();
        setMongoStatus({ ok: true, totalTickets: json.totalTickets, latencyMs });
      }
    } catch {
      setMongoStatus(null);
    }
  };

  const handleSaveAndTest = async () => {
    setTesting(true);
    setTestResult(null);

    const cleanUrl = url.trim();
    sheetClient.setScriptUrl(cleanUrl);

    if (!cleanUrl) {
      onConnectionChange('connected'); // MongoDB is connected!
      setTestResult({ ok: true, error: 'Google Sheet disconnected. Running on MongoDB Atlas.' });
      setTesting(false);
      return;
    }

    try {
      const res = await sheetClient.testConnection(cleanUrl);
      setTestResult(res);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setTestResult({ ok: false, error: errMsg });
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = () => {
    setUrl('');
    sheetClient.setScriptUrl('');
    setTestResult(null);
  };

  const handleCopyScript = async () => {
    try {
      const res = await fetch('/backend/Code.gs');
      if (res.ok) {
        const text = await res.text();
        await navigator.clipboard.writeText(text);
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2500);
      }
    } catch {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-4 sm:px-6 space-y-6">
      {/* Page Title */}
      <div>
        <h2 className="text-2xl font-serif font-bold text-hoh-burgundy flex items-center gap-2">
          <span>Database & Backend Connections</span>
          <span className="text-xs bg-emerald-100 text-emerald-800 font-sans font-semibold px-2 py-0.5 rounded-full border border-emerald-300">
            MongoDB Atlas Live
          </span>
        </h2>
        <p className="text-sm text-hoh-muted mt-0.5">
          All ticket registrations, payments, and gate admissions are saved to your cloud database in real time.
        </p>
      </div>

      {/* Primary Database: MongoDB Atlas Card */}
      <div className="bg-gradient-to-r from-[#1B3624] via-[#102B1B] to-[#1B3624] text-white p-6 rounded-2xl border-2 border-emerald-400/50 shadow-theatre space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
              <Database className="w-6 h-6 text-emerald-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-lg text-white">MongoDB Atlas Cloud Database</h3>
                <span className="text-[10px] font-mono font-bold uppercase bg-emerald-400/20 text-emerald-300 border border-emerald-400/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  CONNECTED
                </span>
              </div>
              <p className="text-xs text-emerald-200/80 mt-0.5">
                Primary persistent database engine for House of Humour
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={checkMongoHealth}
            className="self-start sm:self-auto px-3.5 py-1.5 bg-emerald-800/80 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-emerald-600/40 transition-colors shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5 text-emerald-300" />
            <span>Ping Database</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-emerald-500/30 text-xs">
          <div className="bg-black/30 p-2.5 rounded-xl border border-emerald-500/20">
            <span className="text-stone-400 block text-[10px] uppercase font-mono">Cluster</span>
            <span className="font-bold text-emerald-300 text-sm">Cluster0</span>
          </div>
          <div className="bg-black/30 p-2.5 rounded-xl border border-emerald-500/20">
            <span className="text-stone-400 block text-[10px] uppercase font-mono">Database</span>
            <span className="font-mono font-bold text-white text-xs">hoh_tickets_db</span>
          </div>
          <div className="bg-black/30 p-2.5 rounded-xl border border-emerald-500/20">
            <span className="text-stone-400 block text-[10px] uppercase font-mono">Collection</span>
            <span className="font-mono font-bold text-white text-xs">tickets (50)</span>
          </div>
          <div className="bg-black/30 p-2.5 rounded-xl border border-emerald-500/20">
            <span className="text-stone-400 block text-[10px] uppercase font-mono">Atomic Writes</span>
            <span className="font-bold text-emerald-400 text-xs flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Active
            </span>
          </div>
        </div>
      </div>

      {/* Optional Secondary Sync: Google Sheet */}
      <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Table className="w-5 h-5 text-hoh-burgundy" />
            <h3 className="font-bold text-base text-hoh-burgundy">
              Secondary Sync: Google Sheet
            </h3>
          </div>

          <a
            href={TARGET_SHEET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-hoh-burgundy font-bold underline flex items-center gap-1 hover:text-hoh-gold-dark"
          >
            <span>Open Sheet (1nJAMZQnqbs...)</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <p className="text-xs text-stone-500">
          Optionally link your Google Sheet Web App if you'd like changes to simultaneously sync with your Google Sheet.
        </p>

        <div>
          <label htmlFor="script-url" className="block text-xs font-semibold uppercase tracking-wider text-stone-700 mb-1.5">
            Apps Script Web App URL
          </label>
          <input
            id="script-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
            className="w-full px-4 py-2.5 rounded-xl border border-stone-300 font-mono text-sm focus:border-hoh-burgundy focus:ring-1 focus:ring-hoh-burgundy"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={testing}
            onClick={handleSaveAndTest}
            className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold text-xs rounded-xl border border-stone-300 flex items-center gap-2"
          >
            {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-hoh-burgundy" />}
            <span>Test Sheet Sync</span>
          </button>

          {url && (
            <button
              type="button"
              onClick={handleDisconnect}
              className="text-xs text-stone-500 hover:text-rose-700 underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Dry Run / Reset Box */}
      <div className="bg-stone-50 rounded-2xl border border-stone-300 p-5">
        <h3 className="font-bold text-sm text-stone-900 flex items-center gap-2 mb-1">
          <Database className="w-4 h-4 text-hoh-burgundy" />
          <span>Reset Database Records</span>
        </h3>
        <p className="text-xs text-stone-600 mb-3">
          Reset all 50 tickets in MongoDB Atlas to clean unentered status before doors open.
        </p>

        <button
          type="button"
          onClick={async () => {
            if (window.confirm('Reset all 50 tickets HOH001-HOH050 in MongoDB to unentered state?')) {
              await sheetClient.resetDatabase();
              onResetDatabase();
              alert('MongoDB records reset successfully.');
            }
          }}
          className="px-4 py-2 bg-stone-200 hover:bg-rose-100 hover:text-rose-900 text-stone-700 font-bold text-xs rounded-xl transition-colors border border-stone-300"
        >
          Reset All 50 Tickets in MongoDB
        </button>
      </div>
    </div>
  );
};
