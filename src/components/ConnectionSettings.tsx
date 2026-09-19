import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, AlertCircle, RefreshCw, Copy, Check,
  ExternalLink, Database, Server, Zap, Table 
} from 'lucide-react';
import { ConnectionMode } from '../types/ticket';
import { getStoredScriptUrl, sheetClient } from '../lib/sheetClient';

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
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  useEffect(() => {
    setUrl(getStoredScriptUrl());
  }, []);

  const handleSaveAndTest = async () => {
    setTesting(true);
    setTestResult(null);

    const cleanUrl = url.trim();
    sheetClient.setScriptUrl(cleanUrl);

    if (!cleanUrl) {
      onConnectionChange('device');
      setTestResult({ ok: true, error: 'Switched to Device Mode (Local Storage).' });
      setTesting(false);
      return;
    }

    try {
      const res = await sheetClient.testConnection(cleanUrl);
      setTestResult(res);
      if (res.ok) {
        onConnectionChange('connected');
      } else {
        onConnectionChange('device');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setTestResult({ ok: false, error: errMsg });
      onConnectionChange('device');
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = () => {
    setUrl('');
    sheetClient.setScriptUrl('');
    setTestResult(null);
    onConnectionChange('device');
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
          <span>Google Sheet Backend Connection</span>
          <span className="text-xs bg-hoh-gold/20 text-hoh-gold-dark font-sans font-semibold px-2 py-0.5 rounded-full border border-hoh-gold/40">
            Live Integration
          </span>
        </h2>
        <p className="text-sm text-hoh-muted mt-0.5">
          Connect this portal to your production Google Sheet for real-time sales and gate admission syncing.
        </p>
      </div>

      {/* Target Sheet Card */}
      <div className="bg-gradient-to-r from-[#2A0C13] to-[#4A1622] text-white p-5 rounded-2xl border-2 border-hoh-gold/40 shadow-theatre flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-600/30 border border-emerald-400/40 flex items-center justify-center shrink-0">
            <Table className="w-6 h-6 text-emerald-300" />
          </div>
          <div>
            <div className="text-[11px] text-hoh-gold font-mono uppercase tracking-wider font-bold">
              Target Google Sheet Configured
            </div>
            <div className="font-bold text-base text-white">
              House of Humour &bull; Tickets Master
            </div>
            <div className="font-mono text-[11px] text-stone-300 mt-0.5 truncate max-w-sm sm:max-w-md">
              ID: {TARGET_SHEET_ID}
            </div>
          </div>
        </div>

        <a
          href={TARGET_SHEET_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-hoh-gold hover:bg-amber-400 text-stone-950 font-bold text-xs rounded-xl shadow-sm transition-colors shrink-0"
        >
          <span>Open Google Sheet</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Google Sheet Web App Connection Box */}
      <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-base text-hoh-burgundy flex items-center gap-2">
              <Server className="w-5 h-5 text-hoh-gold" />
              <span>Google Apps Script Web App Deployment URL</span>
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              Enter the Web App URL generated from your Google Sheet's Apps Script project.
            </p>
          </div>

          <div className="shrink-0">
            {url ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Configured</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                <span>Device Mode (Local)</span>
              </span>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="script-url" className="block text-xs font-semibold uppercase tracking-wider text-stone-700 mb-1.5">
            Web App URL (https://script.google.com/macros/s/.../exec)
          </label>
          <input
            id="script-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/AKfycbx.../exec"
            className="w-full px-4 py-3 rounded-xl border border-stone-300 font-mono text-sm focus:border-hoh-burgundy focus:ring-2 focus:ring-hoh-burgundy/20 placeholder-stone-400"
          />
        </div>

        {/* Test Result Message */}
        {testResult && (
          <div
            className={`p-4 rounded-xl text-xs sm:text-sm font-medium flex items-start gap-2.5 ${
              testResult.ok
                ? 'bg-emerald-50 border border-emerald-300 text-emerald-900'
                : 'bg-rose-50 border border-rose-300 text-rose-900'
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div>
              {testResult.ok ? (
                <div>
                  <strong>Sheet Connection Verified!</strong>
                  {testResult.latencyMs !== undefined && (
                    <span className="ml-2 font-mono text-xs opacity-80">
                      (Latency: {testResult.latencyMs} ms)
                    </span>
                  )}
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Ticket registrations and gate entry locks are now synchronized live with your Google Sheet.
                  </p>
                </div>
              ) : (
                <div>
                  <strong>Connection Status:</strong> {testResult.error}
                  <p className="text-xs text-rose-700 mt-0.5">
                    Check that the Apps Script deployment has "Who has access: Anyone" selected.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            disabled={testing}
            onClick={handleSaveAndTest}
            className="px-5 py-2.5 bg-hoh-burgundy hover:bg-hoh-burgundy-light text-white font-semibold text-xs rounded-xl shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {testing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-hoh-gold" />
                <span>Verifying Endpoint...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 text-hoh-gold" />
                <span>Save & Test Connection</span>
              </>
            )}
          </button>

          {url && (
            <button
              type="button"
              onClick={handleDisconnect}
              className="px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold text-xs rounded-xl transition-colors"
            >
              Disconnect & Use Device Mode
            </button>
          )}
        </div>
      </div>

      {/* Step-by-step Setup Guide */}
      <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-base text-hoh-burgundy flex items-center gap-2">
            <Table className="w-5 h-5 text-hoh-gold" />
            <span>How to Connect Your Google Sheet in 30 Seconds</span>
          </h3>

          <button
            type="button"
            onClick={handleCopyScript}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-900 text-xs font-bold rounded-lg transition-colors border border-stone-300"
          >
            {copiedCode ? (
              <>
                <Check className="w-4 h-4 text-emerald-600" />
                <span>Copied Code.gs!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-hoh-burgundy" />
                <span>Copy Apps Script Code</span>
              </>
            )}
          </button>
        </div>

        <ol className="list-decimal list-inside space-y-3 text-sm text-stone-700">
          <li className="p-3 bg-stone-50 rounded-xl">
            Open your Google Sheet:{' '}
            <a
              href={TARGET_SHEET_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-hoh-burgundy underline hover:text-hoh-gold-dark"
            >
              Open Sheet (1nJAMZQnqbsyciIHz-x4xaRiNzgcRPK861ae1No-tBGI)
            </a>
          </li>
          <li className="p-3 bg-stone-50 rounded-xl">
            In the top menu, click <strong>Extensions &rarr; Apps Script</strong>.
          </li>
          <li className="p-3 bg-stone-50 rounded-xl">
            Click <strong>"Copy Apps Script Code"</strong> above, paste it into the editor (replacing any existing code), and save (<kbd className="bg-stone-200 px-1.5 py-0.5 rounded text-xs font-mono font-bold">Ctrl+S</kbd>).
          </li>
          <li className="p-3 bg-stone-50 rounded-xl">
            In the toolbar function dropdown, select <code className="text-xs bg-stone-200 px-1.5 py-0.5 rounded font-bold text-hoh-burgundy">initSheet</code> and click <strong>Run</strong>.
            <p className="text-xs text-stone-500 mt-1">
              (Grant permission if prompted. This will automatically format headers and create all 50 rows from <span className="font-mono font-bold">HOH001</span> to <span className="font-mono font-bold">HOH050</span> in your Google Sheet!)
            </p>
          </li>
          <li className="p-3 bg-stone-50 rounded-xl">
            Click <strong>Deploy &rarr; New Deployment</strong>:
            <ul className="list-disc list-inside mt-1 ml-4 space-y-0.5 text-xs text-stone-600 font-medium">
              <li>Type: <strong>Web App</strong></li>
              <li>Execute as: <strong>Me</strong></li>
              <li>Who has access: <strong>Anyone</strong></li>
            </ul>
          </li>
          <li className="p-3 bg-stone-50 rounded-xl">
            Copy the <strong>Web App URL</strong>, paste it into the input above, and click <strong>Save & Test Connection</strong>!
          </li>
        </ol>
      </div>

      {/* Dry Run / Reset Box */}
      <div className="bg-stone-50 rounded-2xl border border-stone-300 p-5">
        <h3 className="font-bold text-sm text-stone-900 flex items-center gap-2 mb-1">
          <Database className="w-4 h-4 text-hoh-burgundy" />
          <span>Local Device Data Reset</span>
        </h3>
        <p className="text-xs text-stone-600 mb-3">
          Clear local test bookings and reset all 50 tickets to clean unentered status before doors open.
        </p>

        <button
          type="button"
          onClick={() => {
            if (window.confirm('Reset all local tickets HOH001-HOH050 to initial unentered state?')) {
              onResetDatabase();
            }
          }}
          className="px-4 py-2 bg-stone-200 hover:bg-rose-100 hover:text-rose-900 text-stone-700 font-bold text-xs rounded-xl transition-colors border border-stone-300"
        >
          Reset Local Database
        </button>
      </div>
    </div>
  );
};
